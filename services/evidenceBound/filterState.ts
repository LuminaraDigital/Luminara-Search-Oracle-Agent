/**
 * Send only fields the question needs. Unrelated detail is a distractor.
 */
import type { FilteredDecisionState } from './types';

/**
 * Pick named top-level keys from raw state. Nested paths use dot notation
 * (e.g. "page.url"). Missing keys are omitted, never invented.
 */
export function filterState(
  raw: Record<string, unknown> | null | undefined,
  keys: string[],
): FilteredDecisionState {
  if (!raw || typeof raw !== 'object') return {};
  const out: FilteredDecisionState = {};
  for (const key of keys) {
    if (!key || key.includes('__proto__') || key.includes('constructor')) continue;
    if (!key.includes('.')) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        out[key] = raw[key];
      }
      continue;
    }
    const parts = key.split('.');
    let cur: unknown = raw;
    for (const part of parts) {
      if (!cur || typeof cur !== 'object' || !(part in (cur as object))) {
        cur = undefined;
        break;
      }
      cur = (cur as Record<string, unknown>)[part];
    }
    if (cur !== undefined) {
      out[key] = cur;
    }
  }
  return out;
}

/** Cap visible text for decision prompts (align with browse observe ~6k). */
export function capText(text: string | null | undefined, max = 6000): string {
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/**
 * Build a minimal router state from common Oracle/MCP inputs.
 */
export function buildRouterState(input: {
  userMessage?: string;
  projectId?: string | null;
  domain?: string | null;
  researchLogSummaries?: string[];
  hasProjectContext?: boolean;
  offeredTools?: string[];
  pageUrl?: string;
  pageTitle?: string;
  pageText?: string;
}): FilteredDecisionState {
  return filterState(
    {
      userMessage: (input.userMessage || '').slice(0, 2000),
      projectId: input.projectId ?? null,
      domain: input.domain ?? null,
      researchLogSummaries: (input.researchLogSummaries || []).slice(0, 8),
      hasProjectContext: Boolean(input.hasProjectContext),
      offeredTools: input.offeredTools || [],
      page: {
        url: input.pageUrl || '',
        title: input.pageTitle || '',
        text: capText(input.pageText, 4000),
      },
    },
    [
      'userMessage',
      'projectId',
      'domain',
      'researchLogSummaries',
      'hasProjectContext',
      'offeredTools',
      'page.url',
      'page.title',
      'page.text',
    ],
  );
}
