/**
 * Toll-fraud / anti-enumeration defenses for public auth messaging.
 *
 * Password reset is mediated by the Worker (not the browser Firebase SDK) so
 * IP rate limits, burst gates, and the outbound daily killswitch run before
 * Identity Toolkit can send mail. Responses are constant-shape regardless of
 * whether the email exists.
 *
 * Stack: Cloudflare Workers + KV + Firebase Identity Toolkit REST (web API key).
 * No Admin SDK / service-account private key required.
 */
import type { Env } from './env';
import { json } from './workerUtils';
import {
  checkOutboundDailyBudget,
  enforceBurstLimit,
  enforceDualKeySlidingLimit,
  enforceEdgeBindingLimit,
  incrementOutboundDaily,
  otpIpLimiter,
  passwordResetIpLimiter,
  withRateLimitHeaders,
  type DualRateLimitResult,
} from './securityHardening';

/** Neutral copy returned for every successful-path reset attempt (exists or not). */
export const PASSWORD_RESET_NEUTRAL_MESSAGE =
  'If an account exists with this email address, a password reset link has been dispatched.';

export const PASSWORD_RESET_SUCCESS_BODY = {
  success: true as const,
  message: PASSWORD_RESET_NEUTRAL_MESSAGE,
};

/** Floor latency so exists vs not-found paths are harder to distinguish by timing. */
export const PASSWORD_RESET_MIN_LATENCY_MS = 400;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IDENTITY_TOOLKIT_OOB =
  'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode';

export function normalizeResetEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 320 || !EMAIL_RE.test(email)) return null;
  return email;
}

export async function padMinLatency(startedAt: number, minMs = PASSWORD_RESET_MIN_LATENCY_MS): Promise<void> {
  const elapsed = Date.now() - startedAt;
  if (elapsed < minMs) {
    await new Promise((r) => setTimeout(r, minMs - elapsed));
  }
}

type ToolkitResult =
  | { dispatched: true }
  | { dispatched: false; reason: 'not_found' | 'invalid' | 'provider_error' | 'misconfigured' };

/**
 * Calls Identity Toolkit PASSWORD_RESET. EMAIL_NOT_FOUND is treated as a soft
 * miss (no mail sent) so we can still return the neutral success body.
 */
export async function sendPasswordResetOob(
  env: Env,
  email: string,
  opts?: { fetchImpl?: typeof fetch; continueUrl?: string },
): Promise<ToolkitResult> {
  const apiKey = String(env.FIREBASE_WEB_API_KEY || '').trim();
  if (!apiKey) {
    return { dispatched: false, reason: 'misconfigured' };
  }

  const body: Record<string, string> = {
    requestType: 'PASSWORD_RESET',
    email,
  };
  if (opts?.continueUrl) body.continueUrl = opts.continueUrl;

  const fetchImpl = opts?.fetchImpl || fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${IDENTITY_TOOLKIT_OOB}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { dispatched: false, reason: 'provider_error' };
  }

  if (res.ok) return { dispatched: true };

  let message = '';
  try {
    const errBody = (await res.json()) as { error?: { message?: string } };
    message = String(errBody?.error?.message || '');
  } catch {
    message = '';
  }

  if (message.includes('EMAIL_NOT_FOUND') || message.includes('USER_NOT_FOUND')) {
    return { dispatched: false, reason: 'not_found' };
  }
  if (message.includes('INVALID_EMAIL')) {
    return { dispatched: false, reason: 'invalid' };
  }
  console.warn(
    JSON.stringify({
      event: 'password_reset_provider_error',
      status: res.status,
      // Never log the email address.
      code: message.slice(0, 80) || 'unknown',
    }),
  );
  return { dispatched: false, reason: 'provider_error' };
}

function mergeHeaders(...parts: Array<Record<string, string> | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of parts) {
    if (!p) continue;
    Object.assign(out, p);
  }
  return out;
}

/**
 * Public auth-messaging gate, cheapest and most trustworthy check first:
 *
 *   1. burst      - isolate-local, 5 req/s, catches a single hot connection
 *   2. edge       - AUTH_MESSAGING_LIMITER, atomic per colo, closes the
 *                   read-modify-write race in the KV window below
 *   3. KV window  - the real 3 / 15 min policy limit, fails closed without KV
 *
 * `ip` must come from `clientIp()` (cf-connecting-ip only). Never pass a
 * caller-supplied forwarding header: each forged value is a fresh bucket.
 */
async function gateAuthMessaging(
  env: Env,
  ip: string,
): Promise<DualRateLimitResult> {
  const burst = enforceBurstLimit(ip, 5);
  if (!burst.ok) return burst;

  const edge = await enforceEdgeBindingLimit(env.AUTH_MESSAGING_LIMITER, `pwd_reset:${ip || 'unknown'}`, {
    action: 'password_reset_edge',
    limit: 3,
    windowSec: 60,
  });
  if (!edge.ok) return edge;

  const ipLimit = await passwordResetIpLimiter(env, `ip:${ip || 'unknown'}`);
  if (!ipLimit.ok) return ipLimit;

  return { ok: true, headers: mergeHeaders(burst.headers, edge.headers, ipLimit.headers) };
}

/**
 * Full password-reset handler: burst → edge → IP sliding window → outbound
 * budget → Identity Toolkit → constant success body (except hard 429 / invalid
 * email / misconfigured provider).
 */
export async function handlePasswordResetRequest(
  request: Request,
  env: Env,
  ip: string,
  opts?: { fetchImpl?: typeof fetch; now?: () => number; minLatencyMs?: number },
): Promise<Response> {
  const started = (opts?.now || Date.now)();
  const minLatency = opts?.minLatencyMs ?? PASSWORD_RESET_MIN_LATENCY_MS;

  const gate = await gateAuthMessaging(env, ip);
  if (!gate.ok) return gate.response;

  let emailRaw: unknown;
  try {
    const body = (await request.json()) as { email?: unknown };
    emailRaw = body?.email;
  } catch {
    await padMinLatency(started, minLatency);
    return json({ ok: false, error: 'Request body must be JSON with an email field.', code: 'INVALID_BODY' }, 400);
  }

  const email = normalizeResetEmail(emailRaw);
  if (!email) {
    await padMinLatency(started, minLatency);
    return json({ ok: false, error: 'Enter a valid email address.', code: 'INVALID_EMAIL' }, 400);
  }

  const budget = await checkOutboundDailyBudget(env);
  if (!budget.ok) {
    await padMinLatency(started, minLatency);
    return budget.response;
  }

  const toolkit = await sendPasswordResetOob(env, email, {
    fetchImpl: opts?.fetchImpl,
    continueUrl: env.WEBAPP_URL || undefined,
  });

  if (toolkit.dispatched === false && toolkit.reason === 'misconfigured') {
    await padMinLatency(started, minLatency);
    return json(
      {
        ok: false,
        error: 'Password reset is temporarily unavailable. Try again later.',
        code: 'RESET_UNAVAILABLE',
      },
      503,
    );
  }

  // invalid email from provider: still neutral (do not leak). provider_error: still neutral
  // so attackers cannot probe via differential errors. Only increment budget when mail was sent.
  if (toolkit.dispatched) {
    await incrementOutboundDaily(env, 1);
  }

  await padMinLatency(started, minLatency);
  return withRateLimitHeaders(json(PASSWORD_RESET_SUCCESS_BODY, 200), gate.headers);
}

/** Apply only the public gate stack (burst + edge + sliding window), no dispatch. */
export async function gatePublicAuthMessaging(
  env: Env,
  ip: string,
): Promise<DualRateLimitResult> {
  return gateAuthMessaging(env, ip);
}

/**
 * Public OTP / verification messaging gate (5 / hour / IP + burst + edge).
 * Runs before any provider call so SMS/email pumping cannot start.
 */
async function gateOtpMessaging(env: Env, ip: string): Promise<DualRateLimitResult> {
  const burst = enforceBurstLimit(ip, 5);
  if (!burst.ok) return burst;

  const edge = await enforceEdgeBindingLimit(env.AUTH_MESSAGING_LIMITER, `otp:${ip || 'unknown'}`, {
    action: 'otp_edge',
    limit: 3,
    windowSec: 60,
  });
  if (!edge.ok) return edge;

  const ipLimit = await otpIpLimiter(env, `ip:${ip || 'unknown'}`);
  if (!ipLimit.ok) return ipLimit;

  return { ok: true, headers: mergeHeaders(burst.headers, edge.headers, ipLimit.headers) };
}

export async function gatePublicOtpMessaging(env: Env, ip: string): Promise<DualRateLimitResult> {
  return gateOtpMessaging(env, ip);
}

const EMAIL_VERIFY_NEUTRAL_MESSAGE =
  'If verification is required for this account, a confirmation link has been dispatched.';

/**
 * Authenticated email-verification trigger.
 * Dual-key uid+ip (5 / hour) plus outbound daily killswitch before Identity Toolkit.
 * Always returns a neutral success body (no auth/user-not-found leak).
 */
export async function handleSendVerification(
  request: Request,
  env: Env,
  ip: string,
  uid: string,
  idToken: string,
  opts?: { fetchImpl?: typeof fetch; minLatencyMs?: number },
): Promise<Response> {
  const started = Date.now();
  const minLatency = opts?.minLatencyMs ?? PASSWORD_RESET_MIN_LATENCY_MS;

  const dual = await enforceDualKeySlidingLimit(env, {
    action: 'email_verify',
    uid,
    ip,
    maxRequests: 5,
    windowSeconds: 60 * 60,
  });
  if (!dual.ok) {
    await padMinLatency(started, minLatency);
    return dual.response;
  }

  // Also bind the public IP OTP bucket so unauthenticated floods and authed
  // callers share the same origin pressure (VPN rotation alone is not enough).
  const publicGate = await gateOtpMessaging(env, ip);
  if (!publicGate.ok) {
    await padMinLatency(started, minLatency);
    return publicGate.response;
  }

  const budget = await checkOutboundDailyBudget(env);
  if (!budget.ok) {
    await padMinLatency(started, minLatency);
    return budget.response;
  }

  const apiKey = String(env.FIREBASE_WEB_API_KEY || '').trim();
  if (!apiKey || !idToken) {
    await padMinLatency(started, minLatency);
    return json(
      {
        ok: false,
        error: 'Email verification is temporarily unavailable. Try again later.',
        code: 'VERIFY_UNAVAILABLE',
      },
      503,
    );
  }

  const fetchImpl = opts?.fetchImpl || fetch;
  let dispatched = false;
  try {
    const res = await fetchImpl(`${IDENTITY_TOOLKIT_OOB}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestType: 'VERIFY_EMAIL',
        idToken,
        ...(env.WEBAPP_URL ? { continueUrl: env.WEBAPP_URL } : {}),
      }),
    });
    dispatched = res.ok;
    if (!res.ok) {
      let code = '';
      try {
        const errBody = (await res.json()) as { error?: { message?: string } };
        code = String(errBody?.error?.message || '').slice(0, 80);
      } catch {
        code = 'unknown';
      }
      console.warn(
        JSON.stringify({
          event: 'email_verify_provider_error',
          status: res.status,
          code,
        }),
      );
    }
  } catch {
    console.warn(JSON.stringify({ event: 'email_verify_provider_error', code: 'network' }));
  }

  if (dispatched) {
    await incrementOutboundDaily(env, 1);
  }

  await padMinLatency(started, minLatency);
  // Constant success shape whether Toolkit accepted, rejected, or the account
  // was already verified: never surface Firebase Auth error codes.
  return withRateLimitHeaders(
    json({ success: true, message: EMAIL_VERIFY_NEUTRAL_MESSAGE }, 200),
    mergeHeaders(dual.headers, publicGate.headers),
  );
}
