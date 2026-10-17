import React, { useEffect, useId, useRef, useState } from 'react';
import { AuthPanel, type AuthMode } from './AuthPanel';
import { isInTelegram, getTelegramUserUnsafe } from '../../services/telegram/tma';
import type { AppAuthState } from '../../services/auth/useAppAuth';
import { MINI_APP_URL, botUsernameFromMiniAppUrl } from '../../services/referrals/rules';
import { BrandLoader } from '../intro/BrandLoader';
import { ICONS } from '../../constants';
import '../marketing/space.css';

const FREE_ACCOUNT_POINTS = [
  'Checks across Google Search, AI Overviews, ChatGPT and Perplexity.',
  'Every result labeled Measured, Estimated or Not measured.',
  'One fix to ship first, with copy and schema ready to paste.',
  'A daily hosted allowance. No card needed.',
] as const;

/**
 * Gated Product Access / Login Wall.
 * Standard for B2B SaaS and empirical diagnostic suites:
 * 1. Enables individual user memory (Business DNA, audits, history) across devices.
 * 2. Provides security, isolated tenancy, and verified auditability.
 * 3. Inside Telegram: identity is verified natively via Mini App initData.
 * 4. On the web: Google One-Click or Email/Password in a modern 2-column split studio.
 */
function featureExplanation(view?: string): string | null {
  switch (view) {
    case 'ORACLE_AGENT':
      return 'Ask requires an account to ground conversations in your verified Business DNA and preserve message memory.';
    case 'BRAND_MEMORY':
      return 'Brand Memory requires an account to securely save and synchronize your company facts across devices.';
    case 'NOTEBOOK':
      return 'Studio requires an account to save interactive audit notebooks and research history.';
    case 'BUSINESS_DNA':
      return 'Business DNA requires an account to establish verified entity ownership and private tenant storage.';
    case 'DASHBOARD':
      return 'Workspace requires an account to load your saved audits, readiness metrics, and tracked domains.';
    case 'AGENT_REPORT':
      return 'Agent Reports require an account to view and manage saved diagnostic reports.';
    default:
      return null;
  }
}

export const AuthRequiredScreen: React.FC<{
  auth: AppAuthState;
  featureView?: string;
  initialMode?: AuthMode;
  onBackToMarketing?: () => void;
  isModal?: boolean;
  onClose?: () => void;
}> = ({ auth, featureView, initialMode = 'signin', onBackToMarketing, isModal, onClose }) => {
  const headingId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<AuthMode>(initialMode);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  // Prefer auth-hook Telegram signal (survives background init) over a one-shot module read.
  const inTelegram = Boolean(auth.retryTelegram) || isInTelegram();
  const tgUser = inTelegram ? getTelegramUserUnsafe() : null;

  useEffect(() => {
    if (!isModal || !onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModal, onClose]);

  useEffect(() => {
    if (!isModal || auth.loading) return;
    // Start in the form: the email field, not the close button that comes first in the DOM.
    const root = contentRef.current;
    (root?.querySelector<HTMLElement>('input') ?? root?.querySelector<HTMLElement>('button'))?.focus();
  }, [isModal, auth.loading]);

  if (auth.loading) {
    return (
      <div className={`${isModal ? 'fixed inset-0 z-[80] bg-black/95' : 'min-h-[100dvh] bg-black'} text-ink flex items-center justify-center px-4 relative overflow-hidden`}>
        <div aria-hidden className="lx-stars pointer-events-none absolute inset-0 opacity-70" />
        <BrandLoader caption={inTelegram ? 'Opening your Mini App session' : 'Verifying your account session'} />
      </div>
    );
  }

  if (inTelegram) {
    const tgContent = (
      <div ref={contentRef} className="relative w-full max-w-md space-y-6 my-auto max-h-[calc(100dvh-2rem)]">
        {isModal && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute -top-3 -right-2 w-10 h-10 rounded-full bg-black/70 border border-gold/25 hover:border-gold/50 text-[var(--color-ink-2)] hover:text-ink flex items-center justify-center transition-colors text-sm z-20 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            title="Close (Esc)"
            aria-label="Close login dialog"
          >
            ✕
          </button>
        )}

        <div className="text-center space-y-3">
          <div className="mx-auto flex flex-col items-center gap-3">
            {tgUser?.photo_url ? (
              <img
                src={tgUser.photo_url}
                alt=""
                className="w-14 h-14 rounded-full border border-gold/35 object-cover"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-gold/15 border border-gold/35 flex items-center justify-center">
                <ICONS.LuminaraLogo className="w-8 h-8" />
              </div>
            )}
            <p className="lx-eyebrow">Telegram Mini App</p>
          </div>
          <h1 id={headingId} className="lx-display text-[2.4rem] sm:text-5xl">
            Confirm your Telegram session
          </h1>
          {featureExplanation(featureView) && (
            <div className="lx-glass rounded-2xl p-4 text-sm text-gold-light max-w-sm mx-auto text-left leading-relaxed">
              <span className="lx-eyebrow block mb-1.5">Account required</span>
              {featureExplanation(featureView)}
            </div>
          )}
          <p className="text-sm text-[var(--color-ink-2)] leading-relaxed max-w-sm mx-auto">
            {tgUser?.first_name
              ? `${tgUser.first_name}, we could not verify this open. Reopen from the bot menu or retry below.`
              : 'Your Telegram account is your identity. Audits, Stars, and Business DNA stay tied to this session.'}
          </p>
        </div>

        <div className="lx-glass rounded-3xl p-6 space-y-4">
          <p className="text-sm text-[var(--color-ink-2)] leading-relaxed">
            {auth.reason || 'Could not verify Telegram. Close this view and open Luminara again from the bot menu.'}
          </p>
          {auth.retryTelegram && (
            <button
              type="button"
              onClick={() => auth.retryTelegram?.()}
              className="lx-btn lx-btn-gold w-full"
            >
              Retry Telegram sign-in
            </button>
          )}
          <p className="text-xs text-[var(--color-ink-2)] leading-relaxed text-center">
            Tip: close the Mini App fully, then open it again from @{botUsernameFromMiniAppUrl(MINI_APP_URL)}.
          </p>
        </div>
      </div>
    );

    return isModal ? (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-label="Account access"
        className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/95 overflow-y-auto overflow-x-hidden"
      >
        <div aria-hidden className="lx-stars pointer-events-none fixed inset-0 opacity-70" />
        <div className="absolute inset-0" onClick={onClose} />
        {tgContent}
      </div>
    ) : (
      <div className="min-h-[100dvh] bg-black text-ink flex items-center justify-center px-4 py-10 relative overflow-hidden">
        <div aria-hidden className="lx-stars pointer-events-none absolute inset-0 opacity-70" />
        <div aria-hidden className="lx-horizon pointer-events-none top-[82%]" />
        {tgContent}
      </div>
    );
  }

  const featureNote = featureExplanation(featureView);

  const webSplitCard = (
    <div ref={contentRef} className="lx-glass relative z-10 w-full max-w-[1040px] my-auto rounded-[28px] overflow-hidden grid grid-cols-1 lg:grid-cols-12">
      {isModal && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/70 border border-gold/25 hover:border-gold/50 text-[var(--color-ink-2)] hover:text-ink flex items-center justify-center transition-colors text-sm z-30 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          title="Close (Esc)"
          aria-label="Close login dialog"
        >
          ✕
        </button>
      )}

      {/* Left Column: Sign In / Sign Up Form */}
      <div className="lg:col-span-6 p-6 sm:p-10 md:p-12 flex flex-col justify-center">
        <div className="w-full max-w-md mx-auto space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-gold/15 border border-gold/40 flex items-center justify-center">
                <ICONS.LuminaraLogo className="w-4 h-4" />
              </div>
              <span className="font-serif text-lg text-ink">Luminara Suite</span>
            </div>

            {onBackToMarketing && !isModal && (
              <button
                type="button"
                onClick={onBackToMarketing}
                className="lx-link text-sm"
              >
                ← Back to home
              </button>
            )}
          </div>

          <div className="space-y-2">
            <h1 id={headingId} className="lx-display text-[2.4rem] sm:text-5xl">
              {mode === 'signup' ? 'Create your free account' : 'Welcome back'}
            </h1>
            <p className="text-sm text-[var(--color-ink-2)] leading-relaxed">
              {mode === 'signup'
                ? 'Start your Luminara Suite account to save audits, build your Business DNA, and run hosted AI visibility diagnostics.'
                : 'Access your account and continue your journey with us across web, Telegram, and desktop.'}
            </p>
          </div>

          {featureNote && (
            <div className="lx-glass rounded-2xl p-4 text-sm text-gold-light leading-relaxed">
              <span className="lx-eyebrow block mb-1.5">Account required</span>
              {featureNote}
            </div>
          )}

          <AuthPanel
            initialMode={initialMode}
            mode={mode}
            onModeChange={setMode}
            chromeless
          />
        </div>
      </div>

      {/* Right column: space panel with what the free account unlocks */}
      <div className="hidden lg:flex lg:col-span-6 p-3.5">
        <div className="relative w-full min-h-[580px] rounded-[22px] overflow-hidden border border-gold/25 bg-black flex flex-col p-8">
          <div aria-hidden="true" className="lx-stars pointer-events-none absolute inset-0 opacity-90" />
          <div aria-hidden="true" className="lx-horizon pointer-events-none !w-[1300px] top-[70%]" />
          <div className="relative z-10">
            <p className="lx-eyebrow">Free account</p>
            <p className="mt-5 font-serif text-[2.6rem] leading-[1.02] text-[var(--color-ink)]">
              See what AI says <span className="italic lx-gold-text">about you.</span>
            </p>
            <ul className="mt-8 space-y-4 list-none p-0 m-0">
              {FREE_ACCOUNT_POINTS.map((point) => (
                <li key={point} className="flex gap-3 text-sm leading-relaxed text-[var(--color-ink-2)]">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <p className="relative z-10 mt-auto text-xs text-[var(--color-ink-2)]">
            One account works on the web, Windows, Telegram and MCP.
          </p>
        </div>
      </div>
    </div>
  );

  if (isModal) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-label="Account access"
        className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/90 overflow-y-auto overflow-x-hidden"
      >
        <div aria-hidden className="lx-stars pointer-events-none fixed inset-0 opacity-70" />
        <div className="absolute inset-0" onClick={onClose} />
        {webSplitCard}
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-black text-ink flex items-center justify-center px-4 py-8 sm:py-10 relative overflow-hidden">
      <div aria-hidden className="lx-stars pointer-events-none absolute inset-0 opacity-70" />
      <div aria-hidden className="lx-horizon pointer-events-none top-[84%]" />
      {webSplitCard}
    </div>
  );
};
