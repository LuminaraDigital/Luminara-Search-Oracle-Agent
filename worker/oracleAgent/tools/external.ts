/**
 * Tools that write: save_report (draft, inside Luminara) and create_watch (external: it schedules
 * recurring probes, so it is only ever an approval card until the user approves it).
 */
import { saveAgentReport } from '../../agentReportService';
import { createCitationWatch } from '../../citationWatch';
import { entitlementsFor } from '../../../services/plans/planEntitlements';
import { parsePromptList } from '../../../services/promptList';
import { CITATION_WATCH_ENGINES, isCitationWatchEngine, isWatchCadence } from '../../../services/citationWatch/types';
import { errorOutcome, needsProject, outcome, str, type AgentTool } from '../types';

export const saveReportTool: AgentTool = {
  name: 'save_report',
  description: 'Save a private report to the open project. summary must hold the verdict and the one action. html is a simple HTML body.',
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
    return outcome(`Report saved: "${saved.report.title}". Report link: ${saved.report.url}`, `Saved report "${saved.report.title}"`);
  },
};

export const createWatchTool: AgentTool = {
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
    // The domain is the project's, never an argument: a page cannot point a watch elsewhere.
    const domain = ctx.projectDomain;
    if (!domain) return { ok: false, error: 'The open project has no domain.' };
    const engine = str(args.engine, 20);
    if (!isCitationWatchEngine(engine)) return { ok: false, error: `engine must be one of ${CITATION_WATCH_ENGINES.join(', ')}.` };
    const parsed = parsePromptList(args.prompts);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const plan = entitlementsFor(ctx.plan);
    const cadenceRaw = str(args.cadence, 20);
    const cadence = cadenceRaw && isWatchCadence(cadenceRaw) ? cadenceRaw : String(plan.scheduledReaudit);
    return {
      ok: true,
      args: { domain, engine, prompts: parsed.prompts, cadence },
      preview:
        `Start a citation watch on ${domain}.\n` +
        `Engine: ${engine}. Schedule: ${cadence}.\n` +
        `Prompts (${parsed.prompts.length}):\n${parsed.prompts.map((p) => `- ${p}`).join('\n')}`,
      costNote: `Uses one of your plan's ${plan.sentinelLimit} watch slots and runs on the ${cadence} schedule until you stop it.`,
    };
  },
  execute: async (args, ctx) => {
    if (!ctx.projectDomain || String(args.domain || '').toLowerCase() !== ctx.projectDomain) {
      return errorOutcome('The project domain changed since this was proposed. Nothing was created.', 'Watch: domain changed');
    }
    // createCitationWatch re-checks the plan, the cadence and the watch limit now, at approval time.
    const created = await createCitationWatch(ctx.env, ctx.user, {
      domain: ctx.projectDomain,
      engine: args.engine,
      prompts: args.prompts,
      cadence: args.cadence,
    });
    if (created.status === 201) return outcome(`Citation watch created on ${ctx.projectDomain}.`, `Created a citation watch on ${ctx.projectDomain}`);
    if (created.body.code === 'WATCH_EXISTS') {
      return outcome(`A watch for ${ctx.projectDomain} with these prompts already exists.`, `Citation watch on ${ctx.projectDomain} already exists`);
    }
    return errorOutcome(`Watch not created: ${String(created.body.error || `HTTP ${created.status}`)}`, 'Watch: not created');
  },
};
