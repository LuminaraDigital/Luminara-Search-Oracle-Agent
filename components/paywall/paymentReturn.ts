/**
 * Stripe returns the buyer to /?payment=success or /pricing?payment=cancelled.
 * The Worker builds those URLs. This module is what the page reads.
 */
import { formatAuDate } from '../../utils/formatAuDate';
import { planTitle } from './planCopy';
import type { PaidPlanId } from './planPrices';

const PAID_PLAN_IDS: readonly PaidPlanId[] = ['starter', 'growth', 'agency'];

export type PaymentReturn =
  | { kind: 'success'; planId: PaidPlanId | null }
  | { kind: 'cancelled' };

export type PaymentQuota = { plan?: string; expiresAt?: number };

function isPaidPlanId(value: string): value is PaidPlanId {
  return (PAID_PLAN_IDS as readonly string[]).includes(value);
}

/** The payment, plan, and session_id query keys Stripe sends back. Other keys stay. */
export function parsePaymentReturn(search: string): PaymentReturn | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const payment = (params.get('payment') || '').toLowerCase();
  if (payment === 'cancelled') return { kind: 'cancelled' };
  if (payment !== 'success') return null;
  const plan = (params.get('plan') || '').trim().toLowerCase();
  return { kind: 'success', planId: isPaidPlanId(plan) ? plan : null };
}

export function stripPaymentSearch(search: string): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  params.delete('payment');
  params.delete('plan');
  params.delete('session_id');
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/** True when this return's plan is the active one, with a future expiry. */
export function paymentCredit(payment: PaymentReturn, quota: PaymentQuota | null, now: number): number | null {
  if (payment.kind !== 'success' || !payment.planId || !quota) return null;
  const plan = String(quota.plan || '').trim().toLowerCase();
  if (plan !== payment.planId) return null;
  if (typeof quota.expiresAt !== 'number' || quota.expiresAt <= now) return null;
  return quota.expiresAt;
}

export function paymentReturnMessage(input: {
  payment: PaymentReturn;
  quota: PaymentQuota | null;
  now: number;
  signedIn: boolean;
  /** Auth has not resolved, so do not tell a buyer to sign in yet. */
  pending?: boolean;
}): string {
  if (input.payment.kind === 'cancelled') {
    return 'No payment was taken. You can choose a plan when you are ready.';
  }
  const title = input.payment.planId ? planTitle(input.payment.planId) : 'Your plan';
  const until = input.signedIn ? paymentCredit(input.payment, input.quota, input.now) : null;
  if (until != null) {
    const date = formatAuDate(until);
    if (date) return `Payment received. ${title} is active until ${date}.`;
  }
  if (!input.signedIn && !input.pending) {
    return input.payment.planId
      ? `Payment received. Sign in to see ${title} on your dashboard.`
      : 'Payment received. Sign in to see your plan on the dashboard.';
  }
  return `Payment received. ${title} is still being confirmed.`;
}
