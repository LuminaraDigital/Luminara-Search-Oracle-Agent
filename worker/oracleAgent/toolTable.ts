/**
 * The Oracle tool table (Blueprint section 3). Frozen at module load: nothing at run time
 * (tool arguments, prompts, skills, page text) can change a tool's effect or gate.
 *
 * Effects:
 * - read: looks things up. Runs inside the loop.
 * - draft: writes inside Luminara only (a private report). Runs inside the loop.
 * - external: schedules recurring work or changes something outside Luminara. Never runs inside
 *   the loop; it becomes an approval card (worker/oracleAgent/approvals.ts).
 *
 * The project is always the one the chat was opened on (ctx.projectId). No tool lets the model
 * choose an account, a project or, for create_watch, a domain.
 */
import type { Env } from '../env';
import type { HostedIdentity } from '../userTypes';
import { buildPaidToolRuntime, executePaidTool, PAID_TOOL_CATALOGUE } from '../../services/tools/registry';
import { getProjectContext } from '../projectContextService';
import { getProject } from '../projectService';
import { markProjectContextLoaded } from '../mcpServer';
import { BYOK_PAID_CALL_COST_CENTS, HOSTED_PAID_CALL_COST_CENTS, isBudgetHalted, recordCostEvent } from '../budgets';
import { searchTavily } from '../freeAiAnswer';
import { saveAgentReport } from '../agentReportService';
import { handleCitationWatchRoute } from '../citationWatch';
import { spendDailyQuota } from '../quotaMiddleware';
import { entitlementsFor } from '../../services/plans/planEntitlements';
import { parsePromptList } from '../../services/promptList';
import { CITATION_WATCH_ENGINES, isCitationWatchEngine, isWatchCadence } from '../../services/citationWatch/types';
import type { AgentLimits } from './limits';

export type ToolEffect = 'read' | 'draft' | 'external';

/** Paid calls per turn for accounts with or without a budget policy (Blueprint s3). */
export const PAID_CALLS_PER_TURN = 3;
/** Paid calls per UTC day through the chat loop, per account. */
export const PAID_CALLS_PER_DAY = 25;

export type AgentToolContext = {
  env: Env;
  user: HostedIdentity;
  accountId: string;
  projectId: string | null;
  plan: string;
  /** Agency apiAccess or a BYOK DataForSEO credential. */
  canUsePaid: boolean;
  dfsCred: string | null;
  runId: string | null;
  limits: AgentLimits;
  /** Unattended runs get read tools only, never paid or external. */
  unattended: boolean;
  /** Mutable per-turn state. */
  state: { contextLoaded: boolean; paidCalls: number };
};

export type ToolSource = { url: string; title: string };

export type ToolOutcome = {
  /** Text handed back to the model (fenced by the loop). */
  text: string;
  isError: boolean;
  /** True only for a structured measurement (never for search snippets). */
  measured: boolean;
  /** The user's own stored data (project context): its figures are the user's, not invented. */
  userProvided?: boolean;
  sources: ToolSource[];
  /** Code-built one-line receipt summary. Never model prose. */
  summary: string;
};

export type ExternalPreparation =
  | { ok: true; args: Record<string, unknown>; preview: string; costNote: string }
  | { ok: false; error: string };

export type AgentTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  effect: ToolEffect;
  paid: boolean;
  /** Plain status line shown before the call ("searching live sources"). */
  status: string;
  /** null when allowed, otherwise the reason the model is given. */
  gate: (ctx: AgentToolContext) => Promise<string | null> | string | null;
  /** read and draft tools. */
  run?: (args: Record<string, unknown>, ctx: AgentToolContext) => Promise<ToolOutcome>;
  /** external tools: validate and build the code-rendered preview, before the card. */
  prepare?: (args: Record<string, unknown>, ctx: AgentToolContext) => Promise<ExternalPreparation>;
  /** external tools: run once, after approval, with the stored args. */
  execute?: (args: Record<string, unknown>, ctx: AgentToolContext) => Promise<ToolOutcome>;
};

function errorOutcome(text: string, summary: string): ToolOutcome {
  return { text, isError: true, measured: false, sources: [], summary };
}

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function needsProject(ctx: AgentToolContext): string | null {
  return ctx.projectId ? null : 'No project is open in this chat. Ask the user to open or create a project first.';
}

async function domainOf(ctx: AgentToolContext): Promise<string | null> {
  if (!ctx.projectId) return null;
  const project = await getProject(ctx.env, ctx.accountId, ctx.projectId);
  return project?.domain ? project.domain.toLowerCase() : null;
}

const getProjectContextTool: AgentTool = {
  name: 'get_project_context',
  description:
    'Read the open project: business profile, competitors, key pages and research log. Call this first; paid research needs it.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  effect: 'read',
  paid: false,
  status: 'Reading your project',
  gate: needsProject,
  run: async (_args, ctx) => {
    const context = await getProjectContext(ctx.env, ctx.accountId, ctx.projectId!);
    if (!context) return errorOutcome('Project not found.', 'Project context: not found');
    await markProjectContextLoaded(ctx.env, ctx.accountId, ctx.projectId!);
    ctx.state.contextLoaded = true;
    const domain = await domainOf(ctx);
    return {
      text: context.digestMarkdown,
      isError: false,
      measured: false,
      userProvided: true,
      sources: [],
      summary: domain ? `Read your project (${domain})` : 'Read your project',
    };
  },
};

type AuditRow = {
  measuredAt?: number;
  domain?: string;
  healthScore?: number | null;
  citationRatePercent?: number | null;
  schemaGapCount?: number | null;
  topCompetitor?: string | null;
  summary?: string;
};

const getLastAuditTool: AgentTool = {
  name: 'get_last_audit',
  description:
    "Read the most recent saved Instant Audit for the open project's domain: health score, AI citation rate, schema gaps, top competitor, summary.",
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  effect: 'read',
  paid: false,
  status: 'Reading your last audit',
  gate: needsProject,
  run: async (_args, ctx) => {
    const domain = await domainOf(ctx);
    if (!domain || !ctx.env.DB) return errorOutcome('No project domain.', 'Last audit: no domain');
    const bare = domain.replace(/^www\./, '');
    const row = await ctx.env.DB.prepare(
      `SELECT entry_json FROM audit_history WHERE account_id = ? AND domain = ? ORDER BY measured_at DESC LIMIT 1`,
    )
      .bind(ctx.accountId, bare)
      .first<{ entry_json: string }>()
      .catch(() => null);
    if (!row) {
      return {
        text: `No saved audit for ${bare}. The one action to offer is: run an Instant Audit of ${bare}.`,
        isError: false,
        measured: false,
        sources: [],
        summary: 'Last audit: none saved yet',
      };
    }
    let entry: AuditRow = {};
    try {
      entry = JSON.parse(row.entry_json) as AuditRow;
    } catch {
      return errorOutcome('The saved audit could not be read.', 'Last audit: unreadable');
    }
    const when = entry.measuredAt ? new Date(entry.measuredAt).toISOString().slice(0, 10) : 'unknown date';
    const line = (label: string, value: number | null | undefined, unit = '') =>
      `${label}: ${typeof value === 'number' ? `${value}${unit}` : 'not measured'}`;
    const measured = [entry.healthScore, entry.citationRatePercent, entry.schemaGapCount].some((v) => typeof v === 'number');
    const text = [
      `Saved Instant Audit of ${bare}, measured ${when}.`,
      line('Health score', entry.healthScore),
      line('AI citation rate', entry.citationRatePercent, '%'),
      line('Schema gaps', entry.schemaGapCount),
      `Top competitor: ${entry.topCompetitor || 'not measured'}`,
      `Summary: ${str(entry.summary, 600) || 'none'}`,
    ].join('\n');
    return { text, isError: false, measured, sources: [], summary: `Read your last audit (${when})` };
  },
};

const liveSearchTool: AgentTool = {
  name: 'live_search',
  description:
    'Search the live web. Results are sources to cite, not measurements of the user\'s site. Use a specific query.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'The search query, under 200 characters.' } },
    required: ['query'],
    additionalProperties: false,
  },
  effect: 'read',
  paid: false,
  status: 'Searching live sources',
  gate: (ctx) => (ctx.env.TAVILY_API_KEY ? null : 'Live search is not configured.'),
  run: async (args, ctx) => {
    const query = str(args.query, 200);
    if (!query) return errorOutcome('query is required.', 'Search: no query');
    const spent = await spendDailyQuota(ctx.env, `${ctx.accountId}:oracle-search`, ctx.limits.searchesPerDay);
    if (!spent.ok) {
      return errorOutcome(
        "Today's live search allowance is used up. Answer from what you already have.",
        'Search: daily allowance used',
      );
    }
    const rows = await searchTavily(ctx.env, query);
    if (rows.length === 0) {
      return { text: 'No results.', isError: false, measured: false, sources: [], summary: `Searched "${query}": no results` };
    }
    const text = rows.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n');
    return {
      text,
      isError: false,
      measured: false,
      sources: rows.map((r) => ({ url: r.url, title: r.title })),
      summary: `Searched "${query}" (${rows.length} results)`,
    };
  },
};

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
      // projectId is always the chat's project, never the model's.
      const result = await executePaidTool(meta.name, { ...args, projectId: ctx.projectId }, rt);
      if (!result.isError) {
        const billedCents = ctx.dfsCred ? BYOK_PAID_CALL_COST_CENTS : HOSTED_PAID_CALL_COST_CENTS;
        if (billedCents > 0) {
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
      }
      const structured = (result.structuredContent || {}) as { measurementStatus?: unknown };
      const measured = !result.isError && structured.measurementStatus === 'measured';
      return {
        text: result.text,
        isError: Boolean(result.isError),
        measured,
        sources: [],
        summary: `Ran ${meta.name} (${result.isError ? 'error' : measured ? 'measured' : 'not measured'})`,
      };
    },
  };
}

const saveReportTool: AgentTool = {
  name: 'save_report',
  description:
    'Save a private report to the open project. summary must hold the verdict and the one action. html is a simple HTML body.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      summary: { type: 'string', description: 'Verdict + one action + key measured numbers.' },
      html: { type: 'string', description: 'Report body as simple HTML.' },
    },
    required: ['title', 'summary', 'html'],
    additionalProperties: false,
  },
  effect: 'draft',
  paid: false,
  status: 'Saving a report',
  gate: (ctx) => (ctx.unattended ? 'Saving is not available here.' : needsProject(ctx)),
  run: async (args, ctx) => {
    const saved = await saveAgentReport(ctx.env, ctx.accountId, {
      projectId: ctx.projectId!,
      title: str(args.title, 200),
      summary: str(args.summary, 2000),
      html: typeof args.html === 'string' ? args.html : '',
      skill: 'oracle-chat',
      createdByLabel: 'Oracle',
      createdByUserId: ctx.user.id,
    });
    if (!saved.ok) return errorOutcome(`Report not saved: ${saved.error}`, 'Report: not saved');
    return {
      text: `Report saved: "${saved.report.title}". Report link: ${saved.report.url}`,
      isError: false,
      measured: false,
      sources: [],
      summary: `Saved report "${saved.report.title}"`,
    };
  },
};

const createWatchTool: AgentTool = {
  name: 'create_watch',
  description:
    "Propose a citation watch on the open project's own domain: re-checks whether an AI engine cites the site for a set of prompts on a schedule. Needs the user's approval; it shows as a card.",
  parameters: {
    type: 'object',
    properties: {
      engine: { type: 'string', enum: [...CITATION_WATCH_ENGINES] },
      prompts: { type: 'array', items: { type: 'string' }, description: 'Questions a customer would ask an AI engine.' },
      cadence: { type: 'string', description: 'Optional. Defaults to the plan schedule.' },
    },
    required: ['engine', 'prompts'],
    additionalProperties: false,
  },
  effect: 'external',
  paid: false,
  status: 'Preparing a citation watch',
  gate: (ctx) => {
    if (ctx.unattended) return 'Watches cannot be created here.';
    const noProject = needsProject(ctx);
    if (noProject) return noProject;
    const plan = entitlementsFor(ctx.plan);
    if (plan.scheduledReaudit === 'none' || plan.sentinelLimit <= 0) {
      return 'Citation watches need a plan with scheduled re-audits. Do not offer one; mention it is on paid plans only if asked.';
    }
    return null;
  },
  prepare: async (args, ctx) => {
    const domain = await domainOf(ctx);
    if (!domain) return { ok: false, error: 'The open project has no domain.' };
    const engine = str(args.engine, 20);
    if (!isCitationWatchEngine(engine)) return { ok: false, error: `engine must be one of ${CITATION_WATCH_ENGINES.join(', ')}.` };
    const parsed = parsePromptList(args.prompts);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const plan = entitlementsFor(ctx.plan);
    const cadenceRaw = str(args.cadence, 20);
    const cadence = cadenceRaw && isWatchCadence(cadenceRaw) ? cadenceRaw : String(plan.scheduledReaudit);
    const promptLines = parsed.prompts.map((p) => `- ${p}`).join('\n');
    return {
      ok: true,
      args: { domain, engine, prompts: parsed.prompts, cadence },
      preview:
        `Start a citation watch on ${domain}.\n` +
        `Engine: ${engine}. Schedule: ${cadence}.\n` +
        `Prompts (${parsed.prompts.length}):\n${promptLines}`,
      costNote: `Uses one of your plan's ${plan.sentinelLimit} watch slots and runs on the ${cadence} schedule until you stop it.`,
    };
  },
  execute: async (args, ctx) => {
    // The citation-watch route re-checks the plan, the cadence and the watch limit now, at approval time.
    const domain = await domainOf(ctx);
    if (!domain || String(args.domain || '').toLowerCase() !== domain) {
      return errorOutcome('The project domain changed since this was proposed. Nothing was created.', 'Watch: domain changed');
    }
    const req = new Request('https://internal/citation-watches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain, engine: args.engine, prompts: args.prompts, cadence: args.cadence }),
    });
    const res = await handleCitationWatchRoute(req, ctx.env, ctx.user, '/citation-watches');
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; code?: string; watch?: { id?: string } };
    if (res.ok && body.ok) {
      return { text: `Citation watch created on ${domain}.`, isError: false, measured: false, sources: [], summary: `Created a citation watch on ${domain}` };
    }
    if (body.code === 'WATCH_EXISTS') {
      return { text: `A watch for ${domain} with these prompts already exists.`, isError: false, measured: false, sources: [], summary: `Citation watch on ${domain} already exists` };
    }
    return errorOutcome(`Watch not created: ${body.error || `HTTP ${res.status}`}`, 'Watch: not created');
  },
};

export const AGENT_TOOLS: readonly AgentTool[] = Object.freeze(
  [getProjectContextTool, getLastAuditTool, liveSearchTool, ...PAID_TOOL_CATALOGUE.map(paidTool), saveReportTool, createWatchTool].map(
    (tool) => Object.freeze(tool),
  ),
);

const BY_NAME = new Map(AGENT_TOOLS.map((tool) => [tool.name, tool]));

export function agentToolByName(name: string): AgentTool | undefined {
  return BY_NAME.get(name);
}

/** Tools offered to the model for this context. Unattended runs see read, non-paid tools only. */
export function offeredTools(ctx: AgentToolContext): AgentTool[] {
  return AGENT_TOOLS.filter((tool) => !ctx.unattended || (tool.effect === 'read' && !tool.paid));
}
