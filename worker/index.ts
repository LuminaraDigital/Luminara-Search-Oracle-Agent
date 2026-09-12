/**
 * Luminara Suite - Cloudflare Worker
 *
 * Serves the built Vite app as static assets and exposes a small API:
 *   GET  /api/health                      which providers are configured server-side
 *   GET  /api/auth/session                current Telegram or Firebase identity (if signed in)
 *   GET  /api/enrichment/entity           signed-in Wikidata & Wayback Machine edge resolution with KV cache
 *   POST /api/providers/:id/<path>        authenticated proxy to LLM / search / scrape vendors
 *   *    /api/sidecars/:id/<path>         relay to self-hosted helpers: "languagetool" (Writing check)
 *                                         and "umami" (Results tracking); allow-listed, not metered
 *   POST /api/telegram/webhook            Telegram bot updates (secret-token protected)
 *   POST /api/telegram/auth               validates Mini App initData, returns user + plan
 *   POST /api/telegram/invoice            creates a Telegram Stars invoice link for a plan
 *
 * Provider keys and the bot token live only here (wrangler secrets), never in the client bundle.
 * Firebase ID tokens are verified with Google JWKS (FIREBASE_PROJECT_ID); no Admin private key needed.
 */

import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { validateInitData } from './telegramAuth';
import { bearerFromAuthorization, verifyFirebaseIdToken } from './firebaseAuth';
import { handleTelegramUpdate, createInvoiceLink, refundStarPayment, normalizePlanId, PLANS } from './telegramBot';
import { createTonInvoice, verifyTonPayment, TON_PRICING } from './tonPayment';
import { activateLicenseKey, generateLicenseKeys, importLicenseKeys } from './licenseService';
import { PRIVACY_HTML } from './privacyPolicy';
import { desktopLatestJson, desktopWindowsDownload } from './desktopDownloads';
import {
  MAX_SMALL_BODY_BYTES,
  RateLimiter,
  clientIp,
  readBody,
  withSecurityHeaders,
} from './security';
import { linkTelegramAndFirebase, getWorkspace, putWorkspace, listAllUsers, type WorkspacePayload } from './userStore';
import { getOrCreateUserOrg, hasPermission } from './enterpriseStore';
import { recordAuditLog, getAuditLogs } from './auditLog';

import { corsHeaders, identify, json, secretEquals, billingId } from './workerUtils';
import { getActiveSubscription, checkHostedQuota, type SubRow } from './quotaMiddleware';
import { proxySidecar, isSidecarConfigured, type SidecarId } from './sidecarRelay';
import { proxyProvider, PROVIDERS } from './providerRelay';
import { runSentinelScan, handleSentinelRoute } from './sentinel';
import { handleEntityEnrichment } from './enrichmentService';
import { handleAgentAttestation } from './attestationService';

// Re-exports for consumers and unit tests
export type { HostedIdentity } from './userTypes';
export type { Env } from './env';
export { isPathAllowed, proxyProvider, PROVIDERS } from './providerRelay';
export type { ProviderSpec } from './providerRelay';
export { isSidecarPathAllowed, umamiUpstreamPath, isSidecarConfigured } from './sidecarRelay';
export type { SidecarId } from './sidecarRelay';
export { getActiveSubscription, isUserSubscribed, checkHostedQuota } from './quotaMiddleware';
export type { QuotaStatus, SubRow } from './quotaMiddleware';
export { runSentinelScan, auditSecurityOnEdge } from './sentinel';
export type { SentinelTarget } from './sentinel';

/** Best-effort per-isolate limits (see security.ts). Authenticated hosted-key use is also metered in KV. */
const limiter = new RateLimiter();
const RATE_API_PER_MIN = 120; // any /api/* call, per IP
const RATE_PROVIDER_PER_MIN = 60; // provider / sidecar relays, per IP
const RATE_AUTH_PER_MIN = 20; // initData validation endpoints, per IP

async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');
  const cors = corsHeaders(env, request);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const withCors = async (p: Promise<Response> | Response) => {
    const r = await p;
    Object.entries(cors).forEach(([k, v]) => r.headers.set(k, v));
    return r;
  };

  // Best-effort per-IP throttling. Telegram's webhook is exempt (it is authenticated by secret token).
  const ip = clientIp(request);
  const limited = (bucket: string, perMin: number) => {
    const r = limiter.check(`${bucket}:${ip}`, perMin, 60_000);
    return r.allowed ? null : withCors(json({ error: 'Too many requests. Slow down and try again.' }, 429, { 'Retry-After': String(r.retryAfterSec) }));
  };
  if (path !== '/telegram/webhook') {
    const hit = limited('api', RATE_API_PER_MIN);
    if (hit) return hit;
  }

  if (path === '/health') {
    if (request.method !== 'GET') return withCors(json({ error: 'Method not allowed' }, 405));
    const configured = Object.fromEntries(Object.keys(PROVIDERS).map(id => [id, PROVIDERS[id].auth(env, new Headers(), {}).ok]));
    return withCors(json({
      ok: true,
      providers: configured,
      byok: Object.keys(PROVIDERS),
      tiers: {
        free: ['groq'],
        paid: ['nim', 'ollama', 'openrouter'],
      },
      sidecars: {
        languagetool: isSidecarConfigured(env, 'languagetool'),
        umami: isSidecarConfigured(env, 'umami'),
      },
      telegram: Boolean(env.BOT_TOKEN),
      firebase: Boolean(env.FIREBASE_PROJECT_ID),
      ton: true,
      tonPricing: TON_PRICING,
      requireAuth: env.REQUIRE_TG_AUTH === 'true',
      requireSubscription: env.REQUIRE_SUBSCRIPTION === 'true',
      freeDailyLimit: Number(env.FREE_DAILY_LIMIT || 0),
      plans: PLANS,
    }));
  }

  if (path === '/desktop/latest') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return withCors(json({ error: 'Method not allowed' }, 405));
    }
    return withCors(desktopLatestJson(env));
  }

  if (path === '/auth/session') {
    if (request.method !== 'GET') return withCors(json({ error: 'Method not allowed' }, 405));
    const hit = limited('auth', RATE_AUTH_PER_MIN);
    if (hit) return hit;
    const who = await identify(request, env);
    if (who.error) return withCors(json({ ok: false, error: who.error }, 401));
    if (!who.user) return withCors(json({ ok: false, error: 'Not signed in' }, 401));
    const { org, membership } = await getOrCreateUserOrg(env, who.user);
    return withCors(json({
      ok: true,
      user: who.user,
      accountId: billingId(who.user),
      linked: Boolean(who.user.accountId && who.user.accountId !== who.user.id),
      org: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        tier: org.tier,
        role: membership.role,
      },
    }));
  }

  // Explicit link: send BOTH Telegram initData and Firebase Bearer in one request.
  if (path === '/auth/link') {
    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    const hit = limited('auth', RATE_AUTH_PER_MIN);
    if (hit) return hit;
    const initData = request.headers.get('x-telegram-init-data');
    const bearer = bearerFromAuthorization(request.headers.get('authorization'));
    if (!initData || !bearer) {
      return withCors(json({
        ok: false,
        error: 'Open the Mini App in Telegram, sign in with email/Google there, then try Link again. Both Telegram and Firebase must be present.',
      }, 400));
    }
    if (!env.BOT_TOKEN || !env.FIREBASE_PROJECT_ID) {
      return withCors(json({ ok: false, error: 'Server linking is not configured' }, 503));
    }
    const tg = await validateInitData(initData, env.BOT_TOKEN);
    if (!tg.ok) return withCors(json({ ok: false, error: tg.reason }, 401));
    const fb = await verifyFirebaseIdToken(bearer, env.FIREBASE_PROJECT_ID);
    if (!fb.ok) return withCors(json({ ok: false, error: fb.reason }, 401));
    const linked = await linkTelegramAndFirebase(
      env,
      String(tg.user.id),
      fb.user.uid,
      {
        email: fb.user.email,
        name: fb.user.name,
        tgName: [tg.user.first_name, tg.user.last_name].filter(Boolean).join(' ') || tg.user.username,
      },
    );
    return withCors(json({ ok: true, ...linked }));
  }

  // Per-account workspace (DNA, VFS, audits, chat, optional BYOK keys).
  if (path === '/workspace') {
    const who = await identify(request, env);
    if (who.error || !who.user) return withCors(json({ ok: false, error: who.error || 'Sign in required' }, 401));
    const accountId = billingId(who.user);

    if (request.method === 'GET') {
      const record = await getWorkspace(env, accountId);
      return withCors(json({
        ok: true,
        accountId,
        updatedAt: record?.updatedAt ?? 0,
        payload: record?.payload ?? {},
      }));
    }

    if (request.method === 'PUT') {
      const read = await readBody(request, MAX_SMALL_BODY_BYTES);
      if (!read.ok) return withCors(json({ error: read.error }, read.status));
      const body = (read.value || {}) as { updatedAt?: number; payload?: WorkspacePayload; force?: boolean };
      const clientUpdatedAt = Number(body.updatedAt || 0);
      const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
      const existing = await getWorkspace(env, accountId);
      if (existing && !body.force && existing.updatedAt > clientUpdatedAt) {
        return withCors(json({
          ok: false,
          conflict: true,
          accountId,
          updatedAt: existing.updatedAt,
          payload: existing.payload,
        }, 409));
      }
      const updatedAt = Math.max(clientUpdatedAt, Date.now());
      const saved = await putWorkspace(env, accountId, payload, updatedAt);

      // Enterprise Audit Log: record sync event asynchronously
      try {
        const { org } = await getOrCreateUserOrg(env, who.user);
        await recordAuditLog(env, {
          org_id: org.id,
          actor_id: who.user.id,
          action: 'workspace.sync',
          details: {
            hasEncryptedKeys: Boolean(payload.encryptedKeys),
            keyCount: Object.keys(payload.keys || {}).length,
            storageItemCount: Object.keys(payload.storage || {}).length,
          },
          ip_address: clientIp(request),
          user_agent: request.headers.get('user-agent') || undefined,
        });
      } catch {
        /* ignore audit log recording errors in request path */
      }

      return withCors(json({ ok: true, accountId, updatedAt: saved.updatedAt }));
    }

    return withCors(json({ error: 'Method not allowed' }, 405));
  }

  if (path === '/enterprise/audit-logs') {
    if (request.method !== 'GET') return withCors(json({ error: 'Method not allowed' }, 405));
    const who = await identify(request, env);
    if (who.error || !who.user) return withCors(json({ ok: false, error: who.error || 'Sign in required' }, 401));

    const { org, membership } = await getOrCreateUserOrg(env, who.user);
    if (!hasPermission(membership.role, 'canViewLogs')) {
      return withCors(json({ ok: false, error: 'Forbidden: Auditor or Admin role required' }, 403));
    }

    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);
    const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);

    const logs = await getAuditLogs(env, org.id, { limit, offset });
    return withCors(json({
      ok: true,
      orgId: org.id,
      orgName: org.name,
      role: membership.role,
      total: logs.total,
      entries: logs.entries,
    }));
  }

  if (path === '/auth/quota') {
    if (request.method !== 'GET') return withCors(json({ error: 'Method not allowed' }, 405));
    const who = await identify(request, env);
    const limit = Number(env.FREE_DAILY_LIMIT || 0);
    const now = new Date();
    const midnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const resetSec = Math.max(0, Math.floor((midnightUtc.getTime() - now.getTime()) / 1000));

    if (!who.user) {
      return withCors(json({
        ok: true,
        authenticated: false,
        limit,
        used: 0,
        remaining: limit,
        resetSec,
        isUnlimited: false,
      }));
    }

    const accountId = billingId(who.user);
    let sub: SubRow | null = null;
    if (env.LUMINARA_KV) {
      sub = (await env.LUMINARA_KV.get(`sub:${accountId}`, 'json')) as SubRow | null;
      if (!sub?.expiresAt || sub.expiresAt <= Date.now()) {
        const legacy = (await env.LUMINARA_KV.get(`sub:${who.user.id}`, 'json')) as SubRow | null;
        if (legacy?.expiresAt && legacy.expiresAt > Date.now()) sub = legacy;
      }
    }
    const isSubActive = Boolean(sub?.expiresAt && sub.expiresAt > Date.now());

    if (isSubActive) {
      return withCors(json({
        ok: true,
        authenticated: true,
        accountId,
        plan: sub!.plan,
        expiresAt: sub!.expiresAt,
        limit: -1,
        used: 0,
        remaining: -1,
        resetSec,
        isUnlimited: true,
      }));
    }

    const day = now.toISOString().slice(0, 10);
    const used = env.LUMINARA_KV ? Number((await env.LUMINARA_KV.get(`quota:${accountId}:${day}`)) || 0) : 0;

    return withCors(json({
      ok: true,
      authenticated: true,
      accountId,
      plan: 'free',
      limit,
      used,
      remaining: Math.max(0, limit - used),
      resetSec,
      isUnlimited: limit <= 0,
    }));
  }

  const m = path.match(/^\/providers\/([a-z]+)(\/.*)$/);
  if (m) {
    const hit = limited('relay', RATE_PROVIDER_PER_MIN);
    if (hit) return hit;
    return withCors(proxyProvider(request, env, m[1], m[2]));
  }

  const s = path.match(/^\/sidecars\/([a-z]+)(\/.*)$/);
  if (s) {
    if (s[1] !== 'languagetool' && s[1] !== 'umami') return withCors(json({ error: `Unknown sidecar "${s[1]}"` }, 404));
    const hit = limited('relay', RATE_PROVIDER_PER_MIN);
    if (hit) return hit;
    return withCors(proxySidecar(request, env, s[1] as SidecarId, s[2]));
  }

  if (path === '/telegram/webhook') {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!env.BOT_TOKEN) return json({ error: 'BOT_TOKEN not configured' }, 503);
    if (!env.TELEGRAM_WEBHOOK_SECRET) return json({ error: 'TELEGRAM_WEBHOOK_SECRET not configured' }, 503);
    const secret = request.headers.get('x-telegram-bot-api-secret-token') || '';
    if (!secretEquals(secret, env.TELEGRAM_WEBHOOK_SECRET)) return json({ error: 'bad secret' }, 401);
    const read = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!read.ok) return json({ error: read.error }, read.status);
    ctx.waitUntil(handleTelegramUpdate(read.value, env));
    return json({ ok: true });
  }

  if (path === '/telegram/auth' || path === '/telegram/invoice') {
    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    const hit = limited('auth', RATE_AUTH_PER_MIN);
    if (hit) return hit;
    const read = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!read.ok) return withCors(json({ error: read.error }, read.status));
    const { initData, plan } = (read.value || {}) as { initData?: unknown; plan?: unknown };
    if (typeof initData !== 'string' || !initData) return withCors(json({ error: 'initData required' }, 400));
    if (!env.BOT_TOKEN) return withCors(json({ error: 'BOT_TOKEN not configured' }, 503));
    const v = await validateInitData(initData, env.BOT_TOKEN);
    if (!v.ok) return withCors(json({ error: v.reason }, 401));

    if (path === '/telegram/auth') {
      const tgIdentity: HostedIdentity = { id: String(v.user.id), source: 'telegram' };
      const sub = await getActiveSubscription(env, tgIdentity);
      const resolvedSub = sub || (env.LUMINARA_KV ? await env.LUMINARA_KV.get(`sub:${v.user.id}`, 'json') : null);
      return withCors(json({ ok: true, user: v.user, subscription: resolvedSub, startParam: v.startParam }));
    }
    if (typeof plan !== 'string' || !plan) return withCors(json({ error: 'initData and plan required' }, 400));
    const link = await createInvoiceLink(env, v.user.id, normalizePlanId(plan));
    return withCors(link.ok ? json({ ok: true, url: link.url }) : json({ error: link.error }, 400));
  }

  if (path === '/telegram/refund') {
    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    const hit = limited('auth', RATE_AUTH_PER_MIN);
    if (hit) return hit;

    const secret = request.headers.get('x-telegram-bot-api-secret-token') || request.headers.get('x-admin-secret') || '';
    const isSecretAuthorized = Boolean(env.TELEGRAM_WEBHOOK_SECRET && secretEquals(secret, env.TELEGRAM_WEBHOOK_SECRET));

    if (!isSecretAuthorized) {
      const who = await identify(request, env);
      const adminIds = (env.TELEGRAM_ADMIN_ID || '').split(',').map(s => s.trim()).filter(Boolean);
      const isUserAdmin = Boolean(who.user && adminIds.includes(who.user.id));
      if (!isUserAdmin) return withCors(json({ error: 'Unauthorized refund request' }, 401));
    }

    const read = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!read.ok) return withCors(json({ error: read.error }, read.status));
    const { userId, chargeId } = (read.value || {}) as { userId?: number | string; chargeId?: string };
    if (!userId || !chargeId) return withCors(json({ error: 'userId and chargeId are required' }, 400));

    const result = await refundStarPayment(env, Number(userId), String(chargeId));
    return withCors(json(result, result.ok ? 200 : 400));
  }

  if (path === '/admin/users') {
    if (request.method !== 'GET') return withCors(json({ error: 'Method not allowed' }, 405));
    const hit = limited('auth', RATE_AUTH_PER_MIN);
    if (hit) return hit;

    const secret = request.headers.get('x-telegram-bot-api-secret-token') || request.headers.get('x-admin-secret') || '';
    const isSecretAuthorized = Boolean(env.TELEGRAM_WEBHOOK_SECRET && secretEquals(secret, env.TELEGRAM_WEBHOOK_SECRET));

    if (!isSecretAuthorized) {
      const who = await identify(request, env);
      const adminIds = (env.TELEGRAM_ADMIN_ID || '').split(',').map(s => s.trim()).filter(Boolean);
      const isUserAdmin = Boolean(who.user && adminIds.includes(who.user.id));
      if (!isUserAdmin) return withCors(json({ error: 'Unauthorized' }, 401));
    }

    const users = await listAllUsers(env, 200);
    return withCors(json({ ok: true, total: users.length, users }));
  }

  if (path === '/ton/invoice' || path === '/ton/verify') {
    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    const hit = limited('auth', RATE_AUTH_PER_MIN);
    if (hit) return hit;
    const read = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!read.ok) return withCors(json({ error: read.error }, read.status));

    if (path === '/ton/invoice') {
      const { planId } = (read.value || {}) as { planId?: string };
      if (!planId) return withCors(json({ error: 'planId required' }, 400));
      const who = await identify(request, env);
      if (!who.user) return withCors(json({ error: who.error || 'Sign in required' }, 401));
      const result = await createTonInvoice(env, who.user.id, planId);
      return withCors(result.ok ? json(result) : json({ error: result.error }, 400));
    }

    if (path === '/ton/verify') {
      const { orderId } = (read.value || {}) as { orderId?: string };
      if (!orderId) return withCors(json({ error: 'orderId required' }, 400));
      const who = await identify(request, env);
      if (!who.user) return withCors(json({ error: who.error || 'Sign in required' }, 401));
      const result = await verifyTonPayment(env, orderId, { expectedUserId: who.user.id });
      return withCors(result.ok ? json(result) : json({ error: result.error }, 400));
    }
  }

  // Temporary License Key Activation (growth trial passes & enterprise licenses)
  if (path === '/license/activate') {
    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    const hit = limited('auth', RATE_AUTH_PER_MIN);
    if (hit) return hit;
    const who = await identify(request, env);
    if (!who.user) return withCors(json({ error: who.error || 'Sign in required' }, 401));
    const read = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!read.ok) return withCors(json({ error: read.error }, read.status));
    const { key } = (read.value || {}) as { key?: string };
    if (!key) return withCors(json({ error: 'License key is required' }, 400));
    const result = await activateLicenseKey(env, who.user.id, key);
    return withCors(json(result, result.ok ? 200 : 400));
  }

  // Admin License Key Generation
  if (path === '/admin/license/generate') {
    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    const hit = limited('auth', RATE_AUTH_PER_MIN);
    if (hit) return hit;

    const secret = request.headers.get('x-telegram-bot-api-secret-token') || request.headers.get('x-admin-secret') || '';
    const isSecretAuthorized = Boolean(env.TELEGRAM_WEBHOOK_SECRET && secretEquals(secret, env.TELEGRAM_WEBHOOK_SECRET));

    if (!isSecretAuthorized) {
      const who = await identify(request, env);
      const adminIds = (env.TELEGRAM_ADMIN_ID || '').split(',').map(s => s.trim()).filter(Boolean);
      const isUserAdmin = Boolean(who.user && adminIds.includes(who.user.id));
      if (!isUserAdmin) return withCors(json({ error: 'Unauthorized' }, 401));
    }

    const read = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!read.ok) return withCors(json({ error: read.error }, read.status));
    const body = (read.value || {}) as {
      plan?: string;
      durationDays?: number;
      count?: number;
      campaign?: string;
      isTrial?: boolean;
    };
    if (!body.plan) return withCors(json({ error: 'plan is required' }, 400));
    const keys = await generateLicenseKeys(env, {
      plan: body.plan,
      durationDays: body.durationDays || 3,
      count: body.count || 1,
      campaign: body.campaign,
      isTrial: body.isTrial,
    });
    return withCors(json({ ok: true, count: keys.length, keys }));
  }

  // Admin: seed known serial keys into KV (idempotent; does not overwrite redeemed keys)
  if (path === '/admin/license/seed') {
    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    const hitSeed = limited('auth', RATE_AUTH_PER_MIN);
    if (hitSeed) return hitSeed;

    const seedSecret = request.headers.get('x-telegram-bot-api-secret-token') || request.headers.get('x-admin-secret') || '';
    const seedAuthorized = Boolean(env.TELEGRAM_WEBHOOK_SECRET && secretEquals(seedSecret, env.TELEGRAM_WEBHOOK_SECRET));
    if (!seedAuthorized) {
      const who = await identify(request, env);
      const adminIds = (env.TELEGRAM_ADMIN_ID || '').split(',').map(s => s.trim()).filter(Boolean);
      const isUserAdmin = Boolean(who.user && adminIds.includes(who.user.id));
      if (!isUserAdmin) return withCors(json({ error: 'Unauthorized' }, 401));
    }

    const seedRead = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!seedRead.ok) return withCors(json({ error: seedRead.error }, seedRead.status));
    const seedBody = (seedRead.value || {}) as {
      keys?: Array<{
        key?: string;
        plan?: string;
        durationDays?: number;
        isTrial?: boolean;
        campaign?: string;
        maxRedemptions?: number;
      }>;
    };
    if (!Array.isArray(seedBody.keys) || seedBody.keys.length === 0) {
      return withCors(json({ error: 'keys array is required' }, 400));
    }
    if (seedBody.keys.length > 200) {
      return withCors(json({ error: 'At most 200 keys per seed request' }, 400));
    }
    const seeds = seedBody.keys
      .filter((k) => k && typeof k.key === 'string' && typeof k.plan === 'string')
      .map((k) => ({
        key: String(k.key),
        plan: String(k.plan),
        durationDays: Number(k.durationDays) || 3,
        isTrial: k.isTrial,
        campaign: k.campaign,
        maxRedemptions: k.maxRedemptions,
      }));
    const result = await importLicenseKeys(env, seeds);
    return withCors(json({ ok: true, ...result, requested: seeds.length }));
  }

  // Blockchain Proof-of-Audit attestation verification & storage
  if (path === '/agent/attest') {
    return withCors(handleAgentAttestation(request, env));
  }

  // Drift Sentinel targets
  if (path === '/sentinel/register' || path === '/sentinel/status') {
    return withCors(handleSentinelRoute(request, env, path));
  }

  if (path === '/enrichment/entity') {
    return withCors(handleEntityEnrichment(request, env));
  }

  return withCors(json({ error: 'Not found' }, 404));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return withSecurityHeaders(await handleApi(request, env, ctx));
      } catch (e) {
        // Never echo internal error details (stack traces, upstream messages, env hints) to callers.
        console.error('[api] unhandled error', request.method, url.pathname, e);
        return withSecurityHeaders(json({ error: 'Internal error' }, 500));
      }
    }

    // Direct resolution for BotFather, crawlers, and web visitors requesting the Privacy Policy
    if (
      url.pathname === '/privacy' ||
      url.pathname === '/privacy/' ||
      url.pathname === '/privacy.html' ||
      url.pathname === '/privacy-policy' ||
      url.pathname === '/privacy-policy/'
    ) {
      return withSecurityHeaders(
        new Response(PRIVACY_HTML, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        }),
      );
    }

    // Windows desktop installer: R2 mirror when bound, otherwise GitHub Releases.
    if (url.pathname === '/desktop/windows' || url.pathname === '/desktop/windows/') {
      return withSecurityHeaders(await desktopWindowsDownload(env, request));
    }

    // Static assets with SPA fallback (configured in wrangler.jsonc); security headers + CSP on the HTML shell.
    const assetResponse = await env.ASSETS.fetch(request);
    // Vite hashed files under /assets must never fall through to index.html. SPA HTML for a
    // missing *.js chunk makes dynamic import() fail with "Failed to fetch dynamically imported module".
    const contentType = assetResponse.headers.get('content-type') || '';
    if (
      url.pathname.startsWith('/assets/') &&
      assetResponse.ok &&
      contentType.includes('text/html')
    ) {
      return withSecurityHeaders(
        new Response('Not found', {
          status: 404,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        }),
      );
    }
    return withSecurityHeaders(assetResponse);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runSentinelScan(env));
  },
} satisfies ExportedHandler<Env>;
