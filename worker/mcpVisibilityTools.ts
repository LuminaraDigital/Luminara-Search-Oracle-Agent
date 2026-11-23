/**
 * Free, read-only MCP tools for Visibility Unit Tests (spec 0032). The store lives in visibilityTests.ts.
 */
import type { McpToolDef, McpToolResult } from './mcpServer';
import { cleanDomain, getRunVerdicts, listRuns, providerScorecard } from './visibilityTests';

const OWN_MODEL_NOTE = 'Checks from your own AI accounts are estimates, not measured ChatGPT, Perplexity, or AI Overview results.';

function textResult(text: string, structured?: Record<string, unknown>, isError = false): McpToolResult {
  return { text, structuredContent: structured, isError };
}

export const VISIBILITY_MCP_TOOLS: McpToolDef[] = [
  {
    name: 'list_visibility_tests',
    description: 'Uses no credits. Lists saved Visibility Unit Test runs with their family scores, newest first.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: { domain: { type: 'string' } },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const runs = await listRuns(ctx.env, ctx.accountId, cleanDomain(args.domain), 20);
      const lines = runs.length
        ? runs.map((run) => `- ${run.id}: ${run.domain}, ${run.summary?.graded ?? 0} checks graded, ${run.summary?.notMeasured ?? 0} not measured${run.summary?.estimated ? ', estimated' : ''}`).join('\n')
        : 'No visibility test runs yet. Run an Instant Audit in the app.';
      return textResult(lines, { runs });
    },
  },
  {
    name: 'get_visibility_test',
    description: 'Uses no credits. Returns every verdict and plain reason for one Visibility Unit Test run. Raw answers stay private.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: { runId: { type: 'string' }, domain: { type: 'string' } },
      required: ['runId'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const runId = typeof args.runId === 'string' ? args.runId.trim() : '';
      if (!runId) return textResult('runId required', undefined, true);
      const found = await getRunVerdicts(ctx.env, ctx.accountId, runId);
      // A project-bound token always sends its domain, so it can never read another project's run.
      const domain = cleanDomain(args.domain);
      if (!found || (domain && found.run.domain !== domain)) return textResult('Run not found', undefined, true);
      const lines = found.verdicts.map((v) => `[${v.result}] ${v.label}: ${v.why}`).join('\n');
      const header = found.run.summary?.estimated ? 'Estimated: the owner has not confirmed these facts yet.\n' : '';
      return textResult(`${header}${lines || 'This run has no verdicts.'}\n${OWN_MODEL_NOTE}`, found);
    },
  },
  {
    name: 'get_provider_scorecard',
    description: `Uses no credits. Compares the models on the account's own keys, on its own checks: quality, reported cost, refusals. ${OWN_MODEL_NOTE}`,
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: { domain: { type: 'string' } },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const scorecard = await providerScorecard(ctx.env, ctx.accountId, cleanDomain(args.domain));
      const lines = scorecard.length
        ? scorecard.map((row) => `- ${row.provider}/${row.model}: ${row.answers} answers, ${row.refusals} refused, ${row.errors} failed`).join('\n')
        : 'No model checks yet. Add an OpenRouter key in Settings and press Ask my AI accounts on an audit.';
      return textResult(lines, { scorecard, measurementStatus: 'estimated' });
    },
  },
];
