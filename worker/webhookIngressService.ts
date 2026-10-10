/**
 * Webhook Ingress Service (OpenMausBot-adapted event-driven audit pipeline)
 *
 * Exposes edge endpoints for CI/CD pipelines (GitHub Actions, Vercel),
 * CMS platforms (Shopify, WordPress, Webflow), and external monitors
 * to trigger autonomous search/AEO audit sweeps on deployment.
 *
 * Endpoint patterns:
 *   POST /api/webhooks/ingress
 *   POST /api/webhooks/ingress/:secret
 *
 * Security:
 *   - Timing-safe constant-time secret comparison via secretEquals.
 *   - Fails closed with 503 if no webhook secret is configured.
 *   - Bounded JSON payload parsing (MAX_SMALL_BODY_BYTES).
 *   - Rate-limited via edge rate limiter.
 */

import type { Env } from './env';
import { json, secretEquals } from './workerUtils';
import { MAX_SMALL_BODY_BYTES, readBody } from './security';

export interface WebhookIngressPayload {
  targetUrl: string;
  event?: string;
  branch?: string;
  commit?: string;
  actor?: string;
  metadata?: Record<string, unknown>;
}

export interface WebhookIngressResult {
  ok: boolean;
  auditId: string;
  targetUrl: string;
  event: string;
  receivedAt: number;
  status: 'dispatched' | 'completed' | 'queued';
  dispatchedToTelegram?: boolean;
}

export function extractWebhookSecret(request: Request, pathname: string): string | null {
  // 1. Path param: /api/webhooks/ingress/:secret or /webhooks/ingress/:secret
  const prefix = pathname.startsWith('/api/') ? '/api/webhooks/ingress/' : '/webhooks/ingress/';
  if (pathname.startsWith(prefix) && pathname.length > prefix.length) {
    const raw = pathname.slice(prefix.length).split('/')[0];
    if (raw) return decodeURIComponent(raw);
  }

  // 2. Authorization header: Bearer <secret>
  const auth = request.headers.get('Authorization') || request.headers.get('authorization');
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) return match[1].trim();
  }

  // 3. Custom secret header
  const custom = request.headers.get('x-webhook-secret');
  if (custom) return custom.trim();

  return null;
}

export function normalizeTargetUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProto);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (!parsed.hostname || !parsed.hostname.includes('.')) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export async function handleWebhookIngressRoute(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  const isDirect = pathname === '/api/webhooks/ingress' || pathname === '/webhooks/ingress';
  const isSubpath = pathname.startsWith('/api/webhooks/ingress/') || pathname.startsWith('/webhooks/ingress/');
  if (!isDirect && !isSubpath) {
    return null;
  }

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed. Use POST.' }, 405, {
      Allow: 'POST',
    });
  }

  const configuredSecret = env.INGRESS_WEBHOOK_SECRET || env.AUTH_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return json(
      {
        ok: false,
        error: 'Webhook ingress is unconfigured. Set INGRESS_WEBHOOK_SECRET on worker.',
      },
      503,
    );
  }

  const providedSecret = extractWebhookSecret(request, pathname);
  if (!providedSecret || !secretEquals(providedSecret, configuredSecret)) {
    return json(
      {
        ok: false,
        error: 'Unauthorized: invalid or missing webhook secret.',
      },
      401,
    );
  }

  const bodyResult = await readBody(request, MAX_SMALL_BODY_BYTES, true);
  if (!bodyResult.ok) {
    return json(
      {
        ok: false,
        error: bodyResult.error || 'Failed to read request body.',
      },
      bodyResult.status || 400,
    );
  }

  const payload = (bodyResult.value || {}) as WebhookIngressPayload;
  const rawUrl = typeof payload.targetUrl === 'string' ? payload.targetUrl : '';
  const normalizedUrl = normalizeTargetUrl(rawUrl);
  if (!normalizedUrl) {
    return json(
      {
        ok: false,
        error: 'Invalid or missing targetUrl. Provide a valid domain or URL.',
      },
      400,
    );
  }

  const eventName = typeof payload.event === 'string' && payload.event.trim()
    ? payload.event.trim().slice(0, 64)
    : 'site_deployed';

  const auditId = `ing-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  let dispatchedToTelegram = false;

  const botToken = env.BOT_TOKEN || env.TELEGRAM_BOT_TOKEN;
  const adminChatId = env.TELEGRAM_ADMIN_ID;

  if (botToken && adminChatId) {
    const notifyText = `Luminara Webhook Trigger: ${eventName}\nURL: ${normalizedUrl}\nAudit ID: ${auditId}`;
    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: adminChatId,
          text: notifyText,
        }),
      });
      dispatchedToTelegram = tgRes.ok;
    } catch (err) {
      console.warn('[Webhook Ingress] Telegram notification failed:', err);
    }
  }

  const result: WebhookIngressResult = {
    ok: true,
    auditId,
    targetUrl: normalizedUrl,
    event: eventName,
    receivedAt: Date.now(),
    status: 'dispatched',
    dispatchedToTelegram,
  };

  return json(result, 200);
}
