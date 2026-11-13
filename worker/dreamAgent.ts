/**
 * Dream Consolidation Agent for Luminara Dreaming.
 * Synthesizes pending events into at most 5 reviewed mutation proposals.
 */
import type { Env } from './env';
import type {
  BusinessMemoryItem,
  DreamAgentOutput,
  DreamEvent,
  DreamMemoryType,
} from './dreamingTypes';
import type { EpistemicVariant } from '../services/experiments/hermesAbExperiment';
import {
  EPISTEMIC_STANCE_RULE,
  UNVERIFIED_SECTION_HEADING,
  containsUnverifiedMarker,
  detectUnverifiedFactLeakage,
} from '../services/trust/epistemicStance';
import {
  appendOutputContract,
  extractJsonCandidate,
  runWithSingleJsonRetry,
  type JsonContractValidator,
} from '../services/oracle/jsonContract';

const GROQ_DREAM_MODEL = 'openai/gpt-oss-120b';
const GEMINI_DREAM_MODEL = 'gemini-2.5-flash';
// What a model proposal may name. The store's CHECK covers memory types only.
const DREAM_ACTIONS: readonly string[] = ['create', 'update', 'deprecate'] satisfies DreamAgentOutput['proposals'][number]['action'][];
const DREAM_MEMORY_TYPES: readonly string[] = [
  'business_dna',
  'visibility_profile',
  'action_memory',
  'preference_memory',
  'evidence_memory',
] satisfies DreamMemoryType[];

/** True when a run calls a hosted model rather than the deterministic consolidator. */
export function hasHostedDreamModel(env: Env): boolean {
  return Boolean(env.GROQ_API_KEY || env.GEMINI_API_KEY);
}

const DREAM_AGENT_SYSTEM = `You are Luminara Dreaming, the autonomous memory consolidation engine for Luminara Suite.
Your mission is to consolidate verified business facts, search visibility insights, and recommendation outcomes into durable workspace memory.

Rules:
1. Strict Proposal Budget: Propose at most 5 memory changes per run.
2. Grounding Invariant: Never invent facts. Every proposal MUST cite 1 or more exact source event IDs in "sourceRefs".
3. Update Over Duplicate: If a fact already exists, propose an "update" with memoryId, or "deprecate" if obsolete. Never create duplicate entries.
4. Categorization: Each proposal must map to one of:
   - "business_dna": foundational company profile (industry, target audience, USP, competitors, regions).
   - "visibility_profile": search & AI engine presence (recurring citation gaps, dominant competitor citations, missing schemas).
   - "action_memory": recommendation effectiveness (actions implemented, dismissed, or proven to improve visibility).
   - "preference_memory": client workflow and reporting preferences.
   - "evidence_memory": high-confidence verified data anchors.
5. Approval Protocol:
   - Set requiresApproval: true for: competitor additions/removals, brand positioning changes, service area pivots, memory deprecation, or confidence < 0.85.
   - Set requiresApproval: false for: routine visibility score refreshes, timestamp updates, action status syncs with confidence >= 0.85.
   - Discard any proposal with confidence < 0.50.
6. Output valid JSON only with structure:
{
  "summary": "Brief 1-sentence run summary",
  "proposals": [
    {
      "action": "create" | "update" | "deprecate",
      "memoryId": "optional-existing-id",
      "memoryType": "business_dna" | "visibility_profile" | "action_memory" | "preference_memory" | "evidence_memory",
      "title": "Concise title",
      "content": "Detailed memory content",
      "confidence": 0.90,
      "sourceRefs": ["devt_xxx"],
      "requiresApproval": false,
      "rationale": "Why this change is proposed"
    }
  ]
}`;

export interface ConsolidateInput {
  domain: string;
  pendingEvents: DreamEvent[];
  activeMemories: BusinessMemoryItem[];
  detectedConflictSummary?: string;
  expiredMemoryIds?: string[];
}

/**
 * Deterministic fallback consolidator for offline environments or when no API keys are set.
 */
export function deterministicDreamConsolidator(input: ConsolidateInput): DreamAgentOutput {
  const { domain, pendingEvents, activeMemories, expiredMemoryIds = [] } = input;
  const proposals: DreamAgentOutput['proposals'] = [];

  // 1. Handle expired / stale memories
  for (const expId of expiredMemoryIds.slice(0, 2)) {
    const mem = activeMemories.find((m) => m.id === expId);
    if (mem) {
      proposals.push({
        action: 'deprecate',
        memoryId: mem.id,
        memoryType: mem.memoryType,
        title: mem.title,
        content: `Deprecated stale fact: ${mem.content}`,
        confidence: 0.95,
        sourceRefs: pendingEvents.map((e) => e.id).slice(0, 1),
        requiresApproval: true,
        rationale: 'Memory exceeded validity window and was flagged as stale.',
      });
    }
  }

  // 2. Process high-signal events
  for (const evt of pendingEvents) {
    if (proposals.length >= 5) break;

    if (evt.eventType === 'client_profile_changed') {
      const payload = evt.payload as { name?: string; usp?: string; competitors?: string[] };
      const existingDna = activeMemories.find((m) => m.memoryType === 'business_dna');
      if (existingDna) {
        proposals.push({
          action: 'update',
          memoryId: existingDna.id,
          memoryType: 'business_dna',
          title: payload.name ? `${payload.name} Profile` : existingDna.title,
          content: `Updated Business DNA. USP: ${payload.usp || 'Core market offering'}. Competitors: ${(payload.competitors || []).join(', ') || 'None specified'}.`,
          confidence: 0.95,
          sourceRefs: [evt.id],
          requiresApproval: true,
          rationale: 'Client profile details were updated in settings.',
        });
      } else {
        proposals.push({
          action: 'create',
          memoryType: 'business_dna',
          title: payload.name ? `${payload.name} Profile` : `${domain} DNA`,
          content: `Business DNA established for ${domain}. USP: ${payload.usp || 'Core offering'}.`,
          confidence: 0.90,
          sourceRefs: [evt.id],
          requiresApproval: true,
          rationale: 'Initial business profile creation.',
        });
      }
    } else if (evt.eventType === 'audit_completed') {
      const p = evt.payload as { healthScore?: number; citationRatePercent?: number; topCompetitor?: string };
      const existingVis = activeMemories.find((m) => m.memoryType === 'visibility_profile');
      const score = p.healthScore ?? p.citationRatePercent ?? null;
      if (score !== null) {
        if (existingVis) {
          proposals.push({
            action: 'update',
            memoryId: existingVis.id,
            memoryType: 'visibility_profile',
            title: `Visibility Standing: ${domain}`,
            content: `Recent audit measured visibility score: ${score}%. Top competitor: ${p.topCompetitor || 'None identified'}.`,
            confidence: 0.88,
            sourceRefs: [evt.id],
            requiresApproval: false,
            rationale: 'Visibility metric refreshed from verified audit completion.',
          });
        } else {
          proposals.push({
            action: 'create',
            memoryType: 'visibility_profile',
            title: `Visibility Standing: ${domain}`,
            content: `Initial visibility profile recorded at ${score}%. Top competitor: ${p.topCompetitor || 'None'}.`,
            confidence: 0.85,
            sourceRefs: [evt.id],
            requiresApproval: false,
            rationale: 'Baseline audit profile recorded.',
          });
        }
      }
    } else if (evt.eventType === 'recommendation_updated') {
      const p = evt.payload as { findingId?: string; title?: string; status?: string; citationLogged?: boolean };
      if (p.citationLogged) continue;
      if (p.title) {
        proposals.push({
          action: 'create',
          memoryType: 'action_memory',
          title: `Action: ${p.title.slice(0, 50)}`,
          content: `Recommendation status transitioned to "${p.status || 'updated'}". Title: ${p.title}.`,
          confidence: 0.92,
          sourceRefs: [evt.id],
          requiresApproval: false,
          rationale: `User or system recorded outcome for action ${p.findingId || p.title}.`,
        });
      }
    }
  }

  return {
    summary: `Consolidated ${pendingEvents.length} event(s) into ${proposals.length} proposal(s).`,
    proposals: proposals.slice(0, 5),
    modelId: 'deterministic',
  };
}

const DREAM_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['summary', 'proposals'],
  properties: {
    summary: { type: 'string' },
    unverifiedHypotheses: { type: 'array', items: { type: 'string' } },
    proposals: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        required: ['action', 'memoryType', 'title', 'content', 'confidence', 'sourceRefs', 'rationale'],
      },
    },
  },
};

const validateDreamAgentJson: JsonContractValidator<{
  summary?: string;
  unverifiedHypotheses?: string[];
  proposals: DreamAgentOutput['proposals'];
}> = (parsed) => {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['Top-level value must be a JSON object.'] };
  }
  const obj = parsed as Record<string, unknown>;
  const errors: string[] = [];
  if (obj.summary !== undefined && typeof obj.summary !== 'string') {
    errors.push('"summary" must be a string when provided.');
  }
  if (!Array.isArray(obj.proposals)) {
    errors.push('"proposals" must be an array.');
  } else if (obj.proposals.length > 5) {
    errors.push('"proposals" must contain at most 5 items.');
  } else {
    obj.proposals.forEach((rawItem, idx) => {
      if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
        errors.push(`proposals[${idx}] must be an object.`);
        return;
      }
      const item = rawItem as Record<string, unknown>;
      if (typeof item.action !== 'string' || !DREAM_ACTIONS.includes(item.action)) {
        errors.push(`proposals[${idx}].action must be one of create, update, deprecate.`);
      }
      if (typeof item.memoryType !== 'string' || !DREAM_MEMORY_TYPES.includes(item.memoryType)) {
        errors.push(`proposals[${idx}].memoryType is invalid.`);
      }
      if (typeof item.title !== 'string' || !item.title.trim()) {
        errors.push(`proposals[${idx}].title must be a non-empty string.`);
      }
      if (typeof item.content !== 'string' || !item.content.trim()) {
        errors.push(`proposals[${idx}].content must be a non-empty string.`);
      }
      if (typeof item.confidence !== 'number' || !Number.isFinite(item.confidence)) {
        errors.push(`proposals[${idx}].confidence must be a finite number.`);
      }
      if (!Array.isArray(item.sourceRefs)) {
        errors.push(`proposals[${idx}].sourceRefs must be an array.`);
      }
      if (typeof item.rationale !== 'string') {
        errors.push(`proposals[${idx}].rationale must be a string.`);
      }
    });
  }
  if (
    obj.unverifiedHypotheses !== undefined &&
    (!Array.isArray(obj.unverifiedHypotheses) ||
      !obj.unverifiedHypotheses.every((h) => typeof h === 'string'))
  ) {
    errors.push('"unverifiedHypotheses" must be an array of strings when provided.');
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      summary: typeof obj.summary === 'string' ? obj.summary : undefined,
      unverifiedHypotheses: Array.isArray(obj.unverifiedHypotheses)
        ? obj.unverifiedHypotheses.filter((h): h is string => typeof h === 'string')
        : undefined,
      proposals: obj.proposals as DreamAgentOutput['proposals'],
    },
  };
};

async function callHostedDreamCompletion(
  env: Env,
  fetcher: typeof fetch,
  systemPrompt: string,
  turns: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>,
): Promise<string | null> {
  if (env.GROQ_API_KEY) {
    const res = await fetcher('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_DREAM_MODEL,
        messages: [{ role: 'system', content: systemPrompt }, ...turns],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>;
    } | null;
    return data?.choices?.[0]?.message?.content || null;
  }

  if (env.GEMINI_API_KEY) {
    const res = await fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_DREAM_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: turns.map((t) => ({
            role: t.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: t.content }],
          })),
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        }),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    } | null;
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  }

  return null;
}

export async function runDreamAgent(
  env: Env,
  input: ConsolidateInput,
  fetcher: typeof fetch = fetch,
  opts?: { variant?: EpistemicVariant },
): Promise<DreamAgentOutput> {
  if (!hasHostedDreamModel(env)) {
    return deterministicDreamConsolidator(input);
  }

  const variant: EpistemicVariant = opts?.variant === 'treatment' ? 'treatment' : 'baseline';
  const promptText = `
Workspace Domain: ${input.domain}

Active Business Memories:
${
  input.activeMemories.length === 0
    ? '- None recorded yet.'
    : input.activeMemories
        .map((m) => `[ID: ${m.id}] [${m.memoryType}] ${m.title}: ${m.content} (Confidence: ${m.confidence})`)
        .join('\n')
}

Pending Dream Events:
${
  input.pendingEvents.length === 0
    ? '- No pending events.'
    : input.pendingEvents
        .map(
          (e) =>
            `[Event ID: ${e.id}] [Type: ${e.eventType}] Payload: ${JSON.stringify(e.payload)} (Signal: ${e.signalWeight})`,
        )
        .join('\n')
}

${input.detectedConflictSummary ? `Pre-check Warning: ${input.detectedConflictSummary}` : ''}
${input.expiredMemoryIds?.length ? `Expired Memory IDs for Pruning: ${input.expiredMemoryIds.join(', ')}` : ''}

Consolidate these into at most 5 verified memory mutation proposals. Output JSON only.
`.trim();

  const systemPrompt =
    variant === 'treatment'
      ? appendOutputContract(
          `${DREAM_AGENT_SYSTEM}\n\nEpistemic Rule: ${EPISTEMIC_STANCE_RULE} ` +
            'Place any uncertain inference or unverified causal suspicion in top-level "unverifiedHypotheses" ' +
            'as "UNVERIFIED: <claim> - <basis>", and never propose unverified claims as auto-applied facts.',
          DREAM_OUTPUT_SCHEMA,
        )
      : DREAM_AGENT_SYSTEM;

  try {
    const modelId = env.GROQ_API_KEY ? GROQ_DREAM_MODEL : GEMINI_DREAM_MODEL;
    let parsed: {
      summary?: string;
      unverifiedHypotheses?: string[];
      proposals: DreamAgentOutput['proposals'];
    };
    let contractRetried = false;

    if (variant === 'treatment') {
      const outcome = await runWithSingleJsonRetry({
        firstAttempt: () =>
          callHostedDreamCompletion(env, fetcher, systemPrompt, [{ role: 'user', content: promptText }]),
        retryAttempt: (retryMsg, failedRaw) =>
          callHostedDreamCompletion(env, fetcher, systemPrompt, [
            { role: 'user', content: promptText },
            { role: 'assistant', content: failedRaw },
            { role: 'user', content: retryMsg },
          ]),
        validator: validateDreamAgentJson,
      });
      if (!outcome.ok) {
        return {
          ...deterministicDreamConsolidator(input),
          contractRetried: outcome.retried,
          usedFallback: true,
        };
      }
      parsed = outcome.value;
      contractRetried = outcome.retried;
    } else {
      const rawJson = await callHostedDreamCompletion(env, fetcher, systemPrompt, [
        { role: 'user', content: promptText },
      ]);
      if (!rawJson) {
        return { ...deterministicDreamConsolidator(input), contractRetried: false, usedFallback: true };
      }
      const rawParsed = JSON.parse(extractJsonCandidate(rawJson)) as DreamAgentOutput;
      if (!rawParsed || !Array.isArray(rawParsed.proposals)) {
        return { ...deterministicDreamConsolidator(input), contractRetried: false, usedFallback: true };
      }
      parsed = rawParsed;
    }

    // The model's output is checked against what the run knows before anything is stored: an
    // action and a memory type the store takes, a confidence the model gave, and, for an update
    // or a deprecate, a memory that is active. A proposal that fails is dropped. At most 5.
    const validEventIds = new Set(input.pendingEvents.map((e) => e.id));
    const activeMemoryIds = new Set(input.activeMemories.map((m) => m.id));
    const hypothesisLines =
      variant === 'treatment' && Array.isArray(parsed.unverifiedHypotheses)
        ? parsed.unverifiedHypotheses
            .filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
            .map((h) => {
              const trimmed = h.trim().replace(/^[-*+]\s+/, '');
              return `- ${containsUnverifiedMarker(trimmed) ? trimmed : `UNVERIFIED: ${trimmed}`}`;
            })
        : [];
    const sanitizedProposals = parsed.proposals
      .filter((p) => {
        if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
        if (!p.title || !p.content) return false;
        if (!DREAM_ACTIONS.includes(p.action) || !DREAM_MEMORY_TYPES.includes(p.memoryType)) return false;
        if (typeof p.confidence !== 'number' || !(p.confidence >= 0.5 && p.confidence <= 1)) return false;
        return p.action === 'create' || activeMemoryIds.has(String(p.memoryId));
      })
      .map((p) => {
        // Enforce valid source refs
        const rawRefs = Array.isArray(p.sourceRefs) ? p.sourceRefs : [];
        const filteredRefs = rawRefs.filter((ref): ref is string => typeof ref === 'string' && validEventIds.has(ref));
        const finalRefs =
          filteredRefs.length > 0 ? filteredRefs : input.pendingEvents.slice(0, 1).map((e) => e.id);

        const leakedHypothesis =
          hypothesisLines.length > 0 &&
          detectUnverifiedFactLeakage(
            `${p.title}. ${p.content}\n\n${UNVERIFIED_SECTION_HEADING}\n${hypothesisLines.join('\n')}`,
          ).length > 0;

        const flaggedUnverified =
          variant === 'treatment' &&
          (containsUnverifiedMarker(p.title) ||
            containsUnverifiedMarker(p.content) ||
            containsUnverifiedMarker(p.rationale) ||
            leakedHypothesis);

        const requiresApproval =
          p.requiresApproval === true ||
          flaggedUnverified ||
          p.action === 'deprecate' ||
          p.memoryType === 'business_dna' ||
          p.confidence < 0.85;

        return {
          action: p.action,
          // A create makes a new memory, so a memory id the model gave it names nothing of its own.
          memoryId: p.action === 'create' ? undefined : p.memoryId,
          memoryType: p.memoryType,
          title: String(p.title).slice(0, 200),
          content: String(p.content).slice(0, 4000),
          structuredData: p.structuredData || {},
          confidence: p.confidence,
          sourceRefs: finalRefs,
          requiresApproval,
          rationale: String(p.rationale || 'Consolidated by Dream Agent').slice(0, 500),
        };
      })
      .slice(0, 5);

    return {
      summary: parsed.summary || `Consolidated ${sanitizedProposals.length} memory proposals.`,
      proposals: sanitizedProposals,
      modelId,
      unverifiedHypotheses: parsed.unverifiedHypotheses,
      contractRetried,
      usedFallback: false,
    };
  } catch {
    return {
      ...deterministicDreamConsolidator(input),
      contractRetried: false,
      usedFallback: true,
    };
  }
}
