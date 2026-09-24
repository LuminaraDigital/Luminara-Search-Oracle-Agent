/**
 * DataForSEO LLM Mentions → EngineVisibilityResult (W4).
 */
import type { EngineVisibilityResult, VisibilityEngineId } from './engineVisibilityTypes';
import { notMeasuredEngine } from './engineVisibilityTypes';
import { dfsFirstResult } from '../tools/dfsParse';

export type DfsPostFn = (
  path: string,
  payload: unknown,
) => Promise<{ ok: boolean; body: unknown; error?: string; code?: string }>;

const PLATFORM_MAP: Record<string, VisibilityEngineId> = {
  chat_gpt: 'chatgpt',
  chatgpt: 'chatgpt',
  google: 'google_aio',
  google_ai_overview: 'google_aio',
  perplexity: 'perplexity',
};

function mapPlatform(raw: string | undefined): VisibilityEngineId | null {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/\s+/g, '_');
  return PLATFORM_MAP[key] || null;
}

/**
 * Fetch LLM Mentions for a domain/brand across target platforms.
 */
export async function fetchDataForSeoMentions(opts: {
  dfsPost: DfsPostFn;
  domain: string;
  brand?: string;
  queries?: string[];
  locationCode?: number;
  languageCode?: string;
}): Promise<EngineVisibilityResult[]> {
  const measuredAt = Date.now();
  const target = opts.domain.replace(/^www\./, '');
  const keyword = opts.queries?.[0] || opts.brand || target;
  const payload = [
    {
      keywords: [keyword],
      location_code: opts.locationCode || 2840,
      language_code: opts.languageCode || 'en',
      platform: 'google',
      filters: ['and', [['domain', '=', target]]],
      limit: 20,
    },
  ];

  // Try google + chat_gpt platforms in parallel when API supports platform field.
  const platforms = ['google', 'chat_gpt', 'perplexity'] as const;
  const results: EngineVisibilityResult[] = [];

  for (const platform of platforms) {
    const engine = mapPlatform(platform);
    if (!engine) continue;
    const bodyPayload = [{ ...payload[0], platform }];
    const res = await opts.dfsPost(
      '/v3/ai_optimization/llm_mentions/search_mentions/live',
      bodyPayload,
    );
    if (!res.ok) {
      results.push(notMeasuredEngine(engine, res.error || res.code || 'DFS_MENTIONS_FAILED', measuredAt));
      continue;
    }
    const first = dfsFirstResult(res.body);
    if (first && typeof first === 'object' && (first as { _dfsTaskError?: boolean })._dfsTaskError) {
      results.push(notMeasuredEngine(engine, 'DFS task error', measuredAt));
      continue;
    }
    const rows = Array.isArray(first) ? first : [];
    const evidence = rows.slice(0, 10).map((row) => {
      const r = row as Record<string, unknown>;
      const snippet = String(r.answer || r.snippet || r.title || '').slice(0, 400);
      const cited =
        snippet.toLowerCase().includes(target.toLowerCase()) ||
        (opts.brand ? snippet.toLowerCase().includes(opts.brand.toLowerCase()) : false) ||
        Boolean(r.mentioned);
      return {
        query: keyword,
        cited,
        answerSnippet: snippet || undefined,
        sources: Array.isArray(r.sources) ? (r.sources as string[]).map(String) : undefined,
      };
    });
    if (!evidence.length) {
      results.push(notMeasuredEngine(engine, 'Empty DFS mentions result', measuredAt));
      continue;
    }
    const citedCount = evidence.filter((e) => e.cited).length;
    results.push({
      engine,
      measurementStatus: 'measured',
      method: 'dataforseo_llm_mentions',
      cited: citedCount > 0,
      citationRatePercent: Math.round((citedCount / evidence.length) * 100),
      evidence,
      measuredAt,
    });
  }

  return results;
}
