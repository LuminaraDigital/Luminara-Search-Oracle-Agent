/**
 * Append-only audit memory timeline (Brand Memory foundation).
 * Signed in, the account's D1 history (`/api/audits/history`) is the durable copy and this
 * browser list is its cache. Guests keep the browser list only. Depth gated by plan entitlements.
 */

import { entitlementsFor, type PlanId } from '../plans/planEntitlements';
import { clipPlain } from '../../utils/clipPlain';
import { notifyAuditActivity } from './auditActivity';
import { flushWorkspacePush, noteWorkspaceDirty, workspaceAccountId, workspaceHistoryReady } from '../sync/workspaceSyncService';
import { accountKnownSignedIn, apiBase, workerFetchWithAuthRetry } from '../apiClient';

const STORAGE_KEY = 'luminara_audit_history_v1';
const MAX_HARD_CAP = 500;

export interface AuditHistoryEntry {
  id: string;
  domain: string;
  focus: string;
  measuredAt: number;
  healthScore: number | null;
  citationRatePercent: number | null;
  schemaGapCount: number | null;
  topCompetitor: string | null;
  competitorsMentioned: string[];
  title: string;
  summary: string;
  reportExcerpt: string;
  clientId?: string | null;
  tags: string[];
}

let memoryStore: AuditHistoryEntry[] = [];

function normalizeDomain(raw: string): string {
  return raw
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase();
}

function canUseLocalStorage(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const probe = '__luminara_ah_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function uniqueById(entries: AuditHistoryEntry[]): AuditHistoryEntry[] {
  const map = new Map<string, AuditHistoryEntry>();
  for (const entry of entries) map.set(entry.id, entry);
  return [...map.values()];
}

function loadAll(): AuditHistoryEntry[] {
  if (!canUseLocalStorage()) return uniqueById(memoryStore);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return uniqueById(memoryStore);
    const parsed = JSON.parse(raw) as AuditHistoryEntry[];
    return uniqueById(Array.isArray(parsed) ? parsed : memoryStore);
  } catch {
    return uniqueById(memoryStore);
  }
}

function saveAll(entries: AuditHistoryEntry[]): void {
  memoryStore = [...entries];
  if (!canUseLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* quota */
  }
}

function extractHealthScore(text: string): number | null {
  const m =
    text.match(/Health\s*Score[^0-9]{0,40}(\d{1,3})\s*\/\s*100/i) ||
    text.match(/\b(\d{1,3})\s*\/\s*100\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

function extractSchemaGaps(text: string): number | null {
  const m = text.match(/schema\s+gaps?[^0-9]{0,30}(\d+)/i);
  if (m) return Number(m[1]);
  const bullets = (text.match(/^\s*[-*]\s+.*schema/gim) || []).length;
  return bullets > 0 ? bullets : null;
}

function extractCompetitors(text: string, dnaCompetitors: string[] = []): string[] {
  const found = new Set<string>();
  for (const c of dnaCompetitors) {
    if (c && text.toLowerCase().includes(c.toLowerCase())) found.add(c);
  }
  const wiki = text.matchAll(/\[\[([^\]]+)\]\]/g);
  for (const m of wiki) {
    const name = m[1].trim();
    if (name) found.add(name);
  }
  return [...found].slice(0, 20);
}

export interface RecordAuditInput {
  domain: string;
  focus: string;
  reportText: string;
  title?: string;
  healthScore?: number | null;
  citationRatePercent?: number | null;
  topCompetitor?: string | null;
  dnaCompetitors?: string[];
  clientId?: string | null;
  planId?: PlanId | string | null;
  measuredAt?: number;
  /** When this id is already saved, the row is updated instead of listed twice. */
  id?: string;
}

let auditSeq = 0;

export function recordAudit(input: RecordAuditInput): AuditHistoryEntry {
  const domain = normalizeDomain(input.domain);
  const text = input.reportText || '';
  const summary =
    text
      .split(/\n+/)
      .map((l) => l.trim())
      .find((l) => l.length > 40 && !l.startsWith('#') && !l.startsWith('|')) ||
    text.slice(0, 240);

  const entry: AuditHistoryEntry = {
    id: input.id || `audit-${Date.now()}-${(++auditSeq).toString(36)}`,
    domain,
    focus: input.focus,
    measuredAt: input.measuredAt ?? Date.now(),
    healthScore: input.healthScore !== undefined ? input.healthScore : extractHealthScore(text),
    citationRatePercent:
      typeof input.citationRatePercent === 'number' ? Math.round(input.citationRatePercent) : null,
    schemaGapCount: extractSchemaGaps(text),
    topCompetitor: input.topCompetitor ?? null,
    competitorsMentioned: extractCompetitors(text, input.dnaCompetitors),
    title: input.title || `${input.focus} audit · ${domain}`,
    summary: clipPlain(summary, 400),
    reportExcerpt: text.slice(0, 80_000),
    clientId: input.clientId ?? null,
    tags: [input.focus.toLowerCase(), domain],
  };

  const depth = entitlementsFor(input.planId).auditHistoryDepth;
  const all = loadAll();
  const existing = all.findIndex((row) => row.id === entry.id);
  const saved = existing >= 0 ? { ...entry, measuredAt: all[existing].measuredAt } : entry;
  if (existing >= 0) all[existing] = saved;
  else all.push(saved);
  all.sort((a, b) => a.measuredAt - b.measuredAt);

  let trimmed = all;
  if (depth > 0) {
    const byDomain = new Map<string, AuditHistoryEntry[]>();
    for (const e of all) {
      const list = byDomain.get(e.domain) || [];
      list.push(e);
      byDomain.set(e.domain, list);
    }
    trimmed = [];
    for (const [, list] of byDomain) {
      trimmed.push(...list.slice(-depth));
    }
  }
  if (trimmed.length > MAX_HARD_CAP) {
    trimmed = trimmed.slice(-MAX_HARD_CAP);
  }
  trimmed.sort((a, b) => a.measuredAt - b.measuredAt);
  saveAll(trimmed);
  notifyAuditActivity();
  try {
    noteWorkspaceDirty();
    void flushWorkspacePush(false);
  } catch {
    /* sync is optional when storage is unavailable */
  }
  void pushAuditToServer(saved);
  return entry;
}

const HISTORY_API = '/api/audits/history';

/** Saves one entry to the account's D1 history. Guests and failed calls keep the browser copy only. */
export async function pushAuditToServer(entry: AuditHistoryEntry): Promise<boolean> {
  if (!apiBase() || !accountKnownSignedIn()) return false;
  try {
    const res = await workerFetchWithAuthRetry(`${apiBase()}${HISTORY_API}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entry }),
    });
    if (res.ok) uploadedIds.add(entry.id);
    return res.ok;
  } catch {
    return false;
  }
}

export type ServerHistoryResult = { ok: true; entries: AuditHistoryEntry[] } | { ok: false; error: string };

const HISTORY_TIMEOUT_MS = 8_000;
/** Ids this page already sent, so a reload of the list does not send them again. */
const uploadedIds = new Set<string>();

/**
 * Reads the account's newest saved audits from the API and caches them in this browser.
 * Browser-only entries in that window (saved before this API, or while it was down) are uploaded,
 * but only when this browser's copy is known to be this account's: a failed sign-in pull can
 * leave another account's history here, and a guest's copy is not adopted by whoever signs in.
 * A copy that names another account is replaced by the server list.
 */
export async function syncAuditHistoryFromServer(limit = 8): Promise<ServerHistoryResult> {
  if (!apiBase() || !accountKnownSignedIn()) return { ok: false, error: 'Not signed in' };
  if (!workspaceHistoryReady()) return { ok: false, error: 'Account history is still loading' };
  let entries: AuditHistoryEntry[];
  let accountId: string | undefined;
  try {
    const res = await workerFetchWithAuthRetry(`${apiBase()}${HISTORY_API}?limit=${limit}`, {
      signal: AbortSignal.timeout(HISTORY_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; accountId?: string; entries?: unknown; error?: string }
      | null;
    if (!res.ok || !body?.ok || !Array.isArray(body.entries)) {
      return { ok: false, error: body?.error || `Saved reports could not be loaded (HTTP ${res.status})` };
    }
    entries = body.entries as AuditHistoryEntry[];
    accountId = body.accountId;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Saved reports could not be loaded' };
  }

  const owner = workspaceAccountId();
  const ours = Boolean(owner && accountId && owner === accountId);
  const foreign = Boolean(owner && accountId && owner !== accountId);
  for (const entry of entries) uploadedIds.add(entry.id);
  // A full page hides older server rows, so only local entries newer than its oldest row can be missing.
  const oldestShown = entries.length >= limit ? Math.min(...entries.map((e) => e.measuredAt)) : 0;
  const missing = ours
    ? listAudits({ limit }).filter((e) => !uploadedIds.has(e.id) && e.measuredAt > oldestShown)
    : [];
  const merged = uniqueById([...(foreign ? [] : loadAll()), ...entries]).sort((a, b) => a.measuredAt - b.measuredAt);
  saveAll(merged.slice(-MAX_HARD_CAP));
  notifyAuditActivity();
  void (async () => {
    for (const entry of missing) await pushAuditToServer(entry);
  })();
  return { ok: true, entries: listAudits({ limit }) };
}

export function listAudits(opts?: {
  domain?: string;
  clientId?: string | null;
  limit?: number;
}): AuditHistoryEntry[] {
  let list = loadAll();
  if (opts?.domain) {
    const d = normalizeDomain(opts.domain);
    list = list.filter((e) => e.domain === d);
  }
  if (opts?.clientId) {
    list = list.filter((e) => e.clientId === opts.clientId);
  }
  list = [...list].sort((a, b) => b.measuredAt - a.measuredAt);
  if (opts?.limit && opts.limit > 0) list = list.slice(0, opts.limit);
  return list;
}

export function getAudit(id: string): AuditHistoryEntry | null {
  return loadAll().find((e) => e.id === id) || null;
}

export function clearAuditHistory(domain?: string): void {
  if (!domain) {
    saveAll([]);
    return;
  }
  const d = normalizeDomain(domain);
  saveAll(loadAll().filter((e) => e.domain !== d));
}

export const auditHistoryService = {
  record: recordAudit,
  list: listAudits,
  get: getAudit,
  clear: clearAuditHistory,
  syncFromServer: syncAuditHistoryFromServer,
  STORAGE_KEY,
};
