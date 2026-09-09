/**
 * App-level auth: Telegram Mini App initData OR Firebase (web).
 * Marketing pages stay public; product tools require a signed-in account.
 */
import { useEffect, useState } from 'react';
import { isInTelegram, getInitDataRaw } from '../telegram/tma';
import {
  isFirebaseConfigured,
  subscribeFirebaseUser,
  startFirebaseAuthListener,
} from './firebaseAuthService';
import type { User } from 'firebase/auth';
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
  const inTelegram = isInTelegram();
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [firebaseReady, setFirebaseReady] = useState(!isFirebaseConfigured());
  const [tgReady, setTgReady] = useState(!inTelegram);
  const [tgOk, setTgOk] = useState(false);
  const [tgError, setTgError] = useState<string | null>(null);

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
    if (!inTelegram) {
      setTgReady(true);
      setTgOk(false);
      return;
    }
    const raw = getInitDataRaw();
    if (!raw) {
      setTgReady(true);
      setTgOk(false);
      setTgError('Open this Mini App from Telegram so we can verify your account.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const session = await telegramAuth();
        if (cancelled) return;
        if (session?.ok) {
          setTgOk(true);
          setTgError(null);
        } else {
          // initData present: allow UI; Worker still validates every API call.
          setTgOk(true);
          setTgError(null);
        }
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
  }, [inTelegram]);

  const loading = !firebaseReady || !tgReady;

  if (inTelegram) {
    return {
      loading,
      authenticated: tgOk,
      source: tgOk ? 'telegram' : null,
      label: tgOk ? 'Telegram' : null,
      reason: tgOk ? null : (tgError || 'Telegram sign-in required'),
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
