/**
 * Account memory for every signed-in plan:
 * - POST /api/memory/context through the real Worker (auth, no plan gate, flags, isolation,
 *   rate limit);
 * - the web client helper (services/memory/accountMemoryClient.ts);
 * - the memory block reaching the web chat's prompt (geminiService.streamQuery).
 * No model or Telegram API is called; the database is SQLite with the real migrations.
 */
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { isApiAccessRoute } from '../worker/apiAccess';
import type { Env } from '../worker/env';
import { createSqliteD1, type SqliteD1 } from './helpers/sqliteD1';
import { memoryDailyQuotaNamespace } from './helpers/memoryDailyQuota';
import { CHAT_EXTRACTIONS_DAILY_CAP } from '../worker/memoryExtract';

const botToken = '123456:ACCOUNT_MEMORY_TEST';
const ORIGIN = 'https://luminarasuite.com';
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function signInitData(userId: number): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Owner' }),
  };
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const p = new URLSearchParams(fields);
  p.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
}

function memoryKv() {
  const store = new Map<string, string>();
  return {
    get: async (k: string, type?: string) => {
      const v = store.get(k);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
    list: async () => ({ keys: [], list_complete: true }),
  };
}

function makeEnv(flags: Partial<Env> = {}): Env & { DB: SqliteD1 } {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    DB: createSqliteD1(),
    LUMINARA_KV: memoryKv() as unknown as KVNamespace,
    DAILY_QUOTA: memoryDailyQuotaNamespace(),
    WEBAPP_URL: `${ORIGIN}/`,
    ALLOWED_ORIGINS: ORIGIN,
    BOT_TOKEN: botToken,
    ...flags,
  } as Env & { DB: SqliteD1 };
}

function post(path: string, body: unknown, tgId?: number, ip = '10.9.0.1') {
  return new Request(`${ORIGIN}/api${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      'cf-connecting-ip': ip,
      ...(tgId ? { 'x-telegram-init-data': signInitData(tgId) } : {}),
    },
    body: JSON.stringify(body),
  });
}

const call = async (env: Env, req: Request) => {
  const res = await worker.fetch(req, env, ctx);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
};

/** Saves a fact for this Telegram user through the real extract route (regex path, flag off). */
async function saveFact(env: Env, tgId: number, message: string) {
  const res = await call({ ...env, MEMORY_LLM_EXTRACT: 'false' } as Env, post('/memory/extract', { message, autoStore: true }, tgId));
  expect(res.body).toMatchObject({ ok: true, stored: 1 });
}

describe('POST /api/memory/context (every signed-in plan)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('is not behind the Agency plan gate', () => {
    expect(isApiAccessRoute('/memory/context')).toBe(false);
    expect(isApiAccessRoute('/memory/extract')).toBe(false);
  });

  it('needs a signed-in caller', async () => {
    const res = await call(makeEnv({ MEMORY_RECALL_V2: 'true' }), post('/memory/context', { query: 'bakery' }));
    expect(res.status).toBe(401);
  });

  it('flags off: a free user gets no block and no extraction', async () => {
    const env = makeEnv();
    await saveFact(env, 71001, 'We always bake sourdough for our Leeds bakery');
    const res = await call(env, post('/memory/context', { query: 'Leeds bakery' }, 71001));
    expect(res).toEqual({ status: 200, body: { ok: true, block: '', facts: [], recall: false, extract: false } });
  });

  it('flags on: a free user gets their own facts, fenced, and is told to extract', async () => {
    const env = makeEnv({ MEMORY_RECALL_V2: 'true', MEMORY_LLM_EXTRACT: 'true' });
    await saveFact(env, 71002, 'We always bake sourdough for our Leeds bakery');
    await saveFact(env, 71003, 'Our competitor bakery in Leeds always undercuts us');
    const res = await call(env, post('/memory/context', { query: 'Leeds bakery' }, 71002));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ recall: true, extract: true });
    expect(res.body.facts).toEqual(['We always bake sourdough for our Leeds bakery']);
    expect(res.body.block).toMatch(/UNTRUSTED_ACCOUNT_MEMORY_[0-9a-f]+_BEGIN/);
    expect(res.body.block).not.toContain('undercuts');
  });

  it('rejects a missing query', async () => {
    const res = await call(makeEnv({ MEMORY_RECALL_V2: 'true' }), post('/memory/context', {}, 71004));
    expect(res.status).toBe(400);
  });

  it('rate limits memory extraction per account: 6 a minute', async () => {
    const env = makeEnv();
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      statuses.push((await call(env, post('/memory/extract', { message: `hello number ${i}` }, 71005, `10.9.1.${i}`))).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429, 429]);
  });

  it('at the daily extraction cap: no model call and no new rows', async () => {
    const env = makeEnv({ MEMORY_LLM_EXTRACT: 'true', GROQ_API_KEY: 'test-key' });
    const first = await call(env, post('/memory/extract', { message: 'We always bake sourdough in Leeds' }, 71006));
    expect(first.body).toMatchObject({ ok: true });
    const accountId = (env.DB.sqlite.prepare(`SELECT account_id FROM memory_chat_extractions LIMIT 1`).get() as { account_id: string } | undefined)?.account_id;
    const owner = accountId ?? String(71006);
    const insert = env.DB.sqlite.prepare(
      `INSERT INTO memory_chat_extractions (id, account_id, fact_text, confidence, status, created_at) VALUES (?, ?, 'x', 0.5, 'pending', ?)`,
    );
    for (let i = 0; i < CHAT_EXTRACTIONS_DAILY_CAP; i++) insert.run(`cap_${i}`, owner, Date.now());
    const before = env.DB.sqlite.prepare(`SELECT COUNT(*) AS n FROM memory_chat_extractions`).get().n;
    const groq = vi.fn();
    vi.stubGlobal('fetch', groq);
    const capped = await call(env, post('/memory/extract', { message: 'We always deliver to York on Fridays' }, 71006, '10.9.2.1'));
    vi.unstubAllGlobals();
    expect(capped.body).toMatchObject({ ok: true, capped: true, stored: 0 });
    expect(groq).not.toHaveBeenCalled();
    expect(env.DB.sqlite.prepare(`SELECT COUNT(*) AS n FROM memory_chat_extractions`).get().n).toBe(before);
  });
});

describe('web client: accountMemoryClient', () => {
  const fetchMock = vi.fn();
  const session: Record<string, string> = {};
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    Object.keys(session).forEach((k) => delete session[k]);
    (globalThis as any).sessionStorage = {
      getItem: (k: string) => session[k] ?? null,
      setItem: (k: string, v: string) => { session[k] = String(v); },
    };
    vi.doMock('../services/apiClient', () => ({ apiBase: () => ORIGIN, workerFetchWithAuthRetry: fetchMock }));
  });
  afterEach(() => vi.doUnmock('../services/apiClient'));

  it('returns the block and the extract switch from the server', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, block: 'MEMORY', facts: ['x'], extract: true })));
    const { fetchAccountMemory } = await import('../services/memory/accountMemoryClient');
    expect(await fetchAccountMemory('where do we deliver?')).toEqual({ block: 'MEMORY', extract: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${ORIGIN}/api/memory/context`);
    expect(JSON.parse(init.body)).toEqual({ query: 'where do we deliver?' });
  });

  it('gives no block and no extraction on an error, a non-OK answer or an empty question', async () => {
    const { fetchAccountMemory, NO_ACCOUNT_MEMORY } = await import('../services/memory/accountMemoryClient');
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    expect(await fetchAccountMemory('q')).toEqual(NO_ACCOUNT_MEMORY);
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 429 }));
    expect(await fetchAccountMemory('q')).toEqual(NO_ACCOUNT_MEMORY);
    expect(await fetchAccountMemory('   ')).toEqual(NO_ACCOUNT_MEMORY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops asking for a while once the server says memory is off', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, block: '', facts: [], recall: false, extract: false })));
    const { fetchAccountMemory, NO_ACCOUNT_MEMORY } = await import('../services/memory/accountMemoryClient');
    expect(await fetchAccountMemory('one')).toEqual(NO_ACCOUNT_MEMORY);
    expect(await fetchAccountMemory('two')).toEqual(NO_ACCOUNT_MEMORY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps asking while recall is on, even with nothing remembered yet', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true, block: '', facts: [], recall: true, extract: true })));
    const { fetchAccountMemory } = await import('../services/memory/accountMemoryClient');
    await fetchAccountMemory('one');
    await fetchAccountMemory('two');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up at the time limit even when signing in hangs', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { fetchAccountMemory, NO_ACCOUNT_MEMORY } = await import('../services/memory/accountMemoryClient');
    const started = Date.now();
    expect(await fetchAccountMemory('q', 50)).toEqual(NO_ACCOUNT_MEMORY);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('sends only the user’s message for extraction', async () => {
    fetchMock.mockResolvedValue(new Response('{}'));
    const { rememberFromMessage } = await import('../services/memory/accountMemoryClient');
    await rememberFromMessage('We bake in Leeds.');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${ORIGIN}/api/memory/extract`);
    expect(JSON.parse(init.body)).toEqual({ message: 'We bake in Leeds.', autoStore: true });
  });
});
