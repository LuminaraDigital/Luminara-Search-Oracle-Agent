import { describe, expect, it } from 'vitest';
import {
  upsertAppUser,
  listAllUsers,
  linkTelegramAndFirebase,
  resolveAccountId,
  writeSubscriptionRecord,
  getWorkspace,
  putWorkspace,
  type StoredUser,
} from '../worker/userStore';

function mockKv(store = new Map<string, string>()) {
  return {
    store,
    kv: {
      get: async (key: string, type?: string) => {
        const v = store.get(key);
        if (v === undefined) return null;
        return type === 'json' ? JSON.parse(v) : v;
      },
      put: async (key: string, value: string) => { store.set(key, value); },
    } as unknown as KVNamespace,
  };
}

describe('upsertAppUser', () => {
  it('writes a KV user profile and preserves created_at on update', async () => {
    const { kv, store } = mockKv();
    await upsertAppUser({ LUMINARA_KV: kv }, { id: 'fb:abc', source: 'firebase', email: 'a@b.co', name: 'A' });
    const first = JSON.parse(store.get('user:fb:abc')!) as StoredUser;
    expect(first.firebase_uid).toBe('abc');
    expect(first.account_id).toBe('fb:abc');
    expect(first.email).toBe('a@b.co');
    const created = first.created_at;

    await new Promise((r) => setTimeout(r, 5));
    await upsertAppUser({ LUMINARA_KV: kv }, { id: 'fb:abc', source: 'firebase', email: 'c@d.co', name: 'C' });
    const second = JSON.parse(store.get('user:fb:abc')!) as StoredUser;
    expect(second.email).toBe('c@d.co');
    expect(second.created_at).toBe(created);
    expect(second.last_seen_at).toBeGreaterThanOrEqual(created);
  });

  it('maintains users:index and returns sorted user accounts with listAllUsers', async () => {
    const { kv } = mockKv();
    await upsertAppUser({ LUMINARA_KV: kv }, { id: 'fb:1', source: 'firebase', email: 'one@example.com' });
    await new Promise(r => setTimeout(r, 5));
    await upsertAppUser({ LUMINARA_KV: kv }, { id: 'tg:2', source: 'telegram', name: 'Two' });

    const all = await listAllUsers({ LUMINARA_KV: kv });
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe('tg:2');
    expect(all[1].id).toBe('fb:1');
  });
});

describe('account linking', () => {
  it('shares one account_id and mirrors an active Stars sub to the linked account', async () => {
    const { kv, store } = mockKv();
    store.set('sub:42', JSON.stringify({ plan: 'starter', expiresAt: Date.now() + 86400_000 }));

    const linked = await linkTelegramAndFirebase(
      { LUMINARA_KV: kv },
      '42',
      'uid-web',
      { email: 'owner@example.com', name: 'Owner', tgName: 'TG Owner' },
    );

    expect(linked.accountId).toBeTruthy();
    const tg = JSON.parse(store.get('user:42')!) as StoredUser;
    const fb = JSON.parse(store.get('user:fb:uid-web')!) as StoredUser;
    expect(tg.account_id).toBe(linked.accountId);
    expect(fb.account_id).toBe(linked.accountId);
    expect(await resolveAccountId({ LUMINARA_KV: kv }, 'fb:uid-web')).toBe(linked.accountId);

    const mirrored = JSON.parse(store.get(`sub:${linked.accountId}`)!) as { plan: string };
    expect(mirrored.plan).toBe('starter');
  });

  it('writeSubscriptionRecord dual-writes account and login keys', async () => {
    const { kv, store } = mockKv();
    await upsertAppUser({ LUMINARA_KV: kv }, { id: '99', source: 'telegram' });
    await writeSubscriptionRecord({ LUMINARA_KV: kv }, '99', {
      plan: 'growth',
      paymentMethod: 'ton',
      expiresAt: Date.now() + 1000,
    });
    expect(store.has('sub:99')).toBe(true);
  });
});

describe('workspace blob', () => {
  it('stores and loads a workspace payload from KV', async () => {
    const { kv } = mockKv();
    await putWorkspace({ LUMINARA_KV: kv }, 'acct-1', { storage: { luminara_business_dna: '{}' } }, 100);
    const got = await getWorkspace({ LUMINARA_KV: kv }, 'acct-1');
    expect(got?.updatedAt).toBe(100);
    expect(got?.payload.storage?.luminara_business_dna).toBe('{}');
  });
});
