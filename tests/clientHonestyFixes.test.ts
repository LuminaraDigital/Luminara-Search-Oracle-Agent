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
  beforeEach(() => {
    vi.restoreAllMocks();
    mockLocalStorage.clear();
  });

  it('returns empty fields (not invented claims) when no model answers', async () => {
    vi.spyOn(aiProviderService, 'getBestAvailableProvider').mockResolvedValue(null as any);
    const dna = await geminiService.extractBusinessDNA('Acme Corp');
    expect(dna.name).toBe('Acme Corp');
    expect(dna.mission).toBe('');
    expect(dna.usp).toBe('');
    expect(dna.targetAudience).toBe('');
    expect(dna.competitors).toEqual([]);
    expect(dna.perceivedGaps).toEqual([]);
  });

  it('keeps missing model fields empty', async () => {
    vi.spyOn(aiProviderService, 'getBestAvailableProvider').mockResolvedValue({ id: 'groq' } as any);
    vi.spyOn(aiProviderService, 'generateWithFailover').mockResolvedValue({ text: '{"name":"Acme"}' } as any);
    const dna = await geminiService.extractBusinessDNA('Acme Corp');
    expect(dna).toMatchObject({ name: 'Acme', mission: '', usp: '', targetAudience: '', perceivedGaps: [] });
  });
});
