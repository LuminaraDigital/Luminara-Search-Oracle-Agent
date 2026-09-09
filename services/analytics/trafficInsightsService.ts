/**
 * Results tracking: first-party traffic for the audited domain, with visits referred by AI
 * assistants and by search engines. Closes the loop "audit -> fix -> did it work".
 *
 * Backed by an Umami instance reached through `sidecarFetch('umami', ...)`:
 *  - self-hosted: `<url>/api/...` with `Authorization: Bearer <token>`
 *  - Umami Cloud: `https://api.umami.is/v1/...` with `x-umami-api-key`
 * In relay mode we always send `/api/...`; the Worker rewrites for Cloud.
 */
import { isSidecarConfiguredOnServer, sidecarFetch } from '../apiClient';
import { configService } from '../configService';

export type TrafficStatus = 'not_configured' | 'no_website' | 'ready' | 'error';

export interface ReferralSource { name: string; host: string; visits: number }

export interface TrafficMetric { current: number; previous: number; changePct: number | null }

export interface ReferralGroup extends TrafficMetric {
  total: number;
  previousTotal: number;
  bySource: ReferralSource[];
}

export interface TrackedWebsite { id: string; name: string; domain: string }

export interface TrafficImpact {
  status: TrafficStatus;
  domain: string;
  websiteId?: string;
  websiteName?: string;
  message?: string;
  period: { startAt: number; endAt: number; days: number };
  visitors: TrafficMetric;
  pageviews: TrafficMetric;
  visits: TrafficMetric;
  aiAssistantReferrals: { total: number; previousTotal: number; changePct: number | null; bySource: ReferralSource[] };
  searchReferrals: { total: number; previousTotal: number; changePct: number | null; bySource: ReferralSource[] };
  topReferrers: ReferralSource[];
  topPages: { path: string; views: number }[];
  fetchedAt: number;
}

export interface GetImpactOptions { days?: number; timeoutMs?: number }

const CACHE_KEY = 'luminara_traffic_impact';

// ---- Pure helpers ----------------------------------------------------------------------------

const AI_SOURCES: Array<{ name: string; hosts: string[] }> = [
  { name: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com', 'openai.com'] },
  { name: 'Perplexity', hosts: ['perplexity.ai'] },
  { name: 'Gemini', hosts: ['gemini.google.com', 'bard.google.com'] },
  { name: 'Copilot', hosts: ['copilot.microsoft.com'] },
  { name: 'Claude', hosts: ['claude.ai'] },
  { name: 'You.com', hosts: ['you.com'] },
  { name: 'Meta AI', hosts: ['meta.ai'] },
  { name: 'Poe', hosts: ['poe.com'] },
  { name: 'Mistral', hosts: ['chat.mistral.ai'] },
  { name: 'DeepSeek', hosts: ['chat.deepseek.com'] },
  { name: 'Grok', hosts: ['grok.com', 'x.ai'] },
];

const SEARCH_SOURCES: Array<{ name: string; hosts: string[] }> = [
  { name: 'Bing', hosts: ['bing.com'] },
  { name: 'DuckDuckGo', hosts: ['duckduckgo.com'] },
  { name: 'Yahoo', hosts: ['yahoo.com', 'search.yahoo.com'] },
  { name: 'Ecosia', hosts: ['ecosia.org'] },
  { name: 'Brave', hosts: ['search.brave.com'] },
  { name: 'Yandex', hosts: ['yandex.com', 'yandex.ru'] },
  { name: 'Baidu', hosts: ['baidu.com'] },
];

export function normalizeHost(input: string): string {
  let h = String(input || '').trim().toLowerCase();
  h = h.replace(/^[a-z]+:\/\//, '');
  h = h.split('/')[0].split('?')[0].split('#')[0];
  h = h.replace(/:\d+$/, '');
  h = h.replace(/^www\./, '');
  return h;
}

function hostMatches(host: string, candidate: string): boolean {
  return host === candidate || host.endsWith(`.${candidate}`);
}

export function classifyReferrer(hostInput: string): { kind: 'ai' | 'search' | 'other'; name: string } {
  const host = normalizeHost(hostInput);
  if (!host) return { kind: 'other', name: '' };
  for (const s of AI_SOURCES) {
    if (s.hosts.some(h => hostMatches(host, h))) return { kind: 'ai', name: s.name };
  }
  for (const s of SEARCH_SOURCES) {
    if (s.hosts.some(h => hostMatches(host, h))) return { kind: 'search', name: s.name };
  }
  // Any google.<tld> host that is not gemini/bard counts as Google search.
  if (/(^|\.)google\./.test(host) || host === 'google.com') return { kind: 'search', name: 'Google' };
  return { kind: 'other', name: host };
}

export function pctChange(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (prev === 0) return cur === 0 ? 0 : null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/** Umami stats fields are `{value, prev}` (v2.x), `{value, change}` (older) or a plain number. */
export function normalizeStat(raw: unknown): { value: number; prev: number | null } {
  if (typeof raw === 'number') return { value: raw, prev: null };
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const value = Number(o.value ?? 0) || 0;
    if (typeof o.prev === 'number') return { value, prev: o.prev };
    if (typeof o.change === 'number') return { value, prev: value - o.change };
    return { value, prev: null };
  }
  return { value: 0, prev: null };
}

export function domainsMatch(websiteDomain: string, target: string): boolean {
  const a = normalizeHost(websiteDomain);
  const b = normalizeHost(target);
  if (!a || !b) return false;
  return a === b || b.endsWith(`.${a}`) || a.endsWith(`.${b}`);
}

function metric(current: number, previous: number): TrafficMetric {
  return { current, previous, changePct: pctChange(current, previous) };
}

function emptyImpact(domain: string, days: number, status: TrafficStatus, message?: string): TrafficImpact {
  const endAt = Date.now();
  return {
    status,
    domain: normalizeHost(domain),
    message,
    period: { startAt: endAt - days * 86400000, endAt, days },
    visitors: metric(0, 0),
    pageviews: metric(0, 0),
    visits: metric(0, 0),
    aiAssistantReferrals: { total: 0, previousTotal: 0, changePct: null, bySource: [] },
    searchReferrals: { total: 0, previousTotal: 0, changePct: null, bySource: [] },
    topReferrers: [],
    topPages: [],
    fetchedAt: endAt,
  };
}

function groupReferrers(rows: Array<{ host: string; visits: number }>, kind: 'ai' | 'search'): ReferralSource[] {
  const byName = new Map<string, ReferralSource>();
  for (const r of rows) {
    const c = classifyReferrer(r.host);
    if (c.kind !== kind) continue;
    const existing = byName.get(c.name);
    if (existing) existing.visits += r.visits;
    else byName.set(c.name, { name: c.name, host: normalizeHost(r.host), visits: r.visits });
  }
  return [...byName.values()].sort((a, b) => b.visits - a.visits);
}

function sumVisits(sources: ReferralSource[]): number {
  return sources.reduce((acc, s) => acc + s.visits, 0);
}

// ---- Service ---------------------------------------------------------------------------------

export class TrafficInsightsService {
  private static instance: TrafficInsightsService;

  public static getInstance(): TrafficInsightsService {
    if (!TrafficInsightsService.instance) TrafficInsightsService.instance = new TrafficInsightsService();
    return TrafficInsightsService.instance;
  }

  /** True when the user configured a URL + key, or the hosted relay can reach the analytics service. */
  isConfigured(): boolean {
    const url = configService.getUmamiUrl();
    const key = configService.getUmamiApiKey();
    if (url && key) return true;
    return isSidecarConfiguredOnServer('umami');
  }

  /** Umami Cloud uses /v1, self-hosted uses /api. Relay mode always sends /api (the Worker rewrites). */
  private pathPrefix(): string {
    const direct = configService.getUmamiUrl();
    if (!direct) return '/api';
    return normalizeHost(direct) === 'api.umami.is' ? '/v1' : '/api';
  }

  private async getJson<T = any>(path: string, timeoutMs: number): Promise<T | null | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await sidecarFetch('umami', `${this.pathPrefix()}${path}`, { method: 'GET', signal: controller.signal }, {
        directBase: configService.getUmamiUrl() || undefined,
        userKey: configService.getUmamiApiKey() || undefined,
      });
      if (res === null) return null; // no way to reach the service
      if (!res.ok) throw new Error(`Analytics service answered HTTP ${res.status}`);
      const ct = (res.headers?.get?.('content-type') || '').toLowerCase();
      if (ct.includes('json')) return (await res.json()) as T;
      const raw = await res.text();
      try {
        return JSON.parse(raw) as T;
      } catch {
        throw new Error('Analytics service returned something that is not data (is it running?)');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async listWebsites(timeoutMs = 8000): Promise<TrackedWebsite[] | null> {
    const data = await this.getJson<any>('/websites', timeoutMs);
    if (data === null) return null;
    const arr: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    return arr
      .filter(w => w && (w.id || w.websiteUuid))
      .map(w => ({ id: String(w.id || w.websiteUuid), name: String(w.name || w.domain || ''), domain: String(w.domain || '') }));
  }

  async findWebsite(domain: string, timeoutMs = 8000): Promise<TrackedWebsite | null | undefined> {
    const sites = await this.listWebsites(timeoutMs);
    if (sites === null) return null;
    const target = normalizeHost(domain);
    const exact = sites.find(s => normalizeHost(s.domain) === target);
    if (exact) return exact;
    return sites.find(s => domainsMatch(s.domain, target)) ?? undefined;
  }

  /** Never throws; the result is tagged with `status`. */
  async getImpact(domain: string, opts: GetImpactOptions = {}): Promise<TrafficImpact> {
    const days = Math.max(1, Math.floor(opts.days ?? 30));
    const timeoutMs = opts.timeoutMs ?? 8000;
    try {
      const site = await this.findWebsite(domain, timeoutMs);
      if (site === null) return emptyImpact(domain, days, 'not_configured', 'Results tracking is not connected yet.');
      if (!site) return emptyImpact(domain, days, 'no_website', `No tracked site matches ${normalizeHost(domain)}. Add the tracking snippet to start measuring.`);

      const endAt = Date.now();
      const startAt = endAt - days * 86400000;
      const prevEnd = startAt;
      const prevStart = prevEnd - days * 86400000;
      const win = (s: number, e: number) => `startAt=${s}&endAt=${e}`;
      const id = encodeURIComponent(site.id);

      const [stats, curRef, prevRef, pages] = await Promise.all([
        this.getJson<any>(`/websites/${id}/stats?${win(startAt, endAt)}`, timeoutMs),
        this.getJson<any[]>(`/websites/${id}/metrics?${win(startAt, endAt)}&type=referrer`, timeoutMs),
        this.getJson<any[]>(`/websites/${id}/metrics?${win(prevStart, prevEnd)}&type=referrer`, timeoutMs),
        this.getJson<any[]>(`/websites/${id}/metrics?${win(startAt, endAt)}&type=url`, timeoutMs).catch(() => []),
      ]);

      const visitors = normalizeStat(stats?.visitors);
      const pageviews = normalizeStat(stats?.pageviews);
      const visits = normalizeStat(stats?.visits);
      // Prefer `prev` from the stats payload; older servers need a second stats call for the previous window.
      let prevStats: any;
      if (visitors.prev === null || pageviews.prev === null || visits.prev === null) {
        prevStats = await this.getJson<any>(`/websites/${id}/stats?${win(prevStart, prevEnd)}`, timeoutMs).catch(() => undefined);
      }
      const prevOf = (m: { prev: number | null }, key: string) => m.prev ?? normalizeStat(prevStats?.[key]).value;

      const toRows = (arr: any) => (Array.isArray(arr) ? arr : [])
        .map(r => ({ host: String(r?.x ?? ''), visits: Number(r?.y ?? 0) || 0 }))
        .filter(r => r.host);
      const curRows = toRows(curRef);
      const prevRows = toRows(prevRef);

      const aiNow = groupReferrers(curRows, 'ai');
      const aiPrev = groupReferrers(prevRows, 'ai');
      const searchNow = groupReferrers(curRows, 'search');
      const searchPrev = groupReferrers(prevRows, 'search');
      const aiTotal = sumVisits(aiNow);
      const aiPrevTotal = sumVisits(aiPrev);
      const searchTotal = sumVisits(searchNow);
      const searchPrevTotal = sumVisits(searchPrev);

      const impact: TrafficImpact = {
        status: 'ready',
        domain: normalizeHost(domain),
        websiteId: site.id,
        websiteName: site.name,
        period: { startAt, endAt, days },
        visitors: metric(visitors.value, prevOf(visitors, 'visitors')),
        pageviews: metric(pageviews.value, prevOf(pageviews, 'pageviews')),
        visits: metric(visits.value, prevOf(visits, 'visits')),
        aiAssistantReferrals: { total: aiTotal, previousTotal: aiPrevTotal, changePct: pctChange(aiTotal, aiPrevTotal), bySource: aiNow },
        searchReferrals: { total: searchTotal, previousTotal: searchPrevTotal, changePct: pctChange(searchTotal, searchPrevTotal), bySource: searchNow },
        topReferrers: curRows
          .map(r => ({ name: classifyReferrer(r.host).name || normalizeHost(r.host), host: normalizeHost(r.host), visits: r.visits }))
          .sort((a, b) => b.visits - a.visits)
          .slice(0, 10),
        topPages: (Array.isArray(pages) ? pages : [])
          .map(p => ({ path: String(p?.x ?? ''), views: Number(p?.y ?? 0) || 0 }))
          .filter(p => p.path)
          .sort((a, b) => b.views - a.views)
          .slice(0, 10),
        fetchedAt: Date.now(),
      };
      this.cache(impact);
      return impact;
    } catch (e: any) {
      console.warn('[ResultsTracking] getImpact failed', e);
      return emptyImpact(domain, days, 'error', e?.message || 'Could not read analytics.');
    }
  }

  private cache(impact: TrafficImpact): void {
    if (typeof window === 'undefined') return;
    try {
      const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      all[impact.domain] = impact;
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch {
      // storage full or unavailable; ignore
    }
  }

  getCached(domain: string): TrafficImpact | null {
    if (typeof window === 'undefined') return null;
    try {
      const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      const hit = all[normalizeHost(domain)];
      return hit && hit.status === 'ready' ? (hit as TrafficImpact) : null;
    } catch {
      return null;
    }
  }

  /** The snippet the owner pastes into their site's <head>. */
  trackingSnippet(websiteId: string, scriptBase: string): string {
    const base = String(scriptBase || '').replace(/\/$/, '');
    return `<script defer src="${base}/script.js" data-website-id="${websiteId}"></script>`;
  }

  summaryForLlm(impact: TrafficImpact): string {
    if (impact.status !== 'ready') {
      return `[TRAFFIC & AI REFERRALS] Results tracking not connected for ${impact.domain}; traffic figures are not measured.`;
    }
    const fmt = (m: TrafficMetric) => `${m.current} (previous ${m.previous}${m.changePct === null ? '' : `, ${m.changePct >= 0 ? '+' : ''}${m.changePct}%`})`;
    const src = (s: ReferralSource[]) => (s.length ? s.slice(0, 5).map(x => `${x.name} ${x.visits}`).join(', ') : 'none');
    const lines = [
      `[TRAFFIC & AI REFERRALS (measured from the site's own analytics, last ${impact.period.days} days)]`,
      `Visitors: ${fmt(impact.visitors)}. Visits: ${fmt(impact.visits)}. Pageviews: ${fmt(impact.pageviews)}.`,
      `Visits from AI assistants: ${impact.aiAssistantReferrals.total} (previous ${impact.aiAssistantReferrals.previousTotal}${impact.aiAssistantReferrals.changePct === null ? '' : `, ${impact.aiAssistantReferrals.changePct >= 0 ? '+' : ''}${impact.aiAssistantReferrals.changePct}%`}) — ${src(impact.aiAssistantReferrals.bySource)}.`,
      `Visits from search engines: ${impact.searchReferrals.total} (previous ${impact.searchReferrals.previousTotal}${impact.searchReferrals.changePct === null ? '' : `, ${impact.searchReferrals.changePct >= 0 ? '+' : ''}${impact.searchReferrals.changePct}%`}) — ${src(impact.searchReferrals.bySource)}.`,
    ];
    if (impact.topPages.length) lines.push(`Top pages: ${impact.topPages.slice(0, 5).map(p => `${p.path} (${p.views})`).join(', ')}.`);
    lines.push('These are measured figures, not estimates.');
    lines.push('--------------------------------------------------');
    return lines.join('\n');
  }
}

export const trafficInsightsService = TrafficInsightsService.getInstance();
