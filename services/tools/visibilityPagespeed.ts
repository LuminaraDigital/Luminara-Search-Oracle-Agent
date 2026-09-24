/**
 * Fallback visibility + PageSpeed helpers when live tools are not invoked.
 * Live W4 visibility: `getVisibilitySnapshot` → `runVisibilityRouter`.
 * Live PageSpeed: `getPagespeedSummary` → `fetchPagespeedInsights`.
 * These stubs stay not_measured so callers never invent KPIs without credentials.
 */
import type { ToolResult } from './types';

export type VisibilityEngineId = 'chatgpt' | 'google_aio' | 'perplexity';

export type VisibilitySnapshotStub = {
  domain: string;
  engines: Array<{
    engine: VisibilityEngineId;
    measurementStatus: 'not_measured' | 'measured';
    citationRate: number | null;
    reason: string;
  }>;
};

export function buildVisibilityStub(domain: string): VisibilitySnapshotStub {
  const reason =
    'No live probe in this path; use get_visibility_snapshot (DFS Mentions / OpenRouter) for measured or estimated results.';
  return {
    domain,
    engines: [
      { engine: 'chatgpt', measurementStatus: 'not_measured', citationRate: null, reason },
      { engine: 'google_aio', measurementStatus: 'not_measured', citationRate: null, reason },
      { engine: 'perplexity', measurementStatus: 'not_measured', citationRate: null, reason },
    ],
  };
}

export function visibilityToolResult(domain: string): ToolResult {
  const snap = buildVisibilityStub(domain);
  return {
    text: `Visibility snapshot: ${domain}. Verdict: not_measured (call get_visibility_snapshot for live router).`,
    structuredContent: {
      measurementStatus: 'not_measured',
      code: 'VISIBILITY_NOT_MEASURED',
      ...snap,
    },
  };
}

export type PagespeedStub = {
  url: string;
  measurementStatus: 'not_measured';
  lcpMs: null;
  cls: null;
  inpMs: null;
  reason: string;
};

export function buildPagespeedStub(url: string): PagespeedStub {
  return {
    url,
    measurementStatus: 'not_measured',
    lcpMs: null,
    cls: null,
    inpMs: null,
    reason: 'No PSI key in this path; use get_pagespeed_summary for live Core Web Vitals.',
  };
}

export function pagespeedToolResult(url: string): ToolResult {
  const stub = buildPagespeedStub(url);
  return {
    text: `PageSpeed: ${url}. Verdict: not_measured (call get_pagespeed_summary for live PSI).`,
    structuredContent: { code: 'PSI_NOT_MEASURED', ...stub },
  };
}
