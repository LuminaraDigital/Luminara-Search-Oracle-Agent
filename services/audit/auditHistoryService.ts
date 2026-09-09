/**
 * Append-only audit memory timeline (Brand Memory foundation).
 * Browser-local with workspace sync; depth gated by plan entitlements.
 */

import { entitlementsFor, type PlanId } from '../plans/planEntitlements';

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

function loadAll(): AuditHistoryEntry[] {
  if (!canUseLocalStorage()) return [...memoryStore];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...memoryStore];
    const parsed = JSON.parse(raw) as AuditHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [...memoryStore];
  } catch {
    return [...memoryStore];
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
  citationRatePercent?: number | null;
  topCompetitor?: string | null;
  dnaCompetitors?: string[];
  clientId?: string | null;
  planId?: PlanId | string | null;
  measuredAt?: number;
}

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
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    domain,
    focus: input.focus,
    measuredAt: input.measuredAt ?? Date.now(),
    healthScore: extractHealthScore(text),
    citationRatePercent:
      typeof input.citationRatePercent === 'number' ? Math.round(input.citationRatePercent) : null,
    schemaGapCount: extractSchemaGaps(text),
    topCompetitor: input.topCompetitor ?? null,
    competitorsMentioned: extractCompetitors(text, input.dnaCompetitors),
    title: input.title || `${input.focus} audit · ${domain}`,
    summary: summary.slice(0, 400),
    reportExcerpt: text.slice(0, 4000),
    clientId: input.clientId ?? null,
    tags: [input.focus.toLowerCase(), domain],
  };

  const depth = entitlementsFor(input.planId).auditHistoryDepth;
  const all = loadAll();
  all.push(entry);
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
  return entry;
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
  STORAGE_KEY,
};
