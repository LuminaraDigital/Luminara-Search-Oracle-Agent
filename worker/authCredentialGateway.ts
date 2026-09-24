/**
 * Worker-mediated email/password sign-up and sign-in via Identity Toolkit REST.
 *
 * Closes the residual credential-stuffing surface that existed when the browser
 * called Firebase Auth directly (no Worker-visible IP quotas). Pair with App Check
 * enforcement in the Firebase console so attackers cannot bypass the Worker by
 * hitting Identity Toolkit with the public web API key alone.
 */
import type { Env } from './env';
import { json } from './workerUtils';
import {
  enforceBurstLimit,
  enforceEdgeBindingLimit,
  signInIpLimiter,
  signUpIpLimiter,
  withRateLimitHeaders,
  type DualRateLimitResult,
} from './securityHardening';
import { padMinLatency, normalizeResetEmail, PASSWORD_RESET_MIN_LATENCY_MS } from './authTollFraud';
import { enforceAppCheckIfRequired } from './appCheck';

const IDENTITY_SIGN_UP = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp';
const IDENTITY_SIGN_IN = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';

const MIN_PASSWORD_LEN = 6;
const MAX_PASSWORD_LEN = 128;

/** Anti-enumeration copy for failed sign-in (missing user / wrong password). */
export const SIGN_IN_FAILURE_MESSAGE = 'Email or password is incorrect.';

/** Anti-enumeration copy when sign-up cannot complete (including email already registered). */
export const SIGN_UP_FAILURE_MESSAGE =
  'Could not create an account with those details. Try signing in or reset your password.';

function mergeHeaders(...parts: Array<Record<string, string> | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of parts) {
    if (!p) continue;
    Object.assign(out, p);
  }
  return out;
}

function normalizePassword(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length < MIN_PASSWORD_LEN || raw.length > MAX_PASSWORD_LEN) return null;
  return raw;
}

async function gateCredential(
  env: Env,
  ip: string,
  kind: 'signup' | 'signin',
): Promise<DualRateLimitResult> {
  const burst = enforceBurstLimit(ip, 5);
  if (!burst.ok) return burst;

  const edge = await enforceEdgeBindingLimit(env.AUTH_MESSAGING_LIMITER, `${kind}:${ip || 'unknown'}`, {
    action: `${kind}_edge`,
    limit: kind === 'signup' ? 5 : 20,
    windowSec: 60,
  });
  if (!edge.ok) return edge;

  const ipLimit =
    kind === 'signup'
      ? await signUpIpLimiter(env, `ip:${ip || 'unknown'}`)
      : await signInIpLimiter(env, `ip:${ip || 'unknown'}`);
  if (!ipLimit.ok) return ipLimit;

  return { ok: true, headers: mergeHeaders(burst.headers, edge.headers, ipLimit.headers) };
}

type ToolkitAuthOk = {
  ok: true;
  idToken: string;
  refreshToken: string;
  localId: string;
  email: string;
  expiresIn: string;
};

type ToolkitAuthErr = {
  ok: false;
  kind: 'invalid_email' | 'weak_password' | 'auth_failed' | 'misconfigured' | 'provider_error' | 'too_many';
  providerCode?: string;
};

async function callIdentityAuth(
  env: Env,
  url: string,
  body: Record<string, unknown>,
  opts?: { fetchImpl?: typeof fetch; appCheckToken?: string },
): Promise<ToolkitAuthOk | ToolkitAuthErr> {
  const apiKey = String(env.FIREBASE_WEB_API_KEY || '').trim();
  if (!apiKey) return { ok: false, kind: 'misconfigured' };

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const appCheck = String(opts?.appCheckToken || '').trim();
  if (appCheck) headers['X-Firebase-AppCheck'] = appCheck;

  const fetchImpl = opts?.fetchImpl || fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${url}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, kind: 'provider_error' };
  }

  let parsed: {
    idToken?: string;
    refreshToken?: string;
    localId?: string;
    email?: string;
    expiresIn?: string;
    error?: { message?: string };
  } = {};
  try {
    parsed = (await res.json()) as typeof parsed;
  } catch {
    parsed = {};
  }

  if (res.ok && parsed.idToken && parsed.refreshToken && parsed.localId) {
    return {
      ok: true,
      idToken: parsed.idToken,
      refreshToken: parsed.refreshToken,
      localId: parsed.localId,
      email: String(parsed.email || body.email || ''),
      expiresIn: String(parsed.expiresIn || '3600'),
    };
  }

  const code = String(parsed.error?.message || '').toUpperCase();
  if (code.includes('TOO_MANY_ATTEMPTS') || code.includes('TOO_MANY_REQUESTS')) {
    return { ok: false, kind: 'too_many', providerCode: code.slice(0, 80) };
  }
  if (code.includes('INVALID_EMAIL')) {
    return { ok: false, kind: 'invalid_email', providerCode: code.slice(0, 80) };
  }
  if (code.includes('WEAK_PASSWORD') || code.includes('PASSWORD_LOGIN_DISABLED')) {
    return { ok: false, kind: 'weak_password', providerCode: code.slice(0, 80) };
  }
  // EMAIL_EXISTS, EMAIL_NOT_FOUND, INVALID_PASSWORD, INVALID_LOGIN_CREDENTIALS, etc.
  // Collapse to auth_failed so callers can apply constant anti-enumeration copy.
  console.warn(
    JSON.stringify({
      event: 'credential_auth_provider_error',
      status: res.status,
      code: code.slice(0, 80) || 'unknown',
    }),
  );
  return { ok: false, kind: 'auth_failed', providerCode: code.slice(0, 80) };
}

function parseCredentialBody(raw: unknown): { email: string; password: string; appCheckToken?: string } | { error: Response } {
  if (!raw || typeof raw !== 'object') {
    return {
      error: json({ ok: false, error: 'Request body must be JSON with email and password.', code: 'INVALID_BODY' }, 400),
    };
  }
  const body = raw as { email?: unknown; password?: unknown; appCheckToken?: unknown };
  const email = normalizeResetEmail(body.email);
  if (!email) {
    return { error: json({ ok: false, error: 'Enter a valid email address.', code: 'INVALID_EMAIL' }, 400) };
  }
  const password = normalizePassword(body.password);
  if (!password) {
    return {
      error: json(
        {
          ok: false,
          error: `Password must be ${MIN_PASSWORD_LEN}-${MAX_PASSWORD_LEN} characters.`,
          code: 'WEAK_PASSWORD',
        },
        400,
      ),
    };
  }
  const appCheckToken =
    typeof body.appCheckToken === 'string' && body.appCheckToken.trim() ? body.appCheckToken.trim() : undefined;
  return { email, password, appCheckToken };
}

/**
 * POST /api/auth/sign-up
 * Rate-limited Identity Toolkit signUp. Never returns EMAIL_EXISTS to the client.
 */
export async function handleSignUp(
  request: Request,
  env: Env,
  ip: string,
  opts?: { fetchImpl?: typeof fetch; minLatencyMs?: number },
): Promise<Response> {
  const started = Date.now();
  const minLatency = opts?.minLatencyMs ?? PASSWORD_RESET_MIN_LATENCY_MS;

  const gate = await gateCredential(env, ip, 'signup');
  if (!gate.ok) return gate.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    await padMinLatency(started, minLatency);
    return json({ ok: false, error: 'Request body must be JSON with email and password.', code: 'INVALID_BODY' }, 400);
  }

  const parsed = parseCredentialBody(raw);
  if ('error' in parsed) {
    await padMinLatency(started, minLatency);
    return parsed.error;
  }

  const appCheckGate = await enforceAppCheckIfRequired(request, env, parsed.appCheckToken);
  if (!appCheckGate.ok) {
    await padMinLatency(started, minLatency);
    return appCheckGate.response;
  }

  const result = await callIdentityAuth(
    env,
    IDENTITY_SIGN_UP,
    { email: parsed.email, password: parsed.password, returnSecureToken: true },
    { fetchImpl: opts?.fetchImpl, appCheckToken: parsed.appCheckToken },
  );

  await padMinLatency(started, minLatency);

  if (result.ok) {
    return withRateLimitHeaders(
      json({
        ok: true,
        idToken: result.idToken,
        refreshToken: result.refreshToken,
        localId: result.localId,
        email: result.email,
        expiresIn: result.expiresIn,
      }),
      gate.headers,
    );
  }

  if (result.kind === 'misconfigured') {
    return json(
      { ok: false, error: 'Sign-up is temporarily unavailable. Try again later.', code: 'AUTH_UNAVAILABLE' },
      503,
    );
  }
  if (result.kind === 'too_many') {
    return json({ ok: false, error: 'Too many attempts. Wait a minute and try again.', code: 'RATE_LIMITED' }, 429);
  }
  if (result.kind === 'invalid_email') {
    return json({ ok: false, error: 'Enter a valid email address.', code: 'INVALID_EMAIL' }, 400);
  }
  if (result.kind === 'weak_password') {
    return json(
      { ok: false, error: `Use a password with at least ${MIN_PASSWORD_LEN} characters.`, code: 'WEAK_PASSWORD' },
      400,
    );
  }
  // auth_failed + provider_error: constant anti-enumeration body (covers EMAIL_EXISTS).
  return withRateLimitHeaders(
    json({ ok: false, error: SIGN_UP_FAILURE_MESSAGE, code: 'SIGN_UP_FAILED' }, 400),
    gate.headers,
  );
}

/**
 * POST /api/auth/sign-in
 * Rate-limited Identity Toolkit signInWithPassword. Collapses not-found / wrong-password.
 */
export async function handleSignIn(
  request: Request,
  env: Env,
  ip: string,
  opts?: { fetchImpl?: typeof fetch; minLatencyMs?: number },
): Promise<Response> {
  const started = Date.now();
  const minLatency = opts?.minLatencyMs ?? PASSWORD_RESET_MIN_LATENCY_MS;

  const gate = await gateCredential(env, ip, 'signin');
  if (!gate.ok) return gate.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    await padMinLatency(started, minLatency);
    return json({ ok: false, error: 'Request body must be JSON with email and password.', code: 'INVALID_BODY' }, 400);
  }

  const parsed = parseCredentialBody(raw);
  if ('error' in parsed) {
    await padMinLatency(started, minLatency);
    return parsed.error;
  }

  const appCheckGate = await enforceAppCheckIfRequired(request, env, parsed.appCheckToken);
  if (!appCheckGate.ok) {
    await padMinLatency(started, minLatency);
    return appCheckGate.response;
  }

  const result = await callIdentityAuth(
    env,
    IDENTITY_SIGN_IN,
    { email: parsed.email, password: parsed.password, returnSecureToken: true },
    { fetchImpl: opts?.fetchImpl, appCheckToken: parsed.appCheckToken },
  );

  await padMinLatency(started, minLatency);

  if (result.ok) {
    return withRateLimitHeaders(
      json({
        ok: true,
        idToken: result.idToken,
        refreshToken: result.refreshToken,
        localId: result.localId,
        email: result.email,
        expiresIn: result.expiresIn,
      }),
      gate.headers,
    );
  }

  if (result.kind === 'misconfigured') {
    return json(
      { ok: false, error: 'Sign-in is temporarily unavailable. Try again later.', code: 'AUTH_UNAVAILABLE' },
      503,
    );
  }
  if (result.kind === 'too_many') {
    return json({ ok: false, error: 'Too many attempts. Wait a minute and try again.', code: 'RATE_LIMITED' }, 429);
  }
  if (result.kind === 'invalid_email') {
    return json({ ok: false, error: 'Enter a valid email address.', code: 'INVALID_EMAIL' }, 400);
  }
  // Constant failure for missing user / wrong password / provider blips (no enumeration).
  return withRateLimitHeaders(
    json({ ok: false, error: SIGN_IN_FAILURE_MESSAGE, code: 'SIGN_IN_FAILED' }, 401),
    gate.headers,
  );
}
