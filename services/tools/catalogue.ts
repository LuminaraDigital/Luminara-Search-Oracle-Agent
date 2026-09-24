/**
 * Isomorphic tool catalogue (safe for browser imports).
 */
import type { ToolDefinitionMeta } from './types';
export { PAID_TOOL_CATALOGUE } from './paidCatalogue';

/** Browser/Oracle live_search style free tool meta (executed outside DFS). */
export const LIVE_SEARCH_TOOL_META: ToolDefinitionMeta = {
  name: 'live_search',
  description: 'Run a live web search for grounding. Uses Tavily or local SERP when configured.',
  creditClass: 'free',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      maxResults: { type: 'number' },
    },
    required: ['query'],
    additionalProperties: false,
  },
};
