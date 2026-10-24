import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { runWifSmoke } from '../worker/wifSmoke';
import { formatSmokeLines, main as runWifSmokeCli } from '../scripts/wif-smoke.mjs';

const NOW = 1_700_000_000_000;
const SECRET = 'real-admin-secret';
const FEDERATED = 'federated-token';
const ACCESS = 'impersonated-token';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function pemFrom(pkcs8: ArrayBuffer): string {
  const bytes = new Uint8Array(pkcs8);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const b64 = btoa(binary).match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
}

async function signingPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign'],
  );
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  return pemFrom(pkcs8);
}

function wifEnv(pem: string, overrides: Partial<Env> = {}): Env {
  return {
    WEBAPP_URL: 'https://staging.luminarasuite.com/',
    ENVIRONMENT: 'staging',
    ADMIN_SECRET: SECRET,
    GCP_PROJECT_ID: 'luminara-suite-staging',
    GCP_WIF_AUDIENCE: '//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/pool/providers/suite',
    GCP_OIDC_ISSUER: 'https://staging.luminarasuite.com/api/gcp-oidc',
    GCP_OIDC_SUBJECT: 'suite-worker',
    GCP_OIDC_KEY_ID: 'k1',
    GCP_OIDC_SIGNING_KEY: pem,
    GCP_IMPERSONATE_SERVICE_ACCOUNT: 'suite-worker@luminara-suite-staging.iam.gserviceaccount.com',
    DATA_PLANE: 'd1',
    ...overrides,
  } as Env;
}

function req(envPath: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('cf-connecting-ip', '10.8.1.9');
  return new Request(`https://staging.luminarasuite.com${envPath}`, { ...init, headers });
}

type Call = { url: string; method: string; auth: string | null; body: string };

function stubChain(opts?: { stsStatus?: number; patchStatus?: number; probe?: string }): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    calls.push({ url, method, auth: headers.get('authorization'), body: String(init?.body ?? '') });
    if (url.includes('sts.googleapis.com')) {
      if (opts?.stsStatus) return new Response('no', { status: opts.stsStatus });
      return new Response(JSON.stringify({ access_token: FEDERATED }), { status: 200 });
    }
    if (url.includes(':generateAccessToken')) {
      return new Response(JSON.stringify({ accessToken: ACCESS, expireTime: '2030-01-01T00:00:00.000Z' }), { status: 200 });
    }
    if (url.includes('/documents/_smoke/wif-') && method === 'PATCH') {
      if (opts?.patchStatus) return new Response('no', { status: opts.patchStatus });
      return new Response('{}', { status: 200 });
    }
    if (url.includes('/documents/_smoke/wif-') && method === 'GET') {
      const id = decodeURIComponent(url.split('/').pop() ?? '');
      const at = id.slice('wif-'.length);
      return new Response(JSON.stringify({
        fields: {
          probe: { stringValue: opts?.probe ?? 'wif' },
          at: { integerValue: at },
        },
      }), { status: 200 });
    }
    if (url.includes('/documents/_smoke/wif-') && method === 'DELETE') {
      return new Response('', { status: 200 });
    }
    return new Response('unexpected', { status: 500 });
  };
  return { fetchImpl, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/admin/wif-smoke', () => {
  it('returns 404 outside staging and does not call STS', async () => {
    const pem = await signingPem();
    const { fetchImpl, calls } = stubChain();
    vi.stubGlobal('fetch', fetchImpl);
    for (const environment of ['production', undefined, 'Production']) {
      const res = await worker.fetch(
        req('/api/admin/wif-smoke', { method: 'POST', headers: { 'x-admin-secret': SECRET } }),
        wifEnv(pem, { ENVIRONMENT: environment }),
        ctx,
      );
      expect(res.status, String(environment)).toBe(404);
      const body = await res.json() as { ok: boolean; error: string };
      expect(body).toEqual({ ok: false, error: 'Not found' });
    }
    expect(calls).toEqual([]);
  });

  it('requires the admin secret on staging and ignores the webhook secret', async () => {
    const pem = await signingPem();
    const env = wifEnv(pem, { TELEGRAM_WEBHOOK_SECRET: 'webhook-secret' });
    const unset = await worker.fetch(req('/api/admin/wif-smoke', { method: 'POST' }), wifEnv(pem, { ADMIN_SECRET: undefined }), ctx);
    expect(unset.status).toBe(503);
    const wrong = await worker.fetch(
      req('/api/admin/wif-smoke', { method: 'POST', headers: { 'x-admin-secret': 'nope' } }),
      env,
      ctx,
    );
    expect(wrong.status).toBe(401);
    const webhook = await worker.fetch(
      req('/api/admin/wif-smoke', { method: 'POST', headers: { 'x-admin-secret': 'webhook-secret' } }),
      env,
      ctx,
    );
    expect(webhook.status).toBe(401);
    const get = await worker.fetch(req('/api/admin/wif-smoke', { headers: { 'x-admin-secret': SECRET } }), env, ctx);
    expect(get.status).toBe(405);
  });

  it('signs, exchanges, impersonates, and round-trips one smoke doc without leaking tokens', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const pem = await signingPem();
    const { fetchImpl, calls } = stubChain();
    vi.stubGlobal('fetch', fetchImpl);
    const res = await worker.fetch(
      req('/api/admin/wif-smoke', { method: 'POST', headers: { 'x-admin-secret': SECRET } }),
      wifEnv(pem),
      ctx,
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    const body = JSON.parse(text) as { ok: boolean; doc: string; steps: Array<{ step: string; ok: boolean; latencyMs: number }> };
    expect(body.ok).toBe(true);
    expect(body.doc).toBe(`_smoke/wif-${NOW}`);
    expect(body.steps.map((step) => step.step)).toEqual(['sign', 'sts', 'impersonate', 'write', 'read', 'delete']);
    expect(body.steps.map((step) => step.ok)).toEqual([true, true, true, true, true, true]);
    expect(body.steps.every((step) => Number.isInteger(step.latencyMs))).toBe(true);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST https://sts.googleapis.com/v1/token',
      'POST https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/suite-worker%40luminara-suite-staging.iam.gserviceaccount.com:generateAccessToken',
      `PATCH https://firestore.googleapis.com/v1/projects/luminara-suite-staging/databases/(default)/documents/_smoke/wif-${NOW}`,
      `GET https://firestore.googleapis.com/v1/projects/luminara-suite-staging/databases/(default)/documents/_smoke/wif-${NOW}`,
      `DELETE https://firestore.googleapis.com/v1/projects/luminara-suite-staging/databases/(default)/documents/_smoke/wif-${NOW}`,
    ]);
    expect(calls[1].auth).toBe(`Bearer ${FEDERATED}`);
    expect(calls[2].auth).toBe(`Bearer ${ACCESS}`);
    expect(calls[2].body).toContain('"probe"');
    expect(text).not.toContain(FEDERATED);
    expect(text).not.toContain(ACCESS);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('PRIVATE KEY');
    const stsBody = JSON.parse(calls[0].body) as { subjectToken?: string };
    expect(text).not.toContain(stsBody.subjectToken);
    expect(calls.some((call) => call.url.includes('/documents/users/') || call.url.includes('/documents/audits/'))).toBe(false);
  });
});

describe('runWifSmoke failures', () => {
  it('stops before Firestore when STS rejects the JWT', async () => {
    const pem = await signingPem();
    const { fetchImpl, calls } = stubChain({ stsStatus: 403 });
    const report = await runWifSmoke(wifEnv(pem), { fetch: fetchImpl, now: NOW });
    expect(report.ok).toBe(false);
    expect(report.steps.map((step) => [step.step, step.ok, step.error])).toEqual([
      ['sign', true, undefined],
      ['sts', false, 'sts 403'],
    ]);
    expect(calls.some((call) => call.url.includes('firestore.googleapis.com'))).toBe(false);
  });

  it('deletes the doc when the read does not match and skips delete when the write fails', async () => {
    const pem = await signingPem();
    const mismatch = stubChain({ probe: 'other' });
    const badRead = await runWifSmoke(wifEnv(pem), { fetch: mismatch.fetchImpl, now: NOW });
    expect(badRead.ok).toBe(false);
    expect(badRead.steps.map((step) => [step.step, step.ok])).toEqual([
      ['sign', true],
      ['sts', true],
      ['impersonate', true],
      ['write', true],
      ['read', false],
      ['delete', true],
    ]);
    expect(badRead.steps[4].error).toBe('firestore read mismatch');
    expect(mismatch.calls.some((call) => call.method === 'DELETE')).toBe(true);

    const writeFail = stubChain({ patchStatus: 500 });
    const badWrite = await runWifSmoke(wifEnv(pem), { fetch: writeFail.fetchImpl, now: NOW });
    expect(badWrite.steps.map((step) => [step.step, step.ok, step.error])).toEqual([
      ['sign', true, undefined],
      ['sts', true, undefined],
      ['impersonate', true, undefined],
      ['write', false, 'firestore 500'],
    ]);
    expect(writeFail.calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('does not call the network when Workload Identity config is incomplete', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input));
      return new Response('', { status: 500 });
    };
    const report = await runWifSmoke({ ENVIRONMENT: 'staging' } as Env, { fetch: fetchImpl, now: NOW });
    expect(report).toEqual({
      ok: false,
      doc: `_smoke/wif-${NOW}`,
      steps: [{ step: 'sign', ok: false, latencyMs: 0, error: 'workload identity config incomplete' }],
    });
    expect(calls).toEqual([]);
  });
});

describe('wif smoke script lines', () => {
  it('prints pass and fail with latency and redacts a token in an error', () => {
    expect(formatSmokeLines({
      ok: false,
      doc: `_smoke/wif-${NOW}`,
      steps: [
        { step: 'sign', ok: true, latencyMs: 4 },
        { step: 'sts', ok: false, latencyMs: 12, error: 'Bearer eyJhbGciOiJSUzI1NiJ9.aaa.bbb' },
      ],
    })).toEqual([
      'PASS sign 4ms',
      'FAIL sts 12ms redacted',
      `doc _smoke/wif-${NOW}`,
    ]);
  });

  it('sends the admin secret and does not print it', async () => {
    const lines: string[] = [];
    let sent = '';
    const missing = await runWifSmokeCli({ ADMIN_SECRET: '   ' }, globalThis.fetch, () => {}, (line: string) => lines.push(line));
    expect(missing).toBe(1);
    expect(lines).toEqual(['FAIL config: set ADMIN_SECRET in the environment. The value is not printed.']);

    const code = await runWifSmokeCli(
      { ADMIN_SECRET: 'super-secret-value', WIF_SMOKE_URL: 'https://staging.luminarasuite.com/api/admin/wif-smoke' },
      async (_url: string, init?: RequestInit) => {
        sent = new Headers(init?.headers).get('x-admin-secret') || '';
        return new Response(JSON.stringify({
          ok: true,
          doc: '_smoke/wif-10',
          steps: [{ step: 'sign', ok: true, latencyMs: 3 }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
      (line: string) => lines.push(line),
      (line: string) => lines.push(line),
    );
    expect(code).toBe(0);
    expect(sent).toBe('super-secret-value');
    expect(lines.slice(1)).toEqual([
      expect.stringMatching(/^wif smoke https:\/\/staging\.luminarasuite\.com\/api\/admin\/wif-smoke http 200 \d+ms$/),
      'PASS sign 3ms',
      'doc _smoke/wif-10',
    ]);
    expect(lines.join('\n')).not.toContain('super-secret-value');
  });
});
