/**
 * Free MCP reads for per-project history and measured recommendation outcomes.
 */
import type { McpToolDef, McpToolResult } from './mcpServer';
import { MCP_PROJECT_ID_RE, requireProjectId } from './mcpProjectArgs';
import {
  compareProjectSnapshots,
  getProjectHistory,
  listProjectOutcomes,
  markActionDone,
  type ProjectOutcome,
} from './projectHistoryService';

function textResult(text: string, structured?: Record<string, unknown>, isError = false): McpToolResult {
  return { text, structuredContent: structured, isError };
}

function requireProject(args: Record<string, unknown>, ctx: { credential: { projectId?: string | null } }): string | null {
  return requireProjectId(args, ctx);
}

function formatLift(outcome: ProjectOutcome): string {
  if (outcome.dataLabel !== 'measured' || outcome.lift === null) {
    return `${outcome.title}: ${outcome.status}. Too little data to measure lift.`;
  }
  const rounded = Math.round(outcome.lift * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  const signed = rounded > 0 ? `+${text}` : text;
  return `${outcome.title}: ${outcome.status}. Measured lift ${signed} on ${outcome.kind} ${outcome.metric} (${outcome.beforeValue} to ${outcome.afterValue}).`;
}

export const PROJECT_HISTORY_MCP_TOOLS: McpToolDef[] = [
  {
    name: 'get_project_history',
    description:
      'Uses no credits. Returns timestamped audit, keyword, AI visibility, and Instant Audit snapshots for one project, plus the delta versus the previous check of the same kind.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projectId = requireProject(args, ctx);
      if (!projectId) return textResult('Project not found', { code: 'NOT_FOUND' }, true);
      const limit = typeof args.limit === 'number' ? args.limit : 50;
      const history = await getProjectHistory(ctx.env, ctx.accountId, projectId, limit);
      if (!history) return textResult('Project not found', { code: 'NOT_FOUND' }, true);
      if (!history.snapshots.length) {
        return textResult('No measurements yet.', { history });
      }
      const lines = history.trends.map((trend) => {
        const name = [trend.kind, trend.metric !== 'none' ? trend.metric : '', trend.subject].filter(Boolean).join(' ');
        const scoreText = trend.latestScore === null ? 'not measured' : String(trend.latestScore);
        const delta = trend.latestDelta;
        if (!delta || delta.label !== 'measured' || delta.scoreDelta === null) {
          return `${name}: ${scoreText}. Too little data to measure lift.`;
        }
        const rounded = Math.round(delta.scoreDelta * 10) / 10;
        const signed = rounded > 0 ? `+${rounded}` : String(rounded);
        const dropped = delta.droppedEngines.length
          ? ` Dropped out of AI answers: ${delta.droppedEngines.join(', ')}.`
          : '';
        return `${name}: ${scoreText} (${signed} vs previous).${dropped}`;
      });
      return textResult(lines.join('\n'), { history });
    },
  },
  {
    name: 'compare_snapshots',
    description:
      'Uses no credits. Compares two snapshots from the same project. Lift is omitted when either check has no measured score.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        earlierId: { type: 'string' },
        laterId: { type: 'string' },
      },
      required: ['projectId', 'earlierId', 'laterId'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projectId = requireProject(args, ctx);
      const earlierId = typeof args.earlierId === 'string' ? args.earlierId.trim() : '';
      const laterId = typeof args.laterId === 'string' ? args.laterId.trim() : '';
      if (!projectId || !MCP_PROJECT_ID_RE.test(earlierId) || !MCP_PROJECT_ID_RE.test(laterId)) {
        return textResult('Snapshot not found', { code: 'NOT_FOUND' }, true);
      }
      const delta = await compareProjectSnapshots(ctx.env, ctx.accountId, projectId, earlierId, laterId);
      if (!delta) return textResult('Snapshot not found', { code: 'NOT_FOUND' }, true);
      const line =
        delta.label === 'measured' && delta.scoreDelta !== null
          ? `Score change ${delta.scoreDelta}.`
          : 'Too little data to measure lift.';
      const dropped = delta.droppedEngines.length
        ? ` Dropped out of AI answers: ${delta.droppedEngines.join(', ')}.`
        : '';
      return textResult(`${line}${dropped}`, { delta });
    },
  },
  {
    name: 'get_project_outcomes',
    description:
      'Uses no credits. Lists recommended actions for one project. Measured lift is included only when a before and after score both come from stored snapshots.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projectId = requireProject(args, ctx);
      if (!projectId) return textResult('Project not found', { code: 'NOT_FOUND' }, true);
      const outcomes = await listProjectOutcomes(ctx.env, ctx.accountId, projectId);
      if (!outcomes) return textResult('Project not found', { code: 'NOT_FOUND' }, true);
      if (!outcomes.length) return textResult('No recommended actions yet.', { outcomes });
      return textResult(outcomes.map(formatLift).join('\n'), { outcomes });
    },
  },
  {
    name: 'mark_project_action_done',
    description:
      'Uses no credits. Marks a recommended action done and records before/after from stored snapshots. Lift stays empty when a later measured score is missing.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        actionId: { type: 'string' },
      },
      required: ['projectId', 'actionId'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projectId = requireProject(args, ctx);
      const actionId = typeof args.actionId === 'string' ? args.actionId.trim() : '';
      if (!projectId || !MCP_PROJECT_ID_RE.test(actionId)) return textResult('Action not found', { code: 'NOT_FOUND' }, true);
      const outcome = await markActionDone(ctx.env, ctx.accountId, projectId, actionId);
      if (!outcome) return textResult('Action not found', { code: 'NOT_FOUND' }, true);
      return textResult(formatLift(outcome), { outcome });
    },
  },
];
