import React, { useEffect, useState } from 'react';
import {
  isFirebaseConfigured,
  subscribeFirebaseUser,
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  signOutFirebase,
  friendlyFirebaseError,
} from '../../services/auth/firebaseAuthService';
import { Button } from '../ui/Button';

type Mode = 'signin' | 'signup';

/**
 * Email/password + Google signup/signin via Firebase Auth.
 * Shown in Settings when VITE_FIREBASE_* is configured.
 */
export const AuthPanel: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [userLabel, setUserLabel] = useState<string | null>(null);
  const configured = isFirebaseConfigured();

  useEffect(() => {
    if (!configured) return;
    return subscribeFirebaseUser((u) => {
      setUserLabel(u ? (u.email || u.displayName || 'Signed in') : null);
    });
  }, [configured]);

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

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setPassword('');
    } catch (e) {
      setError(friendlyFirebaseError(e));
    } finally {
      setBusy(false);
    }
  };

  if (userLabel) {
    return (
      <div className={`glass-morphism rounded-2xl border border-gold/30 ${compact ? 'p-4 space-y-3' : 'p-5 space-y-4'}`}>
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gold">Account</p>
        <p className="text-sm text-gray-200 font-medium truncate">{userLabel}</p>
        <p className="text-xs text-gray-400 leading-relaxed">
          Signed in with Firebase. Hosted AI keys on Cloudflare use this session (same daily free limit as Telegram).
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
            onClick={() => { setMode('signin'); setError(null); }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`px-2 py-1 rounded ${mode === 'signup' ? 'bg-gold/20 text-gold-light' : 'text-gray-500 hover:text-gray-300'}`}
            onClick={() => { setMode('signup'); setError(null); }}
          >
            Sign up
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed">
        Create an account to use Luminara-hosted AI keys on the Cloudflare Worker without Telegram.
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
        {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
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
        className="w-full text-xs"
        onClick={() => run(() => signInWithGoogle())}
      >
        Continue with Google
      </Button>
    </div>
  );
};
