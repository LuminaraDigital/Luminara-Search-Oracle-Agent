/**
 * The account workspace syncs by server version. Mount and restore are not edits, a pull takes a
 * newer server copy, a stale browser cannot push over it, and pushes never race the pull or throw.
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

const META = 'luminara_workspace_meta';
const DNA = 'luminara_business_dna';

let sync: typeof import('../services/sync/workspaceSyncService');

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

function meta(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(META) || '{}') as Record<string, unknown>;
}

function sent(call = 0): { baseVersion?: number; force?: boolean; payload: { storage?: Record<string, string> } } {
  return putWorkspaceRemote.mock.calls[call][0];
}

function serverCopy(updatedAt: number, dna?: string) {
  return { ok: true, accountId: 'acct_1', updatedAt, payload: { storage: dna ? { [DNA]: dna } : {} } };
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('window', { dispatchEvent: () => true });
  // Fresh module state (backoff, in-flight pull) for every test.
  vi.resetModules();
  sync = await import('../services/sync/workspaceSyncService');
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  putWorkspaceRemote.mockReset();
  fetchWorkspace.mockReset();
});

describe('workspace sync by server version', () => {
  it('saving what storage already holds is not an edit; a changed value is', () => {
    localStorage.setItem(DNA, '{"name":"Acme"}');

    sync.saveWorkspaceItem(DNA, '{"name":"Acme"}');
    expect(localStorage.getItem(META)).toBeNull();

    sync.saveWorkspaceItem(DNA, '{"name":"Acme Labs"}');
    expect(localStorage.getItem(DNA)).toBe('{"name":"Acme Labs"}');
    expect(meta().dirty).toBe(true);
  });

  it('a browser whose copy was stamped on mount takes the newer server copy instead of pushing over it', async () => {
    localStorage.setItem(DNA, '{"name":"week-old"}');
    // What the mount-time stamp left behind: a local clock newer than the server's last save.
    localStorage.setItem(META, JSON.stringify({ updatedAt: Date.now(), accountId: 'acct_1' }));
    const edited = Date.now() - 60_000;
    fetchWorkspace.mockResolvedValue(serverCopy(edited, '{"name":"edited on laptop"}'));

    const result = await sync.pullWorkspaceOnLogin();

    expect(result.ok).toBe(true);
    expect(localStorage.getItem(DNA)).toBe('{"name":"edited on laptop"}');
    expect(putWorkspaceRemote).not.toHaveBeenCalled();
    expect(meta()).toMatchObject({ accountId: 'acct_1', baseVersion: edited, dirty: false });
  });

  it('after sign-out and sign-in the server copy comes back', async () => {
    localStorage.setItem(DNA, '{"name":"Acme"}');
    localStorage.setItem(META, JSON.stringify({ accountId: 'acct_1', baseVersion: 500 }));
    sync.clearLocalWorkspace();
    // App's DNA effect after setDna(null): nothing stored, so nothing to save.
    sync.saveWorkspaceItem(DNA, null);
    fetchWorkspace.mockResolvedValue(serverCopy(500, '{"name":"Acme"}'));

    await sync.pullWorkspaceOnLogin();

    expect(localStorage.getItem(DNA)).toBe('{"name":"Acme"}');
    expect(putWorkspaceRemote).not.toHaveBeenCalled();
  });

  it('edits made on the version the server still has are pushed, based on that version', async () => {
    localStorage.setItem(DNA, '{"name":"new here"}');
    localStorage.setItem(META, JSON.stringify({ accountId: 'acct_1', baseVersion: 500, dirty: true }));
    fetchWorkspace.mockResolvedValue(serverCopy(500, '{"name":"old"}'));
    putWorkspaceRemote.mockResolvedValue({ ok: true, accountId: 'acct_1', updatedAt: 501 });

    await sync.pullWorkspaceOnLogin();

    expect(putWorkspaceRemote).toHaveBeenCalledTimes(1);
    expect(sent().baseVersion).toBe(500);
    expect(sent().force).toBeUndefined();
    expect(sent().payload.storage?.[DNA]).toBe('{"name":"new here"}');
    expect(meta()).toMatchObject({ baseVersion: 501, dirty: false });
  });

  it('edits based on an older version give way to the newer server copy', async () => {
    localStorage.setItem(DNA, '{"name":"stale edit"}');
    localStorage.setItem(META, JSON.stringify({ accountId: 'acct_1', baseVersion: 400, dirty: true }));
    fetchWorkspace.mockResolvedValue(serverCopy(500, '{"name":"laptop"}'));

    await sync.pullWorkspaceOnLogin();

    expect(putWorkspaceRemote).not.toHaveBeenCalled();
    expect(localStorage.getItem(DNA)).toBe('{"name":"laptop"}');
    expect(meta()).toMatchObject({ baseVersion: 500, dirty: false });
  });

  it('a push refused as stale applies the stored copy', async () => {
    localStorage.setItem(DNA, '{"name":"mine"}');
    localStorage.setItem(META, JSON.stringify({ accountId: 'acct_1', baseVersion: 400, dirty: true }));
    putWorkspaceRemote.mockResolvedValue({ ok: false, conflict: true, ...serverCopy(500, '{"name":"theirs"}') });

    await sync.flushWorkspacePush();

    expect(sent().baseVersion).toBe(400);
    expect(localStorage.getItem(DNA)).toBe('{"name":"theirs"}');
    expect(meta()).toMatchObject({ baseVersion: 500, dirty: false });
  });

  it('no push runs during the sign-in pull; an edit made meanwhile goes out after it', async () => {
    let release!: (value: unknown) => void;
    fetchWorkspace.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    putWorkspaceRemote.mockResolvedValue({ ok: true, accountId: 'acct_1', updatedAt: 501 });

    const pull = sync.pullWorkspaceOnLogin();
    localStorage.setItem(DNA, '{"name":"typed during pull"}');
    sync.noteWorkspaceDirty();
    await sync.flushWorkspacePush();
    expect(putWorkspaceRemote).not.toHaveBeenCalled();

    release(serverCopy(500));
    await pull;
    expect(putWorkspaceRemote).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_000);
    expect(putWorkspaceRemote).toHaveBeenCalledTimes(1);
    expect(sent().baseVersion).toBe(500);
    expect(sent().payload.storage?.[DNA]).toBe('{"name":"typed during pull"}');
  });

  it('two sign-in callers share one pull', async () => {
    fetchWorkspace.mockResolvedValue(serverCopy(500, '{"name":"Acme"}'));

    const [a, b] = await Promise.all([sync.pullWorkspaceOnLogin(), sync.pullWorkspaceOnLogin()]);

    expect(a).toEqual({ ok: true, accountId: 'acct_1' });
    expect(b).toEqual(a);
    expect(fetchWorkspace).toHaveBeenCalledTimes(1);
  });

  it('a push that fails offline backs off without throwing', async () => {
    localStorage.setItem(META, JSON.stringify({ accountId: 'acct_1', baseVersion: 500, dirty: true }));
    putWorkspaceRemote.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(sync.flushWorkspacePush()).resolves.toBeUndefined();
    await sync.flushWorkspacePush();
    expect(putWorkspaceRemote).toHaveBeenCalledTimes(1);
    expect(meta().dirty).toBe(true);

    vi.advanceTimersByTime(10_001);
    putWorkspaceRemote.mockResolvedValue({ ok: true, accountId: 'acct_1', updatedAt: 501 });
    await sync.flushWorkspacePush();
    expect(putWorkspaceRemote).toHaveBeenCalledTimes(2);
    expect(meta()).toMatchObject({ baseVersion: 501, dirty: false });
  });
});
