import React, { useEffect, useRef } from 'react';
import { AuthPanel } from './AuthPanel';
import { isInTelegram, getTelegramUserUnsafe } from '../../services/telegram/tma';
import type { AppAuthState } from '../../services/auth/useAppAuth';
import { MINI_APP_URL, botUsernameFromMiniAppUrl } from '../../services/referrals/rules';
import { BrandLoader } from '../intro/BrandLoader';
import { ICONS } from '../../constants';
import '../marketing/space.css';

/**
 * Gated Product Access / Login Wall.
 * Standard for B2B SaaS and empirical diagnostic suites:
 * 1. Enables individual user memory (Business DNA, audits, history) across devices.
 * 2. Provides security, isolated tenancy, and verified auditability.
 * 3. Inside Telegram: identity is verified natively via Mini App initData.
 * 4. On the web: Google One-Click or Email/Password.
 */
function featureExplanation(view?: string): string | null {
  switch (view) {
    case 'ORACLE_AGENT':
      return 'Oracle Chat requires an account to ground conversations in your verified Business DNA and preserve message memory.';
    case 'BRAND_MEMORY':
      return 'Brand Memory requires an account to securely save and synchronize your company facts across devices.';
    case 'NOTEBOOK':
      return 'Studio requires an account to save interactive audit notebooks and research history.';
    case 'BUSINESS_DNA':
      return 'Business DNA requires an account to establish verified entity ownership and private tenant storage.';
    default:
      return null;
  }
}

export const AuthRequiredScreen: React.FC<{
  auth: AppAuthState;
  featureView?: string;
  initialMode?: 'signin' | 'signup';
  onBackToMarketing?: () => void;
  isModal?: boolean;
  onClose?: () => void;
}> = ({ auth, featureView, initialMode = 'signin', onBackToMarketing, isModal, onClose }) => {
  // Prefer auth-hook Telegram signal (survives background init) over a one-shot module read.
  const inTelegram = Boolean(auth.retryTelegram) || isInTelegram();
  const tgUser = inTelegram ? getTelegramUserUnsafe() : null;

  useEffect(() => {
    if (!isModal || !onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModal, onClose]);

  // Move focus into the dialog so keyboard and screen reader users start in the form.
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isModal || auth.loading) return;
    const root = contentRef.current;
    (root?.querySelector<HTMLElement>('input') ?? root?.querySelector<HTMLElement>('button'))?.focus();
  }, [isModal, auth.loading]);

  if (auth.loading) {
    return (
      <div className={`${isModal ? 'fixed inset-0 z-[80] bg-black/95' : 'min-h-[100dvh] bg-black'} text-ink flex items-center justify-center px-4 relative overflow-hidden`}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_35%_20%,rgba(191,149,63,0.14)_0%,transparent_52%)]" />
        <BrandLoader caption={inTelegram ? 'Opening your Mini App session' : 'Verifying your account session'} />
      </div>
    );
  }

  const content = (
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
        {inTelegram ? (
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
        ) : null}
        <h1 className="lx-display text-[2.4rem] sm:text-5xl">
          {inTelegram
            ? 'Confirm your Telegram session'
            : initialMode === 'signup'
              ? 'Create your free account'
              : 'Sign in to Luminara Suite'}
        </h1>
        {featureExplanation(featureView) && (
          <div className="lx-glass rounded-2xl p-4 text-sm text-gold-light max-w-sm mx-auto text-left leading-relaxed">
            <span className="lx-eyebrow block mb-1.5">Account required</span>
            {featureExplanation(featureView)}
          </div>
        )}
        <p className="text-sm text-[var(--color-ink-2)] leading-relaxed max-w-sm mx-auto">
          {inTelegram
            ? tgUser?.first_name
              ? `${tgUser.first_name}, we could not verify this open. Reopen from the bot menu or retry below.`
              : 'Your Telegram account is your identity. Audits, Stars, and Business DNA stay tied to this session.'
            : 'Save audits, keep your business profile, and use hosted AI on web, Telegram, and desktop. Guests can still run Instant Audit with their own AI keys.'}
        </p>
      </div>

      {inTelegram ? (
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
      ) : (
        <AuthPanel initialMode={initialMode} />
      )}

      {onBackToMarketing && !inTelegram && !isModal && (
        <button
          type="button"
          onClick={onBackToMarketing}
          className="lx-link mx-auto block text-sm"
        >
          ← Back to home
        </button>
      )}
    </div>
  );

  if (isModal) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Account access"
        className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/95 overflow-y-auto overflow-x-hidden"
      >
        <div aria-hidden className="lx-stars pointer-events-none fixed inset-0 opacity-70" />
        <div aria-hidden className="lx-horizon pointer-events-none fixed top-[80%]" />
        <div className="absolute inset-0" onClick={onClose} />
        {content}
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-black text-ink flex items-center justify-center px-4 py-10 relative overflow-hidden">
      <div aria-hidden className="lx-stars pointer-events-none absolute inset-0 opacity-70" />
      <div aria-hidden className="lx-horizon pointer-events-none top-[82%]" />
      {content}
    </div>
  );
};
