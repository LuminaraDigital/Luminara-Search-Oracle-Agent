import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAuditHistoryRoute, sanitizeAuditEntry } from '../worker/auditHistoryRoute';
import { D1AuditHistoryRepository } from '../worker/auditHistoryRepo';
import { applyPlanned, formatDryRun, main, parseBackfillArgs, planBackfill, rowsFromExport } from '../worker/backfillFirestore';
import { readPlane } from '../worker/dataPlane';
import { auditDocId, userDocId } from '../worker/dataPlaneDocs';
import { handleGcpOidcRoute } from '../worker/gcpOidc';
import { StubGcpTokenProvider, WorkloadIdentityTokenProvider, exchangeForAccessToken } from '../worker/gcpToken';
import { decodeFields, encodeFields } from '../worker/firestoreRest';
import { D1UserLoginStore } from '../worker/userLoginRepo';
import { upsertAppUser } from '../worker/userStore';
import { runWithWaitUntil } from '../worker/welcomeEmail';
import type { Env } from '../worker/env';
import { createSqliteD1 } from './helpers/sqliteD1';

const botToken = '123456:DATA_PLANE_TEST';
const ORIGIN = 'https://luminarasuite.com';
const EMAIL = 'person@example.com';
const TOKEN = 'stub-access-token';

function initDataFor(userId: number): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Owner' }),
  };
  const dcs = Object.keys(fields).sort().map((key) => `${key}=${fields[key]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const params = new URLSearchParams(fields);
  params.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}

function makeEnv(extra: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    DB: createSqliteD1(),
    WEBAPP_URL: `${ORIGIN}/`,
    ALLOWED_ORIGINS: ORIGIN,
    BOT_TOKEN: botToken,
    ...extra,
  } as Env;
}

function entry(id: string) {
  const checked = sanitizeAuditEntry({
    id,
    domain: 'https://www.Acme.example/pricing',
    focus: 'AEO',
    measuredAt: 1_760_000_000_000,
    healthScore: 72,
    citationRatePercent: null,
    schemaGapCount: 2,
    topCompetitor: null,
    competitorsMentioned: ['Rival'],
    title: 'AEO audit',
    summary: 'Organization schema is missing.',
    reportExcerpt: `report for ${EMAIL}`,
    clientId: null,
    tags: ['aeo'],
  });
  if (!checked.ok) throw new Error(checked.error);
  return checked.entry;
}

async function putAudit(env: Env, deps?: Parameters<typeof handleAuditHistoryRoute>[2]) {
  const tasks: Promise<unknown>[] = [];
  const started = Date.now();
  const response = await runWithWaitUntil({ waitUntil: (task) => tasks.push(task) }, () =>
    handleAuditHistoryRoute(
      new Request(`${ORIGIN}/api/audits/history`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-telegram-init-data': initDataFor(42) },
        body: JSON.stringify({ entry: entry('audit-1') }),
      }),
      env,
      deps,
    ),
  );
  return { response, tasks, elapsed: Date.now() - started, body: await response.json() as { ok?: boolean; entry?: { domain?: string; measuredAt?: number } } };
}

describe('DATA_PLANE flag', () => {
  it('defaults to d1 and accepts dual and firestore', () => {
    expect(readPlane({})).toBe('d1');
    expect(readPlane({ DATA_PLANE: '' })).toBe('d1');
    expect(readPlane({ DATA_PLANE: 'd1' })).toBe('d1');
    expect(readPlane({ DATA_PLANE: ' dual ' })).toBe('dual');
    expect(readPlane({ DATA_PLANE: 'firestore' })).toBe('firestore');
  });

  it('falls back to d1 on an unknown value and omits values that are not a short token', () => {
    const lines: string[] = [];
    expect(readPlane({ DATA_PLANE: 'nope' }, (line) => lines.push(line))).toBe('d1');
    expect(readPlane({ DATA_PLANE: 'bearer secret pasted here by mistake' }, (line) => lines.push(line))).toBe('d1');
    expect(lines[0]).toContain('"value":"nope"');
    expect(lines[0]).toContain('"fallback":"d1"');
    expect(lines[1]).not.toContain('bearer');
    expect(lines[1]).not.toContain('secret');
  });

  it('is unset in wrangler config', () => {
    const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    expect(text).not.toContain('DATA_PLANE');
  });
});

describe('D1 repositories match the current tables', () => {
  it('keeps the first measuredAt, lists newest first, and trims to the cap', async () => {
    const repo = new D1AuditHistoryRepository(createSqliteD1(), 2);
    const first = { ...entry('audit-old'), measuredAt: 10 };
    const saved = await repo.upsert({ accountId: 'acct', entry: first, now: 10 });
    expect(saved?.measuredAt).toBe(10);
    const again = await repo.upsert({
      accountId: 'acct',
      entry: { ...first, measuredAt: 99, title: 'Updated' },
      now: 20,
    });
    expect(again?.measuredAt).toBe(10);
    expect(again?.title).toBe('Updated');
    await repo.upsert({ accountId: 'acct', entry: { ...entry('audit-mid'), measuredAt: 20 }, now: 30 });
    await repo.upsert({ accountId: 'acct', entry: { ...entry('audit-new'), measuredAt: 30 }, now: 40 });
    const listed = await repo.list({ accountId: 'acct', domain: '', limit: 10 });
    expect(listed.map((row) => row.id)).toEqual(['audit-new', 'audit-mid']);
  });

  it('keeps created_at and the first account_id when the login row is saved again', async () => {
    const db = createSqliteD1();
    const repo = new D1UserLoginStore(db);
    await repo.save({
      id: 'fb:abc',
      source: 'firebase',
      email: EMAIL,
      displayName: 'Pat',
      telegramId: null,
      firebaseUid: 'abc',
      createdAt: 10,
      lastSeenAt: 10,
      accountId: 'acct-1',
    });
    await repo.save({
      id: 'fb:abc',
      source: 'firebase',
      email: 'next@example.com',
      displayName: 'Pat',
      telegramId: null,
      firebaseUid: 'abc',
      createdAt: 99,
      lastSeenAt: 30,
      accountId: 'acct-2',
    });
    const row = await repo.find('fb:abc');
    expect(row?.created_at).toBe(10);
    expect(row?.account_id).toBe('acct-1');
    expect(row?.email).toBe('next@example.com');
    expect(row?.last_seen_at).toBe(30);
  });
});

describe('dual mode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the D1 row when Firestore fails and does not log the token or the report email', async () => {
    const logs: string[] = [];
    const env = makeEnv({ DATA_PLANE: 'dual', GCP_PROJECT_ID: 'luminara-suite-staging' });
    const fetchImpl = vi.fn(async () => {
      throw new Error(`boom ${TOKEN} ${EMAIL}`);
    });
    const { response, tasks, body } = await putAudit(env, {
      fetch: fetchImpl,
      tokenProvider: new StubGcpTokenProvider(TOKEN),
      log: (line) => logs.push(line),
    });
    expect(response.status).toBe(200);
    expect(body.entry?.domain).toBe('acme.example');
    await Promise.all(tasks);
    const text = logs.join('\n');
    expect(text).toContain('"outcome":"error"');
    expect(text).toContain('"entity":"audit"');
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(EMAIL);
    const row = await env.DB!.prepare(`SELECT id FROM audit_history`).first<{ id: string }>();
    expect(row?.id).toBe('audit-1');
  });

  it('returns before a hung Firestore write times out', async () => {
    let auditSettled = false;
    const env = makeEnv({ DATA_PLANE: 'dual', GCP_PROJECT_ID: 'luminara-suite-staging' });
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/users/')) return new Response('{}', { status: 200 });
      if (!init?.signal) throw new Error('missing signal');
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          auditSettled = true;
          reject(new Error('aborted'));
        });
      });
    };
    const logs: string[] = [];
    const { response, tasks, body } = await putAudit(env, {
      fetch: fetchImpl,
      tokenProvider: new StubGcpTokenProvider(TOKEN),
      timeoutMs: 40,
      log: (line) => logs.push(line),
    });
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(auditSettled).toBe(false);
    await Promise.all(tasks);
    expect(auditSettled).toBe(true);
    expect(logs.join('\n')).toContain('"outcome":"timeout"');
    const row = await env.DB!.prepare(`SELECT domain FROM audit_history`).first<{ domain: string }>();
    expect(row?.domain).toBe('acme.example');
  });

  it('does not call Firestore when the flag is d1', async () => {
    const fetchImpl = vi.fn();
    const { response } = await putAudit(makeEnv(), { fetch: fetchImpl, tokenProvider: new StubGcpTokenProvider(TOKEN) });
    expect(response.status).toBe(200);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('still writes D1 when the mirror is not configured', async () => {
    const logs: string[] = [];
    const env = { DB: createSqliteD1(), DATA_PLANE: 'dual' as const };
    const tasks: Promise<unknown>[] = [];
    const stored = await runWithWaitUntil({ waitUntil: (task) => tasks.push(task) }, () =>
      upsertAppUser(env, { id: 'fb:abc', source: 'firebase', email: EMAIL, name: 'Pat' }, { log: (line) => logs.push(line) }),
    );
    await Promise.all(tasks);
    expect(stored.email).toBe(EMAIL);
    expect(logs.join('\n')).toContain('"outcome":"unconfigured"');
    expect(logs.join('\n')).not.toContain(EMAIL);
    const row = await env.DB.prepare(`SELECT email FROM users WHERE id = ?`).bind('fb:abc').first<{ email: string }>();
    expect(row?.email).toBe(EMAIL);
  });
});

describe('Firestore wire format and OIDC', () => {
  it('round-trips the field types the mirror stores', () => {
    const encoded = encodeFields({ title: 'AEO', measuredAt: 12, rate: 1.5, email: null, tags: ['aeo'] });
    expect(encoded.measuredAt).toEqual({ integerValue: '12' });
    expect(encoded.rate).toEqual({ doubleValue: 1.5 });
    expect(encoded.email).toEqual({ nullValue: null });
    expect(decodeFields(encoded)).toEqual({ title: 'AEO', measuredAt: 12, rate: 1.5, email: null, tags: ['aeo'] });
  });

  it('serves only the public half of the JWK', async () => {
    const env = {
      GCP_OIDC_ISSUER: 'https://staging.luminarasuite.com/api/gcp-oidc',
      GCP_OIDC_PUBLIC_JWK: JSON.stringify({ kty: 'RSA', n: 'abc', e: 'AQAB', kid: 'k1', d: 'private-material' }),
    };
    const refused = handleGcpOidcRoute(new Request(`${ORIGIN}/api/gcp-oidc/jwks`), env, '/gcp-oidc/jwks');
    expect(refused?.status).toBe(404);
    expect(await refused?.text()).not.toContain('private-material');

    const ok = handleGcpOidcRoute(
      new Request(`${ORIGIN}/api/gcp-oidc/jwks`),
      { ...env, GCP_OIDC_PUBLIC_JWK: JSON.stringify({ kty: 'RSA', n: 'abc', e: 'AQAB', kid: 'k1' }) },
      '/gcp-oidc/jwks',
    );
    const body = await ok?.json() as { keys: Array<{ kid: string; d?: string }> };
    expect(body.keys[0].kid).toBe('k1');
    expect(body.keys[0].d).toBeUndefined();
  });

  it('exchanges a Worker JWT for an impersonated token and caches it', async () => {
    const pair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign'],
    );
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
    const bytes = new Uint8Array(pkcs8);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const b64 = btoa(binary).match(/.{1,64}/g)?.join('\n') ?? '';
    const armor = (label: string) => `-----${label}-----\n`;
    const pem = `${armor('BEGIN PRIVATE KEY')}${b64}\n${armor('END PRIVATE KEY')}`;
    const calls: Array<{ url: string; body: string; auth: string | null }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, body: String(init?.body ?? ''), auth: headers.get('authorization') });
      if (url.includes('sts.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'federated-token' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        accessToken: 'impersonated-token',
        expireTime: new Date(1_800_000_000_000).toISOString(),
      }), { status: 200 });
    };
    const provider = new WorkloadIdentityTokenProvider({
      audience: '//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/pool/providers/suite',
      issuer: 'https://staging.luminarasuite.com/api/gcp-oidc',
      subject: 'suite-worker',
      keyId: 'k1',
      privateKeyPem: pem,
      serviceAccountEmail: 'suite-worker@luminara-suite-staging.iam.gserviceaccount.com',
    }, fetchImpl);
    expect(await provider.getAccessToken(1_700_000_000_000)).toBe('impersonated-token');
    expect(await provider.getAccessToken(1_700_000_000_000)).toBe('impersonated-token');
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://sts.googleapis.com/v1/token');
    expect(calls[0].body).not.toContain('PRIVATE KEY');
    const stsBody: unknown = JSON.parse(calls[0].body);
    expect(isRecord(stsBody) && stsBody.scope).toBe('https://www.googleapis.com/auth/cloud-platform');
    const iamBody: unknown = JSON.parse(calls[1].body);
    expect(isRecord(iamBody) && Array.isArray(iamBody.scope) && iamBody.scope[0]).toBe('https://www.googleapis.com/auth/datastore');
    const subjectToken = isRecord(stsBody) && typeof stsBody.subjectToken === 'string' ? stsBody.subjectToken : '';
    const payloadPart = subjectToken.split('.')[1] ?? '';
    const payload: unknown = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    expect(isRecord(payload) && payload.sub).toBe('suite-worker');
    expect(isRecord(payload) && payload.iss).toBe('https://staging.luminarasuite.com/api/gcp-oidc');
    expect(calls[1].auth).toBe('Bearer federated-token');
    expect(calls[1].url).toContain('suite-worker%40luminara-suite-staging.iam.gserviceaccount.com:generateAccessToken');
    await provider.getAccessToken(1_800_000_000_000);
    expect(calls).toHaveLength(4);
  });

  it('puts the IAM reason code on the impersonate step', async () => {
    const pair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign'],
    );
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
    const bytes = new Uint8Array(pkcs8);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const b64 = btoa(binary).match(/.{1,64}/g)?.join('\n') ?? '';
    const armor = (label: string) => `-----${label}-----\n`;
    const pem = `${armor('BEGIN PRIVATE KEY')}${b64}\n${armor('END PRIVATE KEY')}`;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('sts.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'federated-token' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        error: { code: 403, message: 'Request had insufficient authentication scopes.', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] },
      }), { status: 403 });
    };
    const exchanged = await exchangeForAccessToken({
      audience: 'audience',
      issuer: 'https://staging.luminarasuite.com/api/gcp-oidc',
      subject: 'suite-worker',
      keyId: 'k1',
      privateKeyPem: pem,
      serviceAccountEmail: 'suite-worker@luminara-suite-staging.iam.gserviceaccount.com',
    }, fetchImpl);
    expect(exchanged.ok).toBe(false);
    if (exchanged.ok) return;
    const impersonate = exchanged.steps.find((step) => step.step === 'impersonate');
    expect(impersonate?.error).toBe('iam 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT');
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

describe('backfill', () => {
  const userRow = {
    id: 'fb:abc',
    source: 'firebase',
    account_id: 'acct',
    email: EMAIL,
    display_name: 'Pat',
    telegram_id: null,
    firebase_uid: 'abc',
    created_at: 10,
    last_seen_at: 20,
    welcome_sent_at: null,
    email_opt_out_at: null,
    email_unsub_token: 'unsub-secret-token',
  };
  const auditRow = {
    account_id: 'acct',
    id: 'audit-1',
    domain: 'acme.example',
    measured_at: 30,
    updated_at: 40,
    entry_json: JSON.stringify(entry('audit-1')),
  };

  it('plans deterministic ids and a second apply leaves the same documents', () => {
    const first = planBackfill({ users: [userRow], audits: [auditRow] });
    const second = planBackfill({ users: [userRow], audits: [auditRow] });
    expect(first.writes.map((write) => `${write.collection}/${write.id}`)).toEqual([
      `users/${userDocId('fb:abc')}`,
      `audits/${auditDocId('acct', 'audit-1')}`,
    ]);
    expect(second.writes).toEqual(first.writes);
    const store = new Map<string, string>();
    applyPlanned(store, first.writes);
    const snapshot = new Map(store);
    applyPlanned(store, second.writes);
    expect(store).toEqual(snapshot);
    const printed = formatDryRun(
      first.writes.filter((write) => write.collection === 'users'),
      first.writes.filter((write) => write.collection === 'audits'),
      first.skipped,
    );
    expect(printed).toContain('users: 1');
    expect(printed).toContain('audits: 1');
    expect(printed).not.toContain(EMAIL);
    expect(printed).not.toContain('unsub-secret-token');
    expect(JSON.stringify(first.writes)).not.toContain('unsub-secret-token');
  });

  it('reads a wrangler json export and refuses the prod project', () => {
    expect(rowsFromExport([{ results: [userRow], success: true }])).toEqual([userRow]);
    const refused = parseBackfillArgs(['--apply', '--project', 'luminara-suite', '--from-users', 'users.json']);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain('--i-understand-prod');
    const dry = parseBackfillArgs(['--from-users', 'users.json']);
    expect(dry.ok && dry.args.mode).toBe('dry-run');
    const both = parseBackfillArgs(['--apply', '--dry-run', '--from-users', 'users.json', '--project', 'luminara-suite-staging']);
    expect(both.ok).toBe(false);
  });

  it('dry-run prints counts and apply twice sends the same upsert', async () => {
    const files = new Map<string, string>([
      ['users.json', JSON.stringify([userRow])],
      ['audits.json', JSON.stringify([auditRow])],
    ]);
    const io = {
      readText: (path: string) => files.get(path) ?? '',
      write: () => undefined,
      writeErr: () => undefined,
    };
    let calls = 0;
    const dry = await main(['--from-users', 'users.json', '--from-audits', 'audits.json', '--project', 'luminara-suite-staging'], {
      ...io,
      write: (text) => {
        calls += 1;
        expect(text).not.toContain(EMAIL);
      },
      fetch: vi.fn(),
    });
    expect(dry).toBe(0);
    expect(calls).toBe(1);

    const patches: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      if (init?.method === 'PATCH') patches.push(String(init.body));
      return new Response('{}', { status: 200 });
    };
    const applyArgs = ['--apply', '--from-users', 'users.json', '--from-audits', 'audits.json', '--project', 'luminara-suite-staging'];
    const provider = new StubGcpTokenProvider(TOKEN);
    expect(await main(applyArgs, { ...io, fetch: fetchImpl, tokenProvider: provider })).toBe(0);
    expect(await main(applyArgs, { ...io, fetch: fetchImpl, tokenProvider: provider })).toBe(0);
    expect(patches).toHaveLength(4);
    expect(patches[0]).toBe(patches[2]);
    expect(patches[1]).toBe(patches[3]);
    expect(patches.join('\n')).not.toContain('unsub-secret-token');
  });
});
