import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/index';
import {
  cmsDeploymentService,
  type DeploymentConfig,
  type DeploymentResult,
  type RemediationPayload,
} from '../services/deployment/cmsDeploymentService';
import {
  CmsDeploymentModal,
  DeploymentResultAlert,
  deploymentResultHeading,
} from '../components/audit/CmsDeploymentModal';

/**
 * Track SW, SW0a-17: the deploy screen tells the truth.
 *
 * The WordPress tests run the real client against the real Worker route. Only the network is
 * fake: a WordPress site that answers 200, a resolver, and the site's home page. A site whose
 * plugin registers the setting prints the schema on the page; a site without one accepts the
 * request and changes nothing, which is the case the screen used to call "deployed".
 */

const botToken = '123456:DEPLOY_TRUTH_TEST';
const DOH = 'https://cloudflare-dns.com/dns-query';
const WP_SETTINGS = 'https://my-site.com/wp-json/wp/v2/settings';
const SITE_HOME = 'https://my-site.com/';
const READBACK = 'https://luminarasuite.com/api/deploy/readback';
const WP_PASSWORD = 'owner:abcd efgh ijkl mnop';

/** Wording that tells the reader the change is on the site now. */
const SAYS_LIVE = /\bdeployed\b|\bpublished\b|\bis (?:now )?live\b|\bwent live\b|\bin production\b/i;
const UNCHECKED_WORDS = /autonomous|verified/i;

function signInitData(userId: number): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Owner' }),
  };
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const p = new URLSearchParams(fields);
  p.set('hash', hash);
  return p.toString();
}

function makeEnv(): Env {
  const store = new Map<string, string>();
  const kv = {
    get: async (key: string, type?: string) => {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({ keys: [] as { name: string }[], list_complete: true, cacheStatus: null }),
  };
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: kv as unknown as KVNamespace,
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    BOT_TOKEN: botToken,
  } as Env;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    /** Everything this browser has stored, as one string. */
    dump: () => JSON.stringify([...data.entries()]),
  };
}

/** The app as a browser tab on luminarasuite.com. Signed in means a Telegram Mini App session. */
function openApp(opts: { signedIn: boolean }) {
  const storage = memoryStorage();
  vi.stubGlobal('window', {
    location: {
      protocol: 'https:',
      origin: 'https://luminarasuite.com',
      hostname: 'luminarasuite.com',
      href: 'https://luminarasuite.com/',
      hash: '',
      search: '',
    },
    ...(opts.signedIn ? { Telegram: { WebApp: { initData: signInitData(4242), platform: 'tdesktop' } } } : {}),
  });
  vi.stubGlobal('localStorage', storage);
  return storage;
}

const payload = (name = 'Acme'): RemediationPayload => ({
  domain: 'my-site.com',
  title: 'Remediation',
  schemaJsonLd: JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name }, null, 2),
});

const wpConfig: DeploymentConfig = { platform: 'wordpress', endpoint: 'https://my-site.com', authToken: WP_PASSWORD };
const webflowConfig: DeploymentConfig = { platform: 'webflow', authToken: 'wf-token-for-tests', siteId: 'site123' };

const ldScript = (json: string) => `<script type="application/ld+json">${json}</script>`;
const homePage = (head: string) =>
  `<!doctype html><html><head><title>My site</title>${head}</head><body><h1>Hello</h1></body></html>`;
/** A response served the way a web page is. `new Response(text)` alone is text/plain. */
const htmlPage = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });

type Handler = (init?: RequestInit) => Response | Promise<Response>;

/**
 * Fake network. The read-back URL is answered by the real Worker unless a test replaces it.
 * Any URL that is not listed throws, so no test can reach a real host.
 */
function fakeNetwork(routes: Record<string, Handler>) {
  const env = makeEnv();
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (routes[url]) return routes[url](init);
    if (url === READBACK) {
      const headers = new Headers(init?.headers);
      headers.set('cf-connecting-ip', '198.51.100.77');
      return worker.fetch(new Request(url, { method: init?.method, body: init?.body as string, headers }), env, ctx);
    }
    if (url.startsWith(DOH)) {
      const answer = new URL(url).searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [];
      return new Response(JSON.stringify({ Status: 0, Answer: answer }), {
        headers: { 'content-type': 'application/dns-json' },
      });
    }
    throw new Error(`unexpected network call: ${url}`);
  });
}

/**
 * A WordPress site. With the plugin, the setting it is sent ends up in the page head. `onPage`
 * is a schema the page carries from the start. `received` is what the settings endpoint was sent.
 */
function fakeWordPress(opts: { pluginRegistersSetting: boolean; onPage?: string }) {
  const site = { onPage: opts.onPage ?? '', received: [] as string[] };
  const routes: Record<string, Handler> = {
    [WP_SETTINGS]: (init) => {
      const sent = JSON.parse(String(init?.body)).luminara_aeo_schema as string;
      site.received.push(sent);
      if (opts.pluginRegistersSetting) site.onPage = sent;
      return new Response('{}', { status: 200 });
    },
    [SITE_HOME]: () => htmlPage(homePage(site.onPage ? ldScript(site.onPage) : '')),
  };
  return { routes, site };
}

/** Answers with each response in turn, then keeps giving the last one. */
function inTurn(...answers: Array<() => Response>): Handler {
  let calls = 0;
  return () => answers[Math.min(calls++, answers.length - 1)]();
}

const renderResult = (result: DeploymentResult) => renderToStaticMarkup(createElement(DeploymentResultAlert, { result }));
const renderModal = () => renderToStaticMarkup(createElement(CmsDeploymentModal, { isOpen: true, onClose: () => {} }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WordPress: deployed only when the schema was absent before the request and present after it', () => {
  beforeEach(() => openApp({ signedIn: true }));

  it('is not a success when the site answers 200 and serves an unchanged page', async () => {
    const wp = fakeWordPress({ pluginRegistersSetting: false });
    fakeNetwork(wp.routes);
    const res = await cmsDeploymentService.deployToWordPress(wpConfig, payload());

    expect(wp.site.received).toHaveLength(1);
    expect(res.success).toBe(false);
    expect(res.seenInPageSource).toBe(false);
    expect(res.message).toBe(
      'WordPress accepted the request and the page did not change. This needs a plugin that registers the setting.',
    );
    expect(res.diffSummary).toEqual({ linesAdded: 0, linesRemoved: 0 });

    const html = renderResult(res);
    expect(html).toContain('the page did not change');
    expect(html).not.toMatch(SAYS_LIVE);
    expect(html).not.toMatch(UNCHECKED_WORDS);
  });

  it('is a success when the page did not hold the schema and now does', async () => {
    const wp = fakeWordPress({ pluginRegistersSetting: true });
    fakeNetwork(wp.routes);
    const res = await cmsDeploymentService.deployToWordPress(wpConfig, payload('Scripts & <Co>'));

    expect(res.success).toBe(true);
    expect(res.seenInPageSource).toBe(true);
    expect(res.alreadyOnPage).toBeUndefined();
    expect(res.message).toBe(
      'Deployed. The schema was not on https://my-site.com/ before the request, and a fresh fetch found it in the page source afterwards.',
    );
    // What WordPress was sent cannot break out of a script tag, and is still the same schema.
    expect(wp.site.received[0]).not.toMatch(/[<>&]/);
    expect(JSON.parse(wp.site.received[0]).name).toBe('Scripts & <Co>');

    const html = renderResult(res);
    expect(html).toContain('>Deployed<');
    expect(html).not.toMatch(UNCHECKED_WORDS);
  });

  // The setting is dropped here too. Without the first read this was reported as "Deployed".
  it('says the schema is already on the page, sends nothing to WordPress and does not call it a deployment', async () => {
    const wp = fakeWordPress({ pluginRegistersSetting: false, onPage: payload().schemaJsonLd });
    fakeNetwork(wp.routes);
    const res = await cmsDeploymentService.deployToWordPress(wpConfig, payload());

    expect(res.message).toBe('This schema is already on the page. Nothing was changed.');
    expect(res.alreadyOnPage).toBe(true);
    expect(wp.site.received).toEqual([]);
    expect(res.diffSummary).toEqual({ linesAdded: 0, linesRemoved: 0 });

    const html = renderResult(res);
    expect(html).toContain('>Already On The Page<');
    expect(html).not.toMatch(SAYS_LIVE);
  });

  it.each([
    ['answers HTTP 500', () => new Response('error', { status: 500 })],
    [
      'cannot be reached',
      () => {
        throw new Error('connection reset');
      },
    ],
  ])('sends nothing to WordPress when the page cannot be read first because the site %s', async (_label, serve) => {
    const wp = fakeWordPress({ pluginRegistersSetting: true });
    fakeNetwork({ ...wp.routes, [SITE_HOME]: serve });
    const res = await cmsDeploymentService.deployToWordPress(wpConfig, payload());

    expect(wp.site.received).toEqual([]);
    expect(res.success).toBe(false);
    // "Could not be read" is said once, with no second copy of it tacked on.
    expect(res.message).toBe(
      'Nothing was sent to WordPress. The page has to be read before and after the request to confirm a change, and it could not be read.',
    );
    expect(renderResult(res)).not.toMatch(SAYS_LIVE);
  });

  it('says the page could not be read back, not that it is unchanged, when only the second read fails', async () => {
    const wp = fakeWordPress({ pluginRegistersSetting: true });
    fakeNetwork({
      ...wp.routes,
      [SITE_HOME]: inTurn(
        () => htmlPage(homePage('')),
        () => new Response('error', { status: 500 }),
      ),
    });
    const res = await cmsDeploymentService.deployToWordPress(wpConfig, payload());

    expect(wp.site.received).toHaveLength(1);
    expect(res.success).toBe(false);
    expect(res.seenInPageSource).toBe(false);
    expect(res.message).toBe('WordPress accepted the request, but the page could not be read back, so nothing is confirmed.');
    expect(renderResult(res)).not.toMatch(SAYS_LIVE);
  });

  it.each([
    [
      'answers HTTP 401',
      () => new Response('{}', { status: 401 }),
      'WordPress did not accept the request: https://my-site.com answered HTTP 401.',
    ],
    [
      'cannot be reached',
      () => {
        throw new Error('connection reset');
      },
      'WordPress did not accept the request: https://my-site.com could not be reached.',
    ],
  ])('is not a success, and says so in plain words, when WordPress %s', async (_label, settings, message) => {
    const wp = fakeWordPress({ pluginRegistersSetting: true });
    fakeNetwork({ ...wp.routes, [WP_SETTINGS]: settings });
    const res = await cmsDeploymentService.deployToWordPress(wpConfig, payload());

    expect(res.success).toBe(false);
    expect(res.message).toBe(message);
    expect(renderResult(res)).not.toMatch(SAYS_LIVE);
  });

  it('sends the WordPress password to WordPress only, never to the read-back route', async () => {
    const wp = fakeWordPress({ pluginRegistersSetting: true });
    const spy = fakeNetwork(wp.routes);
    const res = await cmsDeploymentService.deployToWordPress(wpConfig, payload());
    expect(res.success).toBe(true);

    const readBackCalls = spy.mock.calls.filter((c) => String(c[0]) === READBACK);
    expect(readBackCalls.length).toBeGreaterThan(0);
    for (const [, init] of readBackCalls) {
      const headers = new Headers((init as RequestInit).headers);
      expect(headers.get('authorization') || '').not.toMatch(/^Basic /i);
      const body = String((init as RequestInit).body);
      expect(body).not.toContain('abcd efgh');
      expect(body).not.toContain(btoa(WP_PASSWORD));
    }
  });

  const notOnPage = () => new Response(JSON.stringify({ ok: true, found: false }), { status: 200 });

  it.each([
    ['an answer with no verdict', () => new Response(JSON.stringify({ ok: true }), { status: 200 })],
    ['a verdict that is not a boolean', () => new Response(JSON.stringify({ ok: true, found: 'true' }), { status: 200 })],
    ['found on an error status', () => new Response(JSON.stringify({ ok: true, found: true }), { status: 500 })],
    ['a page of HTML', () => new Response('<html>ok</html>', { status: 200 })],
  ])('is not a success when the read-back after the request returns %s', async (_label, answer) => {
    const wp = fakeWordPress({ pluginRegistersSetting: true });
    fakeNetwork({ ...wp.routes, [READBACK]: inTurn(notOnPage, answer) });
    const res = await cmsDeploymentService.deployToWordPress(wpConfig, payload());

    expect(res.success).toBe(false);
    expect(res.seenInPageSource).toBe(false);
    expect(res.message).toMatch(/could not be read back, so nothing is confirmed/);
    expect(renderResult(res)).not.toMatch(SAYS_LIVE);
  });

  it('sends nothing to WordPress when the first read-back gives no clear answer', async () => {
    const wp = fakeWordPress({ pluginRegistersSetting: true });
    fakeNetwork({ ...wp.routes, [READBACK]: () => new Response(JSON.stringify({ ok: true, found: 'false' }), { status: 200 }) });
    const res = await cmsDeploymentService.deployToWordPress(wpConfig, payload());

    expect(wp.site.received).toEqual([]);
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/^Nothing was sent to WordPress\./);
  });
});

describe('WordPress: a guest gets no "deployed"', () => {
  it('says to sign in and sends the password nowhere when nobody is signed in', async () => {
    openApp({ signedIn: false });
    const wp = fakeWordPress({ pluginRegistersSetting: true });
    fakeNetwork(wp.routes);
    const res = await cmsDeploymentService.deployToWordPress(wpConfig, payload());

    expect(wp.site.received).toEqual([]);
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/^Nothing was sent to WordPress\..*Sign in so the page can be read back\.$/);
    expect(renderResult(res)).not.toMatch(SAYS_LIVE);
  });
});

describe('Webflow: an accepted request is not a published site', () => {
  beforeEach(() => openApp({ signedIn: true }));

  it('says Webflow accepted the request and the site still has to be published', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const res = await cmsDeploymentService.deployToWebflow(webflowConfig, payload());

    expect(res.success).toBe(true);
    expect(res.seenInPageSource).toBeUndefined();
    expect(res.message).toBe('Webflow accepted the request for site site123; publish the site to make it live.');

    const html = renderResult(res);
    expect(html).toContain('>Request Completed<');
    expect(html).not.toMatch(SAYS_LIVE);
    expect(html).not.toMatch(UNCHECKED_WORDS);
  });

  it.each([
    ['answers HTTP 403', () => Promise.resolve(new Response('{}', { status: 403 })), 'Webflow did not accept the request: its API answered HTTP 403.'],
    ['cannot be reached', () => Promise.reject(new Error('connection reset')), 'Webflow did not accept the request: its API could not be reached.'],
  ])('shows no added lines, and a plain reason, when Webflow %s', async (_label, answer, message) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(answer);
    const res = await cmsDeploymentService.deployToWebflow(webflowConfig, payload());

    expect(res.success).toBe(false);
    expect(res.message).toBe(message);
    expect(res.diffSummary.linesAdded).toBe(0);
    expect(renderResult(res)).toContain('+0 lines');
  });
});

describe('Pull request: the body states what was added, and the file is written whole or not at all', () => {
  beforeEach(() => openApp({ signedIn: true }));

  const prConfig = (filePath: string): DeploymentConfig => ({
    platform: 'github_pr',
    repoOwner: 'acme',
    repoName: 'site',
    authToken: 'pat',
    targetBranch: 'main',
    filePath,
  });

  type StoredFile = { sha: string; bytes: Buffer };
  type Pull = { title: string; body: string; head: string; base: string };
  type Faults = { refuseCommit?: boolean; refusePull?: boolean; mainMovesAfterRefRead?: Record<string, Buffer> };

  /**
   * A GitHub repository with the rules that matter here: a branch points at a commit, a new
   * branch is cut from a commit that exists, a file can be read at a branch or at a commit,
   * replacing a file needs its current sha, a path that does not exist yet is created by a PUT,
   * and a pull request needs both branches. Tests read the repository afterwards.
   */
  function fakeGitHubRepo(files: Record<string, Buffer>, faults: Faults = {}) {
    const commits = new Map<string, Map<string, StoredFile>>();
    const heads = new Map<string, string>();
    const pulls: Pull[] = [];
    const commit = (tree: Map<string, StoredFile>) => {
      const sha = `commit-${commits.size + 1}`;
      commits.set(sha, tree);
      return sha;
    };
    const tree = (source: Record<string, Buffer>, version: string) =>
      new Map(Object.entries(source).map(([path, bytes]) => [path, { sha: `blob-${version}-${path}`, bytes }]));
    const filesAt = (ref: string) => commits.get(heads.get(ref) ?? ref);
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    /** GitHub returns file content as base64 broken into lines. */
    const githubBase64 = (bytes: Buffer) => bytes.toString('base64').replace(/(.{60})/g, '$1\n');

    heads.set('main', commit(tree(files, 'v1')));
    let mainMove = faults.mainMovesAfterRefRead;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      if (url.origin !== 'https://api.github.com' || !url.pathname.startsWith('/repos/acme/site/')) {
        throw new Error(`unexpected network call: ${method} ${url}`);
      }
      const path = url.pathname.replace('/repos/acme/site', '');
      const body = init?.body ? JSON.parse(String(init.body)) : {};

      if (method === 'GET' && path.startsWith('/git/ref/heads/')) {
        const sha = heads.get(path.slice('/git/ref/heads/'.length));
        if (!sha) return json({ message: 'Not Found' }, 404);
        if (mainMove) {
          // Somebody pushes to main right after its head was read.
          heads.set('main', commit(tree(mainMove, 'v2')));
          mainMove = undefined;
        }
        return json({ object: { sha } });
      }
      if (method === 'POST' && path === '/git/refs') {
        if (!commits.has(body.sha)) return json({ message: 'Object does not exist' }, 422);
        heads.set(String(body.ref).replace('refs/heads/', ''), body.sha);
        return json({}, 201);
      }
      if (path.startsWith('/contents/')) {
        const filePath = decodeURIComponent(path.slice('/contents/'.length));
        if (method === 'GET') {
          const file = filesAt(url.searchParams.get('ref') || 'main')?.get(filePath);
          if (!file) return json({ message: 'Not Found' }, 404);
          return json({ type: 'file', encoding: 'base64', sha: file.sha, content: githubBase64(file.bytes) });
        }
        if (method === 'PUT') {
          const current = heads.has(body.branch) ? filesAt(body.branch) : undefined;
          if (!current) return json({ message: 'Branch not found' }, 404);
          if (faults.refuseCommit) return json({ message: 'Conflict' }, 409);
          const existing = current.get(filePath);
          if (existing && body.sha !== existing.sha) return json({ message: 'sha does not match' }, 409);
          const next = new Map(current);
          next.set(filePath, { sha: `blob-committed-${filePath}`, bytes: Buffer.from(body.content, 'base64') });
          heads.set(body.branch, commit(next));
          return json({}, existing ? 200 : 201);
        }
      }
      if (method === 'POST' && path === '/pulls') {
        if (faults.refusePull || !heads.has(body.head) || !heads.has(body.base)) {
          return json({ message: 'Validation Failed' }, 422);
        }
        pulls.push(body);
        return json({ html_url: `https://github.com/acme/site/pull/${pulls.length}` }, 201);
      }
      throw new Error(`unexpected network call: ${method} ${url}`);
    });

    return {
      pulls,
      newBranches: () => [...heads.keys()].filter((name) => name !== 'main'),
      text: (branch: string, filePath: string) => filesAt(branch)?.get(filePath)?.bytes.toString('utf8'),
    };
  }

  const originalHtml =
    '<!doctype html>\r\n<html lang="fr">\r\n<head>\r\n  <meta charset="utf-8">\r\n  <title>Café 日本</title>\r\n</head>\r\n<body>\r\n  <h1>Bonjour</h1>\r\n</body>\r\n</html>\r\n';

  it('commits the whole file: every original byte kept, one script block added before </head>', async () => {
    const repo = fakeGitHubRepo({ 'index.html': Buffer.from(originalHtml, 'utf8') });
    const res = await cmsDeploymentService.deployToGitHubPR(prConfig('index.html'), payload());

    expect(res.success).toBe(true);
    expect(res.prUrl).toBe('https://github.com/acme/site/pull/1');
    const [branch] = repo.newBranches();
    expect(repo.pulls).toHaveLength(1);
    expect(repo.pulls[0]).toMatchObject({ head: branch, base: 'main' });
    expect(repo.text('main', 'index.html')).toBe(originalHtml);

    const committed = repo.text(branch, 'index.html')!;
    const [before, after] = originalHtml.split('</head>');
    expect(committed.startsWith(before)).toBe(true);
    expect(committed.endsWith(`</head>${after}`)).toBe(true);
    const added = committed.slice(before.length, committed.length - `</head>${after}`.length);
    expect(added).toMatch(/^<script type="application\/ld\+json">\r\n[\s\S]+\r\n<\/script>\r\n$/);
    const json = added.replace('<script type="application/ld+json">', '').replace('</script>', '');
    expect(JSON.parse(json)).toEqual(JSON.parse(payload().schemaJsonLd));
    expect(res.diffSummary.linesAdded).toBe(committed.split('\n').length - originalHtml.split('\n').length);
  });

  it('builds the commit on the file as it was where the branch was cut, when main moves in between', async () => {
    const movedHtml = originalHtml.replace('Bonjour', 'Bonsoir');
    const repo = fakeGitHubRepo(
      { 'index.html': Buffer.from(originalHtml, 'utf8') },
      { mainMovesAfterRefRead: { 'index.html': Buffer.from(movedHtml, 'utf8') } },
    );
    const res = await cmsDeploymentService.deployToGitHubPR(prConfig('index.html'), payload());

    expect(res.success).toBe(true);
    const committed = repo.text(repo.newBranches()[0], 'index.html')!;
    expect(committed).toContain('Bonjour');
    expect(committed).toContain('application/ld+json');
    expect(repo.text('main', 'index.html')).toBe(movedHtml);
  });

  it('writes a JSX script element into a .tsx layout and leaves the rest of the file alone', async () => {
    const layout =
      'export default function Layout() {\n  return (\n    <html>\n      <head>\n        <title>Acme</title>\n      </head>\n      <body />\n    </html>\n  );\n}\n';
    const repo = fakeGitHubRepo({ 'app/layout.tsx': Buffer.from(layout, 'utf8') });
    const res = await cmsDeploymentService.deployToGitHubPR(prConfig('app/layout.tsx'), payload());

    expect(res.success).toBe(true);
    const committed = repo.text(repo.newBranches()[0], 'app/layout.tsx')!;
    expect(committed).toContain('dangerouslySetInnerHTML={{ __html: JSON.stringify({');
    expect(committed.indexOf('dangerouslySetInnerHTML')).toBeLessThan(committed.indexOf('</head>'));
    expect(committed.replace(/\{\/\* Luminara AEO Schema Injection \*\/\}[\s\S]*?\/>\n/, '')).toBe(layout);
  });

  it('states what was added in the pull request body, and claims nothing that was not checked', async () => {
    const repo = fakeGitHubRepo({ 'index.html': Buffer.from(originalHtml, 'utf8') });
    const res = await cmsDeploymentService.deployToGitHubPR(prConfig('index.html'), payload());
    const pull = repo.pulls[0];

    expect(pull.title).toBe('feat(seo): add Schema.org JSON-LD for my-site.com');
    expect(pull.body).toContain('adds one Schema.org JSON-LD script block to `index.html`');
    expect(pull.body).toContain(`${res.diffSummary.linesAdded} lines added, none removed`);
    expect(pull.body).toContain('Schema.org types in it: Organization');
    expect(pull.body).toContain('Nobody has checked its facts');
    expect(pull.body).toContain('Nothing changes on the site until this pull request is merged and released');
    for (const text of [pull.title, pull.body]) {
      expect(text).not.toMatch(UNCHECKED_WORDS);
      expect(text).not.toMatch(/authoritative|improve visibility|competitor|entity nodes|remediated/i);
      expect(text).not.toContain(String.fromCharCode(0x2014));
    }

    expect(res.message).toMatch(/^Pull request opened: .*Nothing changes on the site until it is merged and released\.$/);
    const html = renderResult(res);
    expect(html).toContain('>Request Completed<');
    expect(html).toContain('View Pull Request on GitHub');
    expect(html).not.toMatch(SAYS_LIVE);
    expect(html).not.toMatch(UNCHECKED_WORDS);
  });

  it.each([
    ['is missing from the branch', 'index.html', null, /could not be read on branch "main": GitHub answered HTTP 404\./],
    ['has no closing head tag', 'index.html', Buffer.from('<div>fragment only</div>\n', 'utf8'), /has no closing <\/head> tag/],
    ['is not text', 'index.html', Buffer.from([0xff, 0xfe, 0x00, 0x3c, 0x2f, 0x68]), /could not be read as a text file/],
    ['is empty', 'app/layout.tsx', Buffer.alloc(0), /could not be read as a text file/],
  ])('writes nothing at all when the target file %s', async (_label, filePath, file, why) => {
    const repo = fakeGitHubRepo(file ? { [filePath]: file } : {});
    const res = await cmsDeploymentService.deployToGitHubPR(prConfig(filePath), payload());

    expect(res.success).toBe(false);
    expect(res.message).toMatch(/^Nothing was written\./);
    expect(res.message).toMatch(why);
    // No branch, so no file anywhere holding a fragment, and no pull request.
    expect(repo.newBranches()).toEqual([]);
    expect(repo.pulls).toEqual([]);
    expect(repo.text('main', filePath)).toBe(file ? file.toString('utf8') : undefined);
    expect(res.prUrl).toBeUndefined();
    expect(renderResult(res)).not.toContain('View Pull Request');
  });

  it('leaves the file as it was and opens no pull request when GitHub refuses the commit', async () => {
    const repo = fakeGitHubRepo({ 'index.html': Buffer.from(originalHtml, 'utf8') }, { refuseCommit: true });
    const res = await cmsDeploymentService.deployToGitHubPR(prConfig('index.html'), payload());

    expect(res.success).toBe(false);
    expect(res.message).toMatch(/Nothing was written to index\.html: GitHub answered HTTP 409 to the commit\./);
    expect(repo.newBranches().map((b) => repo.text(b, 'index.html'))).toEqual([originalHtml]);
    expect(repo.pulls).toEqual([]);
    expect(res.prUrl).toBeUndefined();
  });

  it('shows no pull request link when GitHub did not open one', async () => {
    const repo = fakeGitHubRepo({ 'index.html': Buffer.from(originalHtml, 'utf8') }, { refusePull: true });
    const res = await cmsDeploymentService.deployToGitHubPR(prConfig('index.html'), payload());

    expect(res.success).toBe(false);
    expect(repo.pulls).toEqual([]);
    expect(res.prUrl).toBeUndefined();
    expect(res.message).toMatch(/was committed to branch luminara\/aeo-schema-\d+, but no pull request was confirmed: GitHub answered HTTP 422\./);
    const html = renderResult(res);
    expect(html).not.toContain('View Pull Request');
    expect(html).toContain('>Deployment Error<');
  });
});

describe('the modal: what it offers and what it stores', () => {
  // No real WordPress site has passed the read-back, and no plugin here registers the setting.
  it('does not offer WordPress, or any field for a WordPress password', () => {
    openApp({ signedIn: true });
    const html = renderModal();

    expect(html).toContain('>Webflow<');
    expect(html).toContain('>GitHub PR<');
    expect(html).toContain('>Script Tag<');
    expect(html).not.toContain('WordPress');
    expect(html).not.toContain('cms-wp-endpoint');
    expect(html).not.toContain('Application Password');
  });

  it('names the script tag option for what it does, with no CDN', () => {
    openApp({ signedIn: true });
    const html = renderModal();
    expect(html).toContain('Copy and paste');
    expect(html).not.toContain('CDN');
  });

  it('leaves "remember on this device" off until the user ticks it', () => {
    openApp({ signedIn: true });
    const html = renderModal();
    expect(html).toContain('Remember on this device');
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('checked=""');
  });

  // The password an earlier version saved has no screen left to manage it while the option is hidden.
  it('removes a saved WordPress password and nothing else, and the modal does that on open', () => {
    const storage = openApp({ signedIn: true });
    const github: DeploymentConfig = { platform: 'github_pr', repoOwner: 'acme', repoName: 'site', authToken: 'gh-token-for-tests' };
    cmsDeploymentService.saveConfig('wordpress', wpConfig);
    cmsDeploymentService.saveConfig('webflow', webflowConfig);
    cmsDeploymentService.saveConfig('github_pr', github);
    expect(storage.dump()).toContain('abcd efgh');

    cmsDeploymentService.rememberConfig('wordpress', {}, false);

    expect(cmsDeploymentService.getSavedConfig('wordpress')).toEqual({});
    expect(storage.dump()).not.toContain('abcd efgh');
    expect(cmsDeploymentService.getSavedConfig('webflow')).toEqual(webflowConfig);
    expect(cmsDeploymentService.getSavedConfig('github_pr')).toEqual(github);

    // An effect does not run in a static render, so the call is checked where it is written.
    const modalSource = readFileSync(resolve(process.cwd(), 'components/audit/CmsDeploymentModal.tsx'), 'utf8');
    expect(modalSource).toContain("if (!WORDPRESS_TRIAL_PASSED) cmsDeploymentService.rememberConfig('wordpress', {}, false);");
  });

  it('stores no token unless the user asked, and forgets a stored one when they stop asking', () => {
    const storage = openApp({ signedIn: true });

    cmsDeploymentService.rememberConfig('webflow', webflowConfig, false);
    expect(storage.dump()).not.toContain('wf-token-for-tests');
    expect(cmsDeploymentService.getSavedConfig('webflow')).toEqual({});

    cmsDeploymentService.rememberConfig('webflow', webflowConfig, true);
    expect(cmsDeploymentService.getSavedConfig('webflow').authToken).toBe('wf-token-for-tests');

    cmsDeploymentService.rememberConfig('webflow', webflowConfig, false);
    expect(storage.dump()).not.toContain('wf-token-for-tests');
  });
});

describe('the modal: no "autonomous", no "verified", and "deployed" only after a fetch saw it', () => {
  const modalSource = readFileSync(resolve(process.cwd(), 'components/audit/CmsDeploymentModal.tsx'), 'utf8');
  const serviceSource = readFileSync(resolve(process.cwd(), 'services/deployment/cmsDeploymentService.ts'), 'utf8');

  it('renders a title, a subtitle and a history label without the old claims', async () => {
    openApp({ signedIn: true });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await cmsDeploymentService.deployToWebflow(webflowConfig, payload());

    const html = renderModal();
    expect(html).toContain('1-Click CMS &amp; GitHub Deployment');
    expect(html).toContain('Recent Deployment Attempts (1)');
    expect(html).not.toMatch(UNCHECKED_WORDS);
    expect(html).not.toMatch(SAYS_LIVE);
    expect(html).not.toMatch(/\blive\b/i);
    expect(html).not.toContain('production');
  });

  // Rows saved by the old code say "successfully deployed" for changes nobody checked.
  it('does not list history recorded before the read-back existed', () => {
    openApp({ signedIn: true });
    const legacy: DeploymentResult = {
      success: true,
      platform: 'wordpress',
      deploymentId: 'wp-1',
      message: 'Schema.org @graph successfully deployed to WordPress header for my-site.com.',
      diffSummary: { linesAdded: 5, linesRemoved: 0 },
      timestamp: 1,
    };
    localStorage.setItem('luminara_deployment_history', JSON.stringify([legacy]));

    const html = renderModal();
    expect(html).not.toContain('Recent Deployment');
    expect(html).not.toMatch(SAYS_LIVE);
  });

  it('heads a result "Deployed" only when the read-back saw the schema appear', () => {
    const accepted: DeploymentResult = {
      success: true,
      platform: 'webflow',
      deploymentId: 'x',
      message: 'm',
      diffSummary: { linesAdded: 0, linesRemoved: 0 },
      timestamp: 1,
    };
    expect(deploymentResultHeading({ ...accepted, seenInPageSource: true })).toBe('Deployed');
    expect(deploymentResultHeading(accepted)).toBe('Request Completed');
    expect(deploymentResultHeading({ ...accepted, seenInPageSource: true, alreadyOnPage: true })).toBe('Already On The Page');
    expect(deploymentResultHeading({ ...accepted, success: false, seenInPageSource: true })).toBe('Deployment Error');
  });

  it('has neither word anywhere in the modal source or the service source', () => {
    for (const source of [modalSource, serviceSource]) {
      expect(source).not.toMatch(/autonomous/i);
      expect(source).not.toMatch(/verif/i);
    }
  });

  it('has one string in the modal source that says a change is on the site, behind the read-back flag', () => {
    const codeLines = modalSource.split('\n').filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line));
    const claims = codeLines.filter((line) => /\b(live|deployed|published|production)\b/i.test(line));
    expect(claims).toHaveLength(1);
    expect(claims[0]).toContain("result.seenInPageSource ? 'Deployed'");
  });
});
