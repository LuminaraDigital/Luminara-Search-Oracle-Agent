/**
 * Paid research tools, adapted from the shared catalogue. Agency or BYOK only (AGENTS.md
 * invariant 2), project context first (invariant 3), budget hard stop and per-turn and per-day
 * ceilings checked on every call. The project is always the chat's, never the model's.
 */
import { buildPaidToolRuntime, executePaidTool, PAID_TOOL_CATALOGUE } from '../../../services/tools/registry';
import { BYOK_PAID_CALL_COST_CENTS, HOSTED_PAID_CALL_COST_CENTS, isBudgetHalted, recordCostEvent } from '../../budgets';
import { spendDailyQuota } from '../../quotaMiddleware';
import { errorOutcome, needsProject, outcome, type AgentTool } from '../types';

/** Paid calls per message, for accounts with or without a budget policy. */
export const PAID_CALLS_PER_TURN = 3;
/** Paid calls per UTC day through the chat loop, per account. */
export const PAID_CALLS_PER_DAY = 25;

function paidTool(meta: (typeof PAID_TOOL_CATALOGUE)[number]): AgentTool {
  const props = { ...((meta.inputSchema.properties as Record<string, unknown>) || {}) };
  delete props.projectId;
  const required = ((meta.inputSchema.required as string[]) || []).filter((k) => k !== 'projectId');
  return {
    name: meta.name,
    description: `${meta.description} Needs get_project_context first.`,
    parameters: { type: 'object', properties: props, required, additionalProperties: false },
    effect: 'read',
    paid: true,
    status: 'Running paid research',
    gate: async (ctx) => {
      if (ctx.unattended) return 'Paid research is not available here.';
      if (!ctx.canUsePaid) return 'Paid research needs the Agency plan or your own DataForSEO key.';
      const noProject = needsProject(ctx);
      if (noProject) return noProject;
      if (!ctx.state.contextLoaded) return 'Call get_project_context before paid research.';
      if (ctx.state.paidCalls >= PAID_CALLS_PER_TURN) return 'The paid research limit for this message is reached.';
      if (await isBudgetHalted(ctx.env, ctx.accountId, Date.now())) {
        return 'The account budget hard stop is reached. Paid research is paused until it is raised in Settings.';
      }
      return null;
    },
    run: async (args, ctx) => {
      const daily = await spendDailyQuota(ctx.env, `${ctx.accountId}:oracle-paid`, PAID_CALLS_PER_DAY);
      if (!daily.ok) return errorOutcome("Today's paid research allowance in chat is used up.", `${meta.name}: daily allowance used`);
      ctx.state.paidCalls += 1;
      const rt = buildPaidToolRuntime({
        env: ctx.env,
        accountId: ctx.accountId,
        canUsePaid: ctx.canUsePaid,
        dataForSeoCredential: ctx.dfsCred,
        author: 'oracle',
      });
      const result = await executePaidTool(meta.name, { ...args, projectId: ctx.projectId }, rt);
      const billedCents = ctx.dfsCred ? BYOK_PAID_CALL_COST_CENTS : HOSTED_PAID_CALL_COST_CENTS;
      if (!result.isError && billedCents > 0) {
        await recordCostEvent(ctx.env, {
          accountId: ctx.accountId,
          toolName: meta.name,
          billedCents,
          projectId: ctx.projectId,
          creditClass: 'paid',
          source: 'credit_class',
          runId: ctx.runId,
          credentialKind: 'oracle',
          credentialId: null,
        }).catch((err) => console.error('[oracleAgent] recordCostEvent failed:', err));
      }
      const measured = !result.isError && (result.structuredContent as { measurementStatus?: unknown } | undefined)?.measurementStatus === 'measured';
      const label = result.isError ? 'error' : measured ? 'measured' : 'not measured';
      return outcome(result.text, `Ran ${meta.name} (${label})`, { isError: Boolean(result.isError), measured });
    },
  };
}

export const PAID_TOOLS: AgentTool[] = PAID_TOOL_CATALOGUE.map(paidTool);
