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
import { runAllValidators, summarizeFindings } from './agentOutputValidators';
import {
  buildOracleSystemPrompt,
  fenceToolResult,
  monitorOracleOutput,
  parseAllowRegexAutoTools,
  resolveOracleHistory,
  shouldInvokeResearchKeywords,
  type SessionTurn,
} from './oracleInteractionGuard';

/** Runtime skill slug for hosted Oracle chat (admin-seedable via agent_skills). */
const ORACLE_CHAT_SKILL_SLUG = 'oracle-chat';

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
  /** Required when invokeTool is set: confirms paid side effects. */
  confirmTool?: boolean;
};

/**
 * Stream tokens + tool stages as SSE. Uses hosted Groq when configured.
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

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const write = async (event: string, data: unknown) => {
    await writer.write(encoder.encode(sseLine(event, data)));
  };

  const run = async () => {
    try {
      let sessionStub: ReturnType<DurableObjectNamespace['get']> | null = null;
      const durableObjectAvailable = Boolean(env.ORACLE_SESSION);
      if (env.ORACLE_SESSION) {
        const id = env.ORACLE_SESSION.idFromName(`${accountId}:${sessionId}`);
        sessionStub = env.ORACLE_SESSION.get(id);
      }

      // Load Durable Object history before appending this turn (session continuity).
      let doHistory: SessionTurn[] = [];
      if (sessionStub) {
        try {
          const histRes = await sessionStub.fetch('https://oracle-session/history', { method: 'GET' });
          if (histRes.ok) {
            const histJson = (await histRes.json()) as { turns?: SessionTurn[] };
            doHistory = Array.isArray(histJson.turns) ? histJson.turns : [];
          }
        } catch {
          doHistory = [];
        }
        await sessionStub.fetch('https://oracle-session/append', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'user', content: message }),
        });
      }

      await write('status', { stage: 'thinking' });

      let toolNote = '';
      let hadToolEvidence = false;
      const allowRegexAutoTools = parseAllowRegexAutoTools(env.ORACLE_AUTO_TOOLS);
      const toolDecision = shouldInvokeResearchKeywords(message, {
        allowRegexAutoTools,
        invokeTool: body.invokeTool,
        confirmTool: Boolean(body.confirmTool),
      });

      if (body.projectId && caps.apiAccess && toolDecision.invoke && toolDecision.seed) {
        const rt = buildPaidToolRuntime({
          env,
          accountId,
          canUsePaid: true,
          dataForSeoCredential: dfsCred,
          author: 'oracle',
        });
        const seed = toolDecision.seed;
        await write('tool', {
          tool: 'research_keywords',
          stage: 'running',
          args: { projectId: body.projectId, seeds: [seed] },
          reason: toolDecision.reason,
        });
        const toolResult = await executePaidTool(
          'research_keywords',
          { projectId: body.projectId, seeds: [seed] },
          rt,
        );
        hadToolEvidence = true;
        toolNote = `\n\n${fenceToolResult('research_keywords', toolResult.text)}`;
        await write('tool', {
          tool: 'research_keywords',
          stage: 'done',
          output: toolResult.text,
          structuredContent: toolResult.structuredContent,
        });
      } else if (body.invokeTool === 'research_keywords' && !toolDecision.invoke) {
        await write('tool', {
          tool: 'research_keywords',
          stage: 'blocked',
          reason: toolDecision.reason,
          hint: 'Pass confirmTool:true with invokeTool, or set ORACLE_AUTO_TOOLS=true for legacy regex auto-invoke.',
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
      const systemPrompt = oracleSkill?.promptBody || bundledOraclePrompt;
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

      const monitor = monitorOracleOutput(fullText, hadToolEvidence);
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

      if (sessionStub && fullText) {
        await sessionStub.fetch('https://oracle-session/append', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'assistant', content: fullText }),
        });
      }

      await write('done', {
        ok: true,
        sessionId,
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
      await writer.close();
    }
  };

  void run();

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
