import { describe, expect, it } from 'vitest';
import {
  upsertAppUser,
  listAllUsers,
  linkTelegramAndFirebase,
  AccountLinkRefusedError,
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
    expect(linked.accountId).toBe('42');
  });

  it('merges onto the paid Firebase account when only that side is paid', async () => {
    const { kv, store } = mockKv();
    store.set('sub:fb:uid-web', JSON.stringify({ plan: 'growth', expiresAt: Date.now() + 86400_000 }));

    const linked = await linkTelegramAndFirebase(
      { LUMINARA_KV: kv },
      '42',
      'uid-web',
      { email: 'owner@example.com', name: 'Owner', tgName: 'TG Owner' },
    );

    expect(linked.accountId).toBe('fb:uid-web');
    const tg = JSON.parse(store.get('user:42')!) as StoredUser;
    const fb = JSON.parse(store.get('user:fb:uid-web')!) as StoredUser;
    expect(tg.account_id).toBe('fb:uid-web');
    expect(fb.account_id).toBe('fb:uid-web');
    expect(store.has('sub:42')).toBe(false);
  });

  it('refuses when both sides have distinct active paid plans and writes nothing', async () => {
    const { kv, store } = mockKv();
    const future = Date.now() + 86400_000;
    store.set('user:42', JSON.stringify({
      id: '42',
      source: 'telegram',
      account_id: 'acct-tg',
      created_at: 1_000,
      last_seen_at: 1_000,
    }));
    store.set('user:fb:uid-web', JSON.stringify({
      id: 'fb:uid-web',
      source: 'firebase',
      account_id: 'acct-fb',
      created_at: 2_000,
      last_seen_at: 2_000,
    }));
    store.set('sub:acct-tg', JSON.stringify({ plan: 'starter', expiresAt: future }));
    store.set('sub:acct-fb', JSON.stringify({ plan: 'growth', expiresAt: future }));
    const before = new Map(store);

    await expect(linkTelegramAndFirebase(
      { LUMINARA_KV: kv },
      '42',
      'uid-web',
    )).rejects.toBeInstanceOf(AccountLinkRefusedError);

    expect(store.get('user:42')).toBe(before.get('user:42'));
    expect(store.get('user:fb:uid-web')).toBe(before.get('user:fb:uid-web'));
    expect(store.get('sub:acct-tg')).toBe(before.get('sub:acct-tg'));
    expect(store.get('sub:acct-fb')).toBe(before.get('sub:acct-fb'));
    expect(store.size).toBe(before.size);
  });

  it('still links when both paid flags belong to the same account', async () => {
    const { kv, store } = mockKv();
    const future = Date.now() + 86400_000;
    store.set('user:42', JSON.stringify({
      id: '42',
      source: 'telegram',
      account_id: 'acct-shared',
      telegram_id: '42',
      created_at: 1_000,
      last_seen_at: 1_000,
    }));
    store.set('user:fb:uid-web', JSON.stringify({
      id: 'fb:uid-web',
      source: 'firebase',
      account_id: 'acct-shared',
      firebase_uid: 'uid-web',
      created_at: 2_000,
      last_seen_at: 2_000,
    }));
    store.set('sub:acct-shared', JSON.stringify({ plan: 'agency', expiresAt: future }));

    const linked = await linkTelegramAndFirebase({ LUMINARA_KV: kv }, '42', 'uid-web');
    expect(linked.accountId).toBe('acct-shared');
    const tg = JSON.parse(store.get('user:42')!) as StoredUser;
    const fb = JSON.parse(store.get('user:fb:uid-web')!) as StoredUser;
    expect(tg.account_id).toBe('acct-shared');
    expect(fb.account_id).toBe('acct-shared');
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
