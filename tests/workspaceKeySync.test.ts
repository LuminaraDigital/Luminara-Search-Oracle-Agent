/**
 * BYOK keys reach the account workspace only as the client-encrypted bag, never as plain text,
 * including on a device's first sync and after a sign-out cleared the workspace meta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const putWorkspaceRemote = vi.fn();
const fetchWorkspace = vi.fn();
vi.mock('../services/apiClient', () => ({
  accountKnownSignedIn: () => true,
  apiBase: () => 'https://luminarasuite.com/api',
  fetchWorkspace: (...args: unknown[]) => fetchWorkspace(...args),
  putWorkspaceRemote: (...args: unknown[]) => putWorkspaceRemote(...args),
}));
vi.mock('../services/auth/accountBoot', () => ({ takeAccountBoot: async () => null }));

const { flushWorkspacePush, pullWorkspaceOnLogin } = await import('../services/sync/workspaceSyncService');

const SECRET = 'gsk_live_secret_value_123';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('window', { dispatchEvent: () => true });
  putWorkspaceRemote.mockResolvedValue({ ok: true, accountId: 'acct_1', updatedAt: 1 });
  localStorage.setItem('luminara_groq_key', SECRET);
  localStorage.setItem('luminara_business_dna', '{"name":"Acme"}');
});

afterEach(() => {
  vi.unstubAllGlobals();
  putWorkspaceRemote.mockReset();
  fetchWorkspace.mockReset();
});

function sentPayload() {
  expect(putWorkspaceRemote).toHaveBeenCalled();
  return (putWorkspaceRemote.mock.calls.at(-1)![0] as { payload: Record<string, unknown> }).payload;
}

describe('workspace key sync', () => {
  it('a first sign-in on a device pushes the keys encrypted, not in plain text', async () => {
    fetchWorkspace.mockResolvedValue({ ok: true, accountId: 'acct_1', updatedAt: 0, payload: {} });

    await pullWorkspaceOnLogin();

    const payload = sentPayload();
    expect(payload.keys).toBeUndefined();
    expect(payload.encryptedKeys).toBeTruthy();
    expect(JSON.stringify(payload)).not.toContain(SECRET);
  });

  it('a plain-text key map in a pulled workspace is never written to this device', async () => {
    localStorage.clear();
    fetchWorkspace.mockResolvedValue({
      ok: true,
      accountId: 'acct_1',
      updatedAt: 5,
      payload: { storage: { luminara_business_dna: '{"name":"Remote"}' }, keys: { luminara_groq_key: 'gsk_from_server' } },
    });

    await pullWorkspaceOnLogin();

    expect(localStorage.getItem('luminara_business_dna')).toBe('{"name":"Remote"}');
    expect(localStorage.getItem('luminara_groq_key')).toBeNull();
  });

  it('a key added after a sign-in that had nothing to push is still synced encrypted', async () => {
    localStorage.clear();
    fetchWorkspace.mockResolvedValue({ ok: true, accountId: 'acct_1', updatedAt: 0, payload: {} });
    await pullWorkspaceOnLogin();
    expect(putWorkspaceRemote).not.toHaveBeenCalled();

    localStorage.setItem('luminara_groq_key', SECRET);
    await flushWorkspacePush(true);

    const payload = sentPayload();
    expect(payload.encryptedKeys).toBeTruthy();
    expect(JSON.stringify(payload)).not.toContain(SECRET);
  });

  it('a push with no account in the workspace meta leaves the keys on the device', async () => {
    await flushWorkspacePush(true);

    const payload = sentPayload();
    expect(payload.keys).toBeUndefined();
    expect(payload.encryptedKeys).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain(SECRET);
    expect((payload.storage as Record<string, string>).luminara_business_dna).toBe('{"name":"Acme"}');
  });
});
