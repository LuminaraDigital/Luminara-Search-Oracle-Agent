/**
 * E0 hallucination fixture suite. Escape count must stay 0 (merge gate G1).
 */
import { describe, expect, it } from 'vitest';
import {
  ClaimLedger,
  citationSupportHeuristic,
  coerceClaimStatus,
  composeJudgment,
  enforceRouteGates,
  pickCandidate,
  preParseCandidates,
  routeIntentDeterministic,
  runAtomicChecks,
  validateChoice,
  EvidenceBoundError,
  buildRouterState,
} from '../../services/evidenceBound';
import { verifyDone } from '../../services/browserAction';

describe('hallucination suite (escape rate = 0)', () => {
  it('missing SERP/rank evidence stays not_measured, never invents a rank', () => {
    const dims = runAtomicChecks({
      url: 'https://example.com',
      title: 'Home',
      text: 'Welcome',
      // no rank fields exist in PageEvidence by design
    });
    expect(dims.every((d) => d.id !== 'rank')).toBe(true);
    const judgment = composeJudgment(dims);
    expect(judgment.status === 'estimated' || judgment.status === 'not_measured').toBe(true);
    // Composite must not be marketed as Live SEO score; status never measured.
    expect(judgment.status).not.toBe('measured' as 'estimated');
  });

  it('DONE without verifier checks is not_verified', () => {
    const result = verifyDone({
      goal: 'Open pricing',
      observe: {
        url: 'https://example.com/pricing',
        title: 'Pricing',
        text: 'Pro plan',
        actions: [],
        fingerprint: 'fp',
      },
      checks: undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('not_verified');
  });

  it('vacuous empty-string checks never pass (no invented measured)', () => {
    const result = verifyDone({
      goal: 'Open pricing',
      observe: {
        url: 'https://example.com/pricing',
        title: 'Pricing',
        text: 'Pro plan',
        actions: [],
        fingerprint: 'fp',
      },
      checks: { textIncludes: '', urlIncludes: ['', '  '] },
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('not_verified');
  });

  it('claim with no citation span becomes not_measured/unknown, not measured', () => {
    const support = citationSupportHeuristic({
      claimText: 'You rank #1 for enterprise SEO',
      evidenceSpans: [],
    });
    expect(support.status).not.toBe('measured');
    expect(['not_measured', 'unknown']).toContain(support.status);

    const ledger = new ClaimLedger();
    expect(() =>
      ledger.append({ text: support.claimText, status: 'measured', sources: [] }),
    ).toThrow(EvidenceBoundError);

    const status = coerceClaimStatus('measured', []);
    expect(status).toBe('not_measured');
  });

  it('paid research without project context routes to clarify', () => {
    const state = buildRouterState({
      userMessage: 'Get keyword ranks and backlinks',
      hasProjectContext: false,
      researchLogSummaries: [],
    });
    const routed = enforceRouteGates(routeIntentDeterministic(state), state);
    expect(routed.intent).toBe('clarify');
    expect(routed.needsProjectContext).toBe(true);
  });

  it('browse target id not in observe table cannot be invented via preParse pick', () => {
    const candidates = preParseCandidates('Contact us at hello@example.com');
    expect(pickCandidate(candidates, 'email:999')).toBeNull();
    expect(pickCandidate(candidates, 'email:1')?.value).toBe('hello@example.com');
  });

  it('invalid choice distribution never validates', () => {
    expect(() =>
      validateChoice(
        { choice: 'CLICK', probabilities: { CLICK: 0.5, WAIT: 0.5 }, confidence: 0.9 },
        { CLICK: 'x', TYPE_TEXT: 'y' },
      ),
    ).toThrow(EvidenceBoundError);
  });

});
