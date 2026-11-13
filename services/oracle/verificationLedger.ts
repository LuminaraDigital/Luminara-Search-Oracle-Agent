/**
 * Per-turn verification ledger for Oracle responses (`SUITE-REPORT.md` recommendation #10).
 *
 * Tracks whether the current turn observed a live `measured` tool result and flags
 * unqualified completion/verification claims ("verified live", "confirmed fixed",
 * "issue is resolved", "schema is now valid") when no measurement probe ran.
 */

export interface VerificationObservation {
  toolName: string;
  measurementStatus: 'measured' | 'estimated' | 'not_measured' | 'unknown';
  isError?: boolean;
}

export interface VerificationCheckResult {
  ok: boolean;
  measuredToolCount: number;
  unverifiedCompletionClaims: string[];
  nudgeNote: string | null;
}

const COMPLETION_CLAIM_RE =
  /\b(?:verified\s+live|confirmed\s+fixed|issue\s+is\s+resolved|fix\s+is\s+live|has\s+been\s+fixed|is\s+now\s+fixed|successfully\s+deployed|schema\s+is\s+now\s+valid|now\s+ranking\s+#?\d+|citations?\s+have\s+recovered)\b/i;

const CONDITIONAL_OR_HEDGED_RE =
  /\b(?:not_measured|not\s+measured|not\s+verified|unverified|unknown|if\s+|once\s+|until\s+|verify\s+whether|check\s+whether|cannot\s+confirm|can't\s+confirm|should\s+be|would\s+be|may\s+be|might\s+be)\b/i;

export class VerificationLedger {
  private readonly observations: VerificationObservation[] = [];

  recordToolObservation(obs: VerificationObservation): void {
    this.observations.push({ ...obs });
  }

  measuredCount(): number {
    return this.observations.filter((o) => !o.isError && o.measurementStatus === 'measured').length;
  }

  evaluateResponse(text: string): VerificationCheckResult {
    const measuredToolCount = this.measuredCount();
    if (measuredToolCount > 0 || !text.trim()) {
      return {
        ok: true,
        measuredToolCount,
        unverifiedCompletionClaims: [],
        nudgeNote: null,
      };
    }

    const sentences = text
      .split(/(?<=[.!?])\s+|\r?\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 12 && !s.startsWith('#'));

    const unverifiedCompletionClaims: string[] = [];
    for (const sentence of sentences) {
      if (CONDITIONAL_OR_HEDGED_RE.test(sentence)) continue;
      if (COMPLETION_CLAIM_RE.test(sentence)) {
        unverifiedCompletionClaims.push(sentence.slice(0, 140));
      }
    }

    if (unverifiedCompletionClaims.length === 0) {
      return {
        ok: true,
        measuredToolCount: 0,
        unverifiedCompletionClaims: [],
        nudgeNote: null,
      };
    }

    return {
      ok: false,
      measuredToolCount: 0,
      unverifiedCompletionClaims,
      nudgeNote:
        'Note: No live verification probe ran in this turn; treat live deployment or fix status as not_measured until re-observed.',
    };
  }
}
