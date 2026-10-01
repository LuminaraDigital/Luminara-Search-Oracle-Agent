/**
 * Pending `ref_*` code. Held in sessionStorage until Telegram or Firebase auth,
 * then claimed. The code is an opaque invite token, not a secret and not a user id.
 */

import { normalizeReferralCode } from './rules';

const PENDING_KEY = 'luminara_pending_ref';

type PendingStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStore(): PendingStore | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function holdPendingReferral(code: string, store: PendingStore | null = defaultStore()): void {
  const normalized = normalizeReferralCode(code);
  if (!normalized || !store) return;
  store.setItem(PENDING_KEY, normalized);
}

export function readPendingReferral(store: PendingStore | null = defaultStore()): string | null {
  if (!store) return null;
  return normalizeReferralCode(store.getItem(PENDING_KEY));
}

export function clearPendingReferral(store: PendingStore | null = defaultStore()): void {
  store?.removeItem(PENDING_KEY);
}
