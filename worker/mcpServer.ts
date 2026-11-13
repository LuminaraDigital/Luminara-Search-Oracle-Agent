/**
 * Lightweight JSON-RPC MCP HTTP handler for Luminara (APS A1-A4).
 * Implements initialize, tools/list, tools/call without vendoring the full MCP SDK.
 */
import type { Env } from './env';
import type { HostedIdentity, McpCredential } from './userTypes';
import { SESSION_MCP_CREDENTIAL, credentialAllowsResearch } from './userTypes';
import { billingId, json } from './workerUtils';
import { getActiveSubscription } from './quotaMiddleware';
import { planCapsFor } from './telegramBot';
import type { McpCreditClass } from '../services/projects/types';
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
  consumeApprovedRequest,
  governanceFor,
} from './mcpGovernance';
import { MAX_BODY_BYTES, readBody } from './security';
import { putCounterBestEffort } from './securityHardening';
import {
  dailyRateHeaders,
  enforceMcpBurst,
  logMcpAbuse,
  MCP_HOSTED_PAID_DAILY,
  spendMcpDailyCall,
  type McpDailyUsage,
} from './mcpLimits';
import { clipText, MCP_RESULT_TEXT_CAP, MCP_STRUCTURED_CHAR_CAP, mcpToolAnnotations } from './mcpToolMeta';
import { entitlementsFor } from '../services/plans/planEntitlements';
import {
  BYOK_PAID_CALL_COST_CENTS,
  HOSTED_PAID_CALL_COST_CENTS,
  evaluateSoftAlerts,
  getBudgetStatus,
  isBudgetHalted,
  recordBudgetIncident,
  recordCostEvent,
} from './budgets';
import { auditOrgIdFor, recordAuditLogBestEffort } from './auditLog';
import { redactSensitive } from './logRedaction';
import {
  getActiveBusinessMemories,
  executeDreamRun,
  reviewDreamProposal,
} from './dreamingService';
import { getPendingDreamEvents } from './dreamingQueue';
import { evaluateWakeGate } from './dreamingWakeGate';
import { ACCOUNT_MCP_TOOLS } from './mcpAccountTools';
import { CONVERSION_SPINE_MCP_TOOLS } from './mcpConversionTools';
import { PROJECT_HISTORY_MCP_TOOLS } from './mcpProjectHistoryTools';
import { PROJECT_MONITOR_MCP_TOOLS } from './mcpProjectMonitorTools';
import { FIX_DRAFT_MCP_TOOLS } from './fixDraftRoute';
import { enforceHabitatScope, SELF_DRIVING_MCP_TOOLS } from './selfDrivingHabitat';
import { AGENT_MCP_TOOLS, agentPromptGet, agentPromptsList } from './mcpAgents';
import { webappOrigin } from './agentReportService';
import {
  MCP_INSTRUCTIONS,
  MCP_PROTOCOL_VERSIONS,
  hasSupportedProtocolHeader,
  mcpServerInfo,
  negotiateProtocolVersion,
} from './mcpProtocol';

export type McpToolDef = {
  name: string;
  /** Human name a host may show in place of `name`. */
  title?: string;
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
  /** Which credential authenticated this call (api key, OAuth token, or cookie session). */
  credential: McpCredential;
  dailyUsage: McpDailyUsage | null;
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
  'Access-Control-Expose-Headers':
    'mcp-session-id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After',
};

function mcpJson(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...MCP_CORS, ...extraHeaders },
  });
}

const RESULT_TRUNCATED_MARK = '\nRESULT_TRUNCATED';

function textWithTruncationMark(text: string, max: number): string {
  if (text.includes('RESULT_TRUNCATED')) return clipText(text, max);
  const room = Math.max(0, max - RESULT_TRUNCATED_MARK.length);
  return `${clipText(text, room)}${RESULT_TRUNCATED_MARK}`;
}

/** Cuts tool text and structured JSON. A cut sets `code: RESULT_TRUNCATED` and marks the text. */
export function capToolResult(result: McpToolResult): McpToolResult {
  if (result.isError) return result;
  let text = result.text;
  let structured = result.structuredContent;
  let changed = false;
  if (text.length > MCP_RESULT_TEXT_CAP) {
    text = textWithTruncationMark(text, MCP_RESULT_TEXT_CAP);
    structured = { ...structured, code: 'RESULT_TRUNCATED', limit: MCP_RESULT_TEXT_CAP, textTruncated: true };
    changed = true;
  }
  if (structured && JSON.stringify(structured).length > MCP_STRUCTURED_CHAR_CAP) {
    structured = { code: 'RESULT_TRUNCATED', limit: MCP_STRUCTURED_CHAR_CAP };
    text = textWithTruncationMark(text, MCP_RESULT_TEXT_CAP);
    changed = true;
  }
  return changed ? { ...result, text, structuredContent: structured } : result;
}

const DAILY_LIMIT_CODES = new Set(['MCP_DAILY_LIMIT', 'MCP_PAID_DAILY_LIMIT', 'MCP_QUOTA_STORE']);

function textResult(text: string, structured?: Record<string, unknown>, isError = false): McpToolResult {
  return { text, structuredContent: structured, isError };
}

function dailySpendRefusal(
  ctx: McpToolContext,
  meter: { error: string; reason: 'limit' | 'store'; usage: McpDailyUsage },
  limitCode: 'MCP_DAILY_LIMIT' | 'MCP_PAID_DAILY_LIMIT',
  limit: number,
): McpToolResult {
  if (meter.reason === 'store') {
    logMcpAbuse({
      kind: 'MCP_QUOTA_STORE',
      accountId: ctx.accountId,
      clientId: ctx.credential.clientId ?? null,
    });
    return textResult(meter.error, { code: 'MCP_QUOTA_STORE', retryAfter: 1 }, true);
  }
  logMcpAbuse({
    kind: limitCode,
    accountId: ctx.accountId,
    clientId: ctx.credential.clientId ?? null,
    limit: meter.usage.limit,
    used: meter.usage.used,
  });
  const resetIso = new Date(meter.usage.resetAt * 1000).toISOString();
  const text =
    limitCode === 'MCP_DAILY_LIMIT'
      ? `Daily MCP call limit of ${limit} reached. Resets at ${resetIso}.`
      : `Hosted paid MCP limit of ${limit} calls today reached. Resets at ${resetIso}. BYOK is not counted.`;
  return textResult(
    text,
    {
      code: limitCode,
      ...(limitCode === 'MCP_DAILY_LIMIT' ? { requiredPlan: 'growth' } : {}),
      limit: meter.usage.limit,
      used: meter.usage.used,
      remaining: 0,
      resetAt: meter.usage.resetAt,
    },
    true,
  );
}

function requireString(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A required argument the handler would reject before doing work. */
function missingRequiredInput(schema: Record<string, unknown>, args: Record<string, unknown>): McpToolResult | null {
  if (!Array.isArray(schema.required)) return null;
  const properties = isPlainRecord(schema.properties) ? schema.properties : {};
  const missing: string[] = [];
  for (const key of schema.required) {
    if (typeof key !== 'string') continue;
    const spec = isPlainRecord(properties[key]) ? properties[key] : {};
    if (!requiredArgPresent(spec, args[key])) missing.push(key);
  }
  if (missing.length === 0) return null;
  return textResult(`${missing.join(', ')} required`, { code: 'BAD_INPUT' }, true);
}

function requiredArgPresent(spec: Record<string, unknown>, value: unknown): boolean {
  const type = typeof spec.type === 'string' ? spec.type : '';
  if (type === 'string') return typeof value === 'string' && value.trim().length > 0;
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'number' || type === 'integer') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'object') return isPlainRecord(value);
  if (type !== 'array') return value !== undefined && value !== null && value !== '';
  if (!Array.isArray(value) || value.length === 0) return false;
  const items = isPlainRecord(spec.items) ? spec.items : null;
  if (items?.type !== 'string') return true;
  return value.some((item) => typeof item === 'string' && item.trim().length > 0);
}

async function buildCtx(
  env: Env,
  user: HostedIdentity,
  request: Request,
  credential: McpCredential,
): Promise<McpToolContext> {
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
    credential,
    dailyUsage: null,
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
  await putCounterBestEffort(env, contextLoadedKey(accountId, projectId), String(Date.now()), CONTEXT_LOADED_TTL_SEC);
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
  ...ACCOUNT_MCP_TOOLS,
  {
    name: 'dream_status',
    description: 'Uses no credits. Checks Luminara Dreaming status, pending un-dreamed events, and pending memory review proposals.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
      },
      required: ['domain'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const domain = requireString(args, 'domain');
      if (!domain) return textResult('domain required', undefined, true);
      const pendingEvents = await getPendingDreamEvents(ctx.env, ctx.accountId, domain);
      const activeMemories = await getActiveBusinessMemories(ctx.env, ctx.accountId, domain);
      const wake = evaluateWakeGate({
        pendingEvents,
        activeMemories,
        triggerReason: 'mcp_trigger',
      });
      return textResult(
        [
          `Luminara Dreaming Status for ${domain}:`,
          `- Active Memories: ${activeMemories.length}`,
          `- Pending Un-dreamed Events: ${pendingEvents.length}`,
          `- Wake Gate: ${wake.shouldWake ? 'Ready to dream' : 'Idle'} (${wake.reason})`,
          `- Accumulated Signal Score: ${wake.signalScore.toFixed(1)} / ${wake.threshold.toFixed(1)}`,
        ].join('\n'),
        {
          domain,
          activeMemoriesCount: activeMemories.length,
          pendingEventsCount: pendingEvents.length,
          wake,
        },
      );
    },
  },
  {
    name: 'dream_consolidate',
    description: 'Uses no credits. Triggers an on-demand Luminara Dreaming consolidation run for a domain.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        force: { type: 'boolean' },
      },
      required: ['domain'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const domain = requireString(args, 'domain');
      if (!domain) return textResult('domain required', undefined, true);
      const force = args.force === true;
      const res = await executeDreamRun(ctx.env, ctx.accountId, domain, 'mcp_trigger', { force });
      if (!res.ok) return textResult(res.error, undefined, true);
      if (!res.woke) {
        return textResult(
          `Dream run skipped: ${res.reason} (Signal score: ${res.signalScore}). Pass force: true to override.`,
          { woke: false, reason: res.reason, signalScore: res.signalScore },
        );
      }
      return textResult(
        [
          `Dreaming consolidated ${res.run.eventsEvaluatedCount} event(s) for ${domain}.`,
          `Proposals generated: ${res.proposals.length} (${res.run.autoAppliedCount} auto-applied, ${res.run.pendingReviewCount} pending review).`,
          `Summary: ${res.run.summary}`,
        ].join('\n'),
        { run: res.run, proposals: res.proposals },
      );
    },
  },
  {
    name: 'get_business_memory',
    description: 'Uses no credits. Retrieves active Business DNA, visibility profiles, action memories, and preferences.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        type: { type: 'string' },
      },
      required: ['domain'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const domain = requireString(args, 'domain');
      if (!domain) return textResult('domain required', undefined, true);
      const typeFilter = typeof args.type === 'string' ? args.type.trim() : null;
      let memories = await getActiveBusinessMemories(ctx.env, ctx.accountId, domain);
      if (typeFilter) {
        memories = memories.filter((m) => m.memoryType === typeFilter);
      }
      const lines = memories.length
        ? memories
            .map((m) => `[${m.memoryType.toUpperCase()}] ${m.title}: ${m.content} (Confidence: ${m.confidence})`)
            .join('\n')
        : `No active memories found for ${domain}.`;
      return textResult(lines, { domain, memories });
    },
  },
  {
    name: 'review_dream_proposal',
    description: 'Uses no credits. Approves or rejects a pending memory proposal from Luminara Dreaming.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        proposalId: { type: 'string' },
        action: { type: 'string', enum: ['approve', 'reject'] },
        editedContent: { type: 'string' },
      },
      required: ['proposalId', 'action'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const proposalId = requireString(args, 'proposalId');
      const action = requireString(args, 'action');
      if (!proposalId || (action !== 'approve' && action !== 'reject')) {
        return textResult('proposalId and action ("approve" | "reject") required', undefined, true);
      }
      const editedContent = typeof args.editedContent === 'string' ? args.editedContent : undefined;
      const res = await reviewDreamProposal(
        ctx.env,
        ctx.accountId,
        proposalId,
        action,
        ctx.user.id || 'mcp',
        editedContent,
      );
      if (!res.ok) return textResult(res.error, undefined, true);
      return textResult(
        `Proposal ${proposalId} was ${res.proposal.status}. Memory: "${res.proposal.title}".`,
        { proposal: res.proposal },
      );
    },
  },
  ...FIX_DRAFT_MCP_TOOLS,
  ...CONVERSION_SPINE_MCP_TOOLS,
  ...PROJECT_HISTORY_MCP_TOOLS,
  ...PROJECT_MONITOR_MCP_TOOLS,
  ...SELF_DRIVING_MCP_TOOLS,
  ...AGENT_MCP_TOOLS,
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
  title: string;
  description: string;
  creditClass: McpCreditClass;
  inputSchema: Record<string, unknown>;
  annotations: ReturnType<typeof mcpToolAnnotations>;
}> {
  return TOOLS.map((tool) => {
    // A named agent carries its own title; every other tool takes one from the shared table.
    const annotations = { ...mcpToolAnnotations(tool.name), ...(tool.title ? { title: tool.title } : {}) };
    return {
      name: tool.name,
      title: annotations.title,
      description: tool.description,
      creditClass: tool.creditClass,
      inputSchema: tool.inputSchema,
      annotations,
    };
  });
}

function toolsListPayload() {
  return {
    tools: listMcpToolCatalogue().map(({ name, title, description, inputSchema, annotations }) => ({
      name,
      title,
      description,
      inputSchema,
      annotations,
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

  const habitat = enforceHabitatScope(tool, name, args, ctx.credential);
  if ('blocked' in habitat) {
    await recordAuditLogBestEffort(ctx.env, {
      org_id: auditOrgIdFor(ctx.accountId),
      actor_id: ctx.user.id,
      action: 'mcp_tool_block',
      target_id: name,
      details: redactSensitive({
        tool: name,
        decision: 'block',
        reason: habitat.blocked.structuredContent?.code,
        args,
      }) as Record<string, unknown>,
    });
    return habitat.blocked;
  }
  args = habitat.args;

  const projectId = typeof args.projectId === 'string' ? args.projectId : null;

  // Budget gate runs BEFORE the governance decideToolCall; when the account is
  // budget-halted the budget block wins over every governance outcome.
  if (await isBudgetHalted(ctx.env, ctx.accountId, now)) {
    await recordAuditLogBestEffort(ctx.env, {
      org_id: auditOrgIdFor(ctx.accountId),
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

  // Free and Starter get MCP with a daily call cap; Growth+ is unmetered.
  // The key is the account id, so a new token does not reset the count.
  const mcpDailyCallLimit = entitlementsFor(ctx.planId).mcpDailyCallLimit;
  // Opening a hosted browser session spends crawler time, so it stays on Growth+ (or the paid path).
  // browse_act and browse_goal already need the paid path; browse_close only ends a session.
  if (name === 'browse_observe' && mcpDailyCallLimit > 0 && !canUsePaid(ctx)) {
    return textResult(
      'Browser tools need Growth or Agency. Upgrade, or pass DataForSEO BYOK as x-provider-key.',
      { code: 'PAID_TOOL_FORBIDDEN', requiredPlan: 'growth' },
      true,
    );
  }

  // Scope, plan, and project gates run before approval. A refusal spends no approval and no daily counter.
  // Scope gate: hosted paid research needs mcp:research on the credential. BYOK
  // calls spend the caller's own DataForSEO account, so mcp:free is enough.
  if (creditClass === 'paid' && !ctx.dataForSeoCredential && !credentialAllowsResearch(ctx.credential)) {
    return textResult(
      'Paid tool blocked: this connection was authorized with mcp:free only. Reconnect with scope "mcp:free mcp:research" (Agency plan) or pass DataForSEO BYOK as x-provider-key.',
      { code: 'SCOPE_INSUFFICIENT', requiredScope: 'mcp:research', grantedScopes: ctx.credential.scopes },
      true,
    );
  }
  if (creditClass === 'paid' && !canUsePaid(ctx)) {
    return textResult(
      'Paid tool blocked. Upgrade to Agency or pass DataForSEO BYOK as x-provider-key (login:password).',
      { code: 'PAID_TOOL_FORBIDDEN' },
      true,
    );
  }
  if (creditClass === 'paid') {
    const contextGate = await requireProjectContextBeforePaid(ctx.env, ctx.accountId, projectId);
    if (contextGate) return contextGate;
  }

  // Only a destructive call spends an approval: each one authorizes a single call with its args.
  const approved =
    governanceFor(name).risk === 'destructive' &&
    (await consumeApprovedRequest(ctx.env, ctx.accountId, name, projectId, args));
  const decision = decideToolCall(
    name,
    { subscriptionActive, creditClass, identityPlan: ctx.planId },
    approved,
  );

  await recordAuditLogBestEffort(ctx.env, {
    org_id: auditOrgIdFor(ctx.accountId),
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
    const approvalUrl = `${webappOrigin(ctx.env)}/?mcp_approval=${req.id}`;
    // A repeated call reuses the pending request, so the time left can be well under the full window.
    const minutesLeft = Math.max(1, Math.ceil((req.expiresAt - Date.now()) / 60000));
    return textResult(
      [
        `Luminara needs the account owner's approval before running ${name}.`,
        `Approve or deny: ${approvalUrl}`,
        `The link works for ${minutesLeft} more ${minutesLeft === 1 ? 'minute' : 'minutes'}, for the signed-in account owner only. After approving, ask for the same action again with the same details.`,
      ].join('\n'),
      { requiresApproval: true, actionRequestId: req.id, approvalUrl, expiresAt: req.expiresAt },
    );
  }

  if (!tool) return textResult(`Unknown tool: ${name}`, { code: 'TOOL_NOT_FOUND' }, true);
  const inputError = missingRequiredInput(tool.inputSchema, args);
  if (inputError) return inputError;
  // Daily caps increment only after the gates above allow a known tool with usable input.
  const meter = await spendMcpDailyCall(ctx.env, ctx.accountId, mcpDailyCallLimit);
  ctx.dailyUsage = meter.usage;
  if (!meter.ok) return dailySpendRefusal(ctx, meter, 'MCP_DAILY_LIMIT', mcpDailyCallLimit);
  if (creditClass === 'paid' && !ctx.dataForSeoCredential) {
    const paid = await spendMcpDailyCall(ctx.env, ctx.accountId, MCP_HOSTED_PAID_DAILY, 'mcp_paid', 'hosted paid MCP call');
    if (!paid.ok) return dailySpendRefusal(ctx, paid, 'MCP_PAID_DAILY_LIMIT', MCP_HOSTED_PAID_DAILY);
  }
  const result = capToolResult(await tool.handler(args || {}, ctx));

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
          credentialKind: ctx.credential.kind,
          credentialId: ctx.credential.id,
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
            org_id: auditOrgIdFor(ctx.accountId),
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

/** One request may carry at most this many JSON-RPC messages. */
const MAX_MCP_BATCH = 20;

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id: unknown, code: number, message: string, data?: Record<string, unknown>) {
  return { jsonrpc: '2.0', id: id ?? null, error: data ? { code, message, data } : { code, message } };
}

/**
 * Handle GET/POST /mcp (path without /api prefix is still /mcp under worker).
 */
export async function handleMcpRequest(
  request: Request,
  env: Env,
  user: HostedIdentity,
  credential: McpCredential = SESSION_MCP_CREDENTIAL,
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: MCP_CORS });
  }

  const origin = new URL(request.url).origin;
  if (!hasSupportedProtocolHeader(request)) return mcpJson({ error: 'Unsupported MCP-Protocol-Version' }, 400);

  if (request.method === 'GET') {
    // Streamable HTTP clients GET with this Accept to open a server stream; we offer none.
    if ((request.headers.get('accept') || '').includes('text/event-stream')) {
      return new Response(null, { status: 405, headers: { Allow: 'POST', ...MCP_CORS } });
    }
    return mcpJson({
      ok: true,
      ...mcpServerInfo(origin),
      protocolVersion: MCP_PROTOCOL_VERSIONS[0],
      supportedProtocolVersions: [...MCP_PROTOCOL_VERSIONS],
      tools: listMcpToolCatalogue(),
      typedContextKeys: TYPED_CONTEXT_KEYS,
    });
  }

  if (request.method !== 'POST') {
    return mcpJson({ error: 'Method not allowed' }, 405);
  }

  const ctx = await buildCtx(env, user, request, credential);
  const read = await readBody(request, MAX_BODY_BYTES);
  if (!read.ok) return mcpJson(rpcError(null, read.status === 400 ? -32700 : -32600, read.error), read.status);
  const body = read.value;

  if (Array.isArray(body) && body.length > MAX_MCP_BATCH) {
    return mcpJson(rpcError(null, -32600, `Batch too large: at most ${MAX_MCP_BATCH} messages per request`), 400);
  }
  const messages = Array.isArray(body) ? body : [body];
  // Every rate limit counts HTTP requests, so one request may spend at most one tool call.
  const toolCalls = messages.filter((msg) => (msg as { method?: unknown } | null)?.method === 'tools/call').length;
  if (toolCalls > 1) {
    console.warn(JSON.stringify({ event: 'mcp_batch_refused', toolCalls }));
    return mcpJson(rpcError(null, -32600, 'Send one tools/call per request'), 400);
  }
  const responses: unknown[] = [];
  let rateHeaders: Record<string, string> | undefined;

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
          protocolVersion: negotiateProtocolVersion(m.params?.protocolVersion),
          capabilities: { tools: {}, prompts: {} },
          serverInfo: mcpServerInfo(origin),
          instructions: MCP_INSTRUCTIONS,
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
    if (method === 'prompts/list') {
      responses.push(rpcResult(id, agentPromptsList()));
      continue;
    }
    if (method === 'prompts/get') {
      const prompt = agentPromptGet(m.params?.name, m.params?.arguments);
      responses.push(prompt ? rpcResult(id, prompt) : rpcError(id, -32602, 'Unknown prompt or invalid arguments'));
      continue;
    }
    if (method === 'tools/call') {
      const params = m.params || {};
      const name = typeof params.name === 'string' ? params.name : '';
      const args =
        params.arguments && typeof params.arguments === 'object'
          ? (params.arguments as Record<string, unknown>)
          : {};
      const burst = await enforceMcpBurst(env, ctx.accountId, ctx.credential.clientId ?? null);
      if (!burst.ok) {
        rateHeaders = burst.headers;
        responses.push(
          rpcError(id, -32000, burst.message, {
            code: burst.code,
            limit: burst.limit,
            remaining: 0,
            resetAt: burst.resetAt,
          }),
        );
        continue;
      }
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
      const limitCode = typeof result.structuredContent?.code === 'string' ? result.structuredContent.code : '';
      if (limitCode === 'MCP_QUOTA_STORE') {
        rateHeaders = { 'Retry-After': '1' };
      } else if (limitCode === 'MCP_PAID_DAILY_LIMIT' && result.structuredContent) {
        const paidUsage = result.structuredContent;
        rateHeaders = dailyRateHeaders(
          {
            limit: Number(paidUsage.limit),
            used: Number(paidUsage.used),
            remaining: 0,
            resetAt: Number(paidUsage.resetAt),
          },
          true,
        );
      } else if (ctx.dailyUsage) {
        rateHeaders = dailyRateHeaders(ctx.dailyUsage, DAILY_LIMIT_CODES.has(limitCode));
      }
      if (DAILY_LIMIT_CODES.has(limitCode)) {
        responses.push(rpcError(id, -32000, result.text, result.structuredContent));
        continue;
      }
      const meta: Record<string, unknown> = {};
      if (runHandle) meta.runId = runHandle.runId;
      if (ctx.dailyUsage) {
        meta.rateLimit = {
          limit: ctx.dailyUsage.limit,
          remaining: ctx.dailyUsage.remaining,
          reset: ctx.dailyUsage.resetAt,
        };
      }
      responses.push(
        rpcResult(id, {
          content: [{ type: 'text', text: result.text }],
          structuredContent: result.structuredContent,
          isError: result.isError || false,
          ...(Object.keys(meta).length ? { _meta: meta } : {}),
        }),
      );
      continue;
    }

    responses.push(rpcError(id, -32601, `Method not found: ${method}`));
  }

  if (!Array.isArray(body) && responses.length === 1) {
    return mcpJson(responses[0], 200, rateHeaders);
  }
  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: MCP_CORS });
  }
  return mcpJson(responses, 200, rateHeaders);
}

/** REST helper used by /api/projects routes (not MCP). */
export { json as restJson };
