import { describe, expect, it } from 'vitest';
import { upsertAppUser, type StoredUser } from '../worker/userStore';

describe('upsertAppUser', () => {
  it('writes a KV user profile and preserves created_at on update', async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (key: string, type?: string) => {
        const v = store.get(key);
        if (v === undefined) return null;
        return type === 'json' ? JSON.parse(v) : v;
      },
      put: async (key: string, value: string) => { store.set(key, value); },
    } as unknown as KVNamespace;

    await upsertAppUser({ LUMINARA_KV: kv }, { id: 'fb:abc', source: 'firebase', email: 'a@b.co', name: 'A' });
    const first = JSON.parse(store.get('user:fb:abc')!) as StoredUser;
    expect(first.firebase_uid).toBe('abc');
    expect(first.email).toBe('a@b.co');
    const created = first.created_at;

    await new Promise((r) => setTimeout(r, 5));
    await upsertAppUser({ LUMINARA_KV: kv }, { id: 'fb:abc', source: 'firebase', email: 'c@d.co', name: 'C' });
    const second = JSON.parse(store.get('user:fb:abc')!) as StoredUser;
    expect(second.email).toBe('c@d.co');
    expect(second.created_at).toBe(created);
    expect(second.last_seen_at).toBeGreaterThanOrEqual(created);
  });
});
