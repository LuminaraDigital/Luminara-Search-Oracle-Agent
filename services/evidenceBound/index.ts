/**
 * Evidence-bound decision layer: claim integrity for Oracle / MCP / browse.
 * Pattern library: TypeSafe + jev-ultrafast contracts. No TypeSafe runtime.
 */
export type {
  AtomicDimension,
  ChoiceAnswer,
  Claim,
  ClaimSource,
  ClaimStatus,
  CitationSupportResult,
  CitationVerdict,
  CompositeJudgment,
  FilteredDecisionState,
  Intent,
  NoulAnswer,
  RouteDecision,
  ScoreAnswer,
} from './types';

export {
  EvidenceBoundError,
  validateChoice,
  validateScore,
  validateNoul,
  noulConfidence,
  choiceConfidenceFromProbs,
  shuffleKeys,
} from './validate';

export { filterState, capText, buildRouterState } from './filterState';
export { ClaimLedger, coerceClaimStatus, resetClaimIdCounterForTests } from './claimLedger';
export {
  citationSupportHeuristic,
  citationSupportWithLlm,
  statusFromCitation,
} from './citationSupport';
export {
  INTENTS,
  routeIntentDeterministic,
  routeIntentWithLlm,
  enforceRouteGates,
  isHighStakesIntent,
  testChoice,
} from './intentRoute';
export { runAtomicChecks } from './atomicChecks';
export { composeJudgment, DEFAULT_WEIGHTS } from './compositeScore';
export { preParseCandidates, pickCandidate } from './preParse';
export type { ParsedCandidate } from './preParse';
export type { PageEvidence } from './atomicChecks';

/**
 * Oracle/MCP helper: assemble a pointer string from a ledger.
 * Chat shape: verdict lines + one action hint (caller supplies action).
 */
export function formatOraclePointer(args: {
  ledger: import('./claimLedger').ClaimLedger;
  oneAction: string;
}): string {
  const lines = args.ledger.toVerdictLines(6);
  const summary = args.ledger.summary();
  return [
    lines.length ? lines.join('\n') : '[not_measured] No evidence-bound claims yet.',
    `Claims: measured=${summary.measured} estimated=${summary.estimated} not_measured=${summary.not_measured} unknown=${summary.unknown}.`,
    `One action: ${args.oneAction}`,
  ].join('\n');
}
