/**
 * Browser client for the two Citation Watch reads: GET /api/citation-watches and
 * GET /api/citation-watches/<id>. Same auth path as the trust client.
 */
import { apiBase, workerFetchWithAuthRetry } from '../apiClient';
import type { WatchNote } from './agentNote';

export type CitationWatchSummary = {
  id: string;
  clientId: string | null;
  domain: string;
  engine: string;
  cadence: string;
  active: boolean;
  nextRunAt: number | null;
  createdAt: number;
};

export type CitationWatchRun = {
  id: string;
  ranAt: number;
  measurementStatus: string;
  citedCount: number | null;
  promptCount: number | null;
  share: number | null;
  verdict: string;
  deltaShare: number | null;
  reason: string;
  /** Present only on runs where Oracle wrote a change note. */
  agentNote: WatchNote | null;
};

export class CitationWatchApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'CitationWatchApiError';
  }
}

async function getJson(path: string, label: string): Promise<Record<string, unknown>> {
  const r = await workerFetchWithAuthRetry(`${apiBase()}/api${path}`);
  let data: Record<string, unknown> = {};
  try {
    data = (await r.json()) as Record<string, unknown>;
  } catch {
    // Non-JSON body: fall through to the status check.
  }
  if (!r.ok || data.ok === false) {
    const code = typeof data.code === 'string' ? data.code : undefined;
    throw new CitationWatchApiError(typeof data.error === 'string' ? data.error : `${label} failed (${r.status})`, r.status, code);
  }
  return data;
}

export async function listCitationWatches(): Promise<CitationWatchSummary[]> {
  const data = await getJson('/citation-watches', 'List watches');
  return Array.isArray(data.watches) ? (data.watches as CitationWatchSummary[]) : [];
}

/** Newest run first, up to the last 30 runs. */
export async function fetchCitationWatchRuns(id: string): Promise<CitationWatchRun[]> {
  const data = await getJson(`/citation-watches/${encodeURIComponent(id)}`, 'Load watch runs');
  return Array.isArray(data.runs) ? (data.runs as CitationWatchRun[]) : [];
}
