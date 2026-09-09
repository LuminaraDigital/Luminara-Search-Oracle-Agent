/**
 * Luminara Public APIs Enrichment Service
 * Leverages high-authority open APIs (Wikidata, Internet Archive Wayback Machine, Microlink, Security Observatory)
 * to eliminate entity ambiguity in LLMs, prove domain longevity (E-E-A-T), and enrich Schema.org with canonical sameAs links.
 */

import { getApiAuthHeaders } from '../apiClient';

export interface WikidataEntityMatch {
  id: string; // e.g. "Q312" (Apple Inc.)
  label: string;
  description?: string;
  url: string; // e.g. "https://www.wikidata.org/wiki/Q312"
  wikipediaUrl?: string;
}

export interface WaybackHistoryInfo {
  hasArchive: boolean;
  earliestDate?: string; // e.g. "2001-04-12"
  archivedYearsAgo?: number; // e.g. 23
  snapshotUrl?: string;
  status: 'historic_authority' | 'established' | 'new_domain' | 'unindexed';
}

export interface MicrolinkMetadata {
  title?: string;
  description?: string;
  publisher?: string;
  image?: string;
  author?: string;
  date?: string;
  lang?: string;
}

export type MeasurementConfidence = 'full' | 'cors_limited' | 'failed';

export interface SecurityPosture {
  httpsEnforced: boolean;
  redirectsToHttps: boolean;
  hstsEnabled: boolean;
  cspDetected: boolean;
  referrerPolicy: boolean;
  xFrameOptions: boolean;
  securityTxtPresent: boolean;
  trustScore: number; // 0-100
  measurementConfidence: MeasurementConfidence;
}

export interface EnrichedEntityIntelligence {
  domain: string;
  brandName: string;
  wikidata?: WikidataEntityMatch | null;
  wayback: WaybackHistoryInfo;
  metadata?: MicrolinkMetadata | null;
  security: SecurityPosture;
  sameAsUrls: string[];
  timestamp: number;
}

const STORAGE_KEY_ENRICHMENT = 'luminara_entity_enrichment_cache';

export class PublicApisEnrichmentService {
  private static instance: PublicApisEnrichmentService;

  private constructor() {}

  public static getInstance(): PublicApisEnrichmentService {
    if (!PublicApisEnrichmentService.instance) {
      PublicApisEnrichmentService.instance = new PublicApisEnrichmentService();
    }
    return PublicApisEnrichmentService.instance;
  }

  /**
   * Resolves canonical Wikidata entity and Wikipedia URL for a brand or company
   */
  public async resolveWikidataEntity(brandName: string, domain?: string): Promise<WikidataEntityMatch | null> {
    const cleanBrand = brandName.trim();
    if (!cleanBrand || cleanBrand.length < 2) return null;

    try {
      const endpoint = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
        cleanBrand
      )}&language=en&format=json&origin=*&limit=5`;

      const res = await fetch(endpoint, {
        headers: { 'User-Agent': 'LuminaraSearchOracle/1.0 (https://luminarasuite.com)' },
      }).catch(() => null);

      if (!res || !res.ok) return null;

      const data = (await res.json()) as {
        search?: Array<{
          id: string;
          label: string;
          description?: string;
          concepturi?: string;
        }>;
      };

      if (!data.search || data.search.length === 0) return null;

      // Find the most relevant business, technology, organization, or website entity
      const lowerDomain = (domain || '').toLowerCase().replace(/^https?:\/\//, '').split('.')[0];
      const match = data.search.find((item) => {
        const desc = (item.description || '').toLowerCase();
        const lbl = (item.label || '').toLowerCase();
        return (
          desc.includes('company') ||
          desc.includes('business') ||
          desc.includes('software') ||
          desc.includes('corporation') ||
          desc.includes('organization') ||
          desc.includes('website') ||
          desc.includes('service') ||
          lbl === cleanBrand.toLowerCase() ||
          (lowerDomain && (desc.includes(lowerDomain) || lbl.includes(lowerDomain)))
        );
      }) || data.search[0];

      if (!match) return null;

      const qid = match.id;
      const wikipediaUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(match.label.replace(/\s+/g, '_'))}`;

      return {
        id: qid,
        label: match.label,
        description: match.description,
        url: `https://www.wikidata.org/wiki/${qid}`,
        wikipediaUrl,
      };
    } catch (e) {
      console.warn('[Enrichment] Wikidata search fallback', e);
      return null;
    }
  }

  /**
   * Queries Internet Archive Wayback Machine Availability API to verify domain longevity & E-E-A-T age
   */
  public async fetchWaybackDomainAge(domain: string): Promise<WaybackHistoryInfo> {
    const cleanDomain = domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();

    try {
      // Query for the earliest possible snapshot starting from 1996
      const endpoint = `https://archive.org/wayback/available?url=${encodeURIComponent(cleanDomain)}&timestamp=19960101`;
      const res = await fetch(endpoint).catch(() => null);

      if (!res || !res.ok) {
        return { hasArchive: false, status: 'unindexed' };
      }

      const data = (await res.json()) as {
        archived_snapshots?: {
          closest?: {
            available: boolean;
            url: string;
            timestamp: string; // Format: YYYYMMDDhhmmss
            status: string;
          };
        };
      };

      const closest = data?.archived_snapshots?.closest;
      if (!closest || !closest.available || !closest.timestamp) {
        return { hasArchive: false, status: 'unindexed' };
      }

      const ts = closest.timestamp;
      const year = parseInt(ts.substring(0, 4), 10);
      const month = ts.substring(4, 6) || '01';
      const day = ts.substring(6, 8) || '01';
      const earliestDate = `${year}-${month}-${day}`;

      const currentYear = new Date().getFullYear();
      const archivedYearsAgo = Math.max(0, currentYear - year);

      let status: WaybackHistoryInfo['status'] = 'established';
      if (archivedYearsAgo >= 10) status = 'historic_authority';
      else if (archivedYearsAgo <= 2) status = 'new_domain';

      return {
        hasArchive: true,
        earliestDate,
        archivedYearsAgo,
        snapshotUrl: closest.url,
        status,
      };
    } catch (e) {
      console.warn('[Enrichment] Wayback Machine fallback', e);
      return { hasArchive: false, status: 'unindexed' };
    }
  }

  /**
   * Extracts instant OpenGraph and metadata via Microlink Open API
   */
  public async fetchMicrolinkMetadata(url: string): Promise<MicrolinkMetadata | null> {
    const targetUrl = url.includes('://') ? url : `https://${url}`;

    try {
      const endpoint = `https://api.microlink.io?url=${encodeURIComponent(targetUrl)}`;
      const res = await fetch(endpoint).catch(() => null);

      if (!res || !res.ok) return null;

      const data = (await res.json()) as {
        status?: string;
        data?: {
          title?: string;
          description?: string;
          publisher?: string;
          image?: { url?: string };
          author?: string;
          date?: string;
          lang?: string;
        };
      };

      if (!data.data) return null;

      return {
        title: data.data.title,
        description: data.data.description,
        publisher: data.data.publisher,
        image: data.data.image?.url,
        author: data.data.author,
        date: data.data.date,
        lang: data.data.lang,
      };
    } catch (e) {
      console.warn('[Enrichment] Microlink metadata fallback', e);
      return null;
    }
  }

  /**
   * Audits security posture. Never invents HSTS when CORS blocks header reads.
   * Scoring: https 40 + redirects 15 + hsts 15 + csp 10 + referrer 5 + xfo 5 + security.txt 10.
   */
  public async auditSecurityPosture(url: string): Promise<SecurityPosture> {
    const testUrl = url.includes('://') ? url : `https://${url}`;
    const isHttps = testUrl.startsWith('https://');
    let hsts = false;
    let csp = false;
    let referrerPolicy = false;
    let xFrameOptions = false;
    let redirectsToHttps = false;
    let securityTxtPresent = false;
    let measurementConfidence: MeasurementConfidence = 'failed';
    let headersReadable = false;

    try {
      let res = await fetch(testUrl, { method: 'HEAD', redirect: 'follow' }).catch(() => null);
      if (!res || !res.ok) {
        res = await fetch(testUrl, { method: 'GET', redirect: 'follow' }).catch(() => null);
      }

      if (res) {
        measurementConfidence = 'full';
        try {
          const hstsVal = res.headers.get('strict-transport-security');
          const cspVal = res.headers.get('content-security-policy');
          const refVal = res.headers.get('referrer-policy');
          const xfoVal = res.headers.get('x-frame-options');
          // Opaque responses hide headers. basic/cors means we can trust get() results
          // (including honest null = header not set). Do not invent HSTS either way.
          if (res.type === 'opaque') {
            headersReadable = false;
            measurementConfidence = 'cors_limited';
          } else {
            headersReadable = true;
            measurementConfidence = 'full';
            hsts = Boolean(hstsVal);
            csp = Boolean(cspVal);
            referrerPolicy = Boolean(refVal);
            xFrameOptions = Boolean(xfoVal);
          }
          if (res.url && res.url.startsWith('https://') && testUrl.startsWith('http://')) {
            redirectsToHttps = true;
          }
        } catch {
          measurementConfidence = 'cors_limited';
        }
      }

      // Probe HTTP -> HTTPS redirect when starting from https host
      if (isHttps) {
        const httpUrl = testUrl.replace(/^https:\/\//i, 'http://');
        const redir = await fetch(httpUrl, { method: 'GET', redirect: 'follow' }).catch(() => null);
        if (redir?.url?.startsWith('https://')) {
          redirectsToHttps = true;
        } else if (!redir && measurementConfidence === 'full') {
          // leave false; do not invent
        } else if (!redir) {
          measurementConfidence = measurementConfidence === 'failed' ? 'cors_limited' : measurementConfidence;
        }
      }

      // security.txt
      try {
        const origin = new URL(testUrl).origin;
        const st = await fetch(`${origin}/.well-known/security.txt`, { method: 'GET' }).catch(() => null);
        if (st && st.ok) {
          const body = await st.text().catch(() => '');
          securityTxtPresent = /contact\s*:/i.test(body) || /canonical\s*:/i.test(body);
        }
      } catch {
        // non-fatal
      }
    } catch {
      measurementConfidence = isHttps ? 'cors_limited' : 'failed';
    }

    if (measurementConfidence === 'failed' && isHttps) {
      measurementConfidence = 'cors_limited';
    }

    // Honest scoring: never award HSTS/CSP points when headers were not readable
    const canUseHeaderSignals = measurementConfidence === 'full';
    let trustScore = isHttps ? 40 : 0;
    if (redirectsToHttps) trustScore += 15;
    if (canUseHeaderSignals && hsts) trustScore += 15;
    if (canUseHeaderSignals && csp) trustScore += 10;
    if (canUseHeaderSignals && referrerPolicy) trustScore += 5;
    if (canUseHeaderSignals && xFrameOptions) trustScore += 5;
    if (securityTxtPresent) trustScore += 10;

    return {
      httpsEnforced: isHttps,
      redirectsToHttps,
      hstsEnabled: canUseHeaderSignals ? hsts : false,
      cspDetected: canUseHeaderSignals ? csp : false,
      referrerPolicy: canUseHeaderSignals ? referrerPolicy : false,
      xFrameOptions: canUseHeaderSignals ? xFrameOptions : false,
      securityTxtPresent,
      trustScore: Math.min(100, trustScore),
      measurementConfidence,
    };
  }

  /**
   * Prefer Worker edge enrichment when available (full header visibility).
   */
  public async tryWorkerEnrichment(domain: string, brandName: string): Promise<EnrichedEntityIntelligence | null> {
    if (typeof window === 'undefined' || !window.location?.href) return null;
    try {
      const endpoint = `/api/enrichment/entity?domain=${encodeURIComponent(domain)}&brand=${encodeURIComponent(brandName)}`;
      const res = await fetch(endpoint, { headers: getApiAuthHeaders() }).catch(() => null);
      if (!res || !res.ok) return null;
      const body = (await res.json()) as { ok?: boolean; data?: EnrichedEntityIntelligence };
      if (body?.ok && body.data?.security) return body.data;
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Main aggregator: enriches domain audit with Wikidata, Wayback Machine, and security intelligence
   */
  public async enrichAudit(websiteUrl: string, brandName?: string): Promise<EnrichedEntityIntelligence> {
    const cleanDomain = websiteUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    const cleanBrand = brandName || cleanDomain.split('.')[0];

    // Check local cache first
    const cached = this.getCachedEnrichment(cleanDomain);
    if (cached && Date.now() - cached.timestamp < 24 * 3600 * 1000) {
      return cached;
    }

    // Prefer Worker (full security headers) when available
    const fromWorker = await this.tryWorkerEnrichment(cleanDomain, cleanBrand);
    if (fromWorker?.security) {
      this.cacheEnrichment(cleanDomain, fromWorker);
      return fromWorker;
    }

    // Execute in parallel for sub-second enrichment
    const [wikidata, wayback, metadata, security] = await Promise.all([
      this.resolveWikidataEntity(cleanBrand, cleanDomain),
      this.fetchWaybackDomainAge(cleanDomain),
      this.fetchMicrolinkMetadata(websiteUrl),
      this.auditSecurityPosture(websiteUrl),
    ]);

    const sameAsUrls: string[] = [];
    if (wikidata?.url) sameAsUrls.push(wikidata.url);
    if (wikidata?.wikipediaUrl) sameAsUrls.push(wikidata.wikipediaUrl);

    const result: EnrichedEntityIntelligence = {
      domain: cleanDomain,
      brandName: cleanBrand,
      wikidata,
      wayback,
      metadata,
      security,
      sameAsUrls,
      timestamp: Date.now(),
    };

    this.cacheEnrichment(cleanDomain, result);
    return result;
  }

  private getCachedEnrichment(domain: string): EnrichedEntityIntelligence | null {
    if (typeof window === 'undefined') return null;
    try {
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY_ENRICHMENT) || '{}');
      return all[domain] || null;
    } catch {
      return null;
    }
  }

  private cacheEnrichment(domain: string, data: EnrichedEntityIntelligence): void {
    if (typeof window === 'undefined') return;
    try {
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY_ENRICHMENT) || '{}');
      all[domain] = data;
      localStorage.setItem(STORAGE_KEY_ENRICHMENT, JSON.stringify(all));
    } catch (e) {
      console.warn('Failed to cache entity enrichment', e);
    }
  }
}

export const publicApisEnrichmentService = PublicApisEnrichmentService.getInstance();
