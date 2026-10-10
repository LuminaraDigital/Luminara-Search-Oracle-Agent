import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIREBASE_PUBLIC_CONFIG, resolveFirebaseWebConfig } from '../services/auth/firebasePublicConfig';
import {
  MINI_APP_URL,
  PRODUCTION_MINI_APP_URL,
  botUsernameFromMiniAppUrl,
  inviteUrlForCode,
  resolveMiniAppUrl,
} from '../services/referrals/rules';
import { TELEGRAM_MINI_APP_URL } from '../components/paywall/paymentOptions';
import type { AppAuthState } from '../services/auth/useAppAuth';
import type { Env } from '../worker/env';
import { handleReferralRoute } from '../worker/referrals';
import { handleShareRoute, parseTeaserCreateBody } from '../worker/shareService';
import { parseJsonc } from '../scripts/lib/jsonc.mjs';
import { createSqliteD1 } from './helpers/sqliteD1';

/**
 * Track SW, SW0a-14: staging can be signed in to. The staging build takes its own Firebase web
 * config and its own bot link from configuration; the production build is unchanged.
 */

const root = resolve(__dirname, '..');
const STAGING = {
  MODE: 'staging',
  VITE_FIREBASE_API_KEY: 'staging-web-api-value',
  VITE_FIREBASE_AUTH_DOMAIN: 'luminara-suite-staging.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'luminara-suite-staging',
  VITE_FIREBASE_APP_ID: '1:1:web:staging',
};
const STAGING_BOT_LINK = 'https://t.me/LuminaraStagingBot/app';
const TEST_BOT_TOKEN = '123456:MOCK_TOKEN';

function workerEnv(extra: Partial<Env> = {}): Env {
  const store = new Map<string, string>();
  const kv = {
    get: async (key: string, type?: string) => {
      const value = store.get(key);
      if (value === undefined) return null;
      return type === 'json' ? JSON.parse(value) : value;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  };
  return {
    ASSETS: {} as Env['ASSETS'],
    DB: createSqliteD1(),
    LUMINARA_KV: kv as unknown as KVNamespace,
    FREE_DAILY_LIMIT: '10',
    REQUIRE_TG_AUTH: 'true',
    WEBAPP_URL: 'https://staging.luminarasuite.com',
    BOT_TOKEN: TEST_BOT_TOKEN,
    ...extra,
  };
}

function signedHeaders(id: number): Record<string, string> {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: 'Staging' }),
  };
  const checkString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TEST_BOT_TOKEN).digest();
  const params = new URLSearchParams(fields);
  params.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
  return { 'content-type': 'application/json', 'x-telegram-init-data': params.toString() };
}

describe('the Firebase web config a build signs in with', () => {
  it('a production build with no overrides uses the published production project, unchanged', () => {
    expect(resolveFirebaseWebConfig({ MODE: 'production' })).toEqual({
      apiKey: FIREBASE_PUBLIC_CONFIG.apiKey,
      authDomain: 'luminara-suite.firebaseapp.com',
      projectId: 'luminara-suite',
      appId: FIREBASE_PUBLIC_CONFIG.appId,
      messagingSenderId: FIREBASE_PUBLIC_CONFIG.messagingSenderId,
      storageBucket: FIREBASE_PUBLIC_CONFIG.storageBucket,
    });
    expect(resolveFirebaseWebConfig({})?.projectId).toBe('luminara-suite');
    expect(resolveFirebaseWebConfig({ MODE: 'development' })?.projectId).toBe('luminara-suite');
  });

  it('a production build still lets each value be overridden', () => {
    expect(resolveFirebaseWebConfig({ MODE: 'production', VITE_FIREBASE_PROJECT_ID: 'other' })?.projectId).toBe('other');
  });

  it('a staging build with its own values signs in against the staging project', () => {
    const cfg = resolveFirebaseWebConfig(STAGING);
    expect(cfg).toMatchObject({ projectId: 'luminara-suite-staging', authDomain: 'luminara-suite-staging.firebaseapp.com' });
    // Nothing from the production project leaks in, optional fields included.
    expect(cfg?.messagingSenderId).toBeUndefined();
    expect(cfg?.storageBucket).toBeUndefined();
    expect(JSON.stringify(cfg)).not.toContain(FIREBASE_PUBLIC_CONFIG.apiKey);
  });

  it.each(['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'])(
    'a staging build missing %s is not configured, and never falls back to the production project',
    (missing) => {
      expect(resolveFirebaseWebConfig({ ...STAGING, [missing]: '' })).toBeNull();
      expect(resolveFirebaseWebConfig({ ...STAGING, [missing]: undefined })).toBeNull();
    },
  );

  it('a staging build with nothing set is not configured', () => {
    expect(resolveFirebaseWebConfig({ MODE: 'staging' })).toBeNull();
  });

  it('a staging build handed the production project, as from a local .env, is not configured', () => {
    const leaked = {
      MODE: 'staging',
      VITE_FIREBASE_API_KEY: FIREBASE_PUBLIC_CONFIG.apiKey,
      VITE_FIREBASE_AUTH_DOMAIN: FIREBASE_PUBLIC_CONFIG.authDomain,
      VITE_FIREBASE_PROJECT_ID: FIREBASE_PUBLIC_CONFIG.projectId,
      VITE_FIREBASE_APP_ID: FIREBASE_PUBLIC_CONFIG.appId,
    };
    expect(resolveFirebaseWebConfig(leaked)).toBeNull();
    expect(resolveFirebaseWebConfig({ ...STAGING, VITE_FIREBASE_PROJECT_ID: FIREBASE_PUBLIC_CONFIG.projectId })).toBeNull();
    expect(resolveFirebaseWebConfig({ ...STAGING, VITE_FIREBASE_PROJECT_ID: ` ${FIREBASE_PUBLIC_CONFIG.projectId} ` })).toBeNull();
    // The same values are what a production build is meant to use.
    expect(resolveFirebaseWebConfig({ ...leaked, MODE: 'production' })?.projectId).toBe(FIREBASE_PUBLIC_CONFIG.projectId);
  });

  describe('the sign-in service', () => {
    afterEach(() => {
      vi.doUnmock('../services/auth/firebasePublicConfig');
      vi.resetModules();
    });

    it('hands the build mode to the resolver and answers with what the resolver says', async () => {
      const seen: Record<string, unknown>[] = [];
      let answer: unknown = null;
      vi.resetModules();
      vi.doMock('../services/auth/firebasePublicConfig', () => ({
        FIREBASE_PUBLIC_CONFIG,
        resolveFirebaseWebConfig: (env: Record<string, unknown>) => {
          seen.push(env);
          return answer;
        },
      }));
      const { isFirebaseConfigured } = await import('../services/auth/firebaseAuthService');
      expect(isFirebaseConfigured()).toBe(false);
      answer = { apiKey: 'a', authDomain: 'b', projectId: 'c', appId: 'd' };
      expect(isFirebaseConfigured()).toBe(true);
      expect(seen).toHaveLength(2);
      // The test run is itself a build with a mode; the service must pass it on untouched.
      for (const env of seen) expect(env.MODE).toBe('test');
    });

    it('reads its config from the whole build env, MODE included', () => {
      const source = readFileSync(resolve(root, 'services', 'auth', 'firebaseAuthService.ts'), 'utf8');
      expect(source).toContain('return resolveFirebaseWebConfig((import.meta as any).env || {});');
    });
  });

  it('the staging Worker verifies the staging project, which is why the fallback would be refused', () => {
    const wrangler = parseJsonc(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8')) as any;
    expect(wrangler.env.staging.vars.FIREBASE_PROJECT_ID).toBe('luminara-suite-staging');
    expect(wrangler.env.production.vars.FIREBASE_PROJECT_ID).toBe(FIREBASE_PUBLIC_CONFIG.projectId);
  });
});

describe('the Mini App link', () => {
  it('is the published production link when nothing is configured', () => {
    expect(PRODUCTION_MINI_APP_URL).toBe('https://t.me/LuminaraSuiteBot/app');
    expect(MINI_APP_URL).toBe(PRODUCTION_MINI_APP_URL);
    expect(TELEGRAM_MINI_APP_URL).toBe(PRODUCTION_MINI_APP_URL);
    for (const nothing of [undefined, null, '', '   ', 42]) expect(resolveMiniAppUrl(nothing)).toBe(PRODUCTION_MINI_APP_URL);
  });

  it('accepts a t.me bot link, with or without an app name', () => {
    expect(resolveMiniAppUrl('https://t.me/LuminaraStagingBot/app')).toBe('https://t.me/LuminaraStagingBot/app');
    expect(resolveMiniAppUrl(' https://t.me/LuminaraStagingBot ')).toBe('https://t.me/LuminaraStagingBot');
  });

  it.each([
    'http://t.me/LuminaraStagingBot/app',
    'https://t.me.evil.example/LuminaraStagingBot/app',
    'https://evil.example/?https://t.me/LuminaraStagingBot/app',
    'https://t.me/LuminaraStagingBot/app?startapp=x',
    'https://t.me/LuminaraStagingBot/app/extra',
    'https://t.me/ab',
    'javascript:alert(1)',
    // t.me paths that are not a bot: a bot's username ends in "bot".
    'https://t.me/share/url',
    'https://t.me/joinchat/x',
    'https://t.me/durov/123',
    'https://t.me/botfather_news',
  ])('falls back to the production link for %s', (bad) => {
    expect(resolveMiniAppUrl(bad)).toBe(PRODUCTION_MINI_APP_URL);
  });

  it('accepts a bot username ending in "bot" in any case', () => {
    for (const link of ['https://t.me/luminara_staging_bot/app', 'https://t.me/LuminaraStagingBOT', 'https://t.me/a_bot']) {
      expect(resolveMiniAppUrl(link)).toBe(link);
    }
  });

  it('names the bot a link points at, and the production bot for a link that is not accepted', () => {
    expect(botUsernameFromMiniAppUrl(STAGING_BOT_LINK)).toBe('LuminaraStagingBot');
    expect(botUsernameFromMiniAppUrl('https://t.me/LuminaraStagingBot')).toBe('LuminaraStagingBot');
    expect(botUsernameFromMiniAppUrl(PRODUCTION_MINI_APP_URL)).toBe('LuminaraSuiteBot');
    for (const bad of [undefined, '', 'https://t.me/share/url', 'https://evil.example/EvilBot/app']) {
      expect(botUsernameFromMiniAppUrl(bad)).toBe('LuminaraSuiteBot');
    }
  });

  it('invite links and share teasers written by the Worker use the configured bot', () => {
    expect(inviteUrlForCode('abcdefghj2')).toBe('https://t.me/LuminaraSuiteBot/app?startapp=ref_abcdefghj2');
    expect(inviteUrlForCode('abcdefghj2', 'https://t.me/LuminaraStagingBot/app')).toBe(
      'https://t.me/LuminaraStagingBot/app?startapp=ref_abcdefghj2',
    );
    const body = { domain: 'example.com', verdict: 'Readable by crawlers.', topFix: 'Add an llms.txt file.' };
    const byDefault = parseTeaserCreateBody(body);
    const onStaging = parseTeaserCreateBody(body, 'https://t.me/LuminaraStagingBot/app');
    expect(byDefault.ok && byDefault.payload.ctaUrl).toBe(PRODUCTION_MINI_APP_URL);
    expect(onStaging.ok && onStaging.payload.ctaUrl).toBe('https://t.me/LuminaraStagingBot/app');
  });

  it('GET /referrals/me writes the invite link on the bot the Worker is configured with', async () => {
    const read = async (env: Env) => {
      const res = await handleReferralRoute(
        new Request('https://staging.luminarasuite.com/api/referrals/me', { method: 'GET', headers: signedHeaders(7001) }),
        env,
        '/referrals/me',
      );
      expect(res.status).toBe(200);
      return (await res.json()) as { code: string; inviteUrl: string };
    };
    const onStaging = await read(workerEnv({ TELEGRAM_MINI_APP_URL: STAGING_BOT_LINK }));
    expect(onStaging.code).toMatch(/^[a-z0-9]{10}$/);
    expect(onStaging.inviteUrl).toBe(`${STAGING_BOT_LINK}?startapp=ref_${onStaging.code}`);

    const byDefault = await read(workerEnv());
    expect(byDefault.inviteUrl).toBe(`${PRODUCTION_MINI_APP_URL}?startapp=ref_${byDefault.code}`);
    const misconfigured = await read(workerEnv({ TELEGRAM_MINI_APP_URL: 'https://evil.example/EvilBot/app' }));
    expect(misconfigured.inviteUrl).toBe(`${PRODUCTION_MINI_APP_URL}?startapp=ref_${misconfigured.code}`);
  });

  it('a share teaser is stored and read back with the configured bot as its call to action', async () => {
    const env = workerEnv();
    const create = async () => {
      const res = await handleShareRoute(
        new Request('https://staging.luminarasuite.com/api/share/teasers', {
          method: 'POST',
          headers: signedHeaders(7002),
          body: JSON.stringify({ domain: 'example.com', verdict: 'Readable by crawlers.', topFix: 'Add an llms.txt file.' }),
        }),
        env,
        '/share/teasers',
      );
      expect(res.status).toBe(200);
      return (await res.json()) as { id: string; token: string };
    };
    const readCta = async (token: string) => {
      const res = await handleShareRoute(
        new Request(`https://staging.luminarasuite.com/api/share/teasers/${token}`),
        env,
        `/share/teasers/${token}`,
      );
      expect(res.status).toBe(200);
      return ((await res.json()) as { teaser: { ctaUrl: string } }).teaser.ctaUrl;
    };
    const storedCta = async (id: string) => {
      const row = await env.DB!.prepare(`SELECT payload_json FROM share_teasers WHERE id = ?`).bind(id).first<{ payload_json: string }>();
      return (JSON.parse(row!.payload_json) as { ctaUrl: string }).ctaUrl;
    };

    // Written with nothing configured: the production bot, stored and read.
    const first = await create();
    expect(await storedCta(first.id)).toBe(PRODUCTION_MINI_APP_URL);
    expect(await readCta(first.token)).toBe(PRODUCTION_MINI_APP_URL);

    // The read path takes the link from the Worker's variable, whatever the stored row says.
    env.TELEGRAM_MINI_APP_URL = STAGING_BOT_LINK;
    expect(await readCta(first.token)).toBe(STAGING_BOT_LINK);

    // The write path stores it too.
    const second = await create();
    expect(await storedCta(second.id)).toBe(STAGING_BOT_LINK);

    env.TELEGRAM_MINI_APP_URL = 'https://evil.example/EvilBot/app';
    expect(await readCta(second.token)).toBe(PRODUCTION_MINI_APP_URL);
  });

  it('the Worker variable is empty at the top level and in production; staging may name its own bot', () => {
    const wrangler = parseJsonc(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8')) as any;
    expect(wrangler.vars.TELEGRAM_MINI_APP_URL).toBe('');
    expect(wrangler.env.production.vars.TELEGRAM_MINI_APP_URL).toBe('');

    // Staging: empty, or a link that is accepted as written and does not point at the production bot.
    const productionBot = botUsernameFromMiniAppUrl(PRODUCTION_MINI_APP_URL).toLowerCase();
    const allowedOnStaging = (value: unknown): boolean =>
      value === '' ||
      (typeof value === 'string' &&
        resolveMiniAppUrl(value) === value &&
        botUsernameFromMiniAppUrl(value).toLowerCase() !== productionBot);
    expect(allowedOnStaging(wrangler.env.staging.vars.TELEGRAM_MINI_APP_URL)).toBe(true);

    expect(allowedOnStaging('')).toBe(true);
    expect(allowedOnStaging(STAGING_BOT_LINK)).toBe(true);
    expect(allowedOnStaging(PRODUCTION_MINI_APP_URL)).toBe(false);
    expect(allowedOnStaging('https://t.me/luminarasuitebot')).toBe(false);
    expect(allowedOnStaging(` ${STAGING_BOT_LINK}`)).toBe(false);
    expect(allowedOnStaging('https://staging.luminarasuite.com/')).toBe(false);
    expect(allowedOnStaging(undefined)).toBe(false);
  });
});

describe('the tip on the Telegram sign-in screen', () => {
  afterEach(() => {
    vi.doUnmock('../services/referrals/rules');
    vi.resetModules();
  });

  // The link is fixed when the build is made, so a build with another link is stood in for by
  // replacing the one constant the screen reads.
  async function tip(miniAppLink?: string): Promise<string> {
    vi.resetModules();
    if (miniAppLink !== undefined) {
      vi.doMock('../services/referrals/rules', async (original) => ({
        ...(await original<typeof import('../services/referrals/rules')>()),
        MINI_APP_URL: miniAppLink,
      }));
    }
    const { AuthRequiredScreen } = await import('../components/auth/AuthRequiredScreen');
    const auth = { loading: false, authenticated: false, source: null, label: null, reason: null, retryTelegram: () => {} };
    const html = renderToStaticMarkup(createElement(AuthRequiredScreen, { auth: auth as unknown as AppAuthState }));
    return /Tip: [^<]*/.exec(html)?.[0] ?? '';
  }

  it('names the production bot in a build with no link configured', async () => {
    expect(await tip()).toBe('Tip: close the Mini App fully, then open it again from @LuminaraSuiteBot.');
  });

  it('names the staging bot in a build configured with the staging link', async () => {
    expect(await tip(STAGING_BOT_LINK)).toBe('Tip: close the Mini App fully, then open it again from @LuminaraStagingBot.');
  });
});

describe('the Telegram setup script', () => {
  const script = readFileSync(resolve(root, 'scripts', 'telegram-setup.mjs'), 'utf8').replace(/\r\n/g, '\n');
  const getMeAt = script.indexOf("await call('getMe'");
  const setWebhookAt = script.indexOf("await call('setWebhook'");

  it('asks Telegram which bot the token belongs to before any call that changes something', () => {
    const calls = [...script.matchAll(/await call\('([A-Za-z]+)'/g)].map((match) => match[1]);
    expect(calls).toEqual(['getMe', 'setWebhook', 'setChatMenuButton', 'setMyCommands']);
    expect(script.match(/api\.telegram\.org/g)).toHaveLength(1);
  });

  it('stops before any call when EXPECT_BOT_USERNAME is missing', () => {
    const beforeGetMe = script.slice(0, getMeAt);
    expect(getMeAt).toBeGreaterThan(0);
    // With or without a leading @, any case.
    expect(beforeGetMe).toContain("String(process.env.EXPECT_BOT_USERNAME || '').trim().replace(/^@/, '').toLowerCase()");
    expect(beforeGetMe).toMatch(/if \(!expectedBot\) \{\n[^}]*process\.exit\(1\);\n\}/);
  });

  it('stops before the webhook is set when the token belongs to another bot, and says which bot matched', () => {
    const betweenGetMeAndWebhook = script.slice(getMeAt, setWebhookAt);
    expect(setWebhookAt).toBeGreaterThan(getMeAt);
    expect(betweenGetMeAndWebhook).toMatch(
      /if \(!botUsername \|\| botUsername\.toLowerCase\(\) !== expectedBot\) \{\n[\s\S]*?process\.exit\(1\);\n\}/,
    );
    expect(betweenGetMeAndWebhook).toContain('console.log(`Matched bot: @${botUsername}`);');
    expect(betweenGetMeAndWebhook.indexOf('process.exit(1)')).toBeLessThan(betweenGetMeAndWebhook.indexOf('Matched bot'));
  });

  it('keeps pending updates unless told otherwise, because one of them can be a paid update', () => {
    expect(script).not.toMatch(/drop_pending_updates:\s*true/);
    expect(script).toContain("drop_pending_updates: process.env.DROP_PENDING_UPDATES === 'true'");
    expect(script).toContain('EXPECT_BOT_USERNAME=LuminaraSuiteBot BOT_TOKEN=123:abc');
  });
});

describe('the staging runbook', () => {
  const runbook = readFileSync(resolve(root, 'docs', 'runbooks', 'staging-sign-in-and-bot.md'), 'utf8').replace(/\r\n/g, '\n');

  it('names the bot it expects on every run of the setup script, in bash and in PowerShell', () => {
    const runs = runbook.split('\n').filter((line) => line.includes('node scripts/telegram-setup.mjs') && line.includes('BOT_TOKEN='));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatch(/^EXPECT_BOT_USERNAME=<[^>]+> BOT_TOKEN=/);
    const powershell = /```powershell\n([\s\S]*?)```/.exec(runbook)?.[1] ?? '';
    expect(powershell).toContain("$env:EXPECT_BOT_USERNAME = '");
    expect(powershell).toContain("$env:BOT_TOKEN = '");
    expect(powershell.trimEnd().split('\n').pop()).toBe('node scripts/telegram-setup.mjs');
    expect(runbook).toContain('stays in the shell');
  });

  it('tells the owner to set the staging Firebase web API key the Worker signs in with', () => {
    const wrangler = parseJsonc(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8')) as any;
    expect(wrangler.env.staging.vars).toHaveProperty('FIREBASE_WEB_API_KEY');
    expect(runbook).toMatch(/\| `FIREBASE_WEB_API_KEY` \| the staging Firebase web API key/);
    expect(runbook).toContain('answers 503');
  });
});

describe('a local staging deploy', () => {
  const scripts = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;

  it('builds in staging mode, so it never ships the production Firebase fallback', () => {
    expect(scripts['deploy:staging']).toBe('npm run build -- --mode staging && wrangler deploy --env staging');
    // The flag is appended to the end of the build script, which has to be the vite build.
    expect(scripts.build).toMatch(/&& vite build$/);
  });

  it('leaves the production deploy as it was', () => {
    expect(scripts.deploy).toBe('npm run build && wrangler deploy --env production');
  });
});

describe('the deploy workflow', () => {
  const workflow = readFileSync(resolve(root, '.github', 'workflows', 'deploy-cloudflare.yml'), 'utf8').replace(/\r\n/g, '\n');
  const stagingJob = workflow.slice(workflow.indexOf('  deploy_staging:'), workflow.indexOf('  deploy_production:'));
  const productionJob = workflow.slice(workflow.indexOf('  deploy_production:'));

  it('gives the staging build its own values from the staging environment variables', () => {
    for (const name of [
      'VITE_FIREBASE_API_KEY',
      'VITE_FIREBASE_AUTH_DOMAIN',
      'VITE_FIREBASE_PROJECT_ID',
      'VITE_FIREBASE_APP_ID',
      'VITE_TELEGRAM_MINI_APP_URL',
    ]) {
      expect(stagingJob).toContain(`${name}: \${{ vars.${name} }}`);
    }
    expect(stagingJob).toContain('environment: staging');
    expect(stagingJob).toContain('run: npx vite build --mode staging');
  });

  it('leaves the production build exactly as it was: no build-time overrides', () => {
    expect(productionJob).not.toContain('VITE_FIREBASE_');
    expect(productionJob).not.toContain('VITE_TELEGRAM_MINI_APP_URL');
    expect(productionJob).toContain('run: npm run build');
  });

  it('reads public config from variables, never from secrets', () => {
    expect(workflow).not.toMatch(/VITE_[A-Z_]+: \$\{\{ secrets\./);
  });
});
