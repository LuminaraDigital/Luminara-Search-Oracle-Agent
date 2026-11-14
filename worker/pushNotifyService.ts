/**
 * Android push for real-estate agents (FCM HTTP v1). Optional: when Workload Identity or FCM_PROJECT_ID
 * is missing, sends are a logged no-op. Notification text is shown on lock screens, so it carries a
 * first name at most: never an address, phone number or email.
 */
import type { Env } from './env';
import { FIREBASE_MESSAGING_SCOPE, readWorkloadIdentityConfig, tokenProviderFromEnv, type GcpTokenProvider } from './gcpToken';
import { MAX_SMALL_BODY_BYTES, readBody } from './security';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';

export const MAX_PUSH_DEVICES_PER_ACCOUNT = 10;
const PUSH_SEND_TIMEOUT_MS = 3_000;
/** Notification channel the Android app creates for agent alerts. */
const PUSH_CHANNEL_ID = 'agent_signoff';
const FCM_TOKEN_PATTERN = /^[A-Za-z0-9_:.-]{20,4096}$/;

export type PushKind = 'signoff' | 'callback';
export type PushMessage = { title: string; body: string; kind: PushKind; enquiryId: string; appointmentId?: string };
/** Sent when the item was handled somewhere else, so the alert leaves every phone. Carries no text. */
export type PushDismissal = { kind: 'dismiss'; of: PushKind; enquiryId: string };
export type PushDeps = { fetchImpl?: typeof fetch; tokenProvider?: GcpTokenProvider | null };

let cachedProvider: { key: string; provider: GcpTokenProvider | null } | null = null;

// One provider per Workload Identity config, so the FCM access token is reused across sends.
function defaultTokenProvider(env: Env): GcpTokenProvider | null {
  const key = JSON.stringify(readWorkloadIdentityConfig(env));
  if (cachedProvider?.key !== key) {
    cachedProvider = { key, provider: tokenProviderFromEnv(env, fetch, FIREBASE_MESSAGING_SCOPE) };
  }
  return cachedProvider.provider;
}

/** First name only, for the notification body. Falls back to "A contact". */
export function firstNameOf(fullName: string | null | undefined): string {
  const first = String(fullName ?? '').trim().split(/\s+/)[0] ?? '';
  const clean = first.replace(/[^\p{L}'-]/gu, '').slice(0, 30);
  return clean || 'A contact';
}

/** One alert per item: a repeat replaces the earlier one, and a dismissal removes it. */
export function pushTag(kind: PushKind, enquiryId: string): string {
  return `${kind}:${enquiryId}`;
}

export function dismissalOf(of: PushKind, enquiryId: string): PushDismissal {
  return { kind: 'dismiss', of, enquiryId };
}

/** The FCM message without its device token. A dismissal is data only, so Android shows nothing for it. */
function fcmBody(message: PushMessage | PushDismissal): Record<string, unknown> {
  if (message.kind === 'dismiss') {
    return { data: { kind: 'dismiss', tag: pushTag(message.of, message.enquiryId) } };
  }
  const tag = pushTag(message.kind, message.enquiryId);
  const data: Record<string, string> = { kind: message.kind, enquiryId: message.enquiryId, open: 'today', tag };
  if (message.appointmentId) data.appointmentId = message.appointmentId;
  return {
    notification: { title: message.title, body: message.body },
    data,
    android: { notification: { channel_id: PUSH_CHANNEL_ID, tag } },
  };
}

export function signoffMessage(contactName: string | null | undefined, enquiryId: string, appointmentId: string): PushMessage {
  return {
    title: 'Needs your sign-off',
    body: `${firstNameOf(contactName)} wants an appraisal. Tap to approve a time.`,
    kind: 'signoff',
    enquiryId,
    appointmentId,
  };
}

export function callbackMessage(contactName: string | null | undefined, enquiryId: string): PushMessage {
  return {
    title: 'Call-back needed',
    body: `${firstNameOf(contactName)} needs a call from you. Tap to see why.`,
    kind: 'callback',
    enquiryId,
  };
}

/** Never throws. Fans out to every registered device for the account. */
export async function sendAgentPush(
  env: Env,
  accountId: string,
  message: PushMessage | PushDismissal,
  deps: PushDeps = {},
): Promise<void> {
  try {
    const projectId = env.FCM_PROJECT_ID?.trim();
    const db = env.DB;
    if (!db || !projectId) return;
    const provider = deps.tokenProvider === undefined ? defaultTokenProvider(env) : deps.tokenProvider;
    if (!provider) {
      console.log(JSON.stringify({ event: 'push_skipped', reason: 'wif_not_configured' }));
      return;
    }
    const devices = await db.prepare(`SELECT id, token FROM push_devices WHERE account_id = ?`)
      .bind(accountId)
      .all<{ id: string; token: string }>();
    const rows = devices.results ?? [];
    if (rows.length === 0) return;
    const accessToken = await provider.getAccessToken();
    const fetchImpl = deps.fetchImpl ?? fetch;
    const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
    const body = fcmBody(message);
    // Parallel, each bounded, so every send finishes or aborts inside the caller's wait.
    await Promise.allSettled(rows.map(async (device) => {
      const res = await fetchImpl(url, {
        method: 'POST',
        signal: AbortSignal.timeout(PUSH_SEND_TIMEOUT_MS),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ message: { token: device.token, ...body } }),
      });
      if (res.ok) return;
      const text = await res.text().catch(() => '');
      // Only a token FCM says is gone is removed. INVALID_ARGUMENT can also mean our payload, so it is kept.
      if (res.status === 404 || /UNREGISTERED/.test(text)) {
        await db.prepare(`DELETE FROM push_devices WHERE id = ?`).bind(device.id).run();
      } else {
        await db.prepare(`UPDATE push_devices SET last_error = ?, updated_at = ? WHERE id = ?`)
          .bind(`fcm ${res.status}`, Date.now(), device.id)
          .run();
      }
    }));
  } catch (err) {
    console.log(JSON.stringify({ event: 'push_failed', error: err instanceof Error ? err.message.slice(0, 120) : 'unknown' }));
  }
}

/** Awaitable but bounded: a slow FCM never holds up the caller for more than a few seconds. */
export async function notifyAgent(
  env: Env,
  accountId: string,
  message: PushMessage | PushDismissal,
  deps: PushDeps = {},
): Promise<void> {
  if (!env.FCM_PROJECT_ID?.trim()) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, PUSH_SEND_TIMEOUT_MS);
  });
  try {
    await Promise.race([sendAgentPush(env, accountId, message, deps), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function handlePushRoute(
  request: Request,
  env: Env,
  user: HostedIdentity,
  path: string,
): Promise<Response | null> {
  if (path !== '/push/devices') return null;
  if (request.method !== 'POST' && request.method !== 'DELETE') return null;
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
  const parsed = await readBody(request, MAX_SMALL_BODY_BYTES);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);
  const body = (parsed.value && typeof parsed.value === 'object' ? parsed.value : {}) as Record<string, unknown>;
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!FCM_TOKEN_PATTERN.test(token)) {
    return json({ ok: false, error: 'token must be an FCM registration token (20 to 4096 letters, digits, - _ : .).' }, 400);
  }
  const accountId = billingId(user);

  if (request.method === 'DELETE') {
    await env.DB.prepare(`DELETE FROM push_devices WHERE token = ? AND account_id = ?`).bind(token, accountId).run();
    return json({ ok: true });
  }

  if (body.platform !== 'android') {
    return json({ ok: false, error: "platform must be 'android'." }, 400);
  }
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO push_devices (id, account_id, token, platform, created_at, updated_at)
     VALUES (?, ?, ?, 'android', ?, ?)
     ON CONFLICT(token) DO UPDATE SET account_id = excluded.account_id, updated_at = excluded.updated_at, last_error = NULL`,
  )
    .bind(`pd_${crypto.randomUUID()}`, accountId, token, now, now)
    .run();
  await env.DB.prepare(
    `DELETE FROM push_devices WHERE account_id = ? AND id NOT IN (
       SELECT id FROM push_devices WHERE account_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT ?
     )`,
  )
    .bind(accountId, accountId, MAX_PUSH_DEVICES_PER_ACCOUNT)
    .run();
  return json({ ok: true });
}
