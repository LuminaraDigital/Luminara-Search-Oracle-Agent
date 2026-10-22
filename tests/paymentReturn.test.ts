import { describe, expect, it } from 'vitest';
import {
  nextPaymentReturn,
  parsePaymentReturn,
  paymentCredit,
  paymentReturnMessage,
  stripPaymentSearch,
} from '../components/paywall/paymentReturn';

const until = Date.UTC(2026, 10, 21, 12);
const date = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }).format(until);

describe('payment return', () => {
  it('reads a successful starter return and drops the checkout query', () => {
    expect(parsePaymentReturn('?payment=success&plan=starter&session_id=cs_test_1')).toEqual({
      kind: 'success',
      planId: 'starter',
    });
    expect(stripPaymentSearch('?payment=success&plan=starter&session_id=cs_test_1&keep=1')).toBe('?keep=1');
    expect(nextPaymentReturn('', { kind: 'success', planId: 'starter' })).toEqual({
      kind: 'success',
      planId: 'starter',
    });
    expect(nextPaymentReturn('?payment=cancelled', { kind: 'success', planId: 'starter' })).toEqual({
      kind: 'cancelled',
    });
    expect(stripPaymentSearch('?payment=cancelled')).toBe('');
  });

  it('names the credited plan and date, and stays quiet until then', () => {
    const payment = parsePaymentReturn('?payment=success&plan=starter&session_id=cs_live');
    expect(payment).toEqual({ kind: 'success', planId: 'starter' });
    if (!payment || payment.kind !== 'success') throw new Error('expected a starter return');
    expect(paymentReturnMessage({
      payment,
      quota: { plan: 'starter', expiresAt: until },
      now: until - 1000,
      signedIn: true,
    })).toBe(`Payment received. Starter is active until ${date}.`);
    expect(paymentReturnMessage({
      payment,
      quota: { plan: 'free' },
      now: until,
      signedIn: true,
    })).toBe('Payment received. Starter is still being confirmed.');
    expect(paymentCredit(payment, { plan: 'growth', expiresAt: until }, until - 1)).toBeNull();
  });

  it('uses a calm cancel line and does not invent a date for a guest', () => {
    expect(paymentReturnMessage({
      payment: { kind: 'cancelled' },
      quota: null,
      now: until,
      signedIn: false,
    })).toBe('No payment was taken. You can choose a plan when you are ready.');
    expect(paymentReturnMessage({
      payment: { kind: 'success', planId: 'agency' },
      quota: { plan: 'agency', expiresAt: until },
      now: until - 1,
      signedIn: false,
    })).toBe('Payment received. Sign in to see Agency on your dashboard.');
  });
});
