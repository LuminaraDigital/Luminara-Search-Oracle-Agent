/**
 * Cohesive Hermes turn coordinator for `worker/oracleChat.ts`.
 *
 * Keeps `worker/oracleChat.ts` well under the 1,000-line ceiling while wiring:
 * - First-party A/B assignment (`EPISTEMIC_AB_ENABLED`) + epistemic stance prompt rule
 * - Frozen `OracleSession` memory snapshot (`ORACLE_LOOP_GUARDS_ENABLED`)
 * - Context-scope warn-only tool output threat scan (`THREAT_SCAN_MODE`)
 * - Session-scoped `ToolLoopGuardrail` duplicate/cycle guard (`ORACLE_LOOP_GUARDS_ENABLED`)
 * - Cost-aware `EmptyResponseGuard` stream retry/fallback (`ORACLE_LOOP_GUARDS_ENABLED`)
 * - Per-turn `VerificationLedger` check + symmetric D1 A/B validator telemetry
 */

import type { Env } from './env';
import type { EpistemicAssignment } from '../services/experiments/hermesAbExperiment';
import {
  EPISTEMIC_STANCE_RULE,
  detectUnverifiedFactLeakage,
  parseUnverifiedSection,
} from '../services/trust/epistemicStance';
import {
  ToolLoopGuardrail,
  oracleLoopGuardsEnabled,
  type ToolGuardStepRecord,
} from '../services/oracle/toolLoopGuardrails';
import { EmptyResponseGuard } from '../services/oracle/emptyResponseGuard';
import { groqModelCandidates } from '../services/llm/nativeModelDefaults';
import {
  VerificationLedger,
  type VerificationCheckResult,
} from '../services/oracle/verificationLedger';
import { GroundedCitationLedger } from '../services/audit/groundedCitations';
import {
  MEMORY_SNAPSHOT_STATE_KEY,
  TOOL_GUARD_STATE_KEY,
  isReservedOracleStateKey,
  resolveSessionMemorySnapshot,
  type SessionStateStub,
} from './oracleMemorySnapshot';
import { scanToolResultThreats } from './oracleInteractionGuard';
import { resolveThreatScanMode } from '../services/trust/threatPatterns';
import { recordServerProductEvent } from './productAnalytics';

export { MEMORY_SNAPSHOT_STATE_KEY, TOOL_GUARD_STATE_KEY, isReservedOracleStateKey };
const MAX_STORED_TOOL_GUARD_STEPS = 24;
const MAX_REGISTERED_TOOL_URLS = 20;
const TOOL_URL_RE = /https?:\/\/[^\s"'<>\\`{}[\]]+/g;

function cleanExtractedUrl(raw: string): string {
  let cleaned = raw.replace(/[.,;:!?*_]+$/, '');
  while (cleaned.endsWith(')')) {
    const opens = (cleaned.match(/\(/g) || []).length;
    const closes = (cleaned.match(/\)/g) || []).length;
    if (closes > opens) {
      cleaned = cleaned.slice(0, -1).replace(/[.,;:!?*_]+$/, '');
    } else {
      break;
    }
  }
  return cleaned;
}

export function registerToolUrlsInLedger(
  ledger: GroundedCitationLedger,
  rawToolText: string,
): void {
  if (!rawToolText) return;
  TOOL_URL_RE.lastIndex = 0;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = TOOL_URL_RE.exec(rawToolText)) !== null && count < MAX_REGISTERED_TOOL_URLS) {
    const candidateUrl = cleanExtractedUrl(match[0]);
    if (!candidateUrl) continue;
    try {
      const windowStart = Math.max(0, match.index - 240);
      const windowEnd = Math.min(rawToolText.length, match.index + candidateUrl.length + 240);
      const localWindow = rawToolText.slice(windowStart, windowEnd).trim();
      ledger.registerSource(candidateUrl, { fetchedText: localWindow });
      count += 1;
    } catch {
      /* skip malformed URL token */
    }
  }
}

export async function prepareOraclePromptWithHermes(params: {
  env: Env;
  sessionStub: SessionStateStub | null;
  accountId: string;
  message: string;
  baseSystemPrompt: string;
  assignment: EpistemicAssignment;
}): Promise<{
  systemPrompt: string;
  memoryFacts: string[];
  memoryFromSnapshot: boolean;
}> {
  const memory = await resolveSessionMemorySnapshot({
    env: params.env,
    sessionStub: params.sessionStub,
    accountId: params.accountId,
    message: params.message,
  });

  let systemPrompt = params.baseSystemPrompt;
  if (memory.block) {
    systemPrompt = `${systemPrompt}\n\n${memory.block}`;
  }
  if (params.assignment.enabled && params.assignment.variant === 'treatment') {
    systemPrompt = `${systemPrompt}\n\n${EPISTEMIC_STANCE_RULE}`;
  }

  return {
    systemPrompt,
    memoryFacts: memory.facts,
    memoryFromSnapshot: memory.fromSnapshot,
  };
}

function isToolGuardStepRecord(raw: unknown): raw is ToolGuardStepRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.step === 'number' &&
    Number.isFinite(r.step) &&
    typeof r.toolName === 'string' &&
    typeof r.argsSig === 'string' &&
    typeof r.resultSig === 'string' &&
    typeof r.resultChars === 'number' &&
    Number.isFinite(r.resultChars) &&
    typeof r.isPoller === 'boolean'
  );
}

async function readSessionToolHistory(
  sessionStub: SessionStateStub | null,
): Promise<ToolGuardStepRecord[]> {
  if (!sessionStub) return [];
  try {
    const res = await sessionStub.fetch(`https://oracle-session/state?key=${TOOL_GUARD_STATE_KEY}`);
    if (!res.ok) return [];
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      doc?: { records?: unknown };
    } | null;
    if (!body?.ok || !Array.isArray(body.doc?.records)) return [];
    return body.doc.records.filter(isToolGuardStepRecord);
  } catch {
    return [];
  }
}

async function writeSessionToolHistory(
  sessionStub: SessionStateStub | null,
  records: ToolGuardStepRecord[],
): Promise<void> {
  if (!sessionStub) return;
  try {
    await sessionStub.fetch('https://oracle-session/state/patch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: TOOL_GUARD_STATE_KEY,
        snapshot: { records: records.slice(-MAX_STORED_TOOL_GUARD_STEPS) },
      }),
    });
  } catch {
    /* best effort */
  }
}

function formatGroundedIndexNote(ledger: GroundedCitationLedger | undefined): string {
  if (!ledger) return '';
  const entries = ledger.list();
  if (entries.length === 0) return '';
  const pairs = entries.map((e) => `[${e.id}] ${e.url}`).join('; ');
  return `\n\n[Retrieved source index for [n] citations: ${pairs}]`;
}

export async function guardOracleToolExecution(params: {
  env: Env;
  accountId: string;
  sessionId: string;
  sessionStub: SessionStateStub | null;
  toolName: string;
  args: Record<string, unknown>;
  rawToolText: string;
  measurementStatus: 'measured' | 'estimated' | 'not_measured' | 'unknown';
  isError?: boolean;
  verificationLedger: VerificationLedger;
  groundedLedger?: GroundedCitationLedger;
}): Promise<{ effectiveToolText: string; stalled: boolean }> {
  params.verificationLedger.recordToolObservation({
    toolName: params.toolName,
    measurementStatus: params.measurementStatus,
    isError: params.isError,
  });
  if (!params.isError && params.groundedLedger) {
    registerToolUrlsInLedger(params.groundedLedger, params.rawToolText);
  }

  const scanMode = resolveThreatScanMode(params.env);
  const threatHit = scanToolResultThreats(
    params.toolName,
    params.rawToolText,
    scanMode,
  );
  if (threatHit && threatHit.findings.length > 0) {
    await recordServerProductEvent(params.env.DB, {
      accountId: params.accountId !== 'guest' ? params.accountId : null,
      sessionId: params.sessionId,
      type: 'threat_scan_triggered',
      path: '/api/oracle/chat',
      data: {
        surface: 'oracle_tool_result',
        tool: params.toolName,
        mode: scanMode,
        blocked: false,
        patternId: threatHit.findings[0],
      },
    });
  }

  const groundedIndexNote = formatGroundedIndexNote(params.groundedLedger);
  if (!oracleLoopGuardsEnabled(params.env)) {
    return { effectiveToolText: `${params.rawToolText}${groundedIndexNote}`, stalled: false };
  }

  const prior = await readSessionToolHistory(params.sessionStub);
  const guard = new ToolLoopGuardrail({ initialRecords: prior });
  const outcome = guard.observeCall({
    toolName: params.toolName,
    args: params.args,
    resultText: params.rawToolText,
  });
  await writeSessionToolHistory(params.sessionStub, guard.history());
  // Prior HTTP turns do not persist raw toolNote blobs in DO chat history, so keep rawToolText
  // intact across turns and append the loop-guard stall notice when 3x repetition or a cycle hits.
  let effectiveToolText = `${params.rawToolText}${groundedIndexNote}`;
  if (outcome.notice) {
    effectiveToolText = `${effectiveToolText}\n\n${outcome.notice}`;
  }
  return {
    effectiveToolText,
    stalled: outcome.stalled,
  };
}

async function consumeSseCompletionStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (delta: string) => Promise<void>,
): Promise<{ fullText: string; finishReason: string | null; reasoningTokens: number }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let finishReason: string | null = null;
  let reasoningTokens = 0;
  let completionTokens = 0;

  const processLine = async (line: string): Promise<void> => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const dataStr = trimmed.slice(5).trimStart();
    if (!dataStr || dataStr === '[DONE]') return;
    try {
      const parsed = JSON.parse(dataStr) as {
        choices?: Array<{
          delta?: { content?: string; reasoning?: string; reasoning_content?: string };
          finish_reason?: string | null;
        }>;
        usage?: {
          completion_tokens?: number;
          completion_tokens_details?: { reasoning_tokens?: number };
        };
        x_groq?: {
          usage?: {
            completion_tokens?: number;
            completion_tokens_details?: { reasoning_tokens?: number };
          };
        };
      };
      const choice = parsed.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const reasoningDelta = choice?.delta?.reasoning || choice?.delta?.reasoning_content;
      if (reasoningDelta) {
        reasoningTokens += Math.max(1, Math.ceil(reasoningDelta.length / 4));
      }
      const reportedReasoning =
        parsed.usage?.completion_tokens_details?.reasoning_tokens ??
        parsed.x_groq?.usage?.completion_tokens_details?.reasoning_tokens;
      if (typeof reportedReasoning === 'number' && Number.isFinite(reportedReasoning)) {
        reasoningTokens = Math.max(reasoningTokens, reportedReasoning);
      }
      const reportedCompletion =
        parsed.usage?.completion_tokens ?? parsed.x_groq?.usage?.completion_tokens;
      if (typeof reportedCompletion === 'number' && Number.isFinite(reportedCompletion)) {
        completionTokens = Math.max(completionTokens, reportedCompletion);
      }
      const delta = choice?.delta?.content;
      if (delta) {
        fullText += delta;
        await onDelta(delta);
      }
    } catch {
      /* ignore malformed chunk */
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      if (buffer.trim()) {
        for (const line of buffer.split('\n')) {
          await processLine(line);
        }
      }
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      await processLine(line);
    }
  }
  if (!fullText && finishReason === 'length' && completionTokens > 0) {
    reasoningTokens = Math.max(reasoningTokens, completionTokens);
  }
  return { fullText, finishReason, reasoningTokens };
}

export async function streamGroqChatWithEmptyGuard(params: {
  env: Env;
  model: string;
  messages: Array<{ role: string; content: string }>;
  onDelta: (delta: string) => Promise<void>;
  fetcher?: typeof fetch;
}): Promise<
  | { ok: true; fullText: string; retriedEmpty: boolean }
  | { ok: false; status: number; detail: string }
> {
  const fetcher = params.fetcher ?? fetch;
  const primaryKey = params.env.GROQ_API_KEY || params.env.GROQ_API_KEY_FALLBACK;
  if (!primaryKey) {
    return { ok: false, status: 503, detail: 'Hosted Groq key not configured' };
  }
  const fallbackKey =
    params.env.GROQ_API_KEY &&
    params.env.GROQ_API_KEY_FALLBACK &&
    params.env.GROQ_API_KEY_FALLBACK !== params.env.GROQ_API_KEY
      ? params.env.GROQ_API_KEY_FALLBACK
      : primaryKey;
  const candidates = groqModelCandidates(params.model);
  const fallbackModel = candidates[1] ?? params.model;

  const guardsOn = oracleLoopGuardsEnabled(params.env);
  const emptyGuard = new EmptyResponseGuard({ maxRetries: 1 });
  let attempt = 0;

  while (true) {
    const activeKey = attempt === 0 ? primaryKey : fallbackKey;
    const activeModel = attempt === 0 ? params.model : fallbackModel;
    const maxTokens = attempt === 0 ? 2048 : 4096;
    const llmRes = await fetcher('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${activeKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: activeModel,
        messages: params.messages,
        temperature: 0.5,
        max_tokens: maxTokens,
        stream: true,
      }),
    });

    if (!llmRes.ok || !llmRes.body) {
      const errText = await llmRes.text().catch(() => '');
      return { ok: false, status: llmRes.status, detail: errText.slice(0, 200) };
    }

    const { fullText, finishReason, reasoningTokens } = await consumeSseCompletionStream(
      llmRes.body,
      params.onDelta,
    );
    if (!guardsOn) {
      return { ok: true, fullText, retriedEmpty: false };
    }

    const decision = emptyGuard.evaluate({
      provider: 'groq',
      model: activeModel,
      finishReason,
      content: fullText,
      reasoningTokens,
    });
    if (fullText.trim().length > 0) {
      return { ok: true, fullText, retriedEmpty: attempt > 0 };
    }
    const canRetryEmpty =
      attempt === 0 && (decision.shouldRetry || decision.reason === 'has_reasoning_tokens');
    if (!canRetryEmpty) {
      return {
        ok: false,
        status: 502,
        detail: 'Upstream model returned an empty completion after fallback retry.',
      };
    }
    attempt += 1;
  }
}

export async function finalizeOracleHermesTurn(params: {
  env: Env;
  accountId: string;
  sessionId: string;
  assignment: EpistemicAssignment;
  fullText: string;
  validationOk: boolean;
  validationSummary: { block: number; warn: number; info: number };
  verificationLedger: VerificationLedger;
}): Promise<{ verification: VerificationCheckResult | null }> {
  const verification = oracleLoopGuardsEnabled(params.env)
    ? params.verificationLedger.evaluateResponse(params.fullText)
    : null;

  if (params.assignment.enabled && params.assignment.trackExposure) {
    const parsedEpistemic = parseUnverifiedSection(params.fullText);
    const leakageHits = detectUnverifiedFactLeakage(params.fullText);
    await recordServerProductEvent(params.env.DB, {
      accountId: params.accountId !== 'guest' ? params.accountId : null,
      sessionId: params.sessionId,
      type: 'epistemic_ab_exposed',
      path: '/api/oracle/chat',
      data: {
        variant: params.assignment.variant,
        surface: 'oracle_chat',
        assignmentSource: params.assignment.source,
      },
    });
    await recordServerProductEvent(params.env.DB, {
      accountId: params.accountId !== 'guest' ? params.accountId : null,
      sessionId: params.sessionId,
      type: 'epistemic_validator_result',
      path: '/api/oracle/chat',
      data: {
        variant: params.assignment.variant,
        surface: 'oracle_chat',
        ok: params.validationOk,
        blockCount: params.validationSummary.block,
        warnCount: params.validationSummary.warn,
        infoCount: params.validationSummary.info,
        epistemicSectionPresent: parsedEpistemic.hasSection,
        unverifiedCount: parsedEpistemic.items.length,
        unverifiedLeakageCount: leakageHits.length,
      },
    });
  }

  return { verification };
}
