/**
 * Evidence-bound decision contracts (TypeSafe/Jev shape without vendor lock-in).
 * Code owns truth status. Models propose among closed options only.
 */

export type ClaimStatus = 'measured' | 'estimated' | 'not_measured' | 'unknown';

export type ClaimSource = {
  kind: 'scrape' | 'research_log' | 'dfs' | 'browse_observe' | 'verifier' | 'user' | 'other';
  id?: string;
  excerpt?: string;
  url?: string;
};

export type Claim = {
  id: string;
  text: string;
  status: ClaimStatus;
  sources: ClaimSource[];
};

export type ChoiceAnswer = {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type ScoreAnswer = {
  score: number;
  probabilities: Record<string, number>;
  confidence: number;
};

export type NoulAnswer = {
  noul: number;
};

export type Intent =
  | 'scrape_enough'
  | 'use_research_log'
  | 'browse_interactive'
  | 'paid_research'
  | 'clarify';

export type RouteDecision = {
  intent: Intent;
  toolHint: string | null;
  researchLogFresh: boolean;
  needsProjectContext: boolean;
  /** Advisory only. Never alone unlocks paid or mutating tools. */
  confidence: number;
  selfConsistent: boolean;
  clarifyReason?: string;
};

export type CitationVerdict = 'supports' | 'contradicts' | 'insufficient';

export type CitationSupportResult = {
  verdict: CitationVerdict;
  claimText: string;
  /** Rewritten claim text when verdict is insufficient/contradicts. */
  safeText: string;
  status: ClaimStatus;
};

export type AtomicDimension = {
  id: string;
  label: string;
  /** 0-1 normalized judgment, or null when not_measured. */
  value: number | null;
  status: ClaimStatus;
  note?: string;
};

export type CompositeJudgment = {
  dimensions: AtomicDimension[];
  /** Internal weighted blend; always estimated or not_measured, never Live SEO metric. */
  composite: number | null;
  status: 'estimated' | 'not_measured';
  weights: Record<string, number>;
};

export type FilteredDecisionState = Record<string, unknown>;
