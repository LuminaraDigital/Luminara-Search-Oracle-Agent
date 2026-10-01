import React, { useEffect } from 'react';
import { AuthPanel } from './AuthPanel';
import { isInTelegram } from '../../services/telegram/tma';
import type { AppAuthState } from '../../services/auth/useAppAuth';
import { BrandLoader } from '../intro/BrandLoader';

/**
 * Gated Product Access / Login Wall.
 * Standard for B2B SaaS and empirical diagnostic suites:
 * 1. Enables individual user memory (Business DNA, audits, history) across devices.
 * 2. Provides security, isolated tenancy, and verified auditability.
 * 3. Inside Telegram: identity is verified natively via Mini App initData.
 * 4. On the web: Google One-Click or Email/Password.
 */
export const AuthRequiredScreen: React.FC<{
  auth: AppAuthState;
  initialMode?: 'signin' | 'signup';
  onBackToMarketing?: () => void;
  isModal?: boolean;
  onClose?: () => void;
}> = ({ auth, initialMode = 'signin', onBackToMarketing, isModal, onClose }) => {
  // Prefer auth-hook Telegram signal (survives background init) over a one-shot module read.
  const inTelegram = Boolean(auth.retryTelegram) || isInTelegram();

  useEffect(() => {
    if (!isModal || !onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModal, onClose]);

  if (auth.loading) {
    return (
      <div className={`${isModal ? 'fixed inset-0 z-[80] bg-black/95' : 'min-h-screen bg-black'} text-ink flex items-center justify-center px-4 relative overflow-hidden`}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(191,149,63,0.12)_0%,transparent_55%)]" />
        <BrandLoader caption="Verifying your account session" />
      </div>
    );
  }

  const content = (
    <div className="relative w-full max-w-md space-y-5 my-auto max-h-[calc(100vh-2rem)]">
      {isModal && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-3 -right-2 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-gray-400 hover:text-white flex items-center justify-center transition-colors text-sm z-20 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          title="Close (Esc)"
          aria-label="Close login dialog"
        >
          ✕
        </button>
      )}

      <div className="text-center space-y-2">
        <h1 className="font-display font-normal text-4xl text-[var(--color-ink)] tracking-tight leading-[1.08]">
          {inTelegram ? 'Sign in with Telegram' : 'Sign in to Luminara Suite'}
        </h1>
        <p className="text-sm text-[var(--color-ink-2)] leading-relaxed max-w-sm mx-auto">
          {inTelegram
            ? 'Your Telegram account is your identity. Your saved audits, Stars entitlements, and Business DNA are linked to your session.'
            : 'Save audits, keep your business profile, and use hosted AI on web, Telegram, and desktop. Guests can still run Instant Audit with their own AI keys.'}
        </p>
      </div>

      {inTelegram ? (
        <div className="rounded-lg bg-[var(--color-paper-2)] border border-[var(--color-rule)] p-5 space-y-3">
          <p className="text-sm text-gray-300 leading-relaxed">
            {auth.reason || 'Could not verify Telegram. Close this view and open Luminara again from the bot menu.'}
          </p>
          {auth.retryTelegram && (
            <button
              type="button"
              onClick={() => auth.retryTelegram?.()}
              className="w-full rounded-xl bg-gold/15 border border-gold/40 text-gold text-xs font-bold uppercase tracking-wider py-2.5 hover:bg-gold/25 transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              Retry Telegram sign-in
            </button>
          )}
        </div>
      ) : (
        <AuthPanel initialMode={initialMode} />
      )}

      {onBackToMarketing && !inTelegram && !isModal && (
        <button
          type="button"
          onClick={onBackToMarketing}
          className="w-full text-xs text-gray-400 hover:text-gold transition-colors py-1 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded"
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
        className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/95 overflow-y-auto"
      >
        <div className="absolute inset-0" onClick={onClose} />
        {content}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-ink flex items-center justify-center px-4 py-10 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(191,149,63,0.08)_0%,transparent_55%)]" />
      {content}
    </div>
  );
};
