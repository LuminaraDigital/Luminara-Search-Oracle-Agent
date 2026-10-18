import React, { useCallback, useEffect, useId, useState } from 'react';
import {
  isFirebaseConfigured,
  subscribeFirebaseUser,
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  resetPasswordWithEmail,
  signOutFirebase,
  friendlyFirebaseError,
  MIN_PASSWORD_LENGTH,
} from '../../services/auth/firebaseAuthService';
import { isInTelegram } from '../../services/telegram/tma';
import { linkTelegramFirebaseAccounts } from '../../services/apiClient';
import { pullWorkspaceOnLogin } from '../../services/sync/workspaceSyncService';
import { productTelemetry } from '../../services/analytics/productTelemetry';
import '../marketing/space.css';
import { ConfirmModal } from '../ui/ConfirmModal';

export type AuthMode = 'signin' | 'signup';

const GoogleIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
    />
  </svg>
);

const EyeIcon: React.FC<{ open: boolean; className?: string }> = ({ open, className = 'w-4 h-4' }) =>
  open ? (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );

/**
 * Email/password + Google signup/signin via Firebase Auth (web).
 * Inside Telegram Mini App, Telegram is primary; optional Firebase link merges
 * Stars/TON entitlements and workspace with the website account.
 */
export const AuthPanel: React.FC<{
  compact?: boolean;
  initialMode?: AuthMode;
  mode?: AuthMode;
  onModeChange?: (mode: AuthMode) => void;
  chromeless?: boolean;
}> = ({ compact, initialMode = 'signin', mode: controlledMode, onModeChange, chromeless = false }) => {
  const baseId = useId();
  const emailId = `${baseId}-email`;
  const passwordId = `${baseId}-password`;
  const [internalMode, setInternalMode] = useState<AuthMode>(initialMode);
  const mode = controlledMode ?? internalMode;

  const setMode = useCallback(
    (next: AuthMode) => {
      setInternalMode(next);
      onModeChange?.(next);
    },
    [onModeChange],
  );

  useEffect(() => {
    setInternalMode(initialMode);
  }, [initialMode]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [userLabel, setUserLabel] = useState<string | null>(null);
  const [linkConfirmOpen, setLinkConfirmOpen] = useState(false);
  const configured = isFirebaseConfigured();
  const inTelegram = isInTelegram();
  const closeLinkConfirm = useCallback(() => setLinkConfirmOpen(false), []);

  useEffect(() => {
    if (!configured) return;
    return subscribeFirebaseUser((u) => {
      setUserLabel(u ? (u.email || u.displayName || 'Signed in') : null);
    });
  }, [configured]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
      setPassword('');
    } catch (e) {
      setError(friendlyFirebaseError(e));
    } finally {
      setBusy(false);
    }
  };

  const linkWebAccount = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (!userLabel) {
        await signInWithGoogle({ keepSignedIn });
      }
      setLinkConfirmOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : friendlyFirebaseError(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmLink = async () => {
    setLinkConfirmOpen(false);
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const linked = await linkTelegramFirebaseAccounts({ confirm: true });
      if (!linked.ok) throw new Error(linked.error || 'Could not link accounts');
      await pullWorkspaceOnLogin();
      setInfo('Linked. Telegram and the website now share one plan and saved work.');
    } catch (e) {
      setError(e instanceof Error ? e.message : friendlyFirebaseError(e));
    } finally {
      setBusy(false);
    }
  };

  if (inTelegram) {
    return (
      <div className={chromeless ? 'space-y-4' : `lx-glass rounded-3xl ${compact ? 'p-4 space-y-3' : 'p-6 space-y-4'}`}>
        {!chromeless && <p className="lx-eyebrow">Account</p>}
        <p className="text-sm text-ink font-medium">Signed in with Telegram</p>
        <p className="text-sm text-[var(--color-ink-2)] leading-relaxed">
          Link Telegram and web account - shares subscription. Confirm in the dialog before plans are shared. Opening the Mini App while you are signed in on the web does not merge accounts.
        </p>
        {configured && (
          <button type="button" disabled={busy} onClick={() => void linkWebAccount()} className="lx-btn lx-btn-ghost w-full whitespace-normal text-center disabled:opacity-50">
            Link Telegram and web account - shares subscription
          </button>
        )}
        {userLabel && <p className="text-xs text-gold-light/85 truncate">Web login: {userLabel}</p>}
        {error && <p className="text-xs text-danger-400" role="alert">{error}</p>}
        {info && <p className="text-xs text-success-400" role="status">{info}</p>}
        <ConfirmModal
          open={linkConfirmOpen}
          title="Link Telegram and web account - shares subscription"
          description="This shares one subscription and saved workspace between this Telegram login and the web account. Nothing is merged until you confirm."
          confirmLabel="Link accounts"
          cancelLabel="Cancel"
          onConfirm={() => { void confirmLink(); }}
          onCancel={closeLinkConfirm}
        />
      </div>
    );
  }

  if (!configured) {
    return (
      <div className={chromeless ? 'rounded-2xl border border-gold/15 bg-black/40 p-4 space-y-2' : 'lx-glass rounded-3xl p-6 space-y-2'}>
        {!chromeless && <p className="lx-eyebrow">Account</p>}
        <p className="text-sm text-[var(--color-ink-2)] leading-relaxed">
          Firebase Auth is not configured yet. Add <span className="font-mono text-gray-300">VITE_FIREBASE_*</span> to
          your env and set <span className="font-mono text-gray-300">FIREBASE_PROJECT_ID</span> on the Worker.
        </p>
      </div>
    );
  }

  if (userLabel) {
    return (
      <div className={chromeless ? 'space-y-4' : `lx-glass rounded-3xl ${compact ? 'p-4 space-y-3' : 'p-6 space-y-4'}`}>
        {!chromeless && <p className="lx-eyebrow">Account</p>}
        <p className="text-sm text-ink font-medium truncate">{userLabel}</p>
        <p className="text-sm text-[var(--color-ink-2)] leading-relaxed">
          Signed in with Firebase. Hosted AI keys and saved workspace use this account. Inside Telegram, confirm "Link Telegram and web account - shares subscription" so Stars payments follow you on the web.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => signOutFirebase())}
          className="lx-btn lx-btn-ghost w-full disabled:opacity-50"
        >
          Sign out
        </button>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Enter a valid email address.');
      return;
    }
    if (mode === 'signup' && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use a password with at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (mode === 'signup') {
      void run(async () => {
        await signUpWithEmail(trimmedEmail, password, { keepSignedIn });
        productTelemetry.track('signup_completed', { method: 'email' });
      });
    } else {
      void run(async () => {
        await signInWithEmail(trimmedEmail, password, { keepSignedIn });
      });
    }
  };

  const handlePasswordReset = () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Enter your email address above, then click Reset password.');
      return;
    }
    void run(async () => {
      const result = await resetPasswordWithEmail(trimmedEmail);
      setInfo(result.message);
    });
  };

  const wrapperClass = chromeless
    ? 'space-y-5'
    : `lx-glass rounded-3xl ${compact ? 'p-4 space-y-3.5' : 'p-6 space-y-5'}`;

  return (
    <div className={wrapperClass}>
      {!chromeless && (
        <div className="flex items-center justify-between gap-2">
          <p className="lx-eyebrow">Account</p>
          <div className="flex gap-1 rounded-full border border-gold/20 bg-black/40 p-1 text-sm">
            <button
              type="button"
              className={`px-3.5 py-1.5 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${mode === 'signin' ? 'bg-gold/15 text-gold-light' : 'text-[var(--color-ink-2)] hover:text-ink'}`}
              onClick={() => { setMode('signin'); setError(null); setInfo(null); }}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`px-3.5 py-1.5 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${mode === 'signup' ? 'bg-gold/15 text-gold-light' : 'text-[var(--color-ink-2)] hover:text-ink'}`}
              onClick={() => { setMode('signup'); setError(null); setInfo(null); }}
            >
              Sign up
            </button>
          </div>
        </div>
      )}

      {!chromeless && (
        <p className="text-sm text-[var(--color-ink-2)] leading-relaxed">
          Web accounts use Firebase. Open the Mini App in Telegram and confirm "Link Telegram and web account - shares subscription" so Telegram and the website share one plan.
        </p>
      )}

      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <div className="space-y-1.5">
          <label htmlFor={emailId} className="block text-sm text-ink">
            Email
          </label>
          <div className="rounded-xl border border-gold/20 bg-black/50 transition-colors focus-within:border-gold/60">
            <input
              id={emailId}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
              className="w-full rounded-xl bg-transparent px-4 py-3.5 text-base text-ink placeholder:text-ink/40 outline-none"
              placeholder="Enter your email address"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor={passwordId} className="block text-sm text-ink">
              Password
            </label>
            {mode === 'signup' && (
              <span className={`text-xs ${password.length >= MIN_PASSWORD_LENGTH ? 'text-success-400' : 'text-[var(--color-ink-2)]'}`}>
                {password.length >= MIN_PASSWORD_LENGTH ? `${MIN_PASSWORD_LENGTH}+ characters` : `Min. ${MIN_PASSWORD_LENGTH} characters`}
              </span>
            )}
          </div>
          <div className="relative rounded-xl border border-gold/20 bg-black/50 transition-colors focus-within:border-gold/60">
            <input
              id={passwordId}
              type={showPassword ? 'text' : 'password'}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              required
              minLength={mode === 'signup' ? MIN_PASSWORD_LENGTH : 1}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              className="w-full rounded-xl bg-transparent pl-4 pr-11 py-3.5 text-base text-ink placeholder:text-ink/40 outline-none"
              placeholder={mode === 'signup' ? `Create a password (min. ${MIN_PASSWORD_LENGTH} characters)` : 'Enter your password'}
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute inset-y-0 right-2 my-auto h-9 w-9 flex items-center justify-center rounded-lg text-neutral-400 hover:text-[var(--color-ink)] transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              <EyeIcon open={showPassword} className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-xs">
          <label className="inline-flex items-center gap-2.5 cursor-pointer select-none text-[var(--color-ink-2)] hover:text-[var(--color-ink)] transition-colors">
            <input
              type="checkbox"
              checked={keepSignedIn}
              onChange={(e) => setKeepSignedIn(e.target.checked)}
              className="sr-only peer"
            />
            <span className="w-4 h-4 rounded-md border border-white/25 bg-surface flex items-center justify-center transition-colors peer-checked:bg-gold peer-checked:border-gold peer-focus-visible:ring-2 peer-focus-visible:ring-gold-light">
              {keepSignedIn && (
                <svg className="w-2.5 h-2.5 text-black" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="2 6.5 4.8 9.2 10 3" />
                </svg>
              )}
            </span>
            <span>Keep me signed in</span>
          </label>

          {mode === 'signin' && (
            <button
              type="button"
              disabled={busy}
              onClick={handlePasswordReset}
              className="lx-link text-xs disabled:opacity-40"
            >
              Reset password
            </button>
          )}
        </div>

        {error && (
          <div className="rounded-xl border border-danger-500/30 bg-danger-500/10 px-3.5 py-2.5 text-xs text-danger-300 leading-relaxed" role="alert">
            {error}
          </div>
        )}
        {info && (
          <div className="rounded-xl border border-success-500/30 bg-success-500/10 px-3.5 py-2.5 text-xs text-success-300 leading-relaxed" role="status">
            {info}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="lx-btn lx-btn-gold w-full disabled:opacity-50 disabled:pointer-events-none"
        >
          {busy ? 'Working...' : mode === 'signup' ? 'Create free account' : 'Sign in'}
        </button>
      </form>

      <div className="flex items-center gap-3 py-1">
        <div className="h-px flex-1 bg-gold/15" />
        <span className="text-xs text-[var(--color-ink-2)]">Or continue with</span>
        <div className="h-px flex-1 bg-gold/15" />
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await signInWithGoogle({ keepSignedIn });
            if (mode === 'signup') {
              productTelemetry.track('signup_completed', { method: 'google' });
            }
          })
        }
        className="lx-btn lx-btn-ghost w-full disabled:opacity-50"
      >
        <GoogleIcon className="w-4 h-4" />
        <span>Continue with Google</span>
      </button>

      <p className="text-center text-sm text-[var(--color-ink-2)] pt-1">
        {mode === 'signin' ? (
          <>
            New to Luminara?{' '}
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setError(null);
                setInfo(null);
              }}
              className="lx-link"
            >
              Create a free account
            </button>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setError(null);
                setInfo(null);
              }}
              className="lx-link"
            >
              Sign in
            </button>
          </>
        )}
      </p>
    </div>
  );
};
