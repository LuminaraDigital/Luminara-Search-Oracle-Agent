/**
 * Account MCP tools (whoami, projects, context, reports).
 * Split from mcpServer.ts so the JSON-RPC handler stays under 1000 lines.
 */
import type { McpToolDef } from './mcpServer';
import { markProjectContextLoaded } from './mcpServer';
import { createProject, listProjects } from './projectService';
import { getProjectContext, updateProjectContext } from './projectContextService';
import { getAgentReport, listAgentReports, saveAgentReport } from './agentReportService';
import type { ProjectContextPatch } from '../services/projects/types';
import { MCP_PAGE_PROPERTIES, MCP_RESULT_TEXT_CAP, pageList } from './mcpToolMeta';

function textResult(text: string, structured?: Record<string, unknown>, isError = false) {
  const base: { text: string; structuredContent?: Record<string, unknown>; isError?: boolean } = { text };
  if (structured !== undefined) base.structuredContent = structured;
  if (isError) base.isError = true;
  return base;
}

function requireString(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export const ACCOUNT_MCP_TOOLS: McpToolDef[] = [
  {
    name: 'whoami',
    description:
      'Read this first. Returns the account, plan, and MCP calls used and remaining today. Uses no credits. A new token does not reset the daily count.',
    creditClass: 'free',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, ctx) => {
      const usage = ctx.dailyUsage;
      const resetAt = usage?.resetAt ?? null;
      return textResult(
        [
          `Account: ${ctx.accountId}`,
          `Plan: ${ctx.planId}`,
          `MCP calls used today: ${usage ? usage.used : 'unknown'}`,
          `MCP calls remaining today: ${usage ? (usage.remaining === null ? 'no daily cap' : usage.remaining) : 'unknown'}`,
          `Daily reset (unix seconds): ${resetAt ?? 'unknown'}`,
          `MCP free tools: ${ctx.caps.mcpAccess ? 'yes' : 'no'}`,
          `Agency API / paid research without BYOK: ${ctx.caps.apiAccess ? 'yes' : 'no'}`,
          `BYOK DataForSEO header present: ${ctx.dataForSeoCredential ? 'yes' : 'no'}`,
        ].join('\n'),
        {
          accountId: ctx.accountId,
          plan: ctx.planId,
          mcpAccess: ctx.caps.mcpAccess,
          apiAccess: ctx.caps.apiAccess,
          callsUsedToday: usage?.used ?? null,
          callsRemainingToday: usage?.remaining ?? null,
          resetAt,
        },
      );
    },
  },
  {
    name: 'list_projects',
    description:
      'Lists this account\'s projects, at most 50 per page. Uses no credits. Pass cursor when the previous page set nextCursor.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: { ...MCP_PAGE_PROPERTIES },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const allProjects = await listProjects(ctx.env, ctx.accountId);
      const boundProjectId = ctx.credential.projectId;
      const projects = boundProjectId ? allProjects.filter((p) => p.id === boundProjectId) : allProjects;
      const page = pageList(projects, args);
      const lines = page.items.length
        ? page.items.map((p) => `- ${p.id}: ${p.domain} (${p.name})`).join('\n')
        : 'No projects yet. Use create_project.';
      return textResult(lines, {
        projects: page.items,
        limit: page.limit,
        truncated: page.truncated,
        nextCursor: page.nextCursor,
      });
    },
  },
  {
    name: 'create_project',
    description: 'Uses no credits. Creates a project for a domain (idempotent per account+domain+client).',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        name: { type: 'string' },
        clientId: { type: 'string' },
      },
      required: ['domain'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const domain = requireString(args, 'domain');
      if (!domain) return textResult('domain required', undefined, true);
      const result = await createProject(ctx.env, ctx.accountId, {
        domain,
        name: typeof args.name === 'string' ? args.name : undefined,
        clientId: typeof args.clientId === 'string' ? args.clientId : undefined,
      });
      if (!result.ok) return textResult(result.error, undefined, true);
      return textResult(`Project ${result.project.id} for ${result.project.domain}`, {
        project: result.project,
      });
    },
  },
  {
    name: 'get_project_context',
    description:
      'Uses no credits. Returns typed sections, competitors, key pages, research log, and missingSections.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projectId = requireString(args, 'projectId');
      if (!projectId) return textResult('projectId required', undefined, true);
      const context = await getProjectContext(ctx.env, ctx.accountId, projectId);
      if (!context) return textResult('Project not found', undefined, true);
      await markProjectContextLoaded(ctx.env, ctx.accountId, projectId);
      return textResult(context.digestMarkdown, { context });
    },
  },
  {
    name: 'update_project_context',
    description:
      'Uses no credits. Apply patch ops to project memory (sections, competitors, key pages, research log).',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        updates: { type: 'array', items: { type: 'object' } },
      },
      required: ['projectId', 'updates'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projectId = requireString(args, 'projectId');
      if (!projectId) return textResult('projectId required', undefined, true);
      const updates = args.updates;
      if (!Array.isArray(updates)) return textResult('updates must be an array', undefined, true);
      const result = await updateProjectContext(
        ctx.env,
        ctx.accountId,
        projectId,
        updates as ProjectContextPatch[],
        'mcp',
      );
      if (!result.ok) return textResult(result.error, undefined, true);
      return textResult(result.context.digestMarkdown, { context: result.context });
    },
  },
  {
    name: 'list_reports',
    description:
      'Lists report summaries for one project, at most 50 per page, without HTML bodies. Uses no credits. Pass cursor when nextCursor is set.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, ...MCP_PAGE_PROPERTIES },
      required: ['projectId'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projectId = requireString(args, 'projectId');
      if (!projectId) return textResult('projectId required', undefined, true);
      const reports = await listAgentReports(ctx.env, ctx.accountId, projectId);
      if (!reports) return textResult('Project not found', undefined, true);
      const page = pageList(reports, args);
      const lines = page.items.length
        ? page.items.map((r) => `- ${r.id}: ${r.title} (${r.url})`).join('\n')
        : 'No reports yet.';
      return textResult(lines, {
        reports: page.items,
        limit: page.limit,
        truncated: page.truncated,
        nextCursor: page.nextCursor,
      });
    },
  },
  {
    name: 'get_report',
    description:
      'Fetches one report summary. Set includeHtml true only for a short passage. HTML longer than 32000 characters is cut. Uses no credits.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        reportId: { type: 'string' },
        includeHtml: { type: 'boolean' },
      },
      required: ['reportId'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const reportId = requireString(args, 'reportId');
      if (!reportId) return textResult('reportId required', undefined, true);
      const includeHtml = Boolean(args.includeHtml);
      const report = await getAgentReport(ctx.env, ctx.accountId, reportId, includeHtml);
      if (!report) return textResult('Report not found', undefined, true);
      if (ctx.credential.projectId && report.projectId !== ctx.credential.projectId) {
        return textResult(
          `Tool blocked by Agent Habitat scope: token is bound to project "${ctx.credential.projectId}".`,
          { code: 'HABITAT_PROJECT_SCOPE_VIOLATION', boundProjectId: ctx.credential.projectId },
          true,
        );
      }
      if ('html' in report && report.html.length > MCP_RESULT_TEXT_CAP) {
        return textResult(report.summary, {
          report: { ...report, html: report.html.slice(0, MCP_RESULT_TEXT_CAP) },
          htmlTruncated: true,
          htmlCap: MCP_RESULT_TEXT_CAP,
        });
      }
      return textResult(report.summary, { report });
    },
  },
  {
    name: 'save_report',
    description:
      'Uses no credits. Saves one self-contained HTML report. Chat should return verdict + link only.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string' },
        summary: { type: 'string' },
        html: { type: 'string' },
        skill: { type: 'string' },
        reportId: { type: 'string' },
      },
      required: ['projectId', 'title', 'summary', 'html'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projectId = requireString(args, 'projectId');
      const title = requireString(args, 'title');
      const summary = requireString(args, 'summary');
      const html = typeof args.html === 'string' ? args.html : '';
      if (!projectId || !title || !summary || !html) {
        return textResult('projectId, title, summary, and html are required', undefined, true);
      }
      const result = await saveAgentReport(ctx.env, ctx.accountId, {
        projectId,
        title,
        summary,
        html,
        skill: typeof args.skill === 'string' ? args.skill : undefined,
        reportId: typeof args.reportId === 'string' ? args.reportId : undefined,
        createdByLabel: 'mcp',
        createdByUserId: ctx.user.id,
      });
      if (!result.ok) return textResult(result.error, undefined, true);
      return textResult(
        [
          result.report.summary.split('\n')[0],
          `Read the full report: ${result.report.url}`,
        ].join('\n'),
        { report: result.report },
      );
    },
  },
];
