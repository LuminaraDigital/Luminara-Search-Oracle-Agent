import { describe, expect, it, beforeEach, vi } from 'vitest';
import { publicApisEnrichmentService } from '../services/enrichment/publicApisEnrichmentService';

const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => storage[k] || null,
  setItem: (k: string, v: string) => { storage[k] = String(v); },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
};

if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis;
}
(globalThis as any).localStorage = mockLocalStorage;

describe('PublicApisEnrichmentService', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    vi.restoreAllMocks();
  });

  describe('resolveWikidataEntity', () => {
    it('successfully resolves QID and concept URI for known entity', async () => {
      const mockResponse = {
        search: [
          {
            id: 'Q95',
            label: 'Google',
            description: 'American multinational technology company',
            concepturi: 'http://www.wikidata.org/entity/Q95'
          }
        ]
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const entity = await publicApisEnrichmentService.resolveWikidataEntity('Google', 'google.com');
      expect(entity).not.toBeNull();
      expect(entity?.id).toBe('Q95');
      expect(entity?.label).toBe('Google');
      expect(entity?.description).toBe('American multinational technology company');
      expect(entity?.url).toBe('https://www.wikidata.org/wiki/Q95');
      expect(entity?.wikipediaUrl).toBe('https://en.wikipedia.org/wiki/Google');
    });

    it('returns null gracefully when no entity matches', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ search: [] }),
      } as Response);

      const entity = await publicApisEnrichmentService.resolveWikidataEntity('NonExistentBrandXyz999');
      expect(entity).toBeNull();
    });

    it('handles network failure without throwing', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const entity = await publicApisEnrichmentService.resolveWikidataEntity('Google');
      expect(entity).toBeNull();
    });
  });

  describe('fetchWaybackDomainAge', () => {
    it('calculates historical age and historic authority status correctly', async () => {
      const mockWayback = {
        archived_snapshots: {
          closest: {
            available: true,
            url: 'http://web.archive.org/web/19981111184551/http://google.com:80/',
            timestamp: '19981111184551',
            status: '200'
          }
        }
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockWayback,
      } as Response);

      const history = await publicApisEnrichmentService.fetchWaybackDomainAge('google.com');
      expect(history.hasArchive).toBe(true);
      expect(history.earliestDate).toBe('1998-11-11');
      expect(history.archivedYearsAgo).toBeGreaterThanOrEqual(25);
      expect(history.status).toBe('historic_authority');
      expect(history.snapshotUrl).toContain('web.archive.org');
    });

    it('classifies newer domain as established or new_domain', async () => {
      const currentYear = new Date().getFullYear();
      const recentYear = currentYear - 1;
      const mockWayback = {
        archived_snapshots: {
          closest: {
            available: true,
            url: `http://web.archive.org/web/${recentYear}0101000000/http://newstartup.io/`,
            timestamp: `${recentYear}0101000000`,
            status: '200'
          }
        }
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockWayback,
      } as Response);

      const history = await publicApisEnrichmentService.fetchWaybackDomainAge('newstartup.io');
      expect(history.hasArchive).toBe(true);
      expect(history.earliestDate).toBe(`${recentYear}-01-01`);
      expect(history.status).toBe('new_domain');
    });

    it('returns unindexed status gracefully when no archive snapshot exists', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ archived_snapshots: {} }),
      } as Response);

      const history = await publicApisEnrichmentService.fetchWaybackDomainAge('brand-new-site-2026.com');
      expect(history.hasArchive).toBe(false);
      expect(history.status).toBe('unindexed');
    });
  });

  describe('fetchMicrolinkMetadata', () => {
    it('extracts metadata from Microlink public API', async () => {
      const mockMicrolink = {
        status: 'success',
        data: {
          title: 'Luminara Suite - Autonomous Search Optimization',
          description: 'AEO and GEO intelligence engine',
          publisher: 'Luminara',
          image: { url: 'https://luminarasuite.com/og.png' },
          logo: { url: 'https://luminarasuite.com/logo.svg' }
        }
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockMicrolink,
      } as Response);

      const meta = await publicApisEnrichmentService.fetchMicrolinkMetadata('luminarasuite.com');
      expect(meta).not.toBeNull();
      expect(meta?.title).toBe('Luminara Suite - Autonomous Search Optimization');
      expect(meta?.publisher).toBe('Luminara');
      expect(meta?.image).toBe('https://luminarasuite.com/og.png');
    });
  });

  describe('auditSecurityPosture', () => {
    it('scores full header signals without inventing values', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const u = String(input);
        const method = (init as RequestInit | undefined)?.method || 'GET';
        if (u.includes('security.txt')) {
          return {
            ok: true,
            status: 200,
            type: 'basic',
            text: async () => 'Contact: mailto:security@apple.com\nCanonical: https://apple.com/.well-known/security.txt\n',
            headers: new Headers(),
          } as unknown as Response;
        }
        if (u.startsWith('http://')) {
          return {
            ok: true,
            status: 200,
            type: 'basic',
            url: 'https://apple.com/',
            headers: new Headers(),
          } as unknown as Response;
        }
        if (method === 'HEAD' || method === 'GET') {
          return {
            ok: true,
            status: 200,
            type: 'basic',
            url: 'https://apple.com/',
            headers: new Headers({
              'strict-transport-security': 'max-age=31536000',
              'content-security-policy': "default-src 'self'",
              'referrer-policy': 'no-referrer',
              'x-frame-options': 'DENY',
            }),
          } as unknown as Response;
        }
        return { ok: false, status: 404, type: 'basic', headers: new Headers() } as unknown as Response;
      });

      const posture = await publicApisEnrichmentService.auditSecurityPosture('https://apple.com');
      expect(posture.httpsEnforced).toBe(true);
      expect(posture.hstsEnabled).toBe(true);
      expect(posture.cspDetected).toBe(true);
      expect(posture.referrerPolicy).toBe(true);
      expect(posture.xFrameOptions).toBe(true);
      expect(posture.securityTxtPresent).toBe(true);
      expect(posture.redirectsToHttps).toBe(true);
      expect(posture.measurementConfidence).toBe('full');
      // 40+15+15+10+5+5+10 = 100
      expect(posture.trustScore).toBe(100);
    });

    it('never invents HSTS when CORS/network blocks header reads', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Failed to fetch'));

      const posture = await publicApisEnrichmentService.auditSecurityPosture('https://cors-blocked.example');
      expect(posture.httpsEnforced).toBe(true);
      expect(posture.hstsEnabled).toBe(false);
      expect(posture.cspDetected).toBe(false);
      expect(posture.referrerPolicy).toBe(false);
      expect(posture.xFrameOptions).toBe(false);
      expect(posture.measurementConfidence).toBe('cors_limited');
      expect(posture.trustScore).toBe(40);
    });

    it('treats opaque responses as cors_limited without fake HSTS', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 0,
        type: 'opaque',
        url: '',
        headers: new Headers(),
      } as unknown as Response);

      const posture = await publicApisEnrichmentService.auditSecurityPosture('https://opaque.example');
      expect(posture.hstsEnabled).toBe(false);
      expect(posture.measurementConfidence).toBe('cors_limited');
      expect(posture.trustScore).toBeLessThanOrEqual(55);
    });
  });

  describe('enrichAudit orchestration', () => {
    it('aggregates all public API sources and formats sameAs URIs', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const u = String(input);
        if (u.includes('/api/enrichment/entity')) {
          return { ok: false, status: 404, headers: new Headers() } as unknown as Response;
        }
        if (u.includes('wikidata.org')) {
          return {
            ok: true,
            json: async () => ({
              search: [{
                id: 'Q312',
                label: 'Apple Inc.',
                description: 'American multinational technology company',
                concepturi: 'http://www.wikidata.org/entity/Q312',
              }],
            }),
          } as unknown as Response;
        }
        if (u.includes('archive.org')) {
          return {
            ok: true,
            json: async () => ({
              archived_snapshots: {
                closest: {
                  available: true,
                  url: 'http://web.archive.org/web/19970414000000/http://apple.com/',
                  timestamp: '19970414000000',
                },
              },
            }),
          } as unknown as Response;
        }
        if (u.includes('microlink.io')) {
          return {
            ok: true,
            json: async () => ({
              status: 'success',
              data: { title: 'Apple Official Site', publisher: 'Apple' },
            }),
          } as unknown as Response;
        }
        if (u.includes('security.txt')) {
          return {
            ok: true,
            status: 200,
            type: 'basic',
            text: async () => 'Contact: mailto:security@apple.com\n',
            headers: new Headers(),
          } as unknown as Response;
        }
        if (u.startsWith('http://')) {
          return {
            ok: true,
            status: 200,
            type: 'basic',
            url: 'https://apple.com/',
            headers: new Headers(),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          type: 'basic',
          url: 'https://apple.com/',
          headers: new Headers({
            'strict-transport-security': 'max-age=31536000; includeSubDomains',
            'content-security-policy': "default-src 'self'",
          }),
        } as unknown as Response;
      });

      const enriched = await publicApisEnrichmentService.enrichAudit('https://apple.com', 'Apple Inc.');

      expect(enriched.domain).toBe('apple.com');
      expect(enriched.brandName).toBe('Apple Inc.');
      expect(enriched.wikidata?.id).toBe('Q312');
      expect(enriched.wayback.status).toBe('historic_authority');
      expect(enriched.security.httpsEnforced).toBe(true);
      expect(enriched.security.hstsEnabled).toBe(true);
      expect(enriched.security.measurementConfidence).toBe('full');
      expect(enriched.sameAsUrls).toContain('https://www.wikidata.org/wiki/Q312');
      expect(enriched.sameAsUrls).toContain('https://en.wikipedia.org/wiki/Apple_Inc.');
    });

    it('utilizes localStorage cache on repeated calls', async () => {
      const cachedData = {
        domain: 'cached-domain.com',
        brandName: 'Cached Brand',
        wikidata: {
          id: 'Q12345',
          label: 'Cached Brand',
          description: 'A cached test entity',
          url: 'https://www.wikidata.org/wiki/Q12345',
          wikipediaUrl: 'https://en.wikipedia.org/wiki/Cached_Brand',
        },
        wayback: {
          hasArchive: true,
          earliestDate: '2010-01-01',
          archivedYearsAgo: 16,
          status: 'historic_authority' as const,
        },
        metadata: null,
        security: {
          httpsEnforced: true,
          redirectsToHttps: true,
          hstsEnabled: true,
          cspDetected: false,
          referrerPolicy: false,
          xFrameOptions: false,
          securityTxtPresent: false,
          trustScore: 70,
          measurementConfidence: 'full' as const,
        },
        sameAsUrls: ['https://www.wikidata.org/wiki/Q12345'],
        timestamp: Date.now(),
      };

      storage['luminara_entity_enrichment_cache'] = JSON.stringify({
        'cached-domain.com': cachedData,
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const result = await publicApisEnrichmentService.enrichAudit('cached-domain.com', 'Cached Brand');

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.wikidata?.id).toBe('Q12345');
      expect(result.domain).toBe('cached-domain.com');
      expect(result.wayback.status).toBe('historic_authority');
      expect(result.security.measurementConfidence).toBe('full');
    });
  });
});
