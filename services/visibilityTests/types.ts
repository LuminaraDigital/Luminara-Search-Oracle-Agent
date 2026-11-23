/**
 * Visibility Unit Tests: the closed vocabulary and the wire shapes.
 * A test is one yes/no question. Tags slice results and never change a verdict.
 */

export const SCORER_VERSION = 1;

export const FAMILIES = ['presence', 'accuracy', 'citation', 'structure'] as const;
export type VisibilityFamily = (typeof FAMILIES)[number];

export const FAMILY_LABELS: Record<VisibilityFamily, string> = {
  presence: 'Are you being found?',
  accuracy: 'Are your details right?',
  citation: 'Do people get sent to your website?',
  structure: 'Can AI read your website?',
};

export type VisibilityTestType =
  | 'brand_named'
  | 'site_cited'
  | 'fact_stated'
  | 'claim_absent'
  | 'schema_present'
  | 'site_states_fact';

/** How the expected answer was established. Only `dna_confirmed` is the owner's own word. */
export type VisibilityDerivation = 'dna_confirmed' | 'site_estimated';

export type VisibilityTagKind = 'engine' | 'suburb' | 'service' | 'intent';

export type VisibilityResult = 'pass' | 'fail' | 'not_measured';

/** `search` is a row from web search. `byok_probe` is the owner's own model and stays an estimate. */
export type VisibilityAnswerKind = 'search' | 'byok_probe';

/** Raw facts a run is graded against. Saved with the raw answers, so a regrade needs nothing else. */
export type ExpectedFacts = {
  brand: string;
  domain: string;
  suburb?: string;
  service?: string;
  /** Short facts in the owner's words, such as a phone number or a founding year. */
  keyFacts: string[];
  /** Things no answer should say about the business. */
  bannedClaims: string[];
  /** True once the owner confirmed these facts. Until then every test reads as Estimated. */
  confirmed: boolean;
};

export type RawAnswer = {
  id: string;
  kind: VisibilityAnswerKind;
  engine: string;
  provider: string;
  model: string;
  prompt: string;
  intent: string;
  text: string;
  sources: string[];
  finishReason?: string;
  /** Why the call failed. An error is not a refusal: nothing was measured. */
  error?: string;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Estimated from token counts. Null when unknown, never 0. */
  costUsd: number | null;
  latencyMs: number | null;
  answeredAt: number;
};

export type CrawlSnapshot = {
  pages: Array<{ url: string; title: string; schemaTypes: string[]; text: string }>;
  fetchedAt: number;
};

/** The raw record of one run. It is private: it never reaches a share link. */
export type RawVisibilityRun = {
  facts: ExpectedFacts;
  answers: RawAnswer[];
  snapshot: CrawlSnapshot | null;
};

export type VisibilityVerdict = {
  testId: string;
  testType: VisibilityTestType;
  family: VisibilityFamily;
  derivation: VisibilityDerivation;
  tags: string[];
  /** Null for a test on the website rather than on an answer. */
  answerId: string | null;
  label: string;
  result: VisibilityResult;
  why: string;
};

export type FamilySummary = {
  score: number;
  tests: number;
  passed: number;
  notMeasured: number;
  /** How many answers or crawls the score rests on. One bad answer can fail many tests. */
  answers: number;
};

export type VisibilitySummary = {
  /** Mean of the families with a graded test, so a family's weight never depends on its test count. */
  score: number | null;
  families: Partial<Record<VisibilityFamily, FamilySummary>>;
  graded: number;
  notMeasured: number;
  estimated: boolean;
};

export type ScorecardRow = {
  provider: string;
  model: string;
  answers: number;
  refusals: number;
  errors: number;
  /** Mean of family scores. A refused answer's presence and citation tests count as failed. */
  score: number | null;
  tests: number;
  passed: number;
  costUsd: number | null;
  /** Answers with no cost figure, so a partial total is never read as the whole bill. */
  costUnknown: number;
  averageLatencyMs: number | null;
};
