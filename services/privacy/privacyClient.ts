/**
 * Client helpers for durable Weekly Decision Cards + privacy + memory RAG.
 */
import { apiBase, workerFetchWithAuthRetry } from '../apiClient';

export async function fetchWeeklyDecision(domain: string): Promise<Record<string, unknown> | null> {
  const base = apiBase();
  if (!base) return null;
  const r = await workerFetchWithAuthRetry(
    `${base}/api/weekly-decisions?domain=${encodeURIComponent(domain)}`,
  );
  if (!r.ok) return null;
  const data = (await r.json()) as { ok?: boolean; decision?: Record<string, unknown> | null };
  return data.decision ?? null;
}

export async function upsertWeeklyDecision(input: {
  domain: string;
  title: string;
  whyText?: string;
  findingId?: string;
  commitment?: { actionId: string; label: string; committedAt: number };
  dataFreshness?: 'sample' | 'live' | 'mixed';
  evidence?: unknown;
}): Promise<Record<string, unknown> | null> {
  const base = apiBase();
  if (!base) return null;
  const r = await workerFetchWithAuthRetry(`${base}/api/weekly-decisions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) return null;
  const data = (await r.json()) as { ok?: boolean; decision?: Record<string, unknown> };
  return data.decision ?? null;
}

export async function requestPrivacyExport(): Promise<{
  ok: boolean;
  jobId?: string;
  downloadToken?: string;
  error?: string;
}> {
  const base = apiBase();
  if (!base) return { ok: false, error: 'API unavailable' };
  const r = await workerFetchWithAuthRetry(`${base}/api/privacy/export`, { method: 'POST' });
  return (await r.json()) as { ok: boolean; jobId?: string; downloadToken?: string; error?: string };
}

export async function requestPrivacyDelete(): Promise<{
  ok: boolean;
  jobId?: string;
  confirmToken?: string;
  error?: string;
}> {
  const base = apiBase();
  if (!base) return { ok: false, error: 'API unavailable' };
  const r = await workerFetchWithAuthRetry(`${base}/api/privacy/delete`, { method: 'POST' });
  return (await r.json()) as { ok: boolean; jobId?: string; confirmToken?: string; error?: string };
}

export async function extractChatMemory(message: string, sessionId?: string): Promise<void> {
  const base = apiBase();
  if (!base) return;
  try {
    await workerFetchWithAuthRetry(`${base}/api/memory/extract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, sessionId, autoStore: true }),
    });
  } catch {
    /* best-effort */
  }
}
