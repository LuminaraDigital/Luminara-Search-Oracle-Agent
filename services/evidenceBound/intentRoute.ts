/**
 * Speculative fan-out intent router. Code consumes relevant heads only.
 * Advisory confidence never alone unlocks paid or mutating tools.
 */
import type { FilteredDecisionState, Intent, RouteDecision } from './types';
import {
  EvidenceBoundError,
  shuffleKeys,
  validateChoice,
  validateNoul,
} from './validate';

export const INTENTS: Record<Intent, string> = {
  scrape_enough: 'One-shot HTML/markdown scrape or existing static evidence is enough.',
  use_research_log: 'A fresh research-log entry already answers this.',
  browse_interactive: 'Need indexed DOM observe/act (cookie, FAQ, tab, form).',
  paid_research: 'Need DataForSEO / paid visibility / SERP / keywords / backlinks.',
  clarify: 'Ask the user one clarifying question; do not spend credits yet.',
};

export type IntentLlmFn = (prompt: string) => Promise<string>;

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new EvidenceBoundError('Intent router returned no valid JSON.');
  }
}

function evenProbs(keys: string[], peak: string): Record<string, number> {
  const rest = (1 - 0.7) / Math.max(1, keys.length - 1);
  const out: Record<string, number> = {};
  for (const k of keys) {
    out[k] = k === peak ? 0.7 : rest;
  }
  // Normalize tiny drift.
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  for (const k of keys) out[k] = out[k] / sum;
  return out;
}

/**
 * Deterministic fail-closed router when no LLM (tests / cold path).
 */
export function routeIntentDeterministic(state: FilteredDecisionState): RouteDecision {
  const hasContext = Boolean(state.hasProjectContext);
  const log = Array.isArray(state.researchLogSummaries)
    ? (state.researchLogSummaries as string[])
    : [];
  const msg = String(state.userMessage || '').toLowerCase();
  const researchLogFresh = log.length > 0;

  if (!hasContext && (msg.includes('rank') || msg.includes('keyword') || msg.includes('backlink'))) {
    return {
      intent: 'clarify',
      toolHint: null,
      researchLogFresh: false,
      needsProjectContext: true,
      confidence: 1,
      selfConsistent: true,
      clarifyReason: 'Project context required before paid research.',
    };
  }

  if (researchLogFresh && (msg.includes('again') || msg.includes('reuse') || msg.includes('last research'))) {
    return {
      intent: 'use_research_log',
      toolHint: null,
      researchLogFresh: true,
      needsProjectContext: !hasContext,
      confidence: 0.8,
      selfConsistent: true,
    };
  }

  if (
    msg.includes('click') ||
    msg.includes('expand') ||
    msg.includes('accordion') ||
    msg.includes('cookie') ||
    msg.includes('browse')
  ) {
    return {
      intent: 'browse_interactive',
      toolHint: 'browse_goal',
      researchLogFresh,
      needsProjectContext: !hasContext,
      confidence: 0.75,
      selfConsistent: true,
    };
  }

  if (
    msg.includes('serp') ||
    msg.includes('keyword') ||
    msg.includes('backlink') ||
    msg.includes('rank') ||
    msg.includes('visibility snapshot')
  ) {
    if (!hasContext) {
      return {
        intent: 'clarify',
        toolHint: null,
        researchLogFresh,
        needsProjectContext: true,
        confidence: 1,
        selfConsistent: true,
        clarifyReason: 'Call get_project_context before paid research.',
      };
    }
    return {
      intent: 'paid_research',
      toolHint: null,
      researchLogFresh,
      needsProjectContext: false,
      confidence: 0.75,
      selfConsistent: true,
    };
  }

  return {
    intent: 'scrape_enough',
    toolHint: null,
    researchLogFresh,
    needsProjectContext: !hasContext,
    confidence: 0.6,
    selfConsistent: true,
  };
}

/**
 * High-stakes intents require self-consistency (second shuffled Choice) or fail to clarify.
 */
export function isHighStakesIntent(intent: Intent): boolean {
  return intent === 'paid_research' || intent === 'browse_interactive';
}

/**
 * Enforce product gates on a proposed route. May downgrade to clarify.
 */
export function enforceRouteGates(
  decision: RouteDecision,
  state: FilteredDecisionState,
): RouteDecision {
  const hasContext = Boolean(state.hasProjectContext);
  if (
    (decision.intent === 'paid_research' || decision.intent === 'browse_interactive') &&
    !hasContext &&
    decision.needsProjectContext !== false
  ) {
    // Paid always needs context. Browse may proceed without project in some MCP paths,
    // but APS prefers context first; for paid we hard-block.
    if (decision.intent === 'paid_research') {
      return {
        ...decision,
        intent: 'clarify',
        toolHint: null,
        needsProjectContext: true,
        clarifyReason: 'Call get_project_context before paid research tools (APS).',
        selfConsistent: true,
      };
    }
  }

  if (decision.intent === 'paid_research' && !hasContext) {
    return {
      ...decision,
      intent: 'clarify',
      toolHint: null,
      needsProjectContext: true,
      clarifyReason: 'Call get_project_context before paid research tools (APS).',
      selfConsistent: true,
    };
  }

  if (isHighStakesIntent(decision.intent) && !decision.selfConsistent) {
    return {
      ...decision,
      intent: 'clarify',
      toolHint: null,
      clarifyReason: 'High-stakes intent failed self-consistency; ask user or gather more state.',
    };
  }

  return decision;
}

/**
 * LLM speculative fan-out: intent + research_log_fresh noul + needs_context noul + tool_hint.
 * Self-consistency: for high-stakes intents, second pass with shuffled intent order must agree.
 */
export async function routeIntentWithLlm(args: {
  state: FilteredDecisionState;
  llm: IntentLlmFn;
  offeredTools?: string[];
}): Promise<RouteDecision> {
  const offered = args.offeredTools || (Array.isArray(args.state.offeredTools) ? (args.state.offeredTools as string[]) : []);
  const intentKeys = Object.keys(INTENTS) as Intent[];

  const ask = async (order: string[]): Promise<{ intent: Intent; confidence: number; fresh: boolean; needsCtx: boolean; toolHint: string | null }> => {
    const criteria = Object.fromEntries(order.map((k) => [k, INTENTS[k as Intent]]));
    const prompt = [
      'Route this SEO agent request. Respond with JSON only:',
      '{"intent":{"choice":"...","probabilities":{...},"confidence":0},"research_log_fresh":{"noul":0},"needs_project_context":{"noul":0},"tool_hint":{"choice":"...","probabilities":{...},"confidence":0}}',
      'intent.choice must be one of the intent criteria keys.',
      'tool_hint.choice must be one of offered tools or "none".',
      '',
      `State: ${JSON.stringify(args.state)}`,
      `Intent criteria (order matters for this pass): ${JSON.stringify(criteria)}`,
      `Offered tools: ${JSON.stringify([...offered, 'none'])}`,
    ].join('\n');

    const raw = extractJsonObject(await args.llm(prompt)) as Record<string, unknown>;
    const intentAns = validateChoice(raw.intent as Record<string, unknown>, criteria);
    const fresh = validateNoul(raw.research_log_fresh as Record<string, unknown>).noul >= 0.5;
    const needsCtx = validateNoul(raw.needs_project_context as Record<string, unknown>).noul >= 0.5;

    let toolHint: string | null = null;
    const toolIds = [...offered, 'none'];
    if (raw.tool_hint && typeof raw.tool_hint === 'object') {
      const toolAns = validateChoice(raw.tool_hint as Record<string, unknown>, toolIds);
      toolHint = toolAns.choice === 'none' ? null : toolAns.choice;
    }

    return {
      intent: intentAns.choice as Intent,
      confidence: intentAns.confidence,
      fresh,
      needsCtx,
      toolHint,
    };
  };

  try {
    const first = await ask(intentKeys);
    let selfConsistent = true;
    if (isHighStakesIntent(first.intent)) {
      const shuffled = shuffleKeys(intentKeys, 42) as Intent[];
      const second = await ask(shuffled);
      selfConsistent = second.intent === first.intent;
    }

    const decision: RouteDecision = {
      intent: first.intent,
      toolHint: first.toolHint,
      researchLogFresh: first.fresh,
      needsProjectContext: first.needsCtx,
      confidence: first.confidence,
      selfConsistent,
    };
    return enforceRouteGates(decision, args.state);
  } catch {
    const fallback = routeIntentDeterministic(args.state);
    return enforceRouteGates(fallback, args.state);
  }
}

/** Build a synthetic valid choice payload for tests. */
export function testChoice(choice: string, keys: string[], confidence = 0.9) {
  return {
    choice,
    probabilities: evenProbs(keys, choice),
    confidence,
  };
}
