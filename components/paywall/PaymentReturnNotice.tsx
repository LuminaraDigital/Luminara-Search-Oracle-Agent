import React, { useEffect, useRef, useState } from 'react';
import { accountCallsAllowed, accountKnownSignedIn, fetchQuotaStatus } from '../../services/apiClient';
import {
  paymentReturnMessage,
  paymentCredit,
  parsePaymentReturn,
  stripPaymentSearch,
  type PaymentReturn,
} from './paymentReturn';

// shortcut: eight tries, 1.5s apart. A slower webhook needs a status page, not a longer poll.
const POLL_ATTEMPTS = 8;
const POLL_GAP_MS = 1500;

function replacePaymentUrl(): void {
  const nextSearch = stripPaymentSearch(window.location.search);
  const next = `${window.location.pathname}${nextSearch}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.replaceState(null, '', next);
}

/**
 * Reads the Stripe return query, confirms the plan once the webhook credits it,
 * and sends a signed-in buyer to the dashboard.
 */
export function PaymentReturnNotice() {
  const [payment, setPayment] = useState<PaymentReturn | null>(() =>
    typeof window === 'undefined' ? null : parsePaymentReturn(window.location.search),
  );
  const signedIn = accountKnownSignedIn();
  const authReady = signedIn || !accountCallsAllowed();
  const [message, setMessage] = useState(() =>
    payment
      ? paymentReturnMessage({ payment, quota: null, now: Date.now(), signedIn: false, pending: true })
      : '',
  );
  const statusRef = useRef<HTMLDivElement>(null);
  const openedDashboard = useRef(false);
  const focused = useRef(false);

  useEffect(() => {
    if (!payment || payment.kind !== 'success' || !authReady || !signedIn || openedDashboard.current) return;
    openedDashboard.current = true;
    if (window.location.hash.replace(/^#/, '').toLowerCase() !== 'dashboard') {
      window.location.hash = 'dashboard';
    }
  }, [payment, authReady, signedIn]);

  useEffect(() => {
    if (!payment || !authReady) return;
    let cancelled = false;
    let timer = 0;

    if (payment.kind === 'cancelled' || !signedIn) {
      setMessage(paymentReturnMessage({ payment, quota: null, now: Date.now(), signedIn }));
      replacePaymentUrl();
      return;
    }

    let attempts = 0;
    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      const quota = await fetchQuotaStatus();
      if (cancelled) return;
      const now = Date.now();
      setMessage(paymentReturnMessage({ payment, quota, now, signedIn: true }));
      if (paymentCredit(payment, quota, now) != null || attempts >= POLL_ATTEMPTS) {
        replacePaymentUrl();
        return;
      }
      timer = window.setTimeout(() => { void tick(); }, POLL_GAP_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [payment, authReady, signedIn]);

  useEffect(() => {
    if (!message || focused.current) return;
    focused.current = true;
    statusRef.current?.focus();
  }, [message]);

  if (!payment || !message) return null;

  const dismiss = () => {
    replacePaymentUrl();
    setPayment(null);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex justify-center px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div
        ref={statusRef}
        id="payment-return-status"
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="pointer-events-auto w-full max-w-xl rounded-2xl border border-gold/50 bg-black/95 px-4 py-3 text-[15px] leading-relaxed text-white shadow-2xl outline-none focus:ring-2 focus:ring-gold"
      >
        <p>{message}</p>
        <button type="button" onClick={dismiss} className="mt-2 min-h-11 text-[13px] text-gold-light underline underline-offset-2">
          Dismiss
        </button>
      </div>
    </div>
  );
}
