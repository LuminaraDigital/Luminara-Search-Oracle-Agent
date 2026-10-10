/**
 * Citation support gate: closed check before prose claims a fact.
 * Fail closed to unknown / not_measured.
 */
import type { CitationSupportResult, CitationVerdict, ClaimStatus } from './types';
import { validateChoice, EvidenceBoundError } from './validate';

const VERDICTS: Record<CitationVerdict, string> = {
  supports: 'The evidence span supports the claim.',
  contradicts: 'The evidence span contradicts the claim.',
  insufficient: 'The evidence is missing or too weak to support the claim.',
};

export type CitationLlmFn = (prompt: string) => Promise<string>;

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
    throw new EvidenceBoundError('Citation helper returned no valid JSON.');
  }
}

/**
 * Deterministic overlap check (no model). Used when evidence is empty or for offline gates.
 */
export function citationSupportHeuristic(args: {
  claimText: string;
  evidenceSpans: string[];
}): CitationSupportResult {
  const claim = (args.claimText || '').trim();
  const spans = (args.evidenceSpans || []).map((s) => s.trim()).filter(Boolean);
  if (!claim) {
    return {
      verdict: 'insufficient',
      claimText: claim,
      safeText: 'unknown: empty claim',
      status: 'unknown',
    };
  }
  if (!spans.length) {
    return {
      verdict: 'insufficient',
      claimText: claim,
      safeText: `${claim} (not_measured: no evidence span)`,
      status: 'not_measured',
    };
  }

  const claimTokens = claim
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3);
  const hay = spans.join('\n').toLowerCase();
  const hits = claimTokens.filter((t) => hay.includes(t));
  const ratio = claimTokens.length ? hits.length / claimTokens.length : 0;

  if (ratio >= 0.35) {
    return {
      verdict: 'supports',
      claimText: claim,
      safeText: claim,
      status: 'estimated',
    };
  }
  return {
    verdict: 'insufficient',
    claimText: claim,
    safeText: `${claim} (unknown: evidence does not support this claim)`,
    status: 'unknown',
  };
}

/**
 * Optional LLM Choice over supports|contradicts|insufficient.
 * On parse failure, fall back to heuristic (fail closed).
 */
export async function citationSupportWithLlm(args: {
  claimText: string;
  evidenceSpans: string[];
  llm: CitationLlmFn;
}): Promise<CitationSupportResult> {
  const heuristic = citationSupportHeuristic(args);
  if (heuristic.verdict === 'insufficient' && !args.evidenceSpans.length) {
    return heuristic;
  }

  const prompt = [
    'You are a citation support checker. Pick exactly one verdict.',
    'Respond with JSON only:',
    '{"choice":"supports|contradicts|insufficient","probabilities":{"supports":0,"contradicts":0,"insufficient":0},"confidence":0}',
    'probabilities must sum to 1 and peak on choice.',
    '',
    `Claim: ${args.claimText}`,
    'Evidence spans:',
    ...args.evidenceSpans.slice(0, 12).map((s, i) => `[${i + 1}] ${s.slice(0, 800)}`),
    '',
    'Criteria:',
    JSON.stringify(VERDICTS),
  ].join('\n');

  try {
    const raw = extractJsonObject(await args.llm(prompt));
    const answer = validateChoice(raw as Record<string, unknown>, VERDICTS);
    const verdict = answer.choice as CitationVerdict;
    if (verdict === 'supports') {
      // LLM support alone is estimated, never measured.
      return {
        verdict,
        claimText: args.claimText,
        safeText: args.claimText,
        status: 'estimated',
      };
    }
    if (verdict === 'contradicts') {
      return {
        verdict,
        claimText: args.claimText,
        safeText: `${args.claimText} (unknown: evidence contradicts this claim)`,
        status: 'unknown',
      };
    }
    return {
      verdict: 'insufficient',
      claimText: args.claimText,
      safeText: `${args.claimText} (unknown: insufficient evidence)`,
      status: 'unknown',
    };
  } catch {
    return heuristic;
  }
}

/** Map citation result into a ledger status (never upgrades to measured). */
export function statusFromCitation(result: CitationSupportResult): ClaimStatus {
  return result.status === 'measured' ? 'estimated' : result.status;
}
