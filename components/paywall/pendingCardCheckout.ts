/**
 * Card pay remembers the plan on the existing login wall.
 * After signup or sign-in, checkout runs once and the plan is dropped.
 */
import { accountCallsAllowed } from '../../services/apiClient';
import { redirectToCardCheckout } from './cardCheckout';
import type { PaidPlanId } from './planPrices';

const STORAGE_KEY = 'luminara_pending_card_plan';
export const CARD_CHECKOUT_ERROR_EVENT = 'luminara-card-checkout-error';

/** Shown on the login wall when the buyer came from Pay by card. */
export const CARD_CHECKOUT_ACCOUNT_LINE =
  'A free account is how you pay by card. We do not store your card details. Stripe hosts checkout.';

export function isPaidPlanId(value: unknown): value is PaidPlanId {
  return value === 'starter' || value === 'growth' || value === 'agency';
}

export function readCardCheckoutError(event: Event): string | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  if (typeof detail !== 'object' || detail === null || !('error' in detail)) return null;
  return typeof detail.error === 'string' && detail.error ? detail.error : null;
}

export type LoginWallDetail = {
  mode?: 'signin' | 'signup';
  resumeCheckoutPlanId?: string;
};

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function store(): Store | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function rememberCardCheckout(planId: PaidPlanId): void {
  store()?.setItem(STORAGE_KEY, planId);
}

export function clearPendingCardCheckout(): void {
  store()?.removeItem(STORAGE_KEY);
}

export function readPendingCardCheckout(): PaidPlanId | null {
  const value = store()?.getItem(STORAGE_KEY) ?? null;
  return isPaidPlanId(value) ? value : null;
}

/** Signup wall, with the plan kept for the next successful auth. */
export function openCardCheckoutLogin(planId: PaidPlanId): void {
  rememberCardCheckout(planId);
  window.dispatchEvent(new CustomEvent('luminara-open-login', {
    detail: { mode: 'signup', resumeCheckoutPlanId: planId } satisfies LoginWallDetail,
  }));
}

function loginDetail(detail: unknown): { mode: unknown; resumeCheckoutPlanId: unknown } {
  if (typeof detail !== 'object' || detail === null) {
    return { mode: undefined, resumeCheckoutPlanId: undefined };
  }
  return {
    mode: 'mode' in detail ? detail.mode : undefined,
    resumeCheckoutPlanId: 'resumeCheckoutPlanId' in detail ? detail.resumeCheckoutPlanId : undefined,
  };
}

/**
 * Saves a checkout plan from the login event, or clears one when the wall
 * was opened for anything else. The saved plan is what the wall copy reads.
 */
export function applyLoginDetail(detail: unknown): 'signin' | 'signup' {
  const parsed = loginDetail(detail);
  if (isPaidPlanId(parsed.resumeCheckoutPlanId)) rememberCardCheckout(parsed.resumeCheckoutPlanId);
  else clearPendingCardCheckout();
  return parsed.mode === 'signup' ? 'signup' : 'signin';
}

export type CardCheckoutStart =
  | { ok: true }
  | { ok: false; needsAccount: true }
  | { ok: false; error: string };

/** Pay by card. A signed-out buyer gets the signup wall instead of a Stripe call. */
export async function beginCardCheckout(planId: string): Promise<CardCheckoutStart> {
  if (!isPaidPlanId(planId)) return { ok: false, error: 'Choose Starter, Growth, or Agency.' };
  if (!accountCallsAllowed()) {
    openCardCheckoutLogin(planId);
    return { ok: false, needsAccount: true };
  }
  const result = await redirectToCardCheckout(planId);
  if (!result.ok && /sign in/i.test(result.error)) {
    openCardCheckoutLogin(planId);
    return { ok: false, needsAccount: true };
  }
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export type CardCheckoutResume =
  | { ran: false }
  | { ran: true; ok: true }
  | { ran: true; ok: false; error: string };

let inflight: Promise<CardCheckoutResume> | null = null;

export function cardCheckoutInFlight(): boolean {
  return inflight !== null;
}

/**
 * One Stripe redirect for the saved plan. A second call shares the first
 * request so a remounted auth effect cannot open checkout twice.
 */
export function resumePendingCardCheckout(): Promise<CardCheckoutResume> {
  if (inflight) return inflight;
  const planId = readPendingCardCheckout();
  if (!planId) return Promise.resolve({ ran: false });
  clearPendingCardCheckout();
  inflight = redirectToCardCheckout(planId).then((result): CardCheckoutResume => {
    if (result.ok) return { ran: true, ok: true };
    return { ran: true, ok: false, error: result.error };
  }).finally(() => {
    inflight = null;
  });
  return inflight;
}
