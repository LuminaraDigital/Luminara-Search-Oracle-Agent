/**
 * Competitor watchlist: track citation gains/losses for DNA competitors + custom names.
 * Alerts surface in-app; Telegram delivery goes through Worker Sentinel keywords.
 */

import { entitlementsFor } from '../plans/planEntitlements';
import { listAudits } from '../audit/auditHistoryService';
import { noteWorkspaceDirty } from '../sync/workspaceSyncService';

const STORAGE_KEY = 'luminara_competitor_watchlist_v1';
const ALERTS_KEY = 'luminara_competitor_alerts_v1';

export interface CompetitorWatchItem {
  id: string;
  name: string;
  domain?: string;
  brandDomain: string;
  createdAt: number;
  lastSeenAt?: number;
  lastMentioned?: boolean;
  citationDelta?: number;
}

export interface CompetitorAlert {
  id: string;
  competitorName: string;
  brandDomain: string;
  change: 'gained' | 'lost';
  message: string;
  createdAt: number;
  read: boolean;
}

export function isValidCompetitorName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 100) return false;
  // Reject square brackets or literal placeholders like [Competitor A]
  if (trimmed.includes('[') || trimmed.includes(']') || trimmed.includes('{') || trimmed.includes('}')) return false;
  // Reject generic placeholders
  if (/^(competitor|rival|brand|company|entity)\s*([a-z0-9]|\b.*placeholder\b)?$/i.test(trimmed)) return false;
  if (/^\[?competitor\s+[a-z0-9]+\]?$/i.test(trimmed)) return false;
  if (/^(unknown|none|n\/?a|placeholder|null|undefined)$/i.test(trimmed)) return false;
  return true;
}

let watchMemory: CompetitorWatchItem[] = [];
let alertMemory: CompetitorAlert[] = [];

function canLS(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem('__cw_probe__', '1');
    localStorage.removeItem('__cw_probe__');
    return true;
  } catch {
    return false;
  }
}

function loadWatch(): CompetitorWatchItem[] {
  if (!canLS()) return watchMemory.filter((w) => isValidCompetitorName(w.name));
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return watchMemory.filter((w) => isValidCompetitorName(w.name));
    const parsed = JSON.parse(raw) as CompetitorWatchItem[];
    const valid = Array.isArray(parsed) ? parsed.filter((w) => isValidCompetitorName(w.name)) : watchMemory;
    return valid.filter((w) => isValidCompetitorName(w.name));
  } catch {
    return watchMemory.filter((w) => isValidCompetitorName(w.name));
  }
}

function saveWatch(items: CompetitorWatchItem[]): void {
  watchMemory = items.filter((w) => isValidCompetitorName(w.name));
  if (!canLS()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(watchMemory));
    noteWorkspaceDirty();
  } catch {
    /* ignore */
  }
}

function loadAlerts(): CompetitorAlert[] {
  if (!canLS()) return alertMemory.filter((a) => isValidCompetitorName(a.competitorName));
  try {
    const raw = localStorage.getItem(ALERTS_KEY);
    if (!raw) return alertMemory.filter((a) => isValidCompetitorName(a.competitorName));
    const parsed = JSON.parse(raw) as CompetitorAlert[];
    const valid = Array.isArray(parsed)
      ? parsed.filter((a) => isValidCompetitorName(a.competitorName))
      : alertMemory;
    return valid.filter((a) => isValidCompetitorName(a.competitorName));
  } catch {
    return alertMemory.filter((a) => isValidCompetitorName(a.competitorName));
  }
}

function saveAlerts(alerts: CompetitorAlert[]): void {
  alertMemory = alerts
    .filter((a) => isValidCompetitorName(a.competitorName))
    .slice(-100);
  if (!canLS()) return;
  try {
    localStorage.setItem(ALERTS_KEY, JSON.stringify(alertMemory));
  } catch {
    /* ignore */
  }
}

export function listWatchlist(brandDomain?: string): CompetitorWatchItem[] {
  const all = loadWatch();
  if (!brandDomain) return all;
  const d = brandDomain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
  return all.filter((w) => w.brandDomain === d);
}

export function addCompetitor(
  name: string,
  brandDomain: string,
  opts?: { domain?: string; planId?: string | null }
): CompetitorWatchItem | { error: string } {
  const limit = entitlementsFor(opts?.planId).competitorWatchLimit;
  const items = loadWatch();
  if (items.length >= limit) {
    return { error: `Watchlist limit is ${limit} on your plan.` };
  }
  const cleanName = name.trim().slice(0, 120);
  if (!cleanName || !isValidCompetitorName(cleanName)) {
    return { error: 'Please enter a valid competitor or brand name (placeholders like [Competitor A] are not allowed).' };
  }
  const bd = brandDomain
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase();
  const existing = items.find(
    (w) => w.brandDomain === bd && w.name.toLowerCase() === cleanName.toLowerCase()
  );
  if (existing) return existing;
  const item: CompetitorWatchItem = {
    id: `cw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    domain: opts?.domain,
    brandDomain: bd,
    createdAt: Date.now(),
  };
  items.push(item);
  saveWatch(items);
  return item;
}

export function removeCompetitor(id: string): void {
  saveWatch(loadWatch().filter((w) => w.id !== id));
}

export function seedFromDna(competitors: string[], brandDomain: string, planId?: string | null): number {
  let added = 0;
  for (const name of (competitors || []).filter(isValidCompetitorName)) {
    const res = addCompetitor(name, brandDomain, { planId });
    if (!('error' in res)) added++;
  }
  return added;
}

/**
 * Compare latest two audits for brandDomain and emit gained/lost alerts.
 */
export function evaluateCitationDeltas(brandDomain: string): CompetitorAlert[] {
  const audits = listAudits({ domain: brandDomain }).sort((a, b) => a.measuredAt - b.measuredAt);
  if (audits.length < 2) return [];
  const before = audits[audits.length - 2];
  const after = audits[audits.length - 1];
  const bSet = new Set(before.competitorsMentioned.map((c) => c.toLowerCase()));
  const aSet = new Set(after.competitorsMentioned.map((c) => c.toLowerCase()));
  const watch = listWatchlist(brandDomain);
  const newAlerts: CompetitorAlert[] = [];
  const now = Date.now();

  for (const w of watch) {
    const key = w.name.toLowerCase();
    const was = bSet.has(key);
    const is = aSet.has(key);
    w.lastSeenAt = now;
    w.lastMentioned = is;
    if (was && !is) {
      const alert: CompetitorAlert = {
        id: `ca-${now}-${Math.random().toString(36).slice(2, 6)}`,
        competitorName: w.name,
        brandDomain: w.brandDomain,
        change: 'lost',
        message: `[[${w.name}]] dropped out of your latest audit mentions for ${w.brandDomain}.`,
        createdAt: now,
        read: false,
      };
      newAlerts.push(alert);
      w.citationDelta = (w.citationDelta || 0) - 1;
    } else if (!was && is) {
      // Confirmed across at least two real audits before declaring GAINED
      const totalMentionAudits = audits.filter((a) =>
        a.competitorsMentioned.map((c) => c.toLowerCase()).includes(key),
      ).length;
      if (totalMentionAudits >= 2) {
        const alert: CompetitorAlert = {
          id: `ca-${now}-${Math.random().toString(36).slice(2, 6)}`,
          competitorName: w.name,
          brandDomain: w.brandDomain,
          change: 'gained',
          message: `[[${w.name}]] appeared in your latest audit for ${w.brandDomain}.`,
          createdAt: now,
          read: false,
        };
        newAlerts.push(alert);
        w.citationDelta = (w.citationDelta || 0) + 1;
      }
    }
  }

  saveWatch(watch);
  if (newAlerts.length) {
    saveAlerts([...loadAlerts(), ...newAlerts]);
  }
  return newAlerts;
}

export function listAlerts(unreadOnly = false): CompetitorAlert[] {
  const all = loadAlerts().sort((a, b) => b.createdAt - a.createdAt);
  return unreadOnly ? all.filter((a) => !a.read) : all;
}

export function markAlertsRead(): void {
  saveAlerts(loadAlerts().map((a) => ({ ...a, read: true })));
}

/** Keywords for Worker Sentinel registration (competitor queries). */
export function sentinelKeywordsFor(brandDomain: string, brandName: string): string[] {
  const watch = listWatchlist(brandDomain);
  const base = [`what is ${brandName}`, `best ${brandName} alternative`];
  for (const w of watch.slice(0, 6)) {
    base.push(`${brandName} vs ${w.name}`);
    base.push(`best ${w.name} alternative`);
  }
  return [...new Set(base)].slice(0, 10);
}

export const competitorWatchlistService = {
  list: listWatchlist,
  add: addCompetitor,
  remove: removeCompetitor,
  seedFromDna,
  evaluate: evaluateCitationDeltas,
  listAlerts,
  markAlertsRead,
  sentinelKeywordsFor,
  isValidCompetitorName,
  STORAGE_KEY,
  ALERTS_KEY,
};
