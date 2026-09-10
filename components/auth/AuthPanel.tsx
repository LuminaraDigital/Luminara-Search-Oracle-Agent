import React, { useEffect, useState } from 'react';
import {
  isFirebaseConfigured,
  subscribeFirebaseUser,
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  resetPasswordWithEmail,
  signOutFirebase,
  friendlyFirebaseError,
} from '../../services/auth/firebaseAuthService';
import { isInTelegram } from '../../services/telegram/tma';
import { linkTelegramFirebaseAccounts } from '../../services/apiClient';
import { pullWorkspaceOnLogin } from '../../services/sync/workspaceSyncService';
import { Button } from '../ui/Button';

type Mode = 'signin' | 'signup';

const GoogleIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24">
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

/**
 * Email/password + Google signup/signin via Firebase Auth (web).
 * Inside Telegram Mini App, Telegram is primary; optional Firebase link merges
 * Stars/TON entitlements and workspace with the website account.
 */
export const AuthPanel: React.FC<{ compact?: boolean; initialMode?: Mode }> = ({ compact, initialMode = 'signin' }) => {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [userLabel, setUserLabel] = useState<string | null>(null);
  const configured = isFirebaseConfigured();
  const inTelegram = isInTelegram();

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
        await signInWithGoogle();
      }
      const linked = await linkTelegramFirebaseAccounts();
      if (!linked.ok) throw new Error(linked.error || 'Could not link accounts');
      await pullWorkspaceOnLogin();
      setInfo('Linked. Stars/TON in Telegram and TON on the website now share one plan and saved work.');
    } catch (e) {
      setError(e instanceof Error ? e.message : friendlyFirebaseError(e));
    } finally {
      setBusy(false);
    }
  };

  if (inTelegram) {
    return (
      <div className={`glass-morphism rounded-2xl border border-gold/30 ${compact ? 'p-4 space-y-3' : 'p-5 space-y-4'}`}>
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gold">Account</p>
        <p className="text-sm text-gray-200 font-medium">Signed in with Telegram</p>
        <p className="text-xs text-gray-400 leading-relaxed">
          To keep the same paid plan and saved work on luminarasuite.com, link a Google or email account once.
        </p>
        {configured && (
          <Button variant="secondary" disabled={busy} onClick={() => void linkWebAccount()} className="w-full text-xs">
            {userLabel ? 'Link this web account' : 'Link Google / email account'}
          </Button>
        )}
        {userLabel && <p className="text-[11px] text-gold/80 truncate">Web login: {userLabel}</p>}
        {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
        {info && <p className="text-xs text-emerald-400" role="status">{info}</p>}
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="glass-morphism rounded-2xl border border-white/10 p-5 space-y-2">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gold">Account</p>
        <p className="text-xs text-gray-400 leading-relaxed">
          Firebase Auth is not configured yet. Add <span className="font-mono text-gray-300">VITE_FIREBASE_*</span> to
          your env and set <span className="font-mono text-gray-300">FIREBASE_PROJECT_ID</span> on the Worker.
        </p>
      </div>
    );
  }

  if (userLabel) {
    return (
      <div className={`glass-morphism rounded-2xl border border-gold/30 ${compact ? 'p-4 space-y-3' : 'p-5 space-y-4'}`}>
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gold">Account</p>
        <p className="text-sm text-gray-200 font-medium truncate">{userLabel}</p>
        <p className="text-xs text-gray-400 leading-relaxed">
          Signed in with Firebase. Hosted AI keys and saved workspace use this account. Inside Telegram, use Link so Stars payments follow you on the web.
        </p>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => run(() => signOutFirebase())}
          className="w-full text-xs"
        >
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <div className={`glass-morphism rounded-2xl border border-white/10 ${compact ? 'p-4 space-y-3' : 'p-5 space-y-4'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gold">Account</p>
        <div className="flex gap-1 text-[10px] font-bold uppercase tracking-wider">
          <button
            type="button"
            className={`px-2 py-1 rounded ${mode === 'signin' ? 'bg-gold/20 text-gold-light' : 'text-gray-500 hover:text-gray-300'}`}
            onClick={() => { setMode('signin'); setError(null); setInfo(null); }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`px-2 py-1 rounded ${mode === 'signup' ? 'bg-gold/20 text-gold-light' : 'text-gray-500 hover:text-gray-300'}`}
            onClick={() => { setMode('signup'); setError(null); setInfo(null); }}
          >
            Sign up
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed">
        Web accounts use Firebase. Open the Mini App in Telegram and tap Link so Stars and website TON share one plan.
      </p>

      <form
        className="space-y-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === 'signup') {
            void run(() => signUpWithEmail(email, password));
          } else {
            void run(() => signInWithEmail(email, password));
          }
        }}
      >
        <label className="block space-y-1">
          <span className="text-[10px] font-mono uppercase text-gray-500">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-gray-100 outline-none focus:border-gold/50"
            placeholder="you@example.com"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] font-mono uppercase text-gray-500">Password</span>
          <input
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-gray-100 outline-none focus:border-gold/50"
            placeholder="At least 6 characters"
          />
        </label>
        {mode === 'signin' && (
          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy || !email.trim()}
              className="text-[10px] font-bold uppercase tracking-wider text-gray-500 hover:text-gold disabled:opacity-40"
              onClick={() => run(async () => {
                await resetPasswordWithEmail(email);
                setInfo('Password reset email sent. Check your inbox.');
              })}
            >
              Forgot password?
            </button>
          </div>
        )}
        {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
        {info && <p className="text-xs text-emerald-400" role="status">{info}</p>}
        <Button type="submit" disabled={busy || !email || password.length < 6} className="w-full text-xs">
          {busy ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <div className="relative py-1">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10" /></div>
        <div className="relative flex justify-center"><span className="px-2 text-[10px] uppercase tracking-wider text-gray-500 bg-transparent">or</span></div>
      </div>

      <Button
        variant="secondary"
        disabled={busy}
        className="w-full text-xs flex items-center justify-center gap-2 font-medium"
        onClick={() => run(() => signInWithGoogle())}
      >
        <GoogleIcon className="w-4 h-4" />
        Continue with Google
      </Button>
    </div>
  );
};
