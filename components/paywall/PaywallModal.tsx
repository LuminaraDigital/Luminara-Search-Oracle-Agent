import React, { useEffect, useState } from 'react';
import { useTonConnectUI, useTonWallet, TonConnectButton } from '@tonconnect/ui-react';
import { isInTelegram, payWithStars, haptic } from '../../services/telegram/tma';
import { createStarsInvoice, activateLicenseKey, getServerHealthSync, loadServerHealth, subscribeQuota, fetchQuotaStatus, type QuotaInfo } from '../../services/apiClient';
import { redirectToCardCheckout } from './cardCheckout';
import { checkPendingTonPayment, executeTonPayment, readPendingTonOrder } from '../../services/ton/tonService';
import { executeJettonPayment } from '../../services/ton/jettonService';
import { productTelemetry } from '../../services/analytics/productTelemetry';
import {
  effectiveTab,
  isJettonCheckoutAvailable,
  resolvePaymentOptions,
  TELEGRAM_MINI_APP_URL,
  type PaymentRail,
} from './paymentOptions';
import { cardPayLabel, cardTermLabel, PAID_PLAN_PRICES, type PaidPlanId } from './planPrices';
import { BYOK_CHECKOUT_LINE, CHECKOUT_TERM_LINE, NO_TAX_LINE, NOTHING_TO_CANCEL, PAYWALL_HEADLINE, PAYWALL_SUBLINE, PLAN_CARD_BADGE, TELEGRAM_STARS_HANDOFF, WAITLIST_LINE, planAudience, planBullets, planSeatLine, planTitle, pricingTiers, starsPayLabel } from './planCopy';
import { COMPANY_SERVICES_URL } from '../../services/legal/consumerTerms';
import { ICONS } from '../../constants';
import '../marketing/space.css';
import { toUserFacingText } from '../../utils/userFacingText';

interface Props {
  isOpen?: boolean;
  onClose?: () => void;
  onOpenSettings?: () => void;
  /** Reason from the event that mounted this modal. The listener is not attached yet for that first event. */
  bootReason?: string;
}

export const PaywallModal: React.FC<Props> = ({ isOpen: controlledOpen, onClose, onOpenSettings, bootReason }) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const [triggerReason, setTriggerReason] = useState<string | null>(bootReason ?? null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [health, setHealth] = useState(getServerHealthSync);
  const inTg = isInTelegram();
  const paymentOptions = resolvePaymentOptions({ inTelegram: inTg, health });
  const [activeTab, setActiveTab] = useState<PaymentRail>(paymentOptions.defaultTab);
  const tab = effectiveTab(activeTab, paymentOptions);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [showLicenseInput, setShowLicenseInput] = useState(false);
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [activatingLicense, setActivatingLicense] = useState(false);
  // A TON transfer that was sent and has not been seen as paid yet. Drives "Check my payment".
  const [pendingTonOrder, setPendingTonOrder] = useState<string | null>(() => readPendingTonOrder());
  const [checkingTon, setCheckingTon] = useState(false);
  const [selectedAsset, setTonAsset] = useState<'TON' | 'USDT' | 'LORA'>('TON');
  const jettonLive = isJettonCheckoutAvailable(health);
  const tonAsset = jettonLive ? selectedAsset : 'TON';

  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;

  // Listen to global 402 / paywall event
  useEffect(() => {
    const handlePaywall = (e: any) => {
      const detail = e.detail || {};
      setTriggerReason(toUserFacingText(detail.reason, 'You have reached your daily free AI request limit.'));
      setInternalOpen(true);
      fetchQuotaStatus();
    };
    window.addEventListener('luminara-open-paywall', handlePaywall);
    return () => window.removeEventListener('luminara-open-paywall', handlePaywall);
  }, []);

  useEffect(() => {
    if (isOpen) {
      productTelemetry.track('paywall_viewed', { tab, inTelegram: inTg });
    }
  }, [isOpen, tab, inTg]);

  useEffect(() => {
    return subscribeQuota(q => setQuota(q));
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchQuotaStatus();
      let cancelled = false;
      // The modal usually mounts before /api/health resolves, so re-derive rails on open.
      void loadServerHealth().then(h => {
        if (cancelled) return;
        setHealth(h);
        const opts = resolvePaymentOptions({ inTelegram: inTg, health: h });
        setActiveTab(!inTg && wallet && opts.tonAvailable ? 'ton' : opts.defaultTab);
      });
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          handleClose();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        cancelled = true;
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, inTg, wallet]);

  const handleClose = () => {
    setStatusMessage(null);
    setIsSuccess(false);
    setBusyPlan(null);
    setShowLicenseInput(false);
    setLicenseKeyInput('');
    setActivatingLicense(false);
    if (controlledOpen !== undefined && onClose) {
      onClose();
    } else {
      setInternalOpen(false);
    }
  };

  const handleActivateLicense = async () => {
    if (!licenseKeyInput.trim()) return;
    setActivatingLicense(true);
    setStatusMessage(null);
    try {
      const res = await activateLicenseKey(licenseKeyInput.trim());
      if (res.ok) {
        haptic('success');
        setIsSuccess(true);
        const planName = res.plan ? res.plan.toUpperCase() : 'PREMIUM';
        setStatusMessage(`License activated! ${planName} unlocked for ${res.durationDays || 3} days.`);
        await fetchQuotaStatus();
        setTimeout(() => {
          handleClose();
        }, 2000);
      } else {
        haptic('error');
        setStatusMessage(toUserFacingText(res.error, 'Invalid or expired license key.'));
      }
    } catch (err: any) {
      haptic('error');
      setStatusMessage(toUserFacingText(err, 'Failed to activate license key.'));
    } finally {
      setActivatingLicense(false);
    }
  };

  const handleStarsCheckout = async (planId: string) => {
    if (!inTg) {
      window.open(TELEGRAM_MINI_APP_URL, '_blank', 'noopener,noreferrer');
      setStatusMessage('Opening Luminara in Telegram. Finish your Stars checkout in the Mini App.');
      return;
    }
    setBusyPlan(planId);
    setStatusMessage('Creating Telegram Stars invoice…');
    try {
      const invoiceUrl = await createStarsInvoice(planId);
      const status = await payWithStars(invoiceUrl);
      haptic(status === 'paid' ? 'success' : 'light');

      if (status === 'paid') {
        productTelemetry.track('payment_completed', { planId, method: 'stars', status: 'confirmed' });
        setIsSuccess(true);
        setStatusMessage('Payment received! Activating your subscription…');
        let activated = false;
        for (let i = 0; i < 6 && !activated; i++) {
          await new Promise(r => setTimeout(r, 1200));
          const q = await fetchQuotaStatus();
          activated = Boolean(q && (q.isUnlimited || q.plan !== 'free'));
        }
        if (activated) {
          setStatusMessage('Subscription active! Enjoy your upgraded access.');
          setTimeout(() => {
            handleClose();
          }, 1500);
        } else {
          setStatusMessage('Payment received. Activation pending, refresh in a minute.');
        }
      } else if (status === 'cancelled') {
        setStatusMessage('Checkout was cancelled.');
      } else if (status === 'failed') {
        setStatusMessage('Payment failed. No Stars were charged.');
      } else if (status === 'pending') {
        setStatusMessage('Payment is being processed by Telegram. Your plan will activate momentarily.');
      }
    } catch (err: any) {
      haptic('error');
      setStatusMessage(toUserFacingText(err, 'Could not start Stars checkout.'));
    } finally {
      setBusyPlan(null);
    }
  };

  const handleTonCheckout = async (planId: string) => {
    setBusyPlan(planId);
    setStatusMessage(null);
    try {
      const res = await executeTonPayment(tonConnectUI, planId, msg => setStatusMessage(msg));
      setPendingTonOrder(res.ok ? null : (res.pendingOrderId ?? readPendingTonOrder()));
      if (res.ok) {
        productTelemetry.track('payment_completed', { planId, method: 'ton', status: 'confirmed' });
        haptic('success');
        setIsSuccess(true);
        setStatusMessage('TON payment confirmed! Subscription is now active.');
        setTimeout(async () => {
          await fetchQuotaStatus();
          handleClose();
        }, 2500);
      } else {
        haptic('error');
        setStatusMessage(toUserFacingText(res.error, 'Payment failed or cancelled.'));
      }
    } catch (err: any) {
      haptic('error');
      setStatusMessage(toUserFacingText(err, 'TON transaction failed.'));
    } finally {
      setBusyPlan(null);
    }
  };

  /** The retry the pending notice names. It sends nothing; it asks whether the order was paid. */
  const handleCheckTonPayment = async () => {
    if (!pendingTonOrder || checkingTon) return;
    setCheckingTon(true);
    try {
      const res = await checkPendingTonPayment(pendingTonOrder);
      if (res.ok) {
        productTelemetry.track('payment_completed', { planId: res.plan || 'unknown', method: 'ton', status: 'confirmed' });
        haptic('success');
        setPendingTonOrder(null);
        setIsSuccess(true);
        setStatusMessage('TON payment confirmed! Subscription is now active.');
        await fetchQuotaStatus();
      } else {
        if (res.closed) setPendingTonOrder(null);
        setStatusMessage(toUserFacingText(res.error, 'Could not check the payment. Try again in a minute.'));
      }
    } catch (err: any) {
      setStatusMessage(toUserFacingText(err, 'Could not check the payment. Try again in a minute.'));
    } finally {
      setCheckingTon(false);
    }
  };

  const handleJettonCheckout = async (planId: string, asset: 'USDT' | 'LORA') => {
    setBusyPlan(planId);
    setStatusMessage(null);
    try {
      const res = await executeJettonPayment(
        tonConnectUI,
        '', // Derived on-chain from master + user wallet in executeJettonPayment
        planId,
        asset,
        msg => setStatusMessage(msg),
      );
      if (res.ok) {
        productTelemetry.track('payment_completed', { planId, method: asset.toLowerCase(), status: 'confirmed' });
        haptic('success');
        setIsSuccess(true);
        setStatusMessage(`${asset} Jetton payment confirmed! Subscription is now active.`);
        setTimeout(async () => {
          await fetchQuotaStatus();
          handleClose();
        }, 2000);
      } else {
        haptic('error');
        setStatusMessage(toUserFacingText(res.error, `${asset} transfer could not be completed.`));
      }
    } catch (err: any) {
      haptic('error');
      setStatusMessage(toUserFacingText(err, `Could not finish ${asset} checkout.`));
    } finally {
      setBusyPlan(null);
    }
  };

  const handleCardCheckout = async (planId: string) => {
    setBusyPlan(planId);
    setStatusMessage('Connecting to secure Stripe card checkout…');
    const res = await redirectToCardCheckout(planId);
    if (!res.ok) setStatusMessage(res.error);
    setBusyPlan(null);
  };

  const handlePlanCheckout = (planId: 'starter' | 'growth' | 'agency') => {
    if (tab === 'card') {
      return handleCardCheckout(planId);
    }
    if (tab === 'stars') {
      return handleStarsCheckout(planId);
    }
    if (tonAsset === 'TON') {
      return handleTonCheckout(planId);
    }
    return handleJettonCheckout(planId, tonAsset);
  };

  const planPriceLabel = (plan: PaidPlanId) => {
    const price = PAID_PLAN_PRICES[plan];
    if (tab === 'card') return cardTermLabel(plan);
    if (tab === 'stars') return price.starsLabel.replace(' Stars', ' ⭐');
    if (tonAsset === 'TON') return price.tonLabel;
    if (tonAsset === 'USDT') {
      if (plan === 'starter') return '29 USDT';
      if (plan === 'growth') return '79 USDT';
      return '199 USDT';
    }
    if (plan === 'starter') return '29 LORA';
    if (plan === 'growth') return '79 LORA';
    return '199 LORA';
  };

  const planButtonLabel = (plan: PaidPlanId) => {
    const price = PAID_PLAN_PRICES[plan];
    if (busyPlan === plan) return 'Processing…';
    if (tab === 'card') return cardPayLabel(plan);
    if (tab === 'stars') return starsPayLabel(price.starsLabel, inTg);
    if (tonAsset === 'TON') return `Pay ${price.tonLabel} · 30 days`;
    if (tonAsset === 'USDT') {
      if (plan === 'starter') return 'Pay 29 USDT · 30 days';
      if (plan === 'growth') return 'Pay 79 USDT · 30 days';
      return 'Pay 199 USDT · 30 days';
    }
    if (plan === 'starter') return 'Pay 29 LORA · 30 days';
    if (plan === 'growth') return 'Pay 79 LORA · 30 days';
    return 'Pay 199 LORA · 30 days';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/80 backdrop-blur-xl animate-fade-in font-['Outfit']">
      <div 
        role="dialog"
        aria-modal="true"
        aria-labelledby="paywall-modal-title"
        className="relative my-auto w-full max-w-2xl border border-gold/35 rounded-3xl p-5 sm:p-6 md:p-8 shadow-2xl text-white overflow-hidden max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3.5rem)] overflow-y-auto bg-black/90 backdrop-blur-xl"
      >
        {/* Glow ambient */}
        <div className="absolute top-0 right-1/4 w-72 h-72 bg-gold/10 blur-[120px] rounded-full pointer-events-none" />

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gold/10 border border-gold/30 flex items-center justify-center text-gold">
              <ICONS.Sparkle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold tracking-wide text-gold">Plans</span>
                {paymentOptions.tonAvailable && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold tracking-wide bg-gold/15 text-gold-light border border-gold/30">
                    Stars + TON
                  </span>
                )}
              </div>
              <h3 id="paywall-modal-title" className="lx-display mt-1 text-3xl md:text-4xl">
                {PAYWALL_HEADLINE}
              </h3>
              <p className="mt-2 max-w-md text-sm leading-snug text-gray-400">{PAYWALL_SUBLINE} {NOTHING_TO_CANCEL} {NO_TAX_LINE}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={handleClose}
            className="text-gray-400 hover:text-white p-2 rounded-xl hover:bg-white/5 transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          >
            ✕
          </button>
        </div>

        {/* Reason / Quota Banner */}
        <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 mb-5 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-gray-300">
            <span className="w-2 h-2 rounded-full bg-gold animate-pulse shrink-0" />
            <span>{triggerReason || 'Free tier daily request allowance reached.'}</span>
          </div>
          {quota && !quota.isUnlimited && (
            <span className="font-mono text-gold shrink-0 font-bold">
              {quota.used}/{quota.limit} used today
            </span>
          )}
        </div>

        {/* License Key Gated Entry */}
        <div className="mb-5 p-4 rounded-2xl bg-black/40 border border-gold/40">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <span className="text-base">🔑</span>
              <span>I have a license key</span>
            </div>
            <button
              type="button"
              onClick={() => setShowLicenseInput(!showLicenseInput)}
              className="lx-btn lx-btn-ghost !min-h-8 !px-3.5 !py-1 text-xs"
            >
              {showLicenseInput ? 'Close' : 'Enter Key'}
            </button>
          </div>
          {showLicenseInput && (
            <div className="mt-3 pt-3 border-t border-white/10 space-y-2.5 animate-fade-in">
              <p className="text-[11px] text-gray-400">
                Enter a license key if you have one.
              </p>
              <div className="flex gap-2">
                <label htmlFor="paywall-license-key-input" className="sr-only">License key</label>
                <input
                  id="paywall-license-key-input"
                  type="text"
                  value={licenseKeyInput}
                  onChange={(e) => setLicenseKeyInput(e.target.value.toUpperCase())}
                  placeholder="License key"
                  className="flex-1 px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/20 focus:border-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none text-xs font-mono text-white placeholder-gray-500"
                />
                <button
                  type="button"
                  onClick={handleActivateLicense}
                  disabled={activatingLicense || !licenseKeyInput.trim()}
                  className="lx-btn lx-btn-gold text-sm disabled:opacity-50"
                >
                  {activatingLicense ? 'Activating…' : 'Activate'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Payment Rail Selector: Card only when Worker reports stripeCheckout live; never in TMA */}
        <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-black/40 border border-white/10 mb-6">
          {paymentOptions.cardAvailable && (
            <button
              type="button"
              onClick={() => setActiveTab('card')}
              className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
                tab === 'card'
                  ? 'bg-gold text-black shadow-lg shadow-gold/20'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>Card</span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-black/20 text-black font-semibold">
                30 days
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveTab('stars')}
            className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
              tab === 'stars'
                ? 'bg-gold text-black shadow-lg shadow-gold/20'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>Stars</span>
            {inTg && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-black/20 text-black font-semibold">
                1-Click
              </span>
            )}
          </button>
          {paymentOptions.showTonTab && (
            <button
              type="button"
              onClick={() => setActiveTab('ton')}
              disabled={!paymentOptions.tonAvailable}
              className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
                tab === 'ton'
                  ? 'bg-gold text-black shadow-lg shadow-gold/20'
                  : paymentOptions.tonAvailable
                  ? 'text-gray-400 hover:text-white hover:bg-white/5'
                  : 'text-gray-500 cursor-not-allowed'
              }`}
            >
              <span>TON</span>
              {!paymentOptions.tonAvailable ? (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-gray-400 font-semibold">
                  Soon
                </span>
              ) : wallet && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-black/20 text-black font-semibold">
                  Connected
                </span>
              )}
            </button>
          )}
        </div>

        {/* Jetton Asset Selector: only when the server reports Jetton checkout live */}
        {tab === 'ton' && paymentOptions.tonAvailable && jettonLive && (
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-white/[0.04] border border-white/10 mb-6">
            <button
              type="button"
              onClick={() => setTonAsset('TON')}
              className={`flex-1 py-1.5 px-2.5 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 ${
                tonAsset === 'TON'
                  ? 'bg-gold/20 text-gold border border-gold/40 shadow-sm'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>💎 Native TON</span>
            </button>
            <button
              type="button"
              onClick={() => setTonAsset('USDT')}
              className={`flex-1 py-1.5 px-2.5 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 ${
                tonAsset === 'USDT'
                  ? 'bg-gold/20 text-gold border border-gold/40 shadow-sm'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>💵 USDT (Jetton)</span>
            </button>
            <button
              type="button"
              onClick={() => setTonAsset('LORA')}
              className={`flex-1 py-1.5 px-2.5 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 ${
                tonAsset === 'LORA'
                  ? 'bg-gold/20 text-gold border border-gold/40 shadow-sm'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>$LORA</span>
            </button>
          </div>
        )}

        {tab === 'stars' && !inTg && (
          <p className="mb-4 text-sm leading-relaxed text-gray-300">{TELEGRAM_STARS_HANDOFF} Choosing a plan opens Telegram so you can pay there.</p>
        )}
        {!inTg && !paymentOptions.cardAvailable && !paymentOptions.tonAvailable && (
          <p className="mb-4 text-sm leading-relaxed text-gray-300">{WAITLIST_LINE}</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {pricingTiers.map((tier) => (
            <div
              key={tier.id}
              className={`p-5 rounded-2xl border flex flex-col justify-between space-y-4 hover:border-gold transition-all relative ${
                tier.highlight
                  ? 'border-white/15 bg-white/[0.02]'
                  : tier.id === 'agency'
                    ? 'border-gold/30 bg-gradient-to-br from-gold/10 to-transparent sm:col-span-2'
                    : 'border-gold/40 bg-gold/5'
              }`}
            >
              {tier.highlight && (
                <div className="absolute -top-2.5 right-4 px-2.5 py-0.5 rounded-full bg-gold text-black font-semibold text-[11px] tracking-wide">
                  {PLAN_CARD_BADGE}
                </div>
              )}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-sm font-bold ${tier.highlight ? 'text-white' : 'text-gold-light'}`}>{planTitle(tier.id)}</span>
                  <span className="text-sm font-semibold text-gold-light">{tab === 'card' ? planPriceLabel(tier.id) : `${PAID_PLAN_PRICES[tier.id].audLabel} · ${planPriceLabel(tier.id)}`}</span>
                </div>
                <p className="text-[11px] text-gray-400">{planAudience(tier.id)} · {planSeatLine(tier.id)}</p>
                <p className="text-[11px] text-gray-400 leading-relaxed">{tier.blurb}</p>
                <ul className={`mt-3 gap-1.5 text-[11px] text-gray-300 ${tier.id === 'agency' ? 'grid grid-cols-1 sm:grid-cols-2' : 'space-y-1.5'}`}>
                  {planBullets(tier.id).map((line) => (
                    <li key={line.text} className={`flex items-center gap-2 ${line.included ? 'text-gray-300' : 'text-gray-400'}`}>
                      {line.included ? (
                        <span aria-hidden className="text-gold">✓</span>
                      ) : (
                        <span aria-hidden className="text-gray-400">-</span>
                      )}
                      {line.included ? line.text : <><span className="sr-only">Not included: </span>{line.text}</>}
                    </li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                onClick={() => handlePlanCheckout(tier.id)}
                disabled={busyPlan !== null}
                className={`lx-btn w-full text-sm disabled:opacity-50 ${tier.highlight ? 'lx-btn-gold' : 'lx-btn-ghost'}`}
              >
                {planButtonLabel(tier.id)}
              </button>
            </div>
          ))}
        </div>

        {/* Stripe Card helper if in Card tab (only when stripeCheckout live) */}
        {tab === 'card' && paymentOptions.cardAvailable && (
          <div className="p-4 rounded-2xl bg-black/40 border border-gold/30 mb-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-left">
              <p className="text-xs font-bold text-white">Card checkout (30 days)</p>
              <p className="text-[11px] text-gray-400">
                Secure hosted checkout. One-time 30-day plan grant (not auto-renew unless stated at purchase).
              </p>
            </div>
          </div>
        )}

        {/* TON Wallet Connect helper if in TON tab */}
        {tab === 'ton' && (
          <div className="p-4 rounded-2xl bg-black/40 border border-white/10 mb-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-left">
              <p className="text-xs font-bold text-white">TON Wallet Connection</p>
              <p className="text-[11px] text-gray-400">
                {wallet ? `Connected: ${wallet.account.address.slice(0, 8)}…${wallet.account.address.slice(-6)}` : 'Connect Tonkeeper, Telegram Wallet, or any TON wallet.'}
              </p>
            </div>
            <TonConnectButton />
          </div>
        )}

        {tab === 'stars' && !inTg && (
          <div className="p-4 rounded-2xl bg-black/40 border border-gold/30 mb-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-left">
              <p className="text-xs font-bold text-white">Pay with Telegram Stars</p>
              <p className="text-[11px] text-gray-400">
                {TELEGRAM_STARS_HANDOFF} {CHECKOUT_TERM_LINE}
              </p>
            </div>
            <a
              href={TELEGRAM_MINI_APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="lx-btn lx-btn-gold shrink-0 text-sm"
            >
              Open in Telegram
            </a>
          </div>
        )}

        {/* Telegram Stars Terms & Support Notice */}
        {tab === 'stars' && (
          <div className="p-3 rounded-2xl bg-black/40 border border-white/10 mb-4 text-center text-[11px] text-gray-400 space-y-1">
            <p>
              By purchasing with Telegram Stars, you agree to our{' '}
              <a href="/terms" className="text-gold underline hover:text-gold-light" target="_blank" rel="noopener noreferrer">Terms of Service</a>
              {' '}and{' '}
              <a href="/privacy" className="text-gold underline hover:text-gold-light" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
            </p>
            <p className="text-gray-400 text-[11px]">
              {CHECKOUT_TERM_LINE} For billing help, use /paysupport in the bot.
            </p>
          </div>
        )}

        {/* Status / Feedback message */}
        {statusMessage && (
          <div
            className={`p-3 rounded-xl text-xs text-center font-medium mb-4 ${
              isSuccess ? 'bg-success-500/10 text-success-400 border border-success-500/20' : 'bg-warning-500/10 text-warning-300 border border-warning-500/20'
            }`}
          >
            {statusMessage}
          </div>
        )}

        {/* The retry control for a TON transfer that was sent and is not confirmed yet. Never inside Telegram. */}
        {pendingTonOrder && paymentOptions.showTonTab && (
          <div className="mb-4 text-center">
            <button
              type="button"
              onClick={handleCheckTonPayment}
              disabled={checkingTon}
              className="px-4 py-2 rounded-xl text-xs font-bold border border-gold/40 text-gold-light bg-gold/10 hover:bg-gold/20 transition-all disabled:opacity-50"
            >
              {checkingTon ? 'Checking…' : 'Check my payment'}
            </button>
            <p className="mt-2 text-[11px] text-gray-500 font-mono break-all">Order {pendingTonOrder}</p>
          </div>
        )}

        {/* BYOK alternative */}
        <div className="pt-4 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400">
          <p>
            <span className="text-gray-300">{BYOK_CHECKOUT_LINE}</span>
          </p>
          <button
            type="button"
            onClick={() => {
              handleClose();
              if (onOpenSettings) onOpenSettings();
              else window.dispatchEvent(new CustomEvent('luminara-open-settings'));
            }}
            className="px-4 py-1.5 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-white font-medium text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          >
            Open Settings
          </button>
        </div>

        {/* Not now dismissal */}
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={handleClose}
            className="text-xs text-gray-400 hover:text-gray-300 transition-colors py-1 px-4 rounded-lg hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          >
            Not now
          </button>
        </div>

        <p className="mt-3 text-center text-[11px] text-gray-400">
          Produced by{' '}
          <a
            href={COMPANY_SERVICES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gold/80 hover:text-gold underline-offset-2 hover:underline"
          >
            Luminara Digital
          </a>
        </p>
      </div>
    </div>
  );
};
