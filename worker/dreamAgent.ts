/**
 * Dream Consolidation Agent for Luminara Dreaming.
 * Synthesizes pending events into at most 5 reviewed mutation proposals.
 */
import type { Env } from './env';
import type {
  BusinessMemoryItem,
  DreamAgentOutput,
  DreamEvent,
  DreamProposalAction,
  DreamMemoryType,
} from './dreamingTypes';

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
      "action": "create" | "update" | "deprecate" | "merge",
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
      const p = evt.payload as { findingId?: string; title?: string; status?: string };
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
  };
}

export async function runDreamAgent(
  env: Env,
  input: ConsolidateInput,
  fetcher: typeof fetch = fetch,
): Promise<DreamAgentOutput> {
  const apiKey = env.GROQ_API_KEY || env.GEMINI_API_KEY;
  if (!apiKey) {
    return deterministicDreamConsolidator(input);
  }

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

  try {
    let rawJson: string | null = null;

    if (env.GROQ_API_KEY) {
      const res = await fetcher('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [
            { role: 'system', content: DREAM_AGENT_SYSTEM },
            { role: 'user', content: promptText },
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as {
          choices?: Array<{ message?: { content?: string } }>;
        } | null;
        rawJson = data?.choices?.[0]?.message?.content || null;
      }
    } else if (env.GEMINI_API_KEY) {
      const res = await fetcher(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': env.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: DREAM_AGENT_SYSTEM }] },
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json',
            },
          }),
        },
      );
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        } | null;
        rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
      }
    }

    if (!rawJson) {
      return deterministicDreamConsolidator(input);
    }

    const parsed = JSON.parse(rawJson) as DreamAgentOutput;
    if (!parsed || !Array.isArray(parsed.proposals)) {
      return deterministicDreamConsolidator(input);
    }

    // Filter, validate, and cap proposals at 5
    const validEventIds = new Set(input.pendingEvents.map((e) => e.id));
    const sanitizedProposals = parsed.proposals
      .filter((p) => {
        if (!p.title || !p.content || !p.memoryType || !p.action) return false;
        if (p.confidence < 0.5) return false; // reject low confidence
        return true;
      })
      .map((p) => {
        // Enforce valid source refs
        const filteredRefs = (p.sourceRefs || []).filter((ref) => validEventIds.has(ref));
        const finalRefs =
          filteredRefs.length > 0 ? filteredRefs : input.pendingEvents.slice(0, 1).map((e) => e.id);

        const requiresApproval =
          p.requiresApproval === true ||
          p.action === 'deprecate' ||
          p.memoryType === 'business_dna' ||
          p.confidence < 0.85;

        return {
          action: p.action as DreamProposalAction,
          memoryId: p.memoryId,
          memoryType: p.memoryType as DreamMemoryType,
          title: String(p.title).slice(0, 200),
          content: String(p.content).slice(0, 4000),
          structuredData: p.structuredData || {},
          confidence: Math.min(1.0, Math.max(0.5, p.confidence || 0.8)),
          sourceRefs: finalRefs,
          requiresApproval,
          rationale: String(p.rationale || 'Consolidated by Dream Agent').slice(0, 500),
        };
      })
      .slice(0, 5);

    return {
      summary: parsed.summary || `Consolidated ${sanitizedProposals.length} memory proposals.`,
      proposals: sanitizedProposals,
    };
  } catch {
    return deterministicDreamConsolidator(input);
  }
}
