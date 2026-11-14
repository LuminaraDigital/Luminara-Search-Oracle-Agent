/**
 * Recovery contract for MCP tool errors: every error result carries a stable
 * `code`, a `retry` verdict and `nextSteps` the calling agent can act on.
 * Pattern from stablyai/orca (MIT), src/cli/output/cli-error.ts.
 */
import type { McpToolResult } from './mcpServer';

/** now: transient. after_fix: change the call first. after_reset: wait for resetAt. never: a person must act. */
export type McpRetry = 'now' | 'after_fix' | 'after_reset' | 'never';

type Recovery = { retry: McpRetry; nextSteps: readonly string[] };

const UNCODED: Recovery = {
  retry: 'never',
  nextSteps: ['Do not repeat this call unchanged. Tell the user what failed, using the message above.'],
};

const NOT_FOUND: Recovery = {
  retry: 'after_fix',
  nextSteps: [
    'Get valid ids from list_projects, list_reports or get_project_history.',
    'Call again with an id from that list. Do not guess ids.',
  ],
};

const RECOVERY: Record<string, Recovery> = {
  BAD_INPUT: {
    retry: 'after_fix',
    nextSteps: ['Fix the arguments to match this tool\'s inputSchema from tools/list, then call again.'],
  },
  NOT_FOUND,
  // The tenant gate's code for a project the caller cannot open.
  PROJECT_NOT_FOUND: NOT_FOUND,
  TOOL_NOT_FOUND: {
    retry: 'after_fix',
    nextSteps: ['Call tools/list and use a tool name from it.'],
  },
  CONTEXT_REQUIRED: {
    retry: 'after_fix',
    nextSteps: [
      'Call get_project_context with the projectId (list_projects returns ids).',
      'Then repeat this call with the same projectId.',
    ],
  },
  SCOPE_INSUFFICIENT: {
    retry: 'never',
    nextSteps: [
      'Do not retry. Tell the user to reconnect Luminara with research access, or to add their own DataForSEO key.',
      'Free tools still work on this connection.',
    ],
  },
  PAID_TOOL_FORBIDDEN: {
    retry: 'never',
    nextSteps: [
      'Do not retry. Tell the user this tool needs a higher plan or their own DataForSEO key.',
      'Report the metric as not measured. Do not estimate it.',
    ],
  },
  BUDGET_EXHAUSTED: {
    retry: 'never',
    nextSteps: ['Do not retry. Tell the user the account budget is spent; the account owner can raise it.'],
  },
  GOVERNANCE_BLOCKED: {
    retry: 'never',
    nextSteps: ['Do not retry. Tell the user this tool is blocked for the account, with the reason above.'],
  },
  MCP_DAILY_LIMIT: {
    retry: 'after_reset',
    nextSteps: ['Stop calling tools until resetAt (Unix seconds). Tell the user the daily limit is reached.'],
  },
  MCP_PAID_DAILY_LIMIT: {
    retry: 'after_reset',
    nextSteps: ['Stop paid calls until resetAt (Unix seconds). Free tools still work.'],
  },
  MCP_QUOTA_STORE: {
    retry: 'now',
    nextSteps: ['Repeat this call once after one second.'],
  },
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Adds code, retry and nextSteps to an error result. A handler's own nextSteps win. */
export function withRecovery(result: McpToolResult): McpToolResult {
  if (!result.isError) return result;
  const structured = result.structuredContent ?? {};
  const code = typeof structured.code === 'string' ? structured.code : 'TOOL_ERROR';
  const recovery = RECOVERY[code] ?? UNCODED;
  const nextSteps = isStringArray(structured.nextSteps) ? structured.nextSteps : [...recovery.nextSteps];
  return {
    ...result,
    text: `${result.text}\nNext: ${nextSteps.join(' ')}`,
    structuredContent: { ...structured, code, retry: recovery.retry, nextSteps },
  };
}
