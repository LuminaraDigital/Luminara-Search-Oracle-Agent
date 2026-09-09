import React, { useEffect, useState } from 'react';
import { useTonConnectUI, useTonWallet, TonConnectButton } from '@tonconnect/ui-react';
import { isInTelegram, payWithStars, haptic } from '../../services/telegram/tma';
import { createStarsInvoice, getServerHealthSync, subscribeQuota, fetchQuotaStatus, type QuotaInfo } from '../../services/apiClient';
import { executeTonPayment } from '../../services/ton/tonService';
import { ICONS } from '../../constants';

interface Props {
  isOpen?: boolean;
  onClose?: () => void;
  onOpenSettings?: () => void;
}

export const PaywallModal: React.FC<Props> = ({ isOpen: controlledOpen, onClose, onOpenSettings }) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const [triggerReason, setTriggerReason] = useState<string | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'stars' | 'ton'>(isInTelegram() ? 'stars' : 'ton');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);

  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const inTg = isInTelegram();
  const health = getServerHealthSync();
  const plans = health.plans || {};

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;

  // Listen to global 402 / paywall event
  useEffect(() => {
    const handlePaywall = (e: any) => {
      const detail = e.detail || {};
      setTriggerReason(detail.reason || 'You have reached your daily free AI request limit.');
      setInternalOpen(true);
      fetchQuotaStatus();
    };
    window.addEventListener('luminara-open-paywall', handlePaywall);
    return () => window.removeEventListener('luminara-open-paywall', handlePaywall);
  }, []);

  useEffect(() => {
    return subscribeQuota(q => setQuota(q));
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchQuotaStatus();
      if (!inTg && wallet) {
        setActiveTab('ton');
      }
    }
  }, [isOpen, inTg, wallet]);

  const handleClose = () => {
    setStatusMessage(null);
    setIsSuccess(false);
    setBusyPlan(null);
    if (controlledOpen !== undefined && onClose) {
      onClose();
    } else {
      setInternalOpen(false);
    }
  };

  const handleStarsCheckout = async (planId: string) => {
    if (!inTg) {
      setStatusMessage('Telegram Stars checkout only works inside the Telegram Mini App. Use TON on the web, or open the bot in Telegram.');
      return;
    }
    setBusyPlan(planId);
    setStatusMessage('Creating Telegram Stars invoice…');
    try {
      const invoiceUrl = await createStarsInvoice(planId);
      const status = await payWithStars(invoiceUrl);
      haptic(status === 'paid' ? 'success' : 'light');

      if (status === 'paid') {
        setIsSuccess(true);
        setStatusMessage('Payment received! Activating your subscription…');
        setTimeout(async () => {
          await fetchQuotaStatus();
          handleClose();
        }, 2500);
      } else if (status === 'cancelled') {
        setStatusMessage('Checkout was cancelled.');
      } else if (status === 'failed') {
        setStatusMessage('Payment failed. No Stars were charged.');
      }
    } catch (err: any) {
      haptic('error');
      setStatusMessage(err?.message || 'Could not start Stars checkout.');
    } finally {
      setBusyPlan(null);
    }
  };

  const handleTonCheckout = async (planId: string) => {
    setBusyPlan(planId);
    setStatusMessage(null);
    try {
      const res = await executeTonPayment(tonConnectUI, planId, msg => setStatusMessage(msg));
      if (res.ok) {
        haptic('success');
        setIsSuccess(true);
        setStatusMessage('TON payment confirmed! Subscription is now active.');
        setTimeout(async () => {
          await fetchQuotaStatus();
          handleClose();
        }, 2500);
      } else {
        haptic('error');
        setStatusMessage(res.error || 'Payment failed or cancelled.');
      }
    } catch (err: any) {
      haptic('error');
      setStatusMessage(err?.message || 'TON transaction failed.');
    } finally {
      setBusyPlan(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fade-in font-['Outfit']">
      <div className="relative w-full max-w-2xl glass-morphism border border-gold/40 rounded-3xl p-6 md:p-8 shadow-2xl text-white overflow-hidden max-h-[90vh] overflow-y-auto">
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
                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gold">AI Oracle Paywall</span>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-black tracking-widest uppercase bg-gold/15 text-gold-light border border-gold/30">
                  Dual-Rail
                </span>
              </div>
              <h3 className="text-xl md:text-2xl font-bold tracking-tight text-white mt-0.5">
                Unlock Unlimited AI Intelligence
              </h3>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white p-2 rounded-xl hover:bg-white/5 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Reason / Quota Banner */}
        <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 mb-6 flex items-center justify-between gap-3 text-xs">
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

        {/* Payment Rail Selector */}
        <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-black/40 border border-white/10 mb-6">
          <button
            onClick={() => setActiveTab('stars')}
            className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeTab === 'stars'
                ? 'bg-gold text-black shadow-lg shadow-gold/20'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>⭐ Telegram Stars</span>
            {inTg && (
              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-black/20 text-black font-black">
                1-Click
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('ton')}
            className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeTab === 'ton'
                ? 'bg-gold text-black shadow-lg shadow-gold/20'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>💎 TON Blockchain</span>
            {wallet && (
              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-black/20 text-black font-black">
                Connected
              </span>
            )}
          </button>
        </div>

        {/* Plans Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {/* Starter Plan */}
          <div className="p-5 rounded-2xl border border-gold/40 bg-gold/5 flex flex-col justify-between space-y-4 hover:border-gold transition-all relative">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-gold-light">Starter Plan</span>
                <span className="text-xs font-mono text-gold font-bold">
                  {activeTab === 'stars' ? '2,500 ⭐' : '15 TON'}
                </span>
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Full AI visibility audits for up to 2 domains with monthly re-checks and plain-English action briefs.
              </p>
              <ul className="mt-3 space-y-1.5 text-[11px] text-gray-300">
                <li className="flex items-center gap-2">
                  <span className="text-gold">✓</span> Unlimited AI Search Queries
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-gold">✓</span> 2 Monitored Domains
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-gold">✓</span> PDF &amp; Google Docs Exports
                </li>
              </ul>
            </div>
            <button
              onClick={() => (activeTab === 'stars' ? handleStarsCheckout('starter') : handleTonCheckout('starter'))}
              disabled={busyPlan !== null}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase tracking-[0.2em] text-[10px] hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 shadow-lg"
            >
              {busyPlan === 'starter'
                ? 'Processing…'
                : activeTab === 'stars'
                ? 'Pay 2,500 Stars · 30 Days'
                : 'Pay 15 TON · 30 Days'}
            </button>
          </div>

          {/* Growth Plan */}
          <div className="p-5 rounded-2xl border border-white/15 bg-white/[0.02] flex flex-col justify-between space-y-4 hover:border-gold/60 transition-all relative">
            <div className="absolute -top-2.5 right-4 px-2.5 py-0.5 rounded-full bg-gold text-black font-black text-[9px] uppercase tracking-widest">
              Most Popular
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-white">Growth Plan</span>
                <span className="text-xs font-mono text-gold font-bold">
                  {activeTab === 'stars' ? '7,500 ⭐' : '45 TON'}
                </span>
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                10 domains, automated weekly audits, competitor citation graphs, and 24/7 Telegram Drift Sentinel alerts.
              </p>
              <ul className="mt-3 space-y-1.5 text-[11px] text-gray-300">
                <li className="flex items-center gap-2">
                  <span className="text-gold">✓</span> All Starter Features
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-gold">✓</span> 10 Domains + Competitor Graph
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-gold">✓</span> 24/7 Telegram Sentinel Alerts
                </li>
              </ul>
            </div>
            <button
              onClick={() => (activeTab === 'stars' ? handleStarsCheckout('growth') : handleTonCheckout('growth'))}
              disabled={busyPlan !== null}
              className="w-full py-3 rounded-xl bg-white text-black font-black uppercase tracking-[0.2em] text-[10px] hover:bg-gold-light hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 shadow-lg"
            >
              {busyPlan === 'growth'
                ? 'Processing…'
                : activeTab === 'stars'
                ? 'Pay 7,500 Stars · 30 Days'
                : 'Pay 45 TON · 30 Days'}
            </button>
          </div>
        </div>

        {/* TON Wallet Connect helper if in TON tab */}
        {activeTab === 'ton' && (
          <div className="p-4 rounded-2xl bg-black/40 border border-white/10 mb-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-left">
              <p className="text-xs font-bold text-white">TON Wallet Connection</p>
              <p className="text-[10px] text-gray-400">
                {wallet ? `Connected: ${wallet.account.address.slice(0, 8)}…${wallet.account.address.slice(-6)}` : 'Connect Tonkeeper, Telegram Wallet, or any TON wallet.'}
              </p>
            </div>
            <TonConnectButton />
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

        {/* BYOK alternative */}
        <div className="pt-4 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400">
          <p>
            Prefer your own models? <span className="text-gray-300">Add a Groq / NVIDIA / Ollama key after sign-in.</span>
          </p>
          <button
            onClick={() => {
              handleClose();
              if (onOpenSettings) onOpenSettings();
              else window.dispatchEvent(new CustomEvent('luminara-open-settings'));
            }}
            className="px-4 py-1.5 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-white font-medium text-[11px] transition-colors"
          >
            Open Settings
          </button>
        </div>

        <p className="mt-4 text-center text-[10px] text-gray-600">
          Produced by{' '}
          <a href="https://www.luminarasuite.com/" className="text-gold/80 hover:text-gold underline-offset-2 hover:underline">
            luminarasuite.com
          </a>
        </p>
      </div>
    </div>
  );
};
