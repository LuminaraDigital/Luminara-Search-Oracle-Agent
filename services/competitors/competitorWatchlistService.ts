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
  if (!canLS()) return [...watchMemory];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...watchMemory];
    const parsed = JSON.parse(raw) as CompetitorWatchItem[];
    return Array.isArray(parsed) ? parsed : [...watchMemory];
  } catch {
    return [...watchMemory];
  }
}

function saveWatch(items: CompetitorWatchItem[]): void {
  watchMemory = [...items];
  if (!canLS()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    noteWorkspaceDirty();
  } catch {
    /* ignore */
  }
}

function loadAlerts(): CompetitorAlert[] {
  if (!canLS()) return [...alertMemory];
  try {
    const raw = localStorage.getItem(ALERTS_KEY);
    if (!raw) return [...alertMemory];
    const parsed = JSON.parse(raw) as CompetitorAlert[];
    return Array.isArray(parsed) ? parsed : [...alertMemory];
  } catch {
    return [...alertMemory];
  }
}

function saveAlerts(alerts: CompetitorAlert[]): void {
  alertMemory = alerts.slice(-100);
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
  if (!cleanName) return { error: 'Competitor name required' };
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
  for (const name of competitors || []) {
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
  STORAGE_KEY,
  ALERTS_KEY,
};
