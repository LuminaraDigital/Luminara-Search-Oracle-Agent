import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => storage[k] ?? null,
  setItem: (k: string, v: string) => { storage[k] = String(v); },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); },
};
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis;
}
(globalThis as any).localStorage = mockLocalStorage;

import { isMetricMissing } from '../components/audit/MetricModal';
import { computeRoi } from '../components/audit/ROICalculator';
import { streamOracleChat } from '../services/apiClient';
import { aiProviderService } from '../services/aiProviderService';
import { geminiService } from '../services/geminiService';
import { unifiedScraperService } from '../services/scraping/unifiedScraper';

describe('MetricModal isMetricMissing', () => {
  it('treats empty and placeholder cells as not measured', () => {
    for (const v of ['', '  ', undefined, null, '-', 'n/a', 'unknown', 'not_measured', 'Not measured']) {
      expect(isMetricMissing(v)).toBe(true);
    }
  });
  it('keeps measured values, numeric or text, as measured', () => {
    for (const v of ['42%', '$1,250', 'High', 'Yes', '0']) expect(isMetricMissing(v)).toBe(false);
  });
});

describe('ROICalculator computeRoi', () => {
  it('uses only the user inputs (no hidden conversion multiplier)', () => {
    expect(computeRoi(1000, 2, 100, 50)).toEqual({ current: 2000, projected: 3000, net: 1000 });
  });
});

describe('streamOracleChat error handling', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { protocol: 'https:', origin: 'https://api.test' });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const collect = async (signal?: AbortSignal) => {
    const out: Array<{ type: string; code?: string }> = [];
    for await (const ev of streamOracleChat({ message: 'hi', signal })) out.push(ev);
    return out;
  };

  it('yields a NETWORK error when fetch rejects so the BYOK fallback runs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const events = await collect();
    expect(events).toEqual([expect.objectContaining({ type: 'error', code: 'NETWORK' })]);
  });

  it('returns quietly when the caller aborted', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    }));
    expect(await collect(controller.signal)).toEqual([]);
  });

  it('yields a NETWORK error when the stream reader fails mid-flight', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) { ctrl.error(new TypeError('network reset')); },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    const events = await collect();
    expect(events).toEqual([expect.objectContaining({ type: 'error', code: 'NETWORK' })]);
  });
});

describe('extractBusinessDNA honesty', () => {
  const pageText = 'Luminara Digital helps independent Melbourne agencies with qualified appraisals.';

  beforeEach(() => {
    vi.restoreAllMocks();
    mockLocalStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    (globalThis as any).window = globalThis;
    (globalThis as any).localStorage = mockLocalStorage;
  });

  function luminaraPage(finalUrl = 'https://luminara.digital/') {
    return {
      success: true,
      providerUsed: 'direct' as const,
      url: 'https://luminara.digital/',
      finalUrl,
      statusCode: 200,
      title: 'Luminara Digital',
      description: pageText,
      markdown: pageText,
      formattedEvidence: pageText,
      latencyMs: 1,
      distilled: {
        title: 'Luminara Digital',
        description: pageText,
        openGraph: { site_name: 'Luminara Digital' },
        schemas: [],
        schemaTypes: [],
        headings: [],
        distilledText: pageText,
        formattedEvidence: pageText,
        stats: { rawChars: pageText.length, distilledChars: pageText.length, compressionRatio: 1 },
      },
    };
  }

  it('does not search or apply a profile for a bare word', async () => {
    const model = vi.spyOn(aiProviderService, 'getBestAvailableProvider');
    const scrape = vi.spyOn(unifiedScraperService, 'scrapeAndDistill');
    const dna = await geminiService.extractBusinessDNA('lumi');
    expect(dna.status).toBe('need_domain');
    expect(model).not.toHaveBeenCalled();
    expect(scrape).not.toHaveBeenCalled();
  });

  it('drops a namesake the model invented and keeps the page name', async () => {
    vi.spyOn(unifiedScraperService, 'scrapeAndDistill').mockResolvedValue(luminaraPage());
    vi.spyOn(aiProviderService, 'getBestAvailableProvider').mockResolvedValue({ id: 'groq' } as any);
    vi.spyOn(aiProviderService, 'generateWithFailover').mockResolvedValue({
      text: JSON.stringify({
        name: 'Lumi',
        mission: 'low-minimum-order, eco-friendly packaging',
        usp: 'Custom boxes',
        targetAudience: 'Online stores',
        competitors: ['Packlane', 'Packhelp', 'Arka'],
        perceivedGaps: ['Packaging SEO'],
        rawContext: 'Lumi is a packaging company.',
      }),
    } as any);
    const dna = await geminiService.extractBusinessDNA('https://luminara.digital');
    expect(dna.status).toBe('review');
    if (dna.status !== 'review') return;
    expect(dna.dna.name).toBe('Luminara Digital');
    expect(dna.dna.mission).toBe('');
    expect(dna.dna.competitors).toEqual([]);
    expect(dna.dna.rawContext).not.toContain('Packlane');
  });

  it('does not apply a page that redirected to a different host', async () => {
    vi.spyOn(unifiedScraperService, 'scrapeAndDistill').mockResolvedValue(luminaraPage('https://packhelp.com/'));
    vi.stubGlobal('window', { location: { origin: 'https://luminarasuite.com' }, localStorage: mockLocalStorage });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const model = vi.spyOn(aiProviderService, 'getBestAvailableProvider');
    const dna = await geminiService.extractBusinessDNA('https://luminara.digital');
    expect(dna.status).toBe('unconfirmed');
    expect(model).not.toHaveBeenCalled();
  });

  it('uses the Worker homepage read when the browser scrape fails', async () => {
    vi.spyOn(unifiedScraperService, 'scrapeAndDistill').mockResolvedValue({ ...luminaraPage(), success: false });
    vi.spyOn(aiProviderService, 'getBestAvailableProvider').mockResolvedValue(null as any);
    vi.stubGlobal('window', { location: { origin: 'https://luminarasuite.com' }, localStorage: mockLocalStorage });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      host: 'luminara.digital',
      crawl: { status: 'measured', note: 'Live crawl', robotsPresent: false, llmsPresent: false, aiTxtPresent: false },
      page: {
        finalUrl: 'https://luminara.digital/',
        title: 'Luminara Digital | Listing Growth Desk',
        description: 'Qualified appraisals for independent Melbourne agencies.',
        jsonLdTypes: [],
        noindex: false,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const dna = await geminiService.extractBusinessDNA('luminara.digital');
    expect(dna.status).toBe('review');
    if (dna.status !== 'review') return;
    expect(dna.dna.name).toBe('Luminara Digital');
    expect(dna.dna.mission).toBe('');
    expect(dna.dna.competitors).toEqual([]);
    expect(dna.dna.rawContext).toContain('Read luminara.digital.');
  });

  it('keeps missing model fields empty when the page matches', async () => {
    vi.spyOn(unifiedScraperService, 'scrapeAndDistill').mockResolvedValue(luminaraPage());
    vi.spyOn(aiProviderService, 'getBestAvailableProvider').mockResolvedValue({ id: 'groq' } as any);
    vi.spyOn(aiProviderService, 'generateWithFailover').mockResolvedValue({ text: '{"name":"Luminara Digital"}' } as any);
    const dna = await geminiService.extractBusinessDNA('https://luminara.digital');
    expect(dna.status).toBe('review');
    if (dna.status !== 'review') return;
    expect(dna.dna).toMatchObject({ name: 'Luminara Digital', mission: '', usp: '', targetAudience: '', perceivedGaps: [] });
  });
});
