/**
 * Append-only claim ledger. measured requires sources. No invented metrics.
 */
import type { Claim, ClaimSource, ClaimStatus } from './types';
import { EvidenceBoundError } from './validate';

let nextId = 1;

export function resetClaimIdCounterForTests(): void {
  nextId = 1;
}

export class ClaimLedger {
  private readonly claims: Claim[] = [];

  list(): readonly Claim[] {
    return this.claims;
  }

  /**
   * Append a claim. `measured` without sources throws (fail closed).
   */
  append(input: {
    text: string;
    status: ClaimStatus;
    sources?: ClaimSource[];
    id?: string;
  }): Claim {
    const text = (input.text || '').trim();
    if (!text) {
      throw new EvidenceBoundError('Claim text required.');
    }
    const sources = input.sources ? [...input.sources] : [];
    if (input.status === 'measured' && sources.length === 0) {
      throw new EvidenceBoundError('measured claims require at least one source.');
    }
    const claim: Claim = {
      id: input.id || `c${nextId++}`,
      text,
      status: input.status,
      sources,
    };
    this.claims.push(claim);
    return claim;
  }

  /** Counts by status for Oracle pointer / report JSON. */
  summary(): Record<ClaimStatus, number> {
    const out: Record<ClaimStatus, number> = {
      measured: 0,
      estimated: 0,
      not_measured: 0,
      unknown: 0,
    };
    for (const c of this.claims) {
      out[c.status] += 1;
    }
    return out;
  }

  /**
   * Build chat-safe lines. Never upgrades status.
   */
  toVerdictLines(max = 8): string[] {
    return this.claims.slice(0, max).map((c) => `[${c.status}] ${c.text}`);
  }

  toJSON(): { claims: Claim[]; summary: Record<ClaimStatus, number> } {
    return { claims: [...this.claims], summary: this.summary() };
  }
}

/**
 * Harden a model-proposed status: measured without sources becomes not_measured.
 */
export function coerceClaimStatus(
  status: ClaimStatus,
  sources: ClaimSource[] | undefined,
): ClaimStatus {
  if (status === 'measured' && (!sources || sources.length === 0)) {
    return 'not_measured';
  }
  return status;
}
