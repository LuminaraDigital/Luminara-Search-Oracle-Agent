/**
 * PUT /api/workspace is a versioned write: it lands only on the stored version it was based on,
 * so a stale device gets 409 and the stored copy instead of replacing it.
 */
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { mintOpaqueSession } from '../worker/opaqueSession';
import { getWorkspace, putWorkspace } from '../worker/userStore';
import { createSqliteD1 } from './helpers/sqliteD1';

function kv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
  } as unknown as KVNamespace;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

type PutBody = { ok: boolean; conflict?: boolean; updatedAt: number; payload?: { storage?: Record<string, string> } };

const dna = (name: string) => ({ storage: { luminara_business_dna: JSON.stringify({ name }) } });

async function signedIn() {
  const env = {
    ASSETS: { fetch: async () => new Response('ok') },
    LUMINARA_KV: kv(),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    REQUIRE_TG_AUTH: 'true',
    FIREBASE_PROJECT_ID: 'demo',
  } as unknown as Env;
  const sid = await mintOpaqueSession(env, { uid: 'user42', email: 'a@example.com', name: 'Ada' });
  const headers = { cookie: `__session=${sid}`, 'cf-connecting-ip': '203.0.113.20' };
  const put = async (body: unknown) => {
    const res = await worker.fetch(new Request('https://luminarasuite.com/api/workspace', {
      method: 'PUT',
      headers: { ...headers, origin: 'https://luminarasuite.com', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), env, ctx);
    return { status: res.status, body: (await res.json()) as PutBody };
  };
  const stored = async () => {
    const res = await worker.fetch(new Request('https://luminarasuite.com/api/workspace', { headers }), env, ctx);
    return (await res.json()) as PutBody;
  };
  return { put, stored };
}

describe('PUT /api/workspace versioning', () => {
  it('a write based on an older version gets 409 and the stored copy, and changes nothing', async () => {
    const { put, stored } = await signedIn();
    const first = await put({ baseVersion: 0, payload: dna('phone') });
    expect(first.status).toBe(200);
    const second = await put({ baseVersion: first.body.updatedAt, payload: dna('laptop') });
    expect(second.status).toBe(200);
    expect(second.body.updatedAt).toBeGreaterThan(first.body.updatedAt);

    const stale = await put({ baseVersion: first.body.updatedAt, payload: dna('week-old tablet') });

    expect(stale.status).toBe(409);
    expect(stale.body.conflict).toBe(true);
    expect(stale.body.updatedAt).toBe(second.body.updatedAt);
    expect(stale.body.payload).toEqual(dna('laptop'));
    expect((await stored()).payload).toEqual(dna('laptop'));
  });

  it("an older bundle's forced wall-clock push cannot replace the stored copy", async () => {
    const { put, stored } = await signedIn();
    await put({ baseVersion: 0, payload: dna('laptop') });

    const legacy = await put({ updatedAt: Date.now() + 60_000, force: true, payload: dna('week-old phone') });

    expect(legacy.status).toBe(409);
    expect((await stored()).payload).toEqual(dna('laptop'));
  });

  it('of two writes based on the same version, one lands and the other gets 409', async () => {
    const { put, stored } = await signedIn();
    const first = await put({ baseVersion: 0, payload: dna('start') });

    const [a, b] = await Promise.all([
      put({ baseVersion: first.body.updatedAt, payload: dna('a') }),
      put({ baseVersion: first.body.updatedAt, payload: dna('b') }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? dna('a') : dna('b');
    expect((await stored()).payload).toEqual(winner);
  });
});

describe('putWorkspace compare-and-swap on D1', () => {
  it('writes only over the expected version', async () => {
    const env = { DB: createSqliteD1() };
    expect(await putWorkspace(env, 'acct', dna('a'), 10, null)).toMatchObject({ updatedAt: 10 });
    // A row exists now, so a write that expected none is refused, as is one on the wrong version.
    expect(await putWorkspace(env, 'acct', dna('b'), 11, null)).toBeNull();
    expect(await putWorkspace(env, 'acct', dna('c'), 11, 9)).toBeNull();
    expect(await putWorkspace(env, 'acct', dna('d'), 11, 10)).toMatchObject({ updatedAt: 11 });
    expect(await getWorkspace(env, 'acct')).toEqual({ accountId: 'acct', payload: dna('d'), updatedAt: 11 });
  });
});
