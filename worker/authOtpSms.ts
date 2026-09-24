/**
 * SMS OTP dispatch / verify (Twilio), gated behind env.
 *
 * When OTP_SMS_ENABLED is not "true" or Twilio secrets are missing, request-otp
 * returns 501 without calling any provider (toll-fraud safe stub).
 */
import type { Env } from './env';
import { json } from './workerUtils';
import {
  checkOutboundDailyBudget,
  enforceBurstLimit,
  enforceEdgeBindingLimit,
  incrementOutboundDaily,
  otpIpLimiter,
  withRateLimitHeaders,
  type DualRateLimitResult,
} from './securityHardening';
import { padMinLatency, PASSWORD_RESET_MIN_LATENCY_MS } from './authTollFraud';

const E164_RE = /^\+[1-9]\d{6,14}$/;
const OTP_TTL_SEC = 10 * 60;
const OTP_CODE_LEN = 6;

function mergeHeaders(...parts: Array<Record<string, string> | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of parts) {
    if (!p) continue;
    Object.assign(out, p);
  }
  return out;
}

export function isOtpSmsEnabled(env: Env): boolean {
  if (String(env.OTP_SMS_ENABLED || '').toLowerCase() !== 'true') return false;
  return Boolean(
    String(env.TWILIO_ACCOUNT_SID || '').trim() &&
      String(env.TWILIO_AUTH_TOKEN || '').trim() &&
      String(env.TWILIO_FROM_NUMBER || '').trim(),
  );
}

export function normalizeE164Phone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const phone = raw.trim().replace(/[\s()-]/g, '');
  if (!E164_RE.test(phone)) return null;
  return phone;
}

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

function otpKvKey(phone: string): string {
  return `otp:sms:${phone}`;
}

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomOtpCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  const n = arr[0]! % 10 ** OTP_CODE_LEN;
  return String(n).padStart(OTP_CODE_LEN, '0');
}

async function sendTwilioSms(
  env: Env,
  to: string,
  body: string,
  opts?: { fetchImpl?: typeof fetch },
): Promise<{ ok: true } | { ok: false; status: number }> {
  const sid = String(env.TWILIO_ACCOUNT_SID || '').trim();
  const token = String(env.TWILIO_AUTH_TOKEN || '').trim();
  const from = String(env.TWILIO_FROM_NUMBER || '').trim();
  const auth = btoa(`${sid}:${token}`);
  const fetchImpl = opts?.fetchImpl || fetch;
  const res = await fetchImpl(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    },
  );
  if (!res.ok) {
    console.warn(JSON.stringify({ event: 'twilio_sms_error', status: res.status }));
    return { ok: false, status: res.status };
  }
  return { ok: true };
}

/**
 * POST /api/auth/request-otp
 * Body: { phone: "+15551234567" }
 * When SMS is disabled: 501 after rate gates (no provider call).
 * When enabled: send Twilio SMS, store code hash in KV, return neutral success.
 */
export async function handleRequestOtp(
  request: Request,
  env: Env,
  ip: string,
  opts?: { fetchImpl?: typeof fetch; minLatencyMs?: number },
): Promise<Response> {
  const started = Date.now();
  const minLatency = opts?.minLatencyMs ?? PASSWORD_RESET_MIN_LATENCY_MS;

  const gate = await gateOtpMessaging(env, ip);
  if (!gate.ok) return gate.response;

  if (!isOtpSmsEnabled(env)) {
    await padMinLatency(started, minLatency);
    return withRateLimitHeaders(
      json(
        {
          ok: false,
          error: 'OTP messaging is not enabled for this product.',
          code: 'OTP_NOT_ENABLED',
        },
        501,
      ),
      gate.headers,
    );
  }

  let phoneRaw: unknown;
  try {
    const body = (await request.json()) as { phone?: unknown };
    phoneRaw = body?.phone;
  } catch {
    await padMinLatency(started, minLatency);
    return json({ ok: false, error: 'Request body must be JSON with a phone field.', code: 'INVALID_BODY' }, 400);
  }

  const phone = normalizeE164Phone(phoneRaw);
  if (!phone) {
    await padMinLatency(started, minLatency);
    return json(
      { ok: false, error: 'Enter a valid phone number in E.164 format (e.g. +15551234567).', code: 'INVALID_PHONE' },
      400,
    );
  }

  const budget = await checkOutboundDailyBudget(env);
  if (!budget.ok) {
    await padMinLatency(started, minLatency);
    return budget.response;
  }

  if (!env.LUMINARA_KV) {
    await padMinLatency(started, minLatency);
    return json(
      { ok: false, error: 'OTP store unavailable. Try again later.', code: 'OTP_STORE_UNAVAILABLE' },
      503,
    );
  }

  const code = randomOtpCode();
  const codeHash = await sha256Hex(`${phone}:${code}`);
  await env.LUMINARA_KV.put(
    otpKvKey(phone),
    JSON.stringify({ hash: codeHash, attempts: 0, createdAt: Date.now() }),
    { expirationTtl: OTP_TTL_SEC },
  );

  const sms = await sendTwilioSms(env, phone, `Your Luminara verification code is ${code}`, {
    fetchImpl: opts?.fetchImpl,
  });

  if (!sms.ok) {
    await env.LUMINARA_KV.delete(otpKvKey(phone));
    await padMinLatency(started, minLatency);
    return json(
      { ok: false, error: 'Could not send verification code. Try again later.', code: 'OTP_SEND_FAILED' },
      503,
    );
  }

  await incrementOutboundDaily(env, 1);
  await padMinLatency(started, minLatency);
  // Neutral success: do not echo the phone or confirm delivery details attackers can probe.
  return withRateLimitHeaders(
    json({
      success: true,
      message: 'If this number can receive SMS, a verification code has been dispatched.',
      expiresInSec: OTP_TTL_SEC,
    }),
    gate.headers,
  );
}

/**
 * POST /api/auth/verify-otp
 * Body: { phone, code }. Constant failure message on mismatch (no enumeration of pending OTPs).
 */
export async function handleVerifyOtp(
  request: Request,
  env: Env,
  ip: string,
  opts?: { minLatencyMs?: number },
): Promise<Response> {
  const started = Date.now();
  const minLatency = opts?.minLatencyMs ?? PASSWORD_RESET_MIN_LATENCY_MS;

  const gate = await gateOtpMessaging(env, ip);
  if (!gate.ok) return gate.response;

  if (!isOtpSmsEnabled(env)) {
    await padMinLatency(started, minLatency);
    return withRateLimitHeaders(
      json({ ok: false, error: 'OTP messaging is not enabled for this product.', code: 'OTP_NOT_ENABLED' }, 501),
      gate.headers,
    );
  }

  let body: { phone?: unknown; code?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    await padMinLatency(started, minLatency);
    return json({ ok: false, error: 'Request body must be JSON with phone and code.', code: 'INVALID_BODY' }, 400);
  }

  const phone = normalizeE164Phone(body.phone);
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!phone || !/^\d{6}$/.test(code)) {
    await padMinLatency(started, minLatency);
    return json({ ok: false, error: 'Invalid verification attempt.', code: 'OTP_INVALID' }, 400);
  }

  if (!env.LUMINARA_KV) {
    await padMinLatency(started, minLatency);
    return json({ ok: false, error: 'OTP store unavailable. Try again later.', code: 'OTP_STORE_UNAVAILABLE' }, 503);
  }

  const key = otpKvKey(phone);
  const raw = await env.LUMINARA_KV.get(key);
  const fail = async () => {
    await padMinLatency(started, minLatency);
    return withRateLimitHeaders(
      json({ ok: false, error: 'Invalid or expired verification code.', code: 'OTP_INVALID' }, 401),
      gate.headers,
    );
  };

  if (!raw) return fail();

  let stored: { hash: string; attempts: number };
  try {
    stored = JSON.parse(raw) as typeof stored;
  } catch {
    return fail();
  }

  if (stored.attempts >= 5) {
    await env.LUMINARA_KV.delete(key);
    return fail();
  }

  const codeHash = await sha256Hex(`${phone}:${code}`);
  if (codeHash !== stored.hash) {
    await env.LUMINARA_KV.put(
      key,
      JSON.stringify({ hash: stored.hash, attempts: stored.attempts + 1, createdAt: Date.now() }),
      { expirationTtl: OTP_TTL_SEC },
    );
    return fail();
  }

  await env.LUMINARA_KV.delete(key);
  await padMinLatency(started, minLatency);
  return withRateLimitHeaders(json({ ok: true, verified: true, phone }), gate.headers);
}
