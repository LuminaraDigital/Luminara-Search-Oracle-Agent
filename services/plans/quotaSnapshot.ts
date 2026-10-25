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
  /** Epoch ms of the daily reset (UTC midnight), from resetSec when the snapshot was written. */
  resetAt: number;
  isUnlimited: boolean;
  plan?: string;
  expiresAt?: number;
  /** Hosted scout credits from a qualified invite. Separate from the daily cap. */
  bonusRemaining?: number;
}

let current: QuotaInfo | null = null;
let epoch = 0;
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

/** Read before a quota request starts; pass it to writeQuotaSnapshot when the answer arrives. */
export function quotaEpoch(): number {
  return epoch;
}

/** Drops the write when the account changed after `since` was read: the answer belongs to the account that left. */
export function writeQuotaSnapshot(next: Omit<QuotaInfo, 'resetAt'>, since: number): void {
  if (since !== epoch) return;
  publish({ ...next, resetAt: Date.now() + next.resetSec * 1000 });
}

/** Sign-out or a different account: the previous account's plan must not leak into the next. */
export function clearQuotaSnapshot(): void {
  epoch += 1;
  publish(null);
}
