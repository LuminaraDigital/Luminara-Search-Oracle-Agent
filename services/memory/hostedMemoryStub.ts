/**
 * Hosted memory facts client (W8). Dual-write localStorage + Worker D1 API.
 * Vectorize embedding remains optional until an index is provisioned.
 */
import { apiBase, workerFetchWithAuthRetry } from '../apiClient';

export type MemoryFactStub = {
  id: string;
  accountId: string;
  text: string;
  createdAt: number;
  source: 'local' | 'hosted';
};

const LOCAL_KEY = 'luminara_memory_facts_v1';

export function listLocalMemoryFacts(accountId: string): MemoryFactStub[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const all = JSON.parse(raw) as MemoryFactStub[];
    return all.filter((f) => f.accountId === accountId).slice(0, 100);
  } catch {
    return [];
  }
}

export function appendLocalMemoryFact(accountId: string, text: string): MemoryFactStub {
  const fact: MemoryFactStub = {
    id: `mem_${Date.now().toString(36)}`,
    accountId,
    text: text.slice(0, 2000),
    createdAt: Date.now(),
    source: 'local',
  };
  if (typeof localStorage === 'undefined') return fact;
  const existing = listLocalMemoryFacts(accountId);
  const next = [fact, ...existing].slice(0, 100);
  let all: MemoryFactStub[] = [];
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    all = raw ? (JSON.parse(raw) as MemoryFactStub[]) : [];
  } catch {
    all = [];
  }
  const others = all.filter((f) => f.accountId !== accountId);
  localStorage.setItem(LOCAL_KEY, JSON.stringify([...next, ...others].slice(0, 500)));
  return fact;
}

/** Fetch hosted D1 memory facts. Falls back to empty when API unavailable. */
export async function fetchHostedMemoryFacts(accountId: string): Promise<{
  facts: MemoryFactStub[];
  code: 'OK' | 'MEMORY_HOSTED_PENDING' | 'AUTH_REQUIRED' | 'ERROR';
}> {
  const base = apiBase();
  if (!base) {
    return { facts: listLocalMemoryFacts(accountId), code: 'MEMORY_HOSTED_PENDING' };
  }
  try {
    const r = await workerFetchWithAuthRetry(`${base}/api/memory/facts`);
    if (r.status === 401) {
      return { facts: listLocalMemoryFacts(accountId), code: 'AUTH_REQUIRED' };
    }
    if (!r.ok) {
      return { facts: listLocalMemoryFacts(accountId), code: 'ERROR' };
    }
    const data = (await r.json()) as {
      ok?: boolean;
      facts?: Array<{
        id: string;
        accountId: string;
        text: string;
        source?: string;
        createdAt: number;
      }>;
    };
    const facts: MemoryFactStub[] = (data.facts || []).map((f) => ({
      id: f.id,
      accountId: f.accountId,
      text: f.text,
      createdAt: f.createdAt,
      source: 'hosted' as const,
    }));
    return { facts, code: 'OK' };
  } catch {
    return { facts: listLocalMemoryFacts(accountId), code: 'ERROR' };
  }
}

/** Dual-write: local first, then hosted when signed in. */
export async function appendMemoryFactDual(
  accountId: string,
  text: string,
): Promise<MemoryFactStub> {
  const local = appendLocalMemoryFact(accountId, text);
  const base = apiBase();
  if (!base) return local;
  try {
    const r = await workerFetchWithAuthRetry(`${base}/api/memory/facts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) return local;
    const data = (await r.json()) as { ok?: boolean; fact?: MemoryFactStub };
    if (data.fact) {
      return { ...data.fact, source: 'hosted' };
    }
  } catch {
    // keep local
  }
  return local;
}
