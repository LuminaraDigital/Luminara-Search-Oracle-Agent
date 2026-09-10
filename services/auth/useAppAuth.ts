/**
 * App-level auth: Telegram Mini App initData OR Firebase (web).
 * Marketing pages stay public; product tools require a signed-in account.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  isInTelegram,
  getInitDataRaw,
  whenTelegramReady,
  subscribeTelegramReady,
} from '../telegram/tma';
import {
  isFirebaseConfigured,
  subscribeFirebaseUser,
  startFirebaseAuthListener,
  type User,
} from './firebaseAuthService';
import { telegramAuth } from '../apiClient';

export type AppAuthSource = 'telegram' | 'firebase' | null;

export type AppAuthState = {
  /** Still resolving Telegram session or Firebase listener. */
  loading: boolean;
  /** True when the user may use product tools. */
  authenticated: boolean;
  source: AppAuthSource;
  label: string | null;
  /** Human-readable reason when blocked. */
  reason: string | null;
  /** Re-check Telegram initData after a failed first pass. */
  retryTelegram?: () => void;
};

/**
 * Views that stay reachable without an account (marketing + legal).
 * Everything else requires Telegram (inside TMA) or Firebase (web).
 */
export const PUBLIC_APP_VIEWS = new Set([
  'LANDING',
  'PRIVACY',
  'TERMS',
  'INFRASTRUCTURE',
  'INTELLIGENCE',
  'WHY_US',
  'PRICING',
]);

export function useAppAuth(): AppAuthState {
  const [inTelegram, setInTelegram] = useState(() => isInTelegram());
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [firebaseReady, setFirebaseReady] = useState(!isFirebaseConfigured());
  // Always wait for Telegram init (instant outside TMA) so we never race initData.
  const [tgReady, setTgReady] = useState(false);
  const [tgOk, setTgOk] = useState(false);
  const [tgError, setTgError] = useState<string | null>(null);
  const [authAttempt, setAuthAttempt] = useState(0);

  const retryTelegram = useCallback(() => {
    setAuthAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setFirebaseReady(true);
      return;
    }
    startFirebaseAuthListener();
    return subscribeFirebaseUser((u) => {
      setFirebaseUser(u);
      setFirebaseReady(true);
    });
  }, []);

  useEffect(() => {
    return subscribeTelegramReady((inside) => {
      setInTelegram(inside);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setTgReady(false);

    (async () => {
      const inside = await whenTelegramReady();
      if (cancelled) return;
      setInTelegram(inside);

      if (!inside) {
        setTgOk(false);
        setTgError(null);
        setTgReady(true);
        return;
      }

      const raw = getInitDataRaw();
      if (!raw) {
        setTgOk(false);
        setTgError('Open this Mini App from Telegram so we can verify your account.');
        setTgReady(true);
        return;
      }

      try {
        await telegramAuth();
        if (cancelled) return;
        // initData present: allow UI even if /auth is briefly unreachable;
        // Worker still validates every API call.
        setTgOk(true);
        setTgError(null);
      } catch {
        if (!cancelled) {
          setTgOk(Boolean(raw));
          setTgError(null);
        }
      } finally {
        if (!cancelled) setTgReady(true);
      }
    })();

    return () => { cancelled = true; };
  }, [authAttempt]);

  const loading = !firebaseReady || !tgReady;

  if (inTelegram) {
    return {
      loading,
      authenticated: tgOk,
      source: tgOk ? 'telegram' : null,
      label: tgOk ? 'Telegram' : null,
      reason: tgOk ? null : (tgError || 'Telegram sign-in required'),
      retryTelegram,
    };
  }

  if (firebaseUser) {
    return {
      loading,
      authenticated: true,
      source: 'firebase',
      label: firebaseUser.email || firebaseUser.displayName || 'Signed in',
      reason: null,
    };
  }

  return {
    loading,
    authenticated: false,
    source: null,
    label: null,
    reason: isFirebaseConfigured()
      ? 'Sign in or create an account to use Luminara.'
      : 'Firebase Auth is not configured on this build.',
  };
}
