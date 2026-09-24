/**
 * Live DataForSEO paid research tool handlers (shared by MCP registry).
 */
import { findResearchLogHit, researchLogHitResult } from './researchLogGate';
import type { PaidToolRuntime, ToolResult } from './types';
import { dfsFirstResult } from './dfsParse';
import { runVisibilityRouter } from '../visibility/engineVisibilityRouter';

function requireString(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function notMeasured(text: string, structured: Record<string, unknown>): ToolResult {
  return {
    text,
    structuredContent: { measurementStatus: 'not_measured', ...structured },
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export async function researchKeywords(
  args: Record<string, unknown>,
  rt: PaidToolRuntime,
): Promise<ToolResult> {
  if (!rt.canUsePaid) {
    return {
      text: 'Paid research requires Agency plan or x-provider-key with DataForSEO login:password (BYOK).',
      structuredContent: { code: 'PAID_TOOL_FORBIDDEN' },
      isError: true,
    };
  }
  const projectId = requireString(args, 'projectId');
  if (!projectId) return { text: 'projectId required', isError: true };
  const project = await rt.getProject(projectId);
  if (!project) return { text: 'Project not found', isError: true };
  const seeds = Array.isArray(args.seeds)
    ? args.seeds.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim()).slice(0, 5)
    : [];
  if (!seeds.length) return { text: 'seeds required (1-5)', isError: true };

  const log = await rt.getResearchLog(projectId);
  const hit = findResearchLogHit(log, ['keyword', ...seeds]);
  if (hit) return researchLogHitResult(hit, 'research_keywords');

  const locationCode = Number(project.default_location_code) || 2840;
  const languageCode = project.default_language_code || 'en';
  const payload = [
    {
      keywords: seeds,
      location_code: locationCode,
      language_code: languageCode,
      include_seed_keyword: true,
      limit: 20,
    },
  ];

  const res = await rt.dfsPost('/v3/dataforseo_labs/google/keyword_suggestions/live', payload);
  if (!res.ok) {
    const summary = `Keyword research: seeds=${seeds.join(', ')}. Verdict: not_measured (${res.code || 'DFS_ERROR'}: ${res.error || 'upstream'}).`;
    // Do not append: failed runs must not poison the 30-day reuse gate.
    return notMeasured(summary, { seeds, keywords: [], code: res.code || 'DFS_ERROR', error: res.error });
  }

  const result = dfsFirstResult(res.body);
  if (result && typeof result === 'object' && (result as { _dfsTaskError?: boolean })._dfsTaskError) {
    const summary = `Keyword research: seeds=${seeds.join(', ')}. Verdict: not_measured (DFS task error).`;
    return notMeasured(summary, { seeds, keywords: [], code: 'DFS_TASK_ERROR', detail: result });
  }

  const rows = asArray(result);
  const keywords = rows.slice(0, 20).map((row) => {
    const r = row as Record<string, unknown>;
    const kw = (r.keyword_data as Record<string, unknown> | undefined) || r;
    const info = (kw.keyword_info as Record<string, unknown> | undefined) || {};
    return {
      keyword: String(kw.keyword || r.keyword || ''),
      searchVolume: typeof info.search_volume === 'number' ? info.search_volume : null,
      competition: typeof info.competition === 'number' ? info.competition : null,
    };
  }).filter((k) => k.keyword);

  if (!keywords.length) {
    const summary = `Keyword research: seeds=${seeds.join(', ')}. Verdict: not_measured (empty DFS result).`;
    return notMeasured(summary, { seeds, keywords: [], code: 'DFS_EMPTY' });
  }

  const top = keywords
    .slice(0, 5)
    .map((k) => `${k.keyword}${k.searchVolume != null ? ` (vol ${k.searchVolume})` : ''}`)
    .join('; ');
  const summary = `Keyword research: seeds=${seeds.join(', ')}. Top ideas: ${top}.`;
  await rt.appendResearchLog(projectId, summary);
  return {
    text: summary,
    structuredContent: {
      measurementStatus: 'measured',
      seeds,
      keywords,
      code: 'OK',
    },
  };
}

export async function getDomainOverview(
  args: Record<string, unknown>,
  rt: PaidToolRuntime,
): Promise<ToolResult> {
  if (!rt.canUsePaid) {
    return {
      text: 'Paid research requires Agency plan or DataForSEO BYOK via x-provider-key.',
      structuredContent: { code: 'PAID_TOOL_FORBIDDEN' },
      isError: true,
    };
  }
  const projectId = requireString(args, 'projectId');
  if (!projectId) return { text: 'projectId required', isError: true };
  const project = await rt.getProject(projectId);
  if (!project) return { text: 'Project not found', isError: true };
  const domain = (requireString(args, 'domain') || project.domain).replace(/^www\./, '');

  const log = await rt.getResearchLog(projectId);
  const hit = findResearchLogHit(log, ['domain overview', domain]);
  if (hit) return researchLogHitResult(hit, 'get_domain_overview');

  const locationCode = Number(project.default_location_code) || 2840;
  const languageCode = project.default_language_code || 'en';
  const payload = [{ target: domain, location_code: locationCode, language_code: languageCode }];

  const res = await rt.dfsPost('/v3/dataforseo_labs/google/domain_rank_overview/live', payload);
  if (!res.ok) {
    const summary = `Domain overview: ${domain}. Verdict: not_measured (${res.code || 'DFS_ERROR'}).`;
    return notMeasured(summary, { domain, code: res.code || 'DFS_ERROR', error: res.error });
  }

  const result = dfsFirstResult(res.body);
  const rows = asArray(result);
  const first = (rows[0] || result) as Record<string, unknown> | null;
  if (!first || typeof first !== 'object' || (first as { _dfsTaskError?: boolean })._dfsTaskError) {
    const summary = `Domain overview: ${domain}. Verdict: not_measured (empty or task error).`;
    return notMeasured(summary, { domain, code: 'DFS_EMPTY' });
  }

  const metrics = (first.metrics as Record<string, unknown> | undefined) || first;
  const organic = (metrics.organic as Record<string, unknown> | undefined) || metrics;
  const overview = {
    domain,
    organicEtv: typeof organic.etv === 'number' ? organic.etv : null,
    organicCount: typeof organic.count === 'number' ? organic.count : null,
    organicPos1: typeof organic.pos_1 === 'number' ? organic.pos_1 : null,
  };

  const summary = `Domain overview: ${domain}. Organic count=${overview.organicCount ?? 'unknown'}, etv=${overview.organicEtv ?? 'unknown'}.`;
  await rt.appendResearchLog(projectId, summary);
  return {
    text: summary,
    structuredContent: { measurementStatus: 'measured', ...overview, code: 'OK' },
  };
}

export async function getSerpResults(
  args: Record<string, unknown>,
  rt: PaidToolRuntime,
): Promise<ToolResult> {
  if (!rt.canUsePaid) {
    return {
      text: 'Paid research requires Agency plan or DataForSEO BYOK via x-provider-key.',
      structuredContent: { code: 'PAID_TOOL_FORBIDDEN' },
      isError: true,
    };
  }
  const projectId = requireString(args, 'projectId');
  if (!projectId) return { text: 'projectId required', isError: true };
  const project = await rt.getProject(projectId);
  if (!project) return { text: 'Project not found', isError: true };
  const query = requireString(args, 'query');
  if (!query) return { text: 'query required', isError: true };

  const log = await rt.getResearchLog(projectId);
  const hit = findResearchLogHit(log, ['serp', query]);
  if (hit) return researchLogHitResult(hit, 'get_serp_results');

  const locationCode = Number(project.default_location_code) || 2840;
  const languageCode = project.default_language_code || 'en';
  const payload = [
    {
      keyword: query,
      location_code: locationCode,
      language_code: languageCode,
      depth: 10,
    },
  ];

  const res = await rt.dfsPost('/v3/serp/google/organic/live/advanced', payload);
  if (!res.ok) {
    const summary = `SERP: ${query}. Verdict: not_measured (${res.code || 'DFS_ERROR'}).`;
    return notMeasured(summary, { query, results: [], code: res.code || 'DFS_ERROR', error: res.error });
  }

  const result = dfsFirstResult(res.body);
  const rows = asArray(result);
  const items = asArray(
    rows.length && typeof rows[0] === 'object' && rows[0] && 'items' in (rows[0] as object)
      ? (rows[0] as { items?: unknown[] }).items
      : rows,
  );

  const results = items
    .filter((it) => it && typeof it === 'object' && (it as { type?: string }).type === 'organic')
    .slice(0, 10)
    .map((it) => {
      const o = it as Record<string, unknown>;
      return {
        rank: typeof o.rank_group === 'number' ? o.rank_group : typeof o.rank_absolute === 'number' ? o.rank_absolute : null,
        title: String(o.title || ''),
        url: String(o.url || ''),
        domain: String(o.domain || ''),
      };
    });

  if (!results.length) {
    const summary = `SERP: ${query}. Verdict: not_measured (empty organic results).`;
    return notMeasured(summary, { query, results: [], code: 'DFS_EMPTY' });
  }

  const summary = `SERP: ${query}. Top: ${results
    .slice(0, 3)
    .map((r) => r.domain || r.url)
    .join(', ')}.`;
  await rt.appendResearchLog(projectId, summary);
  return {
    text: summary,
    structuredContent: { measurementStatus: 'measured', query, results, code: 'OK' },
  };
}

export async function getBacklinksOverview(
  args: Record<string, unknown>,
  rt: PaidToolRuntime,
): Promise<ToolResult> {
  if (!rt.canUsePaid) {
    return {
      text: 'Paid research requires Agency plan or DataForSEO BYOK via x-provider-key.',
      structuredContent: { code: 'PAID_TOOL_FORBIDDEN' },
      isError: true,
    };
  }
  const projectId = requireString(args, 'projectId');
  if (!projectId) return { text: 'projectId required', isError: true };
  const project = await rt.getProject(projectId);
  if (!project) return { text: 'Project not found', isError: true };
  const domain = (requireString(args, 'domain') || project.domain).replace(/^www\./, '');

  const log = await rt.getResearchLog(projectId);
  const hit = findResearchLogHit(log, ['backlinks', domain]);
  if (hit) return researchLogHitResult(hit, 'get_backlinks_overview');

  const payload = [{ target: domain, include_subdomains: true, internal_list_limit: 0 }];
  const res = await rt.dfsPost('/v3/backlinks/summary/live', payload);
  if (!res.ok) {
    const summary = `Backlinks overview: ${domain}. Verdict: not_measured (${res.code || 'DFS_ERROR'}).`;
    return notMeasured(summary, { domain, code: res.code || 'DFS_ERROR', error: res.error });
  }

  const result = dfsFirstResult(res.body);
  const rows = asArray(result);
  const first = (rows[0] || null) as Record<string, unknown> | null;
  if (!first || (first as { _dfsTaskError?: boolean })._dfsTaskError) {
    const summary = `Backlinks overview: ${domain}. Verdict: not_measured (empty DFS result).`;
    return notMeasured(summary, { domain, code: 'DFS_EMPTY' });
  }

  const overview = {
    domain,
    backlinks: typeof first.backlinks === 'number' ? first.backlinks : null,
    referringDomains: typeof first.referring_domains === 'number' ? first.referring_domains : null,
    rank: typeof first.rank === 'number' ? first.rank : null,
  };
  const summary = `Backlinks overview: ${domain}. backlinks=${overview.backlinks ?? 'unknown'}, referring_domains=${overview.referringDomains ?? 'unknown'}.`;
  await rt.appendResearchLog(projectId, summary);
  return {
    text: summary,
    structuredContent: { measurementStatus: 'measured', ...overview, code: 'OK' },
  };
}

/** Live W4 visibility via DFS Mentions + optional LLM probes. */
export async function getVisibilitySnapshot(
  args: Record<string, unknown>,
  rt: PaidToolRuntime,
): Promise<ToolResult> {
  if (!rt.canUsePaid) {
    return {
      text: 'Paid research requires Agency plan or DataForSEO BYOK via x-provider-key.',
      structuredContent: { code: 'PAID_TOOL_FORBIDDEN' },
      isError: true,
    };
  }
  const projectId = requireString(args, 'projectId');
  const project = projectId ? await rt.getProject(projectId) : null;
  const domain = (requireString(args, 'domain') || project?.domain || '').replace(/^www\./, '');
  if (!domain) return { text: 'domain or projectId required', isError: true };

  if (projectId) {
    const log = await rt.getResearchLog(projectId);
    const hit = findResearchLogHit(log, ['visibility', domain]);
    if (hit) return researchLogHitResult(hit, 'get_visibility_snapshot');
  }

  const queries = Array.isArray(args.queries)
    ? args.queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).slice(0, 5)
    : [];

  const out = await runVisibilityRouter({
    domain,
    brand: typeof args.brand === 'string' ? args.brand : undefined,
    queries,
    locationCode: Number(project?.default_location_code) || 2840,
    languageCode: project?.default_language_code || 'en',
    dfsPost: async (path, payload) => {
      const res = await rt.dfsPost(path, payload);
      return { ok: res.ok, body: res.body, error: res.error, code: res.code };
    },
    llmGenerate: rt.llmGenerate,
  });

  const summary = `Visibility snapshot: ${domain}. Status=${out.measurementStatus}. Aggregate citation rate=${out.aggregateCitationRatePercent ?? 'n/a'}.`;
  // Only append successful measured runs; estimated / not_measured must not block retries.
  if (projectId && out.measurementStatus === 'measured') {
    await rt.appendResearchLog(projectId, summary);
  }
  return {
    text: summary,
    structuredContent: {
      measurementStatus: out.measurementStatus,
      domain,
      aggregateCitationRatePercent: out.aggregateCitationRatePercent,
      engines: out.engines,
      code: out.measurementStatus === 'measured' ? 'OK' : 'NOT_MEASURED',
    },
  };
}

export async function getPagespeedSummary(
  args: Record<string, unknown>,
  rt: PaidToolRuntime,
): Promise<ToolResult> {
  if (!rt.canUsePaid) {
    return {
      text: 'Paid research requires Agency plan or BYOK credentials.',
      structuredContent: { code: 'PAID_TOOL_FORBIDDEN' },
      isError: true,
    };
  }
  const url = requireString(args, 'url');
  if (!url) return { text: 'url required', isError: true };
  const { fetchPagespeedInsights } = await import('../technical/pageSpeedService');
  const metrics = await fetchPagespeedInsights({
    url,
    apiKey: rt.pagespeedApiKey,
    strategy: args.strategy === 'desktop' ? 'desktop' : 'mobile',
  });
  const summary =
    metrics.measurementStatus === 'measured'
      ? `PageSpeed: ${url}. score=${metrics.performanceScore ?? 'n/a'} LCP=${metrics.lcpMs ?? 'n/a'}ms CLS=${metrics.cls ?? 'n/a'} INP=${metrics.inpMs ?? 'n/a'}ms.`
      : `PageSpeed: ${url}. Verdict: not_measured (${metrics.code || metrics.errorReason || 'unknown'}).`;
  return {
    text: summary,
    structuredContent: { ...metrics },
  };
}
