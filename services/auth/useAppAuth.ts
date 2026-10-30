/**
 * App-level auth: Telegram Mini App initData OR Firebase (web).
 * Marketing pages stay public; product tools require a signed-in account.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  isInTelegram,
  waitForInitDataRaw,
  whenTelegramReady,
  subscribeTelegramReady,
} from '../telegram/tma';
import { hasPersistedAuthSession, persistedAuthSessionInIndexedDb } from './firebaseIdToken';
import { isFirebaseConfigured } from './firebasePublicConfig';

type FirebaseAccount = { email?: string | null; displayName?: string | null };
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
 * Views that stay reachable without an account (marketing + legal + guest Instant Audit).
 * Guest scout uses client BYOK only; hosted Worker LLM / paid relay / hosted PSI still need auth.
 * Everything else requires Telegram (inside TMA) or Firebase (web).
 */
export const PUBLIC_APP_VIEWS = new Set([
  'LANDING',
  'PRIVACY',
  'TERMS',
  'INFRASTRUCTURE',
  'INTELLIGENCE',
  'WHY_US',
  'COMPARE',
  'FREE_TOOLS',
  'PRICING',
  'METHODOLOGY',
  'SAMPLE_REPORT',
  'SHARED_REPORT',
  'VERIFY_ATTESTATION',
  'VERIFY_RECEIPT',
  'VERIFY_AUDIT_RECEIPT',
  'INSTANT_AUDIT',
  'IDEA_SCOUT',
  'ECOSYSTEM_HUB',
  'TRUST_CENTER',
  'LAUNCHPAD',
  'VISION',
  'ENQUIRY_DESK',
]);

/**
 * Marketing nav while Firebase is still loading.
 * A persisted session keeps Dashboard, so Sign in does not flash and then vanish.
 */
export function marketingNavSignedIn(loading: boolean, authenticated: boolean, persistedSession: boolean): boolean {
  return authenticated || (loading && persistedSession);
}

/** Pure decision helper (tested). Soft-open only when signature was not rejected. */
export function decideTelegramGate(input: {
  hasInitData: boolean;
  authStatus: 'ok' | 'invalid' | 'unavailable' | null;
}): { authenticated: boolean; reason: string | null } {
  if (!input.hasInitData) {
    return {
      authenticated: false,
      reason: 'Open this Mini App from Telegram so we can verify your account.',
    };
  }
  if (input.authStatus === 'invalid') {
    return {
      authenticated: false,
      reason: 'Telegram could not verify this session. Close and reopen Luminara from the bot menu.',
    };
  }
  // ok or unavailable (network/5xx): allow shell; Worker validates every hosted call.
  return { authenticated: true, reason: null };
}

export function useAppAuth(): AppAuthState {
  const [inTelegram, setInTelegram] = useState(() => isInTelegram());
  const [firebaseUser, setFirebaseUser] = useState<FirebaseAccount | null>(null);
  const [firebaseReady, setFirebaseReady] = useState(!isFirebaseConfigured());
  // Always wait for Telegram init (instant outside TMA) so we never race initData.
  const [tgReady, setTgReady] = useState(false);
  const [tgOk, setTgOk] = useState(false);
  const [tgError, setTgError] = useState<string | null>(null);
  const [authAttempt, setAuthAttempt] = useState(0);
  // Sync read during render, before paint. IndexedDB is checked after paint below.
  const [resumePersistedSession] = useState(hasPersistedAuthSession);

  const retryTelegram = useCallback(() => {
    setAuthAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setFirebaseReady(true);
      return;
    }
    let cancelled = false;
    let unsub = () => {};
    let timer = 0;
    let started = false;
    // Cold-load protection: await persisted auth settlement from IndexedDB before marking ready.
    const start = () => {
      if (cancelled || started) return;
      started = true;
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      void import('./firebaseAuthService').then((mod) => {
        if (cancelled) return;
        void mod.whenFirebaseAuthReady().then((u) => {
          if (cancelled) return;
          if (!u) {
            setFirebaseReady(true);
            return;
          }
          // Boot starts before the shell is allowed to fetch workspace or quota.
          void mod.primeSignedInBoot().finally(() => {
            if (!cancelled) setFirebaseReady(true);
          });
        });
        mod.startFirebaseAuthListener();
        unsub = mod.subscribeFirebaseUser((u) => {
          if (cancelled) return;
          setFirebaseUser(u);
          if (u) setFirebaseReady(true);
        });
      }).catch(() => {
        if (!cancelled) setFirebaseReady(true);
      });
    };
    const path = (window.location.pathname || '/').replace(/\/+$/, '') || '/';
    const quietMarketing = path === '/' || path === '/pricing';
    if (!quietMarketing || resumePersistedSession) {
      start();
    } else {
      window.addEventListener('pointerdown', start);
      window.addEventListener('keydown', start);
      // Lab traces end before this. A tap still starts auth immediately.
      timer = window.setTimeout(start, 12000);
      // shortcut: IndexedDB cannot be read before paint, so a session that lives only there starts once the store lists an authUser key.
      void persistedAuthSessionInIndexedDb().then((yes) => {
        if (yes) start();
      });
    }

    return () => {
      cancelled = true;
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      if (timer) window.clearTimeout(timer);
      unsub();
    };
  }, [resumePersistedSession]);

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

      const raw = await waitForInitDataRaw();
      if (cancelled) return;

      if (!raw) {
        const decided = decideTelegramGate({ hasInitData: false, authStatus: null });
        setTgOk(decided.authenticated);
        setTgError(decided.reason);
        setTgReady(true);
        return;
      }

      try {
        const result = await telegramAuth();
        if (cancelled) return;
        const decided = decideTelegramGate({
          hasInitData: true,
          authStatus: result.status,
        });
        setTgOk(decided.authenticated);
        if (!decided.authenticated && result.status === 'invalid' && result.error) {
          setTgError(`${decided.reason} (${result.error})`);
        } else {
          setTgError(decided.reason);
        }
      } catch {
        if (!cancelled) {
          const decided = decideTelegramGate({ hasInitData: true, authStatus: 'unavailable' });
          setTgOk(decided.authenticated);
          setTgError(decided.reason);
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
