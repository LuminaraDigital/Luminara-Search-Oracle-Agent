/**
 * Luminara Visibility History: append-only audit snapshots for trend charts.
 * Browser-local first (production-ready offline); Worker KV can mirror later.
 * Falls back to in-memory storage when localStorage is unavailable (SSR / tests).
 *
 * Share of voice is stored as the two counts it is made of (brandMentionCount of
 * promptCount sampled queries). No percentage of it and no change over time is kept.
 */

import type { ShareOfVoiceSummary } from './shareOfVoiceService';

const STORAGE_KEY = 'luminara_visibility_history_v1';
const MAX_POINTS_PER_DOMAIN = 60;
const DEDUPE_MS = 500;

export interface VisibilityHistoryPoint {
  id: string;
  domain: string;
  focus: string;
  measuredAt: number;
  citationRatePercent: number;
  /** Sampled queries whose results named the brand. Null when the audit had no count. */
  brandMentionCount: number | null;
  citeWorthiness?: number;
  topCompetitor?: string | null;
  /** Sampled queries the count is taken from. */
  promptCount: number;
}

export interface VisibilityTrendSeries {
  domain: string;
  points: VisibilityHistoryPoint[];
  deltaCitationRate: number | null;
}

let memoryStore: VisibilityHistoryPoint[] = [];

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
    const probe = '__luminara_vh_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function loadAll(): VisibilityHistoryPoint[] {
  if (!canUseLocalStorage()) return [...memoryStore];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...memoryStore];
    const parsed = JSON.parse(raw) as VisibilityHistoryPoint[];
    return Array.isArray(parsed) ? parsed : [...memoryStore];
  } catch {
    return [...memoryStore];
  }
}

function saveAll(points: VisibilityHistoryPoint[]): void {
  memoryStore = [...points];
  if (!canUseLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(points));
  } catch {
    /* quota / private mode: memory still holds */
  }
}

export interface RecordVisibilityInput {
  domain: string;
  focus: string;
  citationRatePercent: number;
  shareOfVoice?: ShareOfVoiceSummary | null;
  citeWorthiness?: number;
  topCompetitor?: string | null;
  measuredAt?: number;
}

export function recordVisibilitySnapshot(input: RecordVisibilityInput): VisibilityHistoryPoint {
  const domain = normalizeDomain(input.domain);
  const point: VisibilityHistoryPoint = {
    id: `vh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    domain,
    focus: input.focus,
    measuredAt: input.measuredAt ?? Date.now(),
    citationRatePercent: Math.max(0, Math.min(100, Math.round(input.citationRatePercent))),
    brandMentionCount: input.shareOfVoice?.slices.find((slice) => slice.kind === 'brand')?.mentionCount ?? null,
    citeWorthiness: input.citeWorthiness,
    topCompetitor: input.topCompetitor ?? null,
    promptCount: input.shareOfVoice?.totalPrompts ?? 0,
  };

  const all = loadAll().filter(
    (p) => !(p.domain === domain && p.focus === point.focus && Math.abs(p.measuredAt - point.measuredAt) < DEDUPE_MS)
  );
  all.push(point);
  all.sort((a, b) => a.measuredAt - b.measuredAt);

  const byDomain = new Map<string, VisibilityHistoryPoint[]>();
  for (const p of all) {
    const list = byDomain.get(p.domain) || [];
    list.push(p);
    byDomain.set(p.domain, list);
  }
  const trimmed: VisibilityHistoryPoint[] = [];
  for (const [, list] of byDomain) {
    trimmed.push(...list.slice(-MAX_POINTS_PER_DOMAIN));
  }
  trimmed.sort((a, b) => a.measuredAt - b.measuredAt);
  saveAll(trimmed);
  return point;
}

export function getVisibilityTrend(domain: string): VisibilityTrendSeries {
  const d = normalizeDomain(domain);
  const points = loadAll().filter((p) => p.domain === d);
  if (points.length < 2) {
    return { domain: d, points, deltaCitationRate: null };
  }
  const first = points[0];
  const last = points[points.length - 1];
  return {
    domain: d,
    points,
    deltaCitationRate: last.citationRatePercent - first.citationRatePercent,
  };
}

export function clearVisibilityHistory(domain?: string): void {
  if (!domain) {
    saveAll([]);
    return;
  }
  const d = normalizeDomain(domain);
  saveAll(loadAll().filter((p) => p.domain !== d));
}

export const visibilityHistoryService = {
  record: recordVisibilitySnapshot,
  getTrend: getVisibilityTrend,
  clear: clearVisibilityHistory,
  listAll: loadAll,
};
