import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Allora CL0-1, client half: local ingest keeps a synced server id, and an unsynced row patches by stable key.

const calls: Array<{ url: string; init: RequestInit }> = [];
let reply: unknown = null;

vi.mock('../services/apiClient', () => ({
  apiBase: () => 'https://api.test',
  workerFetchWithAuthRetry: async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply), { status: reply ? 200 : 404 });
  },
}));
vi.mock('../services/sync/workspaceSyncService', () => ({ noteWorkspaceDirty: () => {} }));

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}

const SERVER_ID = 'fnd_0123456789abcdef01234567';
const crew = {
  id: 'finding-schema-org',
  category: 'schema' as const,
  severity: 'critical' as const,
  title: 'Missing Organization / Brand Entity Schema',
  description: 'No Organization markup',
};

beforeEach(() => {
  calls.length = 0;
  reply = null;
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('finding board client ids (Allora CL0-1)', () => {
  it('sends the crew rule id as provenance and keeps the server id across a re-audit', async () => {
    const { ingestCrewFindings } = await import('../services/audit/findingBoardService');
    const [first] = await ingestCrewFindings({ domain: 'movida.com.au', findings: [crew], syncRemote: false });
    expect(first.id).toBe('finding-schema-org');
    expect((first.evidence as { provenance?: unknown }).provenance).toEqual({ ruleId: 'finding-schema-org' });

    // The server answered an earlier sync with its own id.
    sessionStorage.setItem(
      'luminara_findings_v1_movida.com.au',
      JSON.stringify([{ ...first, id: SERVER_ID, synced: true, status: 'in_progress' }]),
    );
    const [again] = await ingestCrewFindings({ domain: 'movida.com.au', findings: [crew], syncRemote: false });
    expect(again.id).toBe(SERVER_ID);
    expect(again.status).toBe('in_progress');
  });

  it('stores the rule id and at most 3 target URLs as provenance (Allora CL0-5)', async () => {
    const { ingestCrewFindings } = await import('../services/audit/findingBoardService');
    const urls = ['a', 'b', 'c', 'd'].map((p) => `https://movida.com.au/${p}`);
    const [row] = await ingestCrewFindings({
      domain: 'movida.com.au',
      findings: [{ ...crew, id: 'finding-thin-content', ruleId: 'finding-thin-content', targetUrls: urls, category: 'content_quality', title: 'This page is too short' }],
      syncRemote: false,
    });
    expect((row.evidence as { provenance?: unknown }).provenance).toEqual({
      ruleId: 'finding-thin-content',
      targetUrls: urls.slice(0, 3),
    });
  });

  it('patches an unsynced row by stable key with its domain, and a synced row by server id', async () => {
    const { ingestCrewFindings, patchFindingStatus, isServerFindingId } = await import(
      '../services/audit/findingBoardService'
    );
    expect(isServerFindingId(SERVER_ID)).toBe(true);
    expect(isServerFindingId('finding-schema-org')).toBe(false);
    expect(isServerFindingId('fk_0011aabb_2233ccdd')).toBe(false);

    const [row] = await ingestCrewFindings({ domain: 'www.movida.com.au', findings: [crew], syncRemote: false });
    reply = { finding: { ...row, id: SERVER_ID, status: 'done' } };
    await patchFindingStatus('www.movida.com.au', row.id, 'done');
    expect(calls[0].url).toBe(`https://api.test/api/findings/${encodeURIComponent(row.stableKey)}`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ status: 'done', domain: 'movida.com.au' });

    await patchFindingStatus('movida.com.au', SERVER_ID, 'open');
    expect(calls[1].url).toBe(`https://api.test/api/findings/${SERVER_ID}`);
  });
});
