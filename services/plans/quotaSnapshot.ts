/**
 * The signed-in account's quota and plan as the client last saw it.
 * apiClient writes it from quota headers and the boot read; the Firebase auth service clears it
 * when the user changes. It lives here so both can import it without an import cycle.
 */

export interface QuotaInfo {
  limit: number;
  used: number;
  remaining: number;
  resetSec: number;
  isUnlimited: boolean;
  plan?: string;
  expiresAt?: number;
  /** Hosted scout credits from a qualified invite. Separate from the daily cap. */
  bonusRemaining?: number;
}

let current: QuotaInfo | null = null;
const listeners = new Set<(q: QuotaInfo | null) => void>();

function publish(next: QuotaInfo | null): void {
  current = next;
  listeners.forEach((fn) => { try { fn(current); } catch {} });
}

export function subscribeQuota(fn: (q: QuotaInfo | null) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

export function getCurrentQuotaSync(): QuotaInfo | null {
  return current;
}

export function writeQuotaSnapshot(next: QuotaInfo): void {
  publish(next);
}

/** Sign-out or a different account: the previous account's plan must not leak into the next. */
export function clearQuotaSnapshot(): void {
  publish(null);
}
