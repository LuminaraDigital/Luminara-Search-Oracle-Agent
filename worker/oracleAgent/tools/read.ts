/**
 * Read tools: the open project, its last saved audit, and live search. Free; run inside the loop.
 */
import { getProjectContext } from '../../projectContextService';
import { markProjectContextLoaded } from '../../mcpServer';
import { searchTavily } from '../../freeAiAnswer';
import { spendDailyQuota } from '../../quotaMiddleware';
import { errorOutcome, needsProject, outcome, str, type AgentTool } from '../types';

export const getProjectContextTool: AgentTool = {
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
    const summary = ctx.projectDomain ? `Read your project (${ctx.projectDomain})` : 'Read your project';
    return outcome(context.digestMarkdown, summary, { userProvided: true });
  },
};

type SavedAudit = {
  measuredAt?: number;
  healthScore?: number | null;
  citationRatePercent?: number | null;
  schemaGapCount?: number | null;
  topCompetitor?: string | null;
  summary?: string;
};

function figure(label: string, value: number | null | undefined, unit = ''): string {
  return `${label}: ${typeof value === 'number' ? `${value}${unit}` : 'not measured'}`;
}

export const getLastAuditTool: AgentTool = {
  name: 'get_last_audit',
  description:
    "Read the most recent saved Instant Audit for the open project's domain: health score, AI citation rate, schema gaps, top competitor, summary.",
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  effect: 'read',
  paid: false,
  status: 'Reading your last audit',
  gate: needsProject,
  run: async (_args, ctx) => {
    if (!ctx.projectDomain || !ctx.env.DB) return errorOutcome('No project domain.', 'Last audit: no domain');
    const domain = ctx.projectDomain.replace(/^www\./, '');
    const row = await ctx.env.DB.prepare(
      `SELECT entry_json FROM audit_history WHERE account_id = ? AND domain = ? ORDER BY measured_at DESC LIMIT 1`,
    )
      .bind(ctx.accountId, domain)
      .first<{ entry_json: string }>()
      .catch(() => null);
    if (!row) {
      return outcome(`No saved audit for ${domain}. The one action to offer is: run an Instant Audit of ${domain}.`, 'Last audit: none saved yet');
    }
    let entry: SavedAudit;
    try {
      entry = JSON.parse(row.entry_json) as SavedAudit;
    } catch {
      return errorOutcome('The saved audit could not be read.', 'Last audit: unreadable');
    }
    const when = entry.measuredAt ? new Date(entry.measuredAt).toISOString().slice(0, 10) : 'unknown date';
    const measured = [entry.healthScore, entry.citationRatePercent, entry.schemaGapCount].some((v) => typeof v === 'number');
    const text = [
      `Saved Instant Audit of ${domain}, measured ${when}.`,
      figure('Health score', entry.healthScore),
      figure('AI citation rate', entry.citationRatePercent, '%'),
      figure('Schema gaps', entry.schemaGapCount),
      `Top competitor: ${entry.topCompetitor || 'not measured'}`,
      `Summary: ${str(entry.summary, 600) || 'none'}`,
    ].join('\n');
    return outcome(text, `Read your last audit (${when})`, { measured });
  },
};

export const liveSearchTool: AgentTool = {
  name: 'live_search',
  description: "Search the live web. Results are sources to cite, not measurements of the user's site. Use a specific query.",
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
    if (!spent.ok) return errorOutcome("Today's live search allowance is used up. Answer from what you already have.", 'Search: daily allowance used');
    const rows = await searchTavily(ctx.env, query);
    if (rows.length === 0) return outcome('No results.', `Searched "${query}": no results`);
    return outcome(
      rows.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n'),
      `Searched "${query}" (${rows.length} results)`,
      { sources: rows.map((r) => ({ url: r.url, title: r.title })) },
    );
  },
};
