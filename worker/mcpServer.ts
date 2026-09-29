/**
 * Lightweight JSON-RPC MCP HTTP handler for Luminara (APS A1-A4).
 * Implements initialize, tools/list, tools/call without vendoring the full MCP SDK.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';
import { getActiveSubscription } from './quotaMiddleware';
import { planCapsFor } from './telegramBot';
import { createProject, getProject, listProjects } from './projectService';
import { getProjectContext, updateProjectContext } from './projectContextService';
import { getAgentReport, listAgentReports, saveAgentReport } from './agentReportService';
import type { McpCreditClass, ProjectContextPatch } from '../services/projects/types';
import { TYPED_CONTEXT_KEYS } from '../services/projects/types';
import { hasDataForSeoCredentials } from '../services/config/runtimeKeys';
import {
  PAID_TOOL_CATALOGUE,
  BROWSER_ACTION_CATALOGUE,
  buildPaidToolRuntime,
  executePaidTool,
} from '../services/tools/registry';
import { startRun, completeRun } from './runProvenance';
import {
  decideToolCall,
  createActionRequest,
  hasApprovedRequest,
} from './mcpGovernance';
import {
  BYOK_PAID_CALL_COST_CENTS,
  HOSTED_PAID_CALL_COST_CENTS,
  evaluateSoftAlerts,
  getBudgetStatus,
  isBudgetHalted,
  recordBudgetIncident,
  recordCostEvent,
} from './budgets';
import { recordAuditLogBestEffort } from './auditLog';
import { redactSensitive } from './logRedaction';

export type McpToolDef = {
  name: string;
  description: string;
  creditClass: McpCreditClass;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: McpToolContext) => Promise<McpToolResult>;
};

export type McpToolContext = {
  env: Env;
  user: HostedIdentity;
  accountId: string;
  planId: string;
  caps: ReturnType<typeof planCapsFor>;
  /** Optional BYOK DataForSEO credential from header x-provider-key */
  dataForSeoCredential: string | null;
};

export type McpToolResult = {
  text: string;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const MCP_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Accept, Authorization, mcp-session-id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, x-provider-key',
  'Access-Control-Expose-Headers': 'mcp-session-id',
};

function mcpJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...MCP_CORS },
  });
}

function textResult(text: string, structured?: Record<string, unknown>, isError = false): McpToolResult {
  return { text, structuredContent: structured, isError };
}

function requireString(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

async function buildCtx(env: Env, user: HostedIdentity, request: Request): Promise<McpToolContext> {
  const sub = await getActiveSubscription(env, user);
  const planId = sub?.plan || 'free';
  const caps = planCapsFor(planId);
  const byokRaw = request.headers.get('x-provider-key')?.trim() || null;
  const dataForSeoCredential =
    byokRaw && hasDataForSeoCredentials({ luminara_dataforseo_key: byokRaw }) ? byokRaw : null;
  return {
    env,
    user,
    accountId: billingId(user),
    planId,
    caps,
    dataForSeoCredential,
  };
}

function canUsePaid(ctx: McpToolContext): boolean {
  if (ctx.caps.apiAccess) return true;
  if (ctx.dataForSeoCredential) return true;
  return false;
}

const CONTEXT_LOADED_TTL_SEC = 60 * 60;

function contextLoadedKey(accountId: string, projectId: string): string {
  return `mcp:context_loaded:${accountId}:${projectId}`;
}

/** APS: mark that get_project_context succeeded for this project (KV TTL 1h). */
export async function markProjectContextLoaded(
  env: Env,
  accountId: string,
  projectId: string,
): Promise<void> {
  if (!env.LUMINARA_KV) return;
  await env.LUMINARA_KV.put(contextLoadedKey(accountId, projectId), String(Date.now()), {
    expirationTtl: CONTEXT_LOADED_TTL_SEC,
  });
}

/**
 * APS invariant: paid research requires a recent get_project_context for the project.
 * Returns an error result when the gate fails; null when allowed.
 */
export async function requireProjectContextBeforePaid(
  env: Env,
  accountId: string,
  projectId: string | null,
): Promise<McpToolResult | null> {
  if (!projectId) {
    return textResult(
      'Paid tools require projectId. Call get_project_context for that project first.',
      { code: 'CONTEXT_REQUIRED', reason: 'missing_project_id' },
      true,
    );
  }
  if (!env.LUMINARA_KV) {
    return textResult(
      'Paid tools require project context, but KV is unbound. Bind LUMINARA_KV and call get_project_context.',
      { code: 'CONTEXT_REQUIRED', reason: 'kv_unbound' },
      true,
    );
  }
  const loaded = await env.LUMINARA_KV.get(contextLoadedKey(accountId, projectId));
  if (!loaded) {
    return textResult(
      'Call get_project_context for this project before paid research tools (APS).',
      { code: 'CONTEXT_REQUIRED', reason: 'context_not_loaded' },
      true,
    );
  }
  return null;
}

function paidHandler(name: string) {
  return async (args: Record<string, unknown>, ctx: McpToolContext): Promise<McpToolResult> => {
    const rt = buildPaidToolRuntime({
      env: ctx.env,
      accountId: ctx.accountId,
      canUsePaid: canUsePaid(ctx),
      dataForSeoCredential: ctx.dataForSeoCredential,
      author: 'mcp',
    });
    const result = await executePaidTool(name, args, rt);
    return textResult(result.text, result.structuredContent, result.isError);
  };
}

const TOOLS: McpToolDef[] = [
  {
    name: 'whoami',
    description:
      'Uses no credits. Confirms the connected Luminara account, plan, and MCP access class.',
    creditClass: 'free',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, ctx) =>
      textResult(
        [
          `Account: ${ctx.accountId}`,
          `Plan: ${ctx.planId}`,
          `MCP free tools: ${ctx.caps.mcpAccess ? 'yes' : 'no'}`,
          `Agency API / paid research without BYOK: ${ctx.caps.apiAccess ? 'yes' : 'no'}`,
          `BYOK DataForSEO header present: ${ctx.dataForSeoCredential ? 'yes' : 'no'}`,
        ].join('\n'),
        {
          accountId: ctx.accountId,
          plan: ctx.planId,
          mcpAccess: ctx.caps.mcpAccess,
          apiAccess: ctx.caps.apiAccess,
        },
      ),
  },
  {
    name: 'list_projects',
    description: 'Uses no credits. Lists SEO projects for the connected account.',
    creditClass: 'free',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, ctx) => {
      const projects = await listProjects(ctx.env, ctx.accountId);
      const lines = projects.length
        ? projects.map((p) => `- ${p.id}: ${p.domain} (${p.name})`).join('\n')
        : 'No projects yet. Use create_project.';
      return textResult(lines, { projects });
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
    description: 'Uses no credits. Lists agent report summaries for a project (no HTML bodies).',
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
      const reports = await listAgentReports(ctx.env, ctx.accountId, projectId);
      if (!reports) return textResult('Project not found', undefined, true);
      const lines = reports.length
        ? reports.map((r) => `- ${r.id}: ${r.title} (${r.url})`).join('\n')
        : 'No reports yet.';
      return textResult(lines, { reports });
    },
  },
  {
    name: 'get_report',
    description:
      'Uses no credits. Fetches a report summary; set includeHtml true only when editing a specific passage.',
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
  ...PAID_TOOL_CATALOGUE.map((meta) => ({
    name: meta.name,
    description: meta.description,
    creditClass: meta.creditClass,
    inputSchema: meta.inputSchema,
    handler: paidHandler(meta.name),
  })),
  ...BROWSER_ACTION_CATALOGUE.map((meta) => ({
    name: meta.name,
    description: meta.description,
    creditClass: meta.creditClass,
    inputSchema: meta.inputSchema,
    handler: paidHandler(meta.name),
  })),
];
export function listMcpToolCatalogue(): Array<{
  name: string;
  description: string;
  creditClass: McpCreditClass;
}> {
  return TOOLS.map(({ name, description, creditClass }) => ({ name, description, creditClass }));
}

function toolsListPayload() {
  return {
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: {
        readOnlyHint: t.name.startsWith('get_') || t.name.startsWith('list_') || t.name === 'whoami',
      },
    })),
  };
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<McpToolResult> {
  // One clock read per call: the budget gate, cost event, and soft-alert
  // evaluation must agree on the current UTC window (spec 0014 clock rule).
  const now = Date.now();
  const sub = await getActiveSubscription(ctx.env, ctx.user);
  const subscriptionActive = !!sub;
  const tool = TOOLS.find((t) => t.name === name);
  const creditClass = tool?.creditClass ?? 'free';
  const projectId = typeof args.projectId === 'string' ? args.projectId : null;

  // Budget gate runs BEFORE the governance decideToolCall; when the account is
  // budget-halted the budget block wins over every governance outcome.
  if (await isBudgetHalted(ctx.env, ctx.accountId, now)) {
    await recordAuditLogBestEffort(ctx.env, {
      org_id: ctx.accountId,
      actor_id: ctx.user.id,
      action: 'mcp_tool_block',
      target_id: name,
      details: redactSensitive({
        tool: name,
        decision: 'block',
        reason: 'budget_exhausted',
        projectId,
        args,
      }) as Record<string, unknown>,
    });
    const budgetStatus = await getBudgetStatus(ctx.env, ctx.accountId, now);
    if (budgetStatus.policy) {
      await recordBudgetIncident(ctx.env, ctx.accountId, 100, budgetStatus.spentCents, {
        kind: 'hard',
        policyId: budgetStatus.policy.id,
        now,
      }).catch(() => undefined);
    }
    return textResult(
      'Tool blocked by governance policy: budget_exhausted',
      { code: 'BUDGET_EXHAUSTED', reason: 'budget_exhausted', budgetHalted: true },
      true,
    );
  }

  const approved = await hasApprovedRequest(ctx.env, ctx.accountId, name, projectId);
  const decision = decideToolCall(
    name,
    { subscriptionActive, creditClass, identityPlan: ctx.planId },
    approved,
  );

  await recordAuditLogBestEffort(ctx.env, {
    org_id: ctx.accountId,
    actor_id: ctx.user.id,
    action: `mcp_tool_${decision.action}`,
    target_id: name,
    details: redactSensitive({
      tool: name,
      decision: decision.action,
      reason: decision.action === 'allow' ? undefined : decision.reason,
      projectId,
      args,
    }) as Record<string, unknown>,
  });

  if (decision.action === 'block') {
    return textResult(
      `Tool blocked by governance policy: ${decision.reason}`,
      { code: 'GOVERNANCE_BLOCKED', reason: decision.reason },
      true,
    );
  }
  if (decision.action === 'require_approval') {
    const req = await createActionRequest(ctx.env, {
      userId: ctx.accountId,
      toolName: name,
      projectId,
      args,
    });
    return textResult(
      `Tool requires operator approval. Action request ${req.id} created.`,
      { requiresApproval: true, actionRequestId: req.id },
    );
  }

  if (!tool) return textResult(`Unknown tool: ${name}`, { code: 'TOOL_NOT_FOUND' }, true);
  if (tool.creditClass === 'paid' && !canUsePaid(ctx)) {
    return textResult(
      'Paid tool blocked. Upgrade to Agency or pass DataForSEO BYOK as x-provider-key (login:password).',
      { code: 'PAID_TOOL_FORBIDDEN' },
      true,
    );
  }
  if (tool.creditClass === 'paid') {
    const contextGate = await requireProjectContextBeforePaid(ctx.env, ctx.accountId, projectId);
    if (contextGate) return contextGate;
  }
  const result = await tool.handler(args || {}, ctx);

  // Cost ingestion: cost events land only after a successful PAID tool
  // execution; free tools and error results record nothing. Interim rule per
  // the design record: real provider cost is unavailable at this seam, so the
  // tool bills its declared credit class as cents (source 'credit_class');
  // BYOK calls bill zero (Luminara owes nothing, design decision 9).
  if (tool.creditClass === 'paid' && !result.isError) {
    const billedCents = ctx.dataForSeoCredential
      ? BYOK_PAID_CALL_COST_CENTS
      : HOSTED_PAID_CALL_COST_CENTS;
    if (billedCents > 0) {
      try {
        await recordCostEvent(ctx.env, {
          accountId: ctx.accountId,
          toolName: name,
          billedCents,
          projectId,
          creditClass: 'paid',
          source: 'credit_class',
          now,
        });
      } catch (err) {
        // Metering must never turn a completed tool call into an error.
        console.error('[budgets] recordCostEvent failed after paid tool execution:', err);
      }
      // Soft alerts: post-call, on first crossing of 50/80/95 in the window,
      // record a deduped incident and audit-log budget_soft_alert. Never blocks.
      const status = await getBudgetStatus(ctx.env, ctx.accountId, now);
      if (status.policy && status.state !== 'ok' && status.state !== 'hard_stop') {
        const alert = await evaluateSoftAlerts(ctx.env, ctx.accountId, status, now);
        if (alert?.recorded) {
          await recordAuditLogBestEffort(ctx.env, {
            org_id: ctx.accountId,
            actor_id: ctx.user.id,
            action: 'budget_soft_alert',
            target_id: name,
            details: redactSensitive({
              threshold: alert.threshold,
              percent: Math.round(status.percent * 100) / 100,
              spentCents: status.spentCents,
              limitCents: status.policy.amount_cents,
            }) as Record<string, unknown>,
          });
        }
      }
    }
  }
  return result;
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/**
 * Handle GET/POST /mcp (path without /api prefix is still /mcp under worker).
 */
export async function handleMcpRequest(
  request: Request,
  env: Env,
  user: HostedIdentity,
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: MCP_CORS });
  }

  if (request.method === 'GET') {
    return mcpJson({
      ok: true,
      name: 'luminara-mcp',
      version: '1.0.0',
      protocolVersion: '2024-11-05',
      tools: listMcpToolCatalogue(),
      typedContextKeys: TYPED_CONTEXT_KEYS,
    });
  }

  if (request.method !== 'POST') {
    return mcpJson({ error: 'Method not allowed' }, 405);
  }

  const ctx = await buildCtx(env, user, request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return mcpJson(rpcError(null, -32700, 'Parse error'), 400);
  }

  const messages = Array.isArray(body) ? body : [body];
  const responses: unknown[] = [];

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') {
      responses.push(rpcError(null, -32600, 'Invalid request'));
      continue;
    }
    const m = msg as { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
    const id = m.id;
    const method = m.method;
    if (!method) {
      responses.push(rpcError(id, -32600, 'Method required'));
      continue;
    }

    if (method === 'initialize') {
      responses.push(
        rpcResult(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'luminara-mcp', version: '1.0.0' },
        }),
      );
      continue;
    }
    if (method === 'notifications/initialized' || method === 'initialized') {
      continue;
    }
    if (method === 'ping') {
      responses.push(rpcResult(id, {}));
      continue;
    }
    if (method === 'tools/list') {
      responses.push(rpcResult(id, toolsListPayload()));
      continue;
    }
    if (method === 'tools/call') {
      const params = m.params || {};
      const name = typeof params.name === 'string' ? params.name : '';
      const args =
        params.arguments && typeof params.arguments === 'object'
          ? (params.arguments as Record<string, unknown>)
          : {};
      const runHandle = await startRun(env, {
        surface: 'mcp_tool',
        accountId: ctx.accountId,
        wakeReason: 'mcp_call',
        inputPayload: { tool: name },
      });
      let result: McpToolResult;
      try {
        result = await callTool(name, args, ctx);
        if (runHandle) {
          const budgetHalted = result.structuredContent?.budgetHalted === true;
          await completeRun(
            env,
            runHandle.runId,
            budgetHalted ? 'budget_halted' : result.isError ? 'failed' : 'completed',
          );
        }
      } catch (err) {
        if (runHandle) {
          await completeRun(env, runHandle.runId, 'failed');
        }
        throw err;
      }
      responses.push(
        rpcResult(id, {
          content: [{ type: 'text', text: result.text }],
          structuredContent: result.structuredContent,
          isError: result.isError || false,
          ...(runHandle ? { _meta: { runId: runHandle.runId } } : {}),
        }),
      );
      continue;
    }

    responses.push(rpcError(id, -32601, `Method not found: ${method}`));
  }

  if (!Array.isArray(body) && responses.length === 1) {
    return mcpJson(responses[0]);
  }
  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: MCP_CORS });
  }
  return mcpJson(responses);
}

/** REST helper used by /api/projects routes (not MCP). */
export { json as restJson };
