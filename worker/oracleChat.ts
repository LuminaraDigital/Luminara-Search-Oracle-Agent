/**
 * Agency server Oracle SSE chat (W6 / AI Functions P3).
 * Interaction layer: prompt fencing, DO history trust, explicit tool gate, output monitor.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId } from './workerUtils';
import { buildPaidToolRuntime, executePaidTool, PAID_TOOL_CATALOGUE, BROWSER_ACTION_CATALOGUE } from '../services/tools/registry';
import { planCapsFor } from './telegramBot';
import { getActiveSubscription } from './quotaMiddleware';
import { hasDataForSeoCredentials } from '../services/config/runtimeKeys';
import { startRun, completeRun } from './runProvenance';
import { loadAgentSkill } from './agentSkills';
import {
  BYOK_PAID_CALL_COST_CENTS,
  HOSTED_PAID_CALL_COST_CENTS,
  isBudgetHalted,
  recordCostEvent,
} from './budgets';
import { auditOrgIdFor, recordAuditLogBestEffort } from './auditLog';
import { runAllValidators, summarizeFindings } from './agentOutputValidators';
import {
  buildOracleSystemPrompt,
  extractKeywordSeed,
  fenceToolResult,
  monitorOracleOutput,
  parseAllowRegexAutoTools,
  resolveOracleHistory,
  shouldInvokeResearchKeywords,
  type SessionTurn,
} from './oracleInteractionGuard';
import { guardPasteReadyCopy, HEALTH_CLAIM_WARNING, withHealthClaimRule } from '../services/audit/healthClaimGuard';
import {
  ClaimLedger,
  buildRouterState,
  citationSupportHeuristic,
  coerceClaimStatus,
  formatOraclePointer,
  routeIntentDeterministic,
} from '../services/evidenceBound';
import {
  bindInjectedToolArgs,
  isControlPlaneToolName,
  type AgentEventEnvelope,
  type AgentStreamItem,
  type MidTurnPolicy,
} from '../services/agentCore/harnessProtocol';
import { markProjectContextLoaded, requireProjectContextBeforePaid } from './mcpServer';
import { getProjectContext } from './projectContextService';
import { scheduleWaitUntil } from './welcomeEmail';
import { withoutUnmeasuredClaims } from './chatHonesty';

/** Runtime skill slug for hosted Oracle chat (admin-seedable via agent_skills). */
const ORACLE_CHAT_SKILL_SLUG = 'oracle-chat';

/** Streamed after a reply that stated a number nobody measured. History keeps the filtered copy. */
const UNMEASURED_CLAIM_WARNING =
  'Not measured: a number in this reply was not checked or measured in this chat. Treat it as unknown until an audit measures it.';

/** Cap for control-plane POST bodies (approval, callback, state patch). */
const MAX_CONTROL_BODY_CHARS = 64 * 1024;
/** Cap for tool_end text persisted in DO event log so 500 events stay well below the 2 MB DO value limit. */
const MAX_HARNESS_TOOL_OUTPUT_CHARS = 2048;

export function isOracleServerEnabled(env: Env): boolean {
  return String(env.ORACLE_SERVER_ENABLED || '').toLowerCase() === 'true';
}

function sseLine(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

type OracleChatBody = {
  message?: string;
  sessionId?: string;
  projectId?: string;
  history?: Array<{ role: string; content: string }>;
  /** Explicit paid tool name; regex auto-invoke is off unless ORACLE_AUTO_TOOLS=true. */
  invokeTool?: string;
  /** Optional explicit tool arguments (injected keys like accountId/projectId are stripped). */
  toolArgs?: Record<string, unknown>;
  /** Required when invokeTool is set (unless already remembered in session): confirms paid side effects. */
  confirmTool?: boolean;
  /** When true alongside confirmTool:true, allow-lists the tool for subsequent turns in this session. */
  rememberTool?: boolean;
  /** Busy-turn policy: `accept` joins the active turn, `reject` (default on chat) returns 409. */
  midTurn?: MidTurnPolicy;
};

/**
 * Out-of-band Control & Observability Plane router for `/api/oracle/session/:sessionId/:action`.
 * Exposes `events` (GET `?after=offset`), `approval` (POST), `callback` (POST),
 * `state` (GET), `state/patch` (POST), and `history` (GET).
 */
export async function handleOracleSessionControlRoute(
  request: Request,
  env: Env,
  user: HostedIdentity,
  sessionIdRaw: string,
  actionPath: string,
): Promise<Response> {
  if (!isOracleServerEnabled(env)) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Server Oracle is disabled. Set ORACLE_SERVER_ENABLED=true after staging soak.',
        code: 'ORACLE_DISABLED',
      }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }
  if (!env.ORACLE_SESSION) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'OracleSession Durable Object binding is not configured.',
        code: 'DO_UNAVAILABLE',
      }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }

  // Clients may only read the log/state and resolve gates. Event publishing, turn admission,
  // settle, and truncate stay server-internal so a caller cannot forge tool_end/approval events.
  const allowed =
    (request.method === 'GET' && ['events', 'state', 'history'].includes(actionPath)) ||
    (request.method === 'POST' && ['approval', 'callback', 'state/patch'].includes(actionPath));
  if (!allowed) {
    return new Response(JSON.stringify({ ok: false, error: 'Not found', code: 'NOT_FOUND' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const sessionId = String(sessionIdRaw || `sess_${user.id}`).slice(0, 128);
  const accountId = billingId(user);
  const id = env.ORACLE_SESSION.idFromName(`${accountId}:${sessionId}`);
  const stub = env.ORACLE_SESSION.get(id);
  const url = new URL(request.url);
  const targetUrl = `https://oracle-session/${actionPath}${url.search}`;

  let bodyText: string | undefined;
  if (request.method === 'POST') {
    bodyText = await request.text();
    if (bodyText.length > MAX_CONTROL_BODY_CHARS) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Request body too large', code: 'PAYLOAD_TOO_LARGE' }),
        { status: 413, headers: { 'content-type': 'application/json' } },
      );
    }
  }

  const doRes = await stub.fetch(targetUrl, {
    method: request.method,
    headers: { 'content-type': 'application/json' },
    body: bodyText,
  });

  if (actionPath === 'approval' && request.method === 'POST' && doRes.ok) {
    const cloned = (await doRes.clone().json().catch(() => ({}))) as {
      toolName?: string;
      approved?: boolean;
      remember?: boolean;
    };
    await recordAuditLogBestEffort(env, {
      org_id: auditOrgIdFor(accountId),
      actor_id: user.id,
      action: cloned.approved ? 'oracle_tool_allow' : 'oracle_tool_block',
      target_id: cloned.toolName || 'tool_approval',
      details: {
        surface: 'control_plane',
        sessionId,
        approved: Boolean(cloned.approved),
        remember: Boolean(cloned.remember),
      },
    });
  }

  return doRes;
}

/**
 * Stream tokens + tool stages + 3-plane `harness_event` envelopes as SSE.
 * Uses hosted Groq when configured.
 */
export async function handleOracleChatSse(
  request: Request,
  env: Env,
  user: HostedIdentity,
): Promise<Response> {
  if (!isOracleServerEnabled(env)) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Server Oracle is disabled. Set ORACLE_SERVER_ENABLED=true after staging soak.',
        code: 'ORACLE_DISABLED',
      }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as OracleChatBody;
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return new Response(JSON.stringify({ ok: false, error: 'message required', code: 'BAD_REQUEST' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (body.invokeTool && isControlPlaneToolName(body.invokeTool)) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `Tool "${body.invokeTool}" belongs to the out-of-band control plane and cannot be invoked via chat.`,
        code: 'CONTROL_PLANE_VIOLATION',
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  const sessionId = (body.sessionId || `sess_${user.id}`).slice(0, 128);
  const accountId = billingId(user);
  const runHandle = await startRun(env, {
    surface: 'oracle_chat',
    accountId,
    wakeReason: 'user_invoke',
    inputPayload: {
      sessionId,
      messageLength: message.length,
      hasProviderKey: Boolean(request.headers.get('x-provider-key')),
    },
  });
  const sub = await getActiveSubscription(env, user);
  const caps = planCapsFor(sub?.plan || 'free');
  const byok = request.headers.get('x-provider-key')?.trim() || null;
  const dfsCred =
    byok && hasDataForSeoCredentials({ luminara_dataforseo_key: byok }) ? byok : null;

  const durableObjectAvailable = Boolean(env.ORACLE_SESSION);
  let sessionStub: ReturnType<DurableObjectNamespace['get']> | null = null;
  if (env.ORACLE_SESSION) {
    const id = env.ORACLE_SESSION.idFromName(`${accountId}:${sessionId}`);
    sessionStub = env.ORACLE_SESSION.get(id);
  }

  let doHistory: SessionTurn[] = [];
  let rememberedTools: string[] = [];
  let localOffset = 1;
  let activeTurnId = 'turn_1';
  let activeTurnNumber = 1;
  let turnAdmitted = false;

  if (sessionStub) {
    try {
      const histRes = await sessionStub.fetch('https://oracle-session/history', { method: 'GET' });
      if (histRes.ok) {
        const histJson = (await histRes.json()) as {
          turns?: SessionTurn[];
          rememberedTools?: string[];
        };
        doHistory = Array.isArray(histJson.turns) ? histJson.turns : [];
        rememberedTools = Array.isArray(histJson.rememberedTools)
          ? histJson.rememberedTools
          : [];
      }
    } catch {
      doHistory = [];
    }

    // Plane 1: Two-phase turn admission before opening the SSE stream.
    // Chat has no background queue drainer, so default to 'reject' when busy unless 'accept' is requested.
    const effectiveMidTurn: MidTurnPolicy = body.midTurn === 'accept' ? 'accept' : 'reject';
    const admitRes = await sessionStub.fetch('https://oracle-session/admit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messageId: runHandle?.runId || `msg_${Date.now()}`,
        messageType: 'user_message',
        content: message,
        midTurn: effectiveMidTurn,
      }),
    });
    const admitData = (await admitRes.json().catch(() => ({}))) as {
      disposition?: string;
      turnId?: string;
      activeTurnId?: string;
      turnNumber?: number;
      acceptedOffset?: number;
    };
    if (
      admitRes.status === 409 ||
      admitData?.disposition === 'reject' ||
      admitData?.disposition === 'rejected' ||
      admitData?.disposition === 'enqueued' ||
      admitData?.disposition === 'queued'
    ) {
      if (runHandle) await completeRun(env, runHandle.runId, 'failed');
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Session already has an active turn',
          code: 'TURN_ACTIVE',
          activeTurnId: admitData?.activeTurnId ?? admitData?.turnId ?? null,
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    }
    if (admitRes.ok) {
      turnAdmitted = true;
      if (admitData.turnId) activeTurnId = admitData.turnId;
      if (typeof admitData.turnNumber === 'number') activeTurnNumber = admitData.turnNumber;
    }
  }

  const { readable, writable } = new TransformStream(
    undefined,
    { highWaterMark: 128 },
    { highWaterMark: 128 },
  );
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  let clientGone = false;
  const write = async (event: string, data: unknown) => {
    if (clientGone) return;
    try {
      await writer.write(encoder.encode(sseLine(event, data)));
    } catch {
      // Client disconnected: keep running so the turn still settles and the run is recorded.
      clientGone = true;
    }
  };

  const run = async () => {
    const emitHarnessEvents = async (items: AgentStreamItem[]) => {
      if (items.length === 0) return;
      if (sessionStub) {
        try {
          const evRes = await sessionStub.fetch('https://oracle-session/events', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              agentId: 'oracle',
              turnId: activeTurnId,
              turnNumber: activeTurnNumber,
              events: items,
            }),
          });
          if (evRes.ok) {
            const evJson = (await evRes.json()) as { published?: AgentEventEnvelope[] };
            if (Array.isArray(evJson.published)) {
              for (const envFrame of evJson.published) {
                localOffset = envFrame.offset + 1;
                await write('harness_event', envFrame);
              }
              return;
            }
          }
        } catch {
          /* fallback to local envelope below */
        }
      }
      for (const item of items) {
        const fallbackFrame: AgentEventEnvelope = {
          offset: localOffset++,
          agent_id: 'oracle',
          turn_id: activeTurnId,
          turn_number: activeTurnNumber,
          timestamp: Date.now(),
          event: item,
        };
        await write('harness_event', fallbackFrame);
      }
    };

    try {
      if (sessionStub) {
        await sessionStub.fetch('https://oracle-session/append', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'user', content: message }),
        });
      } else {
        await emitHarnessEvents([
          {
            type: 'message_accepted',
            message_id: runHandle?.runId || `msg_${Date.now()}`,
            message_type: 'user_message',
            disposition: 'started',
          },
          { type: 'turn_started' },
        ]);
      }

      await write('status', { stage: 'thinking' });

      let toolNote = '';
      // The text of a measured tool result: evidence for the numbers in the reply.
      let measuredToolText = '';
      const allowRegexAutoTools = parseAllowRegexAutoTools(env.ORACLE_AUTO_TOOLS);
      const toolDecision = shouldInvokeResearchKeywords(message, {
        allowRegexAutoTools,
        invokeTool: body.invokeTool,
        confirmTool: Boolean(body.confirmTool),
        rememberedTools,
      });

      const wantsPaidTool = Boolean(body.projectId && caps.apiAccess && toolDecision.invoke && toolDecision.seed);
      const toolNow = Date.now();
      const budgetHalted = wantsPaidTool ? await isBudgetHalted(env, accountId, toolNow) : false;
      const toolCallId = `call_${toolNow}`;

      if (wantsPaidTool && budgetHalted) {
        // Same budget gate as MCP callTool: the account hard stop wins over chat confirmTool.
        await recordAuditLogBestEffort(env, {
          org_id: auditOrgIdFor(accountId),
          actor_id: user.id,
          action: 'oracle_tool_block',
          target_id: 'research_keywords',
          details: { tool: 'research_keywords', decision: 'block', reason: 'budget_exhausted', projectId: body.projectId },
        });
        await emitHarnessEvents([
          {
            type: 'tool_error',
            tool_id: toolCallId,
            tool_name: 'research_keywords',
            message: 'budget_exhausted',
          },
        ]);
        await write('tool', {
          tool: 'research_keywords',
          stage: 'blocked',
          reason: 'budget_exhausted',
          hint: 'Monthly budget hard stop reached. Resume or raise the budget in Settings.',
        });
      } else if (wantsPaidTool && toolDecision.seed) {
        const seed = toolDecision.seed;
        const projectId = body.projectId ?? null;

        // APS: same context-before-paid gate as MCP. Oracle loads D1 context once, then marks KV.
        let contextBlock = await requireProjectContextBeforePaid(env, accountId, projectId);
        if (contextBlock && projectId && env.LUMINARA_KV) {
          const ctx = await getProjectContext(env, accountId, projectId);
          if (ctx) {
            await markProjectContextLoaded(env, accountId, projectId);
            contextBlock = await requireProjectContextBeforePaid(env, accountId, projectId);
          }
        }
        const route = routeIntentDeterministic(
          buildRouterState({
            userMessage: message,
            projectId,
            hasProjectContext: !contextBlock,
            offeredTools: ['research_keywords'],
          }),
        );
        if (contextBlock || route.intent === 'clarify') {
          const blockReason = contextBlock
            ? String((contextBlock.structuredContent as { reason?: string } | undefined)?.reason || 'CONTEXT_REQUIRED')
            : route.clarifyReason || 'intent_clarify';
          await recordAuditLogBestEffort(env, {
            org_id: auditOrgIdFor(accountId),
            actor_id: user.id,
            action: 'oracle_tool_block',
            target_id: 'research_keywords',
            details: {
              tool: 'research_keywords',
              decision: 'block',
              reason: blockReason,
              projectId,
            },
          });
          await emitHarnessEvents([
            {
              type: 'tool_error',
              tool_id: toolCallId,
              tool_name: 'research_keywords',
              message: blockReason,
            },
          ]);
          await write('tool', {
            tool: 'research_keywords',
            stage: 'blocked',
            reason: contextBlock ? 'CONTEXT_REQUIRED' : 'intent_clarify',
            hint:
              contextBlock?.text ||
              route.clarifyReason ||
              'Call get_project_context / open the project before paid research (APS).',
            intentRoute: route,
          });
        } else {
          // Bind Injected<T> context (strips any spoofed accountId/projectId from model/body args)
          const { modelFacingInput, executionArgs } = bindInjectedToolArgs(
            { ...(body.toolArgs || {}), seeds: [seed] },
            { projectId: body.projectId, accountId },
          );

          await emitHarnessEvents([
            {
              type: 'tool_requested',
              tool_id: toolCallId,
              tool_name: 'research_keywords',
              tool_input: modelFacingInput,
            },
          ]);

          // If caller passed rememberTool: true with confirmTool: true, register a pending gate
          // and resolve it on the Control Plane so the event log has the full approval pair.
          if (sessionStub && body.confirmTool && body.rememberTool) {
            try {
              await emitHarnessEvents([
                {
                  type: 'tool_approval_requested',
                  tool_id: toolCallId,
                  tool_name: 'research_keywords',
                  tool_input: modelFacingInput,
                  risk_tier: 'paid_research',
                },
              ]);
              await sessionStub.fetch('https://oracle-session/approval', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  toolId: toolCallId,
                  toolName: 'research_keywords',
                  approved: true,
                  remember: true,
                  reason: 'explicit_confirm_with_remember',
                }),
              });
            } catch {
              /* best effort */
            }
          }

          await emitHarnessEvents([
            {
              type: 'tool_start',
              tool_id: toolCallId,
              tool_name: 'research_keywords',
              tool_input: modelFacingInput,
            },
          ]);

          const rt = buildPaidToolRuntime({
            env,
            accountId,
            canUsePaid: true,
            dataForSeoCredential: dfsCred,
            author: 'oracle',
          });
          await write('tool', {
            tool: 'research_keywords',
            stage: 'running',
            args: modelFacingInput,
            modelFacingInput,
            reason: toolDecision.reason,
          });
          const toolResult = await executePaidTool(
            'research_keywords',
            executionArgs,
            rt,
          );
          toolNote = `\n\n${fenceToolResult('research_keywords', toolResult.text)}`;
          if (!toolResult.isError) {
            const billedCents = dfsCred ? BYOK_PAID_CALL_COST_CENTS : HOSTED_PAID_CALL_COST_CENTS;
            if (billedCents > 0) {
              await recordCostEvent(env, {
                accountId,
                toolName: 'research_keywords',
                billedCents,
                projectId: body.projectId ?? null,
                creditClass: 'paid',
                source: 'credit_class',
                runId: runHandle?.runId ?? null,
                credentialKind: 'oracle',
                credentialId: null,
                now: toolNow,
              }).catch((err) => console.error('[budgets] oracle recordCostEvent failed:', err));
            }
            await recordAuditLogBestEffort(env, {
              org_id: auditOrgIdFor(accountId),
              actor_id: user.id,
              action: 'oracle_tool_allow',
              target_id: 'research_keywords',
              details: { tool: 'research_keywords', projectId: body.projectId, byok: Boolean(dfsCred) },
            });
          }
          const structured =
            toolResult.structuredContent && typeof toolResult.structuredContent === 'object'
              ? (toolResult.structuredContent as Record<string, unknown>)
              : {};
          const rawStatus = coerceClaimStatus(
            (typeof structured.measurementStatus === 'string'
              ? structured.measurementStatus
              : 'not_measured') as 'measured' | 'estimated' | 'not_measured' | 'unknown',
            structured.measurementStatus === 'measured'
              ? [{ kind: 'dfs', excerpt: toolResult.text.slice(0, 240) }]
              : [],
          );
          if (!toolResult.isError && rawStatus === 'measured') measuredToolText = toolResult.text;
          const ledger = new ClaimLedger();
          const cite = citationSupportHeuristic({
            claimText: toolResult.text.slice(0, 400),
            evidenceSpans: rawStatus === 'measured' ? [toolResult.text.slice(0, 800)] : [],
          });
          ledger.append({
            text: cite.safeText.slice(0, 400),
            status: rawStatus === 'measured' ? 'measured' : cite.status,
            sources:
              rawStatus === 'measured'
                ? [{ kind: 'dfs', excerpt: toolResult.text.slice(0, 240) }]
                : [{ kind: 'other', excerpt: 'tool result without measured status' }],
          });

          await emitHarnessEvents([
            {
              type: 'tool_end',
              tool_id: toolCallId,
              tool_name: 'research_keywords',
              tool_output: toolResult.text.slice(0, MAX_HARNESS_TOOL_OUTPUT_CHARS),
              measurement_status: rawStatus,
            },
          ]);

          await write('tool', {
            tool: 'research_keywords',
            stage: 'done',
            output: toolResult.text,
            structuredContent: {
              ...structured,
              measurementStatus: rawStatus,
              claimLedger: ledger.toJSON(),
              intentRoute: route,
              oraclePointer: formatOraclePointer({
                ledger,
                oneAction: 'Review keyword ideas in project context, then save_report',
              }),
            },
          });
        }
      } else if (body.invokeTool === 'research_keywords' && !toolDecision.invoke) {
        const seedPreview = extractKeywordSeed(message) || 'general';
        await emitHarnessEvents([
          {
            type: 'tool_approval_requested',
            tool_id: toolCallId,
            tool_name: 'research_keywords',
            tool_input: { seeds: [seedPreview] },
            risk_tier: 'paid_research',
          },
        ]);
        await write('tool', {
          tool: 'research_keywords',
          toolId: toolCallId,
          stage: 'blocked',
          reason: toolDecision.reason,
          hint: 'Pass confirmTool:true with invokeTool, approve via POST /api/oracle/session/:id/approval, or set ORACLE_AUTO_TOOLS=true.',
        });
      }

      const clientHistory = Array.isArray(body.history) ? body.history.slice(-12) : [];
      const historySource = resolveOracleHistory({
        durableObjectAvailable,
        doHistory,
        clientHistory,
      });
      const bundledOraclePrompt = buildOracleSystemPrompt();
      const oracleSkill = await loadAgentSkill(env, ORACLE_CHAT_SKILL_SLUG, {
        fallbackPrompt: bundledOraclePrompt,
      });
      let systemPrompt = withHealthClaimRule(oracleSkill?.promptBody || bundledOraclePrompt);
      let memoryFacts: string[] = [];
      try {
        const { ragContextForOracle } = await import('./memoryRag');
        const memory = await ragContextForOracle(env, billingId(user), message);
        if (memory.block) {
          systemPrompt = `${systemPrompt}\n\n${memory.block}`;
          memoryFacts = memory.facts;
        }
      } catch {
        /* memory RAG is best-effort */
      }
      const messages = [
        { role: 'system', content: systemPrompt },
        ...historySource,
        { role: 'user', content: message + toolNote },
      ];

      const groqKey = env.GROQ_API_KEY || env.GROQ_API_KEY_FALLBACK;
      if (!groqKey) {
        await write('error', { error: 'Hosted Groq key not configured', code: 'NO_LLM' });
        await write('done', { ok: false });
        return;
      }

      const llmRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${groqKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages,
          temperature: 0.5,
          max_tokens: 2048,
          stream: true,
        }),
      });

      if (!llmRes.ok || !llmRes.body) {
        const errText = await llmRes.text();
        await write('error', { error: `LLM error ${llmRes.status}`, detail: errText.slice(0, 200) });
        await write('done', { ok: false });
        return;
      }

      const reader = llmRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              await write('token', { text: delta });
            }
          } catch {
            // ignore
          }
        }
      }

      const monitor = monitorOracleOutput(fullText, Boolean(measuredToolText));
      const guarded = guardPasteReadyCopy(fullText);
      if (guarded.changed) {
        // Tokens already sent keep the original phrases. The warning follows them, and history stores the stripped copy.
        await write('token', { text: `\n\n${HEALTH_CLAIM_WARNING}` });
        fullText = guarded.text;
      }
      if (!monitor.ok) {
        await write('monitor', {
          ok: false,
          flags: monitor.flags,
          notes: monitor.notes,
        });
      }

      // Honesty validators: flag into provenance only (v1 never blocks the stream).
      const validation = runAllValidators(fullText);
      const validationSummary = summarizeFindings(validation.findings);

      // A number nobody measured: the warning follows the tokens already sent, and history stores
      // the filtered copy. Figures the user gave, here or in account memory, and the numbers of a
      // measured tool result stay.
      const userTexts = [...memoryFacts, ...historySource.filter((t) => t.role === 'user').map((t) => t.content), message];
      const honest = withoutUnmeasuredClaims(fullText, userTexts, measuredToolText ? [measuredToolText] : []);
      if (honest.replaced > 0) {
        await write('token', { text: `\n\n${UNMEASURED_CLAIM_WARNING}` });
        fullText = honest.text;
        console.warn(JSON.stringify({ event: 'oracle_output_redacted', sentences: honest.replaced }));
      }

      if (sessionStub && fullText) {
        await sessionStub.fetch('https://oracle-session/append', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'assistant', content: fullText }),
        });
      }

      // Chat -> facts pipeline (best-effort; high-confidence lines auto-store)
      try {
        const { extractFactsFromChat } = await import('./memoryRag');
        await extractFactsFromChat(env, user, {
          message,
          sessionId,
          autoStore: true,
        });
      } catch {
        /* ignore */
      }

      await write('done', {
        ok: true,
        sessionId,
        turnId: activeTurnId,
        turnNumber: activeTurnNumber,
        monitor: monitor.ok ? { ok: true, flags: [] } : { ok: false, flags: monitor.flags, notes: monitor.notes },
        validation: { ok: validation.ok, summary: validationSummary },
        toolsAvailable: [
          ...PAID_TOOL_CATALOGUE.map((t) => t.name),
          // Observe-first: list browse tools even when crawler is unset; calls return BROWSER_UNAVAILABLE.
          ...BROWSER_ACTION_CATALOGUE.map((t) => t.name),
        ],
      });
      if (runHandle) {
        await write('provenance', {
          runId: runHandle.runId,
          skillSlug: ORACLE_CHAT_SKILL_SLUG,
          skillVersion: oracleSkill?.version ?? 0,
          validation: {
            ok: validation.ok,
            summary: validationSummary,
            findings: validation.findings.slice(0, 20),
          },
        });
        await completeRun(env, runHandle.runId, 'completed');
      }
    } catch (e) {
      if (runHandle) {
        await completeRun(env, runHandle.runId, 'failed');
      }
      await write('error', {
        error: e instanceof Error ? e.message : 'Oracle chat failed',
        code: 'ORACLE_ERROR',
      });
      await write('done', { ok: false });
    } finally {
      if (turnAdmitted && sessionStub) {
        try {
          await sessionStub.fetch('https://oracle-session/settle', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ turnId: activeTurnId }),
          });
        } catch {
          /* best effort */
        }
      } else if (!sessionStub) {
        await emitHarnessEvents([{ type: 'turn_end' }]);
      }
      await writer.close().catch(() => {
        /* client already disconnected */
      });
    }
  };

  // Cloudflare cancels work outside waitUntil once the client disconnects; without it a closed
  // tab skips the cost event and the /settle call, leaving the session locked (TURN_ACTIVE).
  scheduleWaitUntil(run().catch((err) => console.error('[oracleChat] stream run failed:', err)));

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
