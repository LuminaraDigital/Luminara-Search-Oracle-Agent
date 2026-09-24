/**
 * Single tool catalogue + dispatcher for MCP, Oracle, and audit (Worker-side).
 */
import type { Env } from '../../worker/env';
import { dataForSeoPost } from '../../worker/dataForSeoClient';
import { getProject } from '../../worker/projectService';
import { getProjectContext, updateProjectContext } from '../../worker/projectContextService';
import type { ContextAuthor } from '../projects/types';
import {
  getBacklinksOverview,
  getDomainOverview,
  getPagespeedSummary,
  getSerpResults,
  getVisibilitySnapshot,
  researchKeywords,
} from './paidResearch';
import { PAID_TOOL_CATALOGUE } from './paidCatalogue';
import { LIVE_SEARCH_TOOL_META } from './catalogue';
import type { PaidToolRuntime, ToolDefinitionMeta, ToolResult } from './types';
import {
  BROWSER_ACTION_CATALOGUE,
  executeBrowserActionTool,
  type BrowserActionRuntime,
} from '../browserAction';

export { PAID_TOOL_CATALOGUE, LIVE_SEARCH_TOOL_META, BROWSER_ACTION_CATALOGUE };

export const PAID_TOOL_NAMES = PAID_TOOL_CATALOGUE.map((t) => t.name);

export function buildPaidToolRuntime(opts: {
  env: Env;
  accountId: string;
  canUsePaid: boolean;
  dataForSeoCredential: string | null;
  author?: ContextAuthor;
  pagespeedApiKey?: string | null;
}): BrowserActionRuntime {
  const {
    env,
    accountId,
    canUsePaid,
    dataForSeoCredential,
    author = 'mcp',
    pagespeedApiKey = env.PAGESPEED_API_KEY || null,
  } = opts;

  const llmGenerate = env.OPENROUTER_API_KEY
    ? async (prompt: string, model = 'openai/gpt-4o-mini') => {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://luminarasuite.com',
            'X-Title': 'Luminara Visibility Probe',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 200,
          }),
        });
        if (!res.ok) {
          throw new Error(`OpenRouter ${res.status}`);
        }
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        return data.choices?.[0]?.message?.content || '';
      }
    : undefined;

  return {
    accountId,
    canUsePaid,
    dataForSeoCredential,
    pagespeedApiKey,
    llmGenerate,
    patchrightUrl: (env.PATCHRIGHT_URL || '').trim() || null,
    crawlerToken: (env.CRAWLER_TOKEN || '').trim() || null,
    getProject: async (projectId) => {
      const p = await getProject(env, accountId, projectId);
      if (!p) return null;
      return {
        id: p.id,
        domain: p.domain,
        default_location_code: p.defaultLocationCode,
        default_language_code: p.defaultLanguageCode,
      };
    },
    getResearchLog: async (projectId) => {
      const ctx = await getProjectContext(env, accountId, projectId);
      if (!ctx) return [];
      return ctx.researchLog.map((e) => ({
        id: e.id,
        entry_date: e.entryDate,
        summary: e.summary,
        created_at: e.createdAt,
      }));
    },
    appendResearchLog: async (projectId, summary) => {
      await updateProjectContext(
        env,
        accountId,
        projectId,
        [{ appendResearchLog: { summary } }],
        author,
      );
    },
    dfsPost: (path, payload) =>
      dataForSeoPost(env, path, payload, { credential: dataForSeoCredential }),
  };
}

export async function executePaidTool(
  name: string,
  args: Record<string, unknown>,
  rt: PaidToolRuntime,
): Promise<ToolResult> {
  if (BROWSER_ACTION_CATALOGUE.some((t) => t.name === name)) {
    return executeBrowserActionTool(name, args, rt as BrowserActionRuntime);
  }
  switch (name) {
    case 'research_keywords':
      return researchKeywords(args, rt);
    case 'get_domain_overview':
      return getDomainOverview(args, rt);
    case 'get_serp_results':
      return getSerpResults(args, rt);
    case 'get_backlinks_overview':
      return getBacklinksOverview(args, rt);
    case 'get_visibility_snapshot':
      return getVisibilitySnapshot(args, rt);
    case 'get_pagespeed_summary':
      return getPagespeedSummary(args, rt);
    default:
      return {
        text: `Unknown paid tool: ${name}`,
        structuredContent: { code: 'TOOL_NOT_FOUND' },
        isError: true,
      };
  }
}

export type { ToolResult, ToolDefinitionMeta, PaidToolRuntime, BrowserActionRuntime };
