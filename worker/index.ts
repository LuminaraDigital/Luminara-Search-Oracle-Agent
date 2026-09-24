/**
 * Luminara Suite - Cloudflare Worker
 *
 * Serves the built Vite app as static assets and exposes a small API:
 *   GET  /api/health                      which providers are configured server-side
 *   GET  /api/auth/session                current Telegram or Firebase identity (if signed in)
 *   POST /api/auth/reset-password         IP-throttled password reset (anti-enumeration)
 *   POST /api/auth/sign-up                IP-throttled Identity Toolkit sign-up
 *   POST /api/auth/sign-in                IP-throttled Identity Toolkit sign-in
 *   POST /api/auth/request-otp            IP-throttled OTP (Twilio when enabled; else 501)
 *   POST /api/auth/verify-otp             IP-throttled OTP verify (when SMS enabled)
 *   POST /api/auth/send-verification      Dual-key email verification trigger (neutral body)
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
import { handleTelegramUpdate, createInvoiceLink, refundStarPayment, normalizePlanId, PLANS, planCapsFor } from './telegramBot';
import { createTonInvoice, verifyTonPayment, isTonPaymentConfigured, TON_PRICING } from './tonPayment';
import { activateLicenseKey, generateLicenseKeys, importLicenseKeys } from './licenseService';
import { PRIVACY_HTML } from './privacyPolicy';
import { TERMS_HTML } from './termsPolicy';
import { LLMS_TXT, ROBOTS_TXT, SITEMAP_XML, buildSitemapXml } from './crawlDocuments';
import { maybeServeMarketingHtml } from './marketingShell';
import { desktopLatestJson, desktopWindowsDownload } from './desktopDownloads';
import {
  MAX_SMALL_BODY_BYTES,
  RateLimiter,
  clientIp,
  readBody,
  withSecurityHeaders,
} from './security';
import {
  linkTelegramAndFirebase,
  getWorkspace,
  putWorkspace,
  listAllUsers,
  withAccountId,
  upsertAppUser,
} from './userStore';
import { getOrCreateUserOrg, hasPermission } from './enterpriseStore';
import { recordAuditLog, getAuditLogs, recordAuditLogBestEffort } from './auditLog';
import { isAdminAuthorized } from './adminAuth';

import { applyCorsHeaders, corsHeaders, identify, json, secretEquals, billingId } from './workerUtils';
import { getActiveSubscription, checkHostedQuota, type SubRow } from './quotaMiddleware';
import { proxySidecar, isSidecarConfigured, type SidecarId } from './sidecarRelay';
import { proxyProvider, PROVIDERS } from './providerRelay';
import { runSentinelScan, handleSentinelRoute } from './sentinel';
import { handleEntityEnrichment } from './enrichmentService';
import { handleAgentAttestation } from './attestationService';
import { checkTelegramUpdateThrottle } from './webhookThrottle';
import {
  guardApiRoute,
  buildSessionCookie,
  buildLogoutCookie,
  verifyWebhookSignature,
  getSessionTokenFromCookie,
} from './authMiddleware';
import { guardApiAccessRoute, resolveMcpUser } from './apiAccess';
import { handleShareRoute } from './shareService';
import { handleMcpRequest, listMcpToolCatalogue } from './mcpServer';
import { handleOracleChatSse, isOracleServerEnabled } from './oracleChat';
import { OracleSession } from './oracleSession';
import { handlePagespeedRoute } from './pagespeedRoute';
import {
  enqueueAuditRun,
  getAuditRun,
  isAuditQueueEnabled,
  processAuditQueueBatch,
} from './auditQueue';
import { handleMcpOAuthRoute } from './mcpOAuth';
import { createMemoryFact, listMemoryFacts } from './memoryService';
import {
  enforceDualRateLimit,
  enforceDualKeySlidingLimit,
  enforceEdgeBindingLimit,
  projectAdminUser,
  rateLimitedResponse,
  sanitizeWorkspaceWrite,
  withRateLimitHeaders,
} from './securityHardening';
import { handlePasswordResetRequest, handleSendVerification } from './authTollFraud';
import { handleRequestOtp, handleVerifyOtp } from './authOtpSms';
import { handleSignIn, handleSignUp } from './authCredentialGateway';

export { OracleSession };
import { createProject, listProjects, getProject } from './projectService';
import { getProjectContext, updateProjectContext, seedContextFromDna } from './projectContextService';
import { getAgentReport, listAgentReports, saveAgentReport, getAgentReportHtmlForAccount } from './agentReportService';
import { createApiKey, listApiKeys, revokeApiKey } from './apiKeyService';
import type { ProjectContextPatch } from '../services/projects/types';
import type { BusinessDNA } from '../types';

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
export { guardApiRoute, buildSessionCookie, buildLogoutCookie } from './authMiddleware';
export { requireApiAccess, isApiAccessRoute, guardApiAccessRoute, requireMcpAccess, isMcpAccessRoute } from './apiAccess';

/** Best-effort per-isolate limits (see security.ts). Authenticated hosted-key use is also metered in KV. */
const limiter = new RateLimiter();
const telegramLimiter = new RateLimiter();
const RATE_API_PER_MIN = 120; // any /api/* call, per IP
const RATE_PROVIDER_PER_MIN = 60; // provider / sidecar relays, per IP
const RATE_AUTH_PER_MIN = 20; // initData validation endpoints, per IP
const RATE_MCP_PER_MIN = 60;
const RATE_ORACLE_PER_MIN = 10;
const RATE_AUDIT_PER_MIN = 5;
const RATE_ENRICHMENT_PER_MIN = 20;
const RATE_SHARE_PUBLIC_PER_MIN = 30;
const RATE_HIGH_COST_EDGE = 20;

/**
 * System org bucket for admin-actor audit events (key mint/seed, user dump, refunds).
 * There is no real organization behind operator actions, but the hash-chained log
 * requires an org_id; this sentinel keeps money/admin events in one reviewable chain.
 */
const ADMIN_SYSTEM_ORG = 'org_system_admin';

async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');
  const cors = corsHeaders(env, request);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const withCors = async (p: Promise<Response> | Response) => {
    const r = await p;
    return applyCorsHeaders(r, cors);
  };

  // Best-effort per-IP throttling. Telegram's webhook skips it (shared Telegram IPs); it is secret-checked and soft-throttled per chat below.
  const ip = clientIp(request);
  const limited = (bucket: string, perMin: number) => {
    const r = limiter.check(`${bucket}:${ip}`, perMin, 60_000);
    if (r.allowed) return null;
    return withCors(
      rateLimitedResponse({
        limit: perMin,
        remaining: 0,
        windowSec: 60,
        retryAfterSec: r.retryAfterSec,
      }),
    );
  };
  if (path !== '/telegram/webhook') {
    const hit = limited('api', RATE_API_PER_MIN);
    if (hit) return hit;

    // Edge binding (Workers Rate Limiting GA): multi-isolate within a colo.
    const edge = await enforceEdgeBindingLimit(env.API_RATE_LIMITER, `api:${ip}`, {
      action: 'api_edge',
      limit: RATE_API_PER_MIN,
      windowSec: 60,
    });
    if (!edge.ok) return withCors(edge.response);
  }

  const isHighCostPath =
    path.startsWith('/providers/') ||
    path === '/mcp' ||
    path.startsWith('/mcp/') ||
    path === '/oracle/chat' ||
    path === '/audit/run' ||
    path === '/enrichment/entity' ||
    path === '/pagespeed';
  if (isHighCostPath) {
    const edgeHigh = await enforceEdgeBindingLimit(env.HIGH_COST_RATE_LIMITER, `hc:${ip}:${path.split('/')[1] || 'root'}`, {
      action: 'high_cost_edge',
      limit: RATE_HIGH_COST_EDGE,
      windowSec: 60,
    });
    if (!edgeHigh.ok) return withCors(edgeHigh.response);
  }

  // Universal Edge Route Guard: intercepts unauthenticated requests to protected endpoints
  const guard = await guardApiRoute(request, env, path);
  if (guard) return withCors(guard);

  // Agency API surfaces require apiAccess (Pro / Agency) after authentication
  const apiAccessGuard = await guardApiAccessRoute(request, env, path);
  if (apiAccessGuard) return withCors(apiAccessGuard);

  if (path === '/health') {
    if (request.method !== 'GET') return withCors(json({ error: 'Method not allowed' }, 405));
    const configured = Object.fromEntries(Object.keys(PROVIDERS).map(id => [id, PROVIDERS[id].auth(env, new Headers(), {}).ok]));
    return withCors(json({
      ok: true,
      providers: configured,
      byok: Object.keys(PROVIDERS),
      tiers: {
        free: ['groq'],
        paid: ['nim', 'ollama', 'openrouter', 'dataforseo'],
      },
      sidecars: {
        languagetool: isSidecarConfigured(env, 'languagetool'),
        umami: isSidecarConfigured(env, 'umami'),
      },
      telegram: Boolean(env.BOT_TOKEN),
      firebase: Boolean(env.FIREBASE_PROJECT_ID),
      appCheckRequired: String(env.REQUIRE_APP_CHECK || '').toLowerCase() === 'true',
      mcpOAuthConfigured: Boolean(String(env.MCP_OAUTH_SECRET || '').trim()),
      pagespeedHosted: Boolean(String(env.PAGESPEED_API_KEY || '').trim()),
      ton: isTonPaymentConfigured(env),
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
    const hit = limited('auth', RATE_AUTH_PER_MIN);
    if (hit) return hit;

    if (request.method === 'GET') {
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

    if (request.method === 'POST') {
      const read = await readBody(request, MAX_SMALL_BODY_BYTES);
      if (!read.ok) return withCors(json({ error: read.error }, read.status));
      const body = (read.value || {}) as { idToken?: string };
      const bearer = bearerFromAuthorization(request.headers.get('authorization'));
      const idToken = String(body.idToken || bearer || '').trim();
      if (!idToken) {
        return withCors(json({ ok: false, error: 'idToken is required' }, 400));
      }
      if (!env.FIREBASE_PROJECT_ID) {
        return withCors(json({ ok: false, error: 'FIREBASE_PROJECT_ID not configured' }, 503));
      }
      const verified = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
      if (!verified.ok) {
        return withCors(json({ ok: false, error: verified.reason }, 401));
      }
      const fbIdentity: HostedIdentity = {
        id: `fb:${verified.user.uid}`,
        source: 'firebase',
        email: verified.user.email,
        name: verified.user.name,
      };
      const stored = await withAccountId(env, fbIdentity);
      const { org, membership } = await getOrCreateUserOrg(env, stored);

      const cookieHeader = buildSessionCookie(idToken);
      const res = json({
        ok: true,
        user: stored,
        accountId: billingId(stored),
        org: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          tier: org.tier,
          role: membership.role,
        },
      }, 200, { 'Set-Cookie': cookieHeader });
      return withCors(res);
    }

    return withCors(json({ error: 'Method not allowed' }, 405));
  }

  if (path === '/auth/logout') {
    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    const cookieHeader = buildLogoutCookie();
    return withCors(json({ ok: true, message: 'Signed out successfully' }, 200, { 'Set-Cookie': cookieHeader }));
  }

  // Public password reset: IP sliding window + burst + outbound killswitch before Identity Toolkit.
  if (path === '/auth/reset-password') {
    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    const hit = limited('auth', RATE_AUTH_PER_MIN);
    if (hit) return hit;
    return withCors(handlePasswordResetRequest(request, env, ip));
  }

  // Worker-mediated email/password (credential stuffing defense + anti-enumeration).
  if (path === '/auth/sign-up') {
    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    const hit = limited('auth', RATE_AUTH_PER_MIN);
    if (hit) return hit;
    return withCors(handleSignUp(request, env, ip));
  }
  if (path === '/auth/sign-in') {
    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    const hit = limited('auth', RATE_AUTH_PER_MIN);
    if (hit) return hit;
    return withCors(handleSignIn(request, env, ip));
  }

  // Public OTP: rate-gated; Twilio SMS only when OTP_SMS_ENABLED + secrets are set.
  if (path === '/auth/request-otp') {
    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    const hit = limited('auth', RATE_AUTH_PER_MIN);
    if (hit) return hit;
    return withCors(handleRequestOtp(request, env, ip));
  }
  if (path === '/auth/verify-otp') {
    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    const hit = limited('auth', RATE_AUTH_PER_MIN);
    if (hit) return hit;
    return withCors(handleVerifyOtp(request, env, ip));
  }

  // Authenticated email verification: dual-key uid+ip + outbound killswitch.
  if (path === '/auth/send-verification') {
    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    const hit = limited('auth', RATE_AUTH_PER_MIN);
    if (hit) return hit;
    const who = await identify(request, env);
    if (who.error || !who.user) {
      return withCors(json({ ok: false, error: who.error || 'Unauthorized', code: 'AUTH_REQUIRED' }, 401));
    }
    const bearer = bearerFromAuthorization(request.headers.get('authorization'));
    const cookieTok = getSessionTokenFromCookie(request);
    const idToken = String(bearer || cookieTok || '').trim();
    return withCors(
      handleSendVerification(request, env, ip, billingId(who.user), idToken),
    );
  }

  if (path === '/webhooks/auth') {
    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    if (!env.AUTH_WEBHOOK_SECRET) {
      return withCors(json({ ok: false, error: 'AUTH_WEBHOOK_SECRET is not configured on the server' }, 503));
    }
    const signature = request.headers.get('x-auth-signature') || request.headers.get('svix-signature') || '';
    const read = await readBody(request, MAX_SMALL_BODY_BYTES, false);
    if (!read.ok) return withCors(json({ error: read.error }, read.status));
    const isValid = await verifyWebhookSignature(read.text, signature, env.AUTH_WEBHOOK_SECRET);
    if (!isValid) {
      return withCors(json({ ok: false, error: 'Invalid webhook signature' }, 401));
    }
    let payload: any = {};
    try {
      payload = JSON.parse(read.text);
    } catch {
      return withCors(json({ ok: false, error: 'Malformed JSON payload' }, 400));
    }

    const event = payload.type || payload.event;
    const data = payload.data || payload.user || {};
    if (event === 'user.deleted' && data.id) {
      const targetId = String(data.id);
      if (env.DB) {
        await env.DB.prepare(`DELETE FROM users WHERE id = ? OR firebase_uid = ?`).bind(targetId, targetId.replace(/^fb:/, '')).run();
      }
      if (env.LUMINARA_KV) {
        await env.LUMINARA_KV.delete(`user:${targetId}`);
      }
    } else if ((event === 'user.created' || event === 'user.updated') && (data.uid || data.id)) {
      const uid = String(data.uid || data.id).replace(/^fb:/, '');
      const userObj: HostedIdentity = {
        id: `fb:${uid}`,
        source: 'firebase',
        email: data.email,
        name: data.displayName || data.name,
      };
      await withAccountId(env, userObj);
    }

    return withCors(json({ ok: true, processed: event || 'unknown' }));
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
      const writeLimit = await enforceDualRateLimit(env, {
        action: 'workspace_put',
        accountId,
        ip,
        limitPerKey: 30,
        windowSec: 60,
      });
      if (!writeLimit.ok) return withCors(writeLimit.response);

      const read = await readBody(request, MAX_SMALL_BODY_BYTES);
      if (!read.ok) return withCors(json({ error: read.error }, read.status));
      const body = (read.value || {}) as { updatedAt?: number; payload?: unknown; force?: boolean };
      const clientUpdatedAt = Number(body.updatedAt || 0);
      const sanitized = sanitizeWorkspaceWrite(body.payload ?? {});
      if (!sanitized.ok) return withCors(json({ ok: false, error: sanitized.error, code: 'INVALID_PAYLOAD' }, 400));
      const payload = sanitized.payload;
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
    const who = await identify(request, env);
    const dual = await enforceDualRateLimit(env, {
      action: 'provider_relay',
      accountId: who.user ? billingId(who.user) : null,
      ip,
      limitPerKey: RATE_PROVIDER_PER_MIN,
      windowSec: 60,
    });
    if (!dual.ok) return withCors(dual.response);
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
    const throttle = checkTelegramUpdateThrottle(read.value, telegramLimiter);
    if (!throttle.allowed) {
      console.warn('[telegram] webhook update throttled', throttle.key);
      return json({ ok: true });
    }
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

    // Admin route: requires the dedicated ADMIN_SECRET. The Telegram webhook secret
    // and Telegram admin ids no longer authorize HTTP refunds; in-bot /refund keeps
    // its own TELEGRAM_ADMIN_ID gate inside handleTelegramUpdate.
    const admin = isAdminAuthorized(env, request);
    if (!admin.ok) return withCors(admin.response);

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

    // Admin route: ADMIN_SECRET only (never Telegram user id, never the webhook secret).
    const admin = isAdminAuthorized(env, request);
    if (!admin.ok) return withCors(admin.response);

    const users = await listAllUsers(env, 200);

    // PII dump surface: record that an operator pulled the user list, not the rows.
    await recordAuditLogBestEffort(env, {
      org_id: ADMIN_SYSTEM_ORG,
      actor_id: 'admin',
      action: 'admin.users.dump',
      details: { count: users.length },
      ip_address: clientIp(request),
      user_agent: request.headers.get('user-agent') || undefined,
    });

    return withCors(json({
      ok: true,
      total: users.length,
      users: users.map(projectAdminUser),
    }));
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
    const accountId = billingId(who.user);
    const dual = await enforceDualRateLimit(env, {
      action: 'license_activate',
      accountId,
      ip,
      limitPerKey: 5,
      windowSec: 60,
    });
    if (!dual.ok) return withCors(dual.response);
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

    // Admin route: ADMIN_SECRET only.
    const admin = isAdminAuthorized(env, request);
    if (!admin.ok) return withCors(admin.response);

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

    // Money event: keys were minted. Log count and plan only; the key material is
    // returned to the caller once and never written to the audit chain.
    await recordAuditLogBestEffort(env, {
      org_id: ADMIN_SYSTEM_ORG,
      actor_id: 'admin',
      action: 'admin.license.generate',
      details: { plan: normalizePlanId(body.plan), count: keys.length, isTrial: Boolean(body.isTrial) },
      ip_address: clientIp(request),
      user_agent: request.headers.get('user-agent') || undefined,
    });

    return withCors(json({ ok: true, count: keys.length, keys }));
  }

  // Admin: seed known serial keys into KV (idempotent; does not overwrite redeemed keys)
  if (path === '/admin/license/seed') {
    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    const hitSeed = limited('auth', RATE_AUTH_PER_MIN);
    if (hitSeed) return hitSeed;

    // Admin route: ADMIN_SECRET only.
    const seedAdmin = isAdminAuthorized(env, request);
    if (!seedAdmin.ok) return withCors(seedAdmin.response);

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

    // Money event: record import outcome counts, never the key strings.
    await recordAuditLogBestEffort(env, {
      org_id: ADMIN_SYSTEM_ORG,
      actor_id: 'admin',
      action: 'admin.license.seed',
      details: { requested: seeds.length, imported: result.imported.length, skipped: result.skipped.length, invalid: result.invalid.length },
      ip_address: clientIp(request),
      user_agent: request.headers.get('user-agent') || undefined,
    });

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

  if (path === '/share/reports' || path.startsWith('/share/reports/')) {
    if (request.method === 'GET' && /^\/share\/reports\/[a-f0-9]{64}$/i.test(path)) {
      const dual = await enforceDualRateLimit(env, {
        action: 'share_public_get',
        accountId: null,
        ip,
        limitPerKey: RATE_SHARE_PUBLIC_PER_MIN,
        windowSec: 60,
      });
      if (!dual.ok) return withCors(dual.response);
    }
    return withCors(handleShareRoute(request, env, path));
  }

  if (path === '/enrichment/entity') {
    const who = await identify(request, env);
    const dual = await enforceDualRateLimit(env, {
      action: 'enrichment_entity',
      accountId: who.user ? billingId(who.user) : null,
      ip,
      limitPerKey: RATE_ENRICHMENT_PER_MIN,
      windowSec: 60,
    });
    if (!dual.ok) return withCors(dual.response);
    return withCors(handleEntityEnrichment(request, env));
  }

  // MCP OAuth 2.1 + PKCE (token + metadata public; authorize needs session)
  if (path.startsWith('/oauth/mcp')) {
    if (path === '/oauth/mcp/token' && request.method === 'POST') {
      const dual = await enforceDualRateLimit(env, {
        action: 'mcp_oauth_token',
        accountId: null,
        ip,
        limitPerKey: 10,
        windowSec: 60,
      });
      if (!dual.ok) return withCors(dual.response);
    }
    const oauthRes = await handleMcpOAuthRoute(request, env, path);
    if (oauthRes) return withCors(oauthRes);
  }

  // Hosted memory facts (W8 incremental)
  if (path === '/memory/facts') {
    const who = await identify(request, env);
    if (who.error || !who.user) {
      return withCors(json({ ok: false, error: who.error || 'Unauthorized', code: 'AUTH_REQUIRED' }, 401));
    }
    if (request.method === 'GET') return withCors(await listMemoryFacts(env, who.user));
    if (request.method === 'POST') {
      const dual = await enforceDualRateLimit(env, {
        action: 'memory_create',
        accountId: billingId(who.user),
        ip,
        limitPerKey: 20,
        windowSec: 60,
      });
      if (!dual.ok) return withCors(dual.response);
      return withCors(await createMemoryFact(request, env, who.user));
    }
    return withCors(json({ error: 'Method not allowed' }, 405));
  }

  // PageSpeed Insights (BYOK header or hosted PAGESPEED_API_KEY)
  if (path === '/pagespeed') {
    const who = await identify(request, env);
    if (who.error || !who.user) {
      return withCors(
        json(
          {
            ok: false,
            error:
              who.error ||
              'Sign in to use hosted PageSpeed, or add a Google PSI key in Settings (Search tab).',
            code: 'AUTH_REQUIRED',
          },
          401,
        ),
      );
    }
    const dual = await enforceDualRateLimit(env, {
      action: 'pagespeed',
      accountId: billingId(who.user),
      ip,
      limitPerKey: 10,
      windowSec: 60,
    });
    if (!dual.ok) return withCors(dual.response);
    return withCors(handlePagespeedRoute(request, env, who.user));
  }

  // APS: MCP (Growth+ mcpAccess; session, lm_live_* API key, or mcp_* OAuth token)
  if (path === '/mcp' || path.startsWith('/mcp/')) {
    const resolved = await resolveMcpUser(request, env);
    if ('response' in resolved) return withCors(resolved.response);
    const dual = await enforceDualRateLimit(env, {
      action: 'mcp',
      accountId: billingId(resolved.user),
      ip,
      limitPerKey: RATE_MCP_PER_MIN,
      windowSec: 60,
    });
    if (!dual.ok) return withCors(dual.response);
    return withCors(handleMcpRequest(request, env, resolved.user));
  }

  // APS: projects + context
  if (path === '/projects' || path.startsWith('/projects/')) {
    const who = await identify(request, env);
    if (who.error || !who.user) {
      return withCors(json({ ok: false, error: who.error || 'Unauthorized', code: 'AUTH_REQUIRED' }, 401));
    }
    const accountId = billingId(who.user);

    if (path === '/projects' && request.method === 'GET') {
      const projects = await listProjects(env, accountId);
      return withCors(json({ ok: true, projects }));
    }
    if (path === '/projects' && request.method === 'POST') {
      const body = await readBody(request, MAX_SMALL_BODY_BYTES);
      if (!body.ok) return withCors(json({ error: body.error }, body.status));
      const raw = JSON.parse(body.text || '{}') as Record<string, unknown>;
      const created = await createProject(env, accountId, {
        domain: String(raw.domain || ''),
        name: typeof raw.name === 'string' ? raw.name : undefined,
        clientId: typeof raw.clientId === 'string' ? raw.clientId : undefined,
      });
      if (!created.ok) return withCors(json({ ok: false, error: created.error }, created.status));
      if (raw.dna && typeof raw.dna === 'object') {
        await seedContextFromDna(env, accountId, created.project.id, raw.dna as BusinessDNA);
      }
      return withCors(json({ ok: true, project: created.project }));
    }

    const projMatch = path.match(/^\/projects\/([^/]+)(?:\/(context))?$/);
    if (projMatch) {
      const projectId = decodeURIComponent(projMatch[1]);
      const isContext = projMatch[2] === 'context';
      if (!isContext && request.method === 'GET') {
        const project = await getProject(env, accountId, projectId);
        if (!project) return withCors(json({ ok: false, error: 'Not found' }, 404));
        return withCors(json({ ok: true, project }));
      }
      if (isContext && request.method === 'GET') {
        const context = await getProjectContext(env, accountId, projectId);
        if (!context) return withCors(json({ ok: false, error: 'Not found' }, 404));
        return withCors(json({ ok: true, context }));
      }
      if (isContext && request.method === 'PATCH') {
        const body = await readBody(request, MAX_SMALL_BODY_BYTES);
        if (!body.ok) return withCors(json({ error: body.error }, body.status));
        const raw = JSON.parse(body.text || '{}') as { updates?: ProjectContextPatch[] };
        const updated = await updateProjectContext(
          env,
          accountId,
          projectId,
          Array.isArray(raw.updates) ? raw.updates : [],
          'user',
        );
        if (!updated.ok) return withCors(json({ ok: false, error: updated.error }, updated.status));
        return withCors(json({ ok: true, context: updated.context }));
      }
    }
    return withCors(json({ error: 'Method not allowed' }, 405));
  }

  // APS: agent reports
  if (path === '/reports' || path.startsWith('/reports/')) {
    const who = await identify(request, env);
    if (who.error || !who.user) {
      return withCors(json({ ok: false, error: who.error || 'Unauthorized', code: 'AUTH_REQUIRED' }, 401));
    }
    const accountId = billingId(who.user);
    if (path === '/reports' && request.method === 'GET') {
      const projectId = url.searchParams.get('projectId') || '';
      if (!projectId) return withCors(json({ ok: false, error: 'projectId required' }, 400));
      const reports = await listAgentReports(env, accountId, projectId);
      if (!reports) return withCors(json({ ok: false, error: 'Project not found' }, 404));
      return withCors(json({ ok: true, reports }));
    }
    if (path === '/reports' && request.method === 'POST') {
      const body = await readBody(request, 600_000);
      if (!body.ok) return withCors(json({ error: body.error }, body.status));
      const raw = JSON.parse(body.text || '{}') as Record<string, unknown>;
      const saved = await saveAgentReport(env, accountId, {
        projectId: String(raw.projectId || ''),
        title: String(raw.title || ''),
        summary: String(raw.summary || ''),
        html: String(raw.html || ''),
        skill: typeof raw.skill === 'string' ? raw.skill : undefined,
        reportId: typeof raw.reportId === 'string' ? raw.reportId : undefined,
        createdByLabel: 'web',
        createdByUserId: who.user.id,
      });
      if (!saved.ok) return withCors(json({ ok: false, error: saved.error }, saved.status));
      return withCors(json({ ok: true, report: saved.report }));
    }
    const rptMatch = path.match(/^\/reports\/([^/]+)(?:\/(html))?$/);
    if (rptMatch && request.method === 'GET') {
      const reportId = decodeURIComponent(rptMatch[1]);
      if (rptMatch[2] === 'html') {
        const doc = await getAgentReportHtmlForAccount(env, accountId, reportId);
        if (!doc) return withCors(json({ ok: false, error: 'Not found' }, 404));
        return withCors(
          new Response(doc.html, {
            status: 200,
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'content-security-policy':
                "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox allow-popups allow-popups-to-escape-sandbox",
              'x-content-type-options': 'nosniff',
            },
          }),
        );
      }
      const includeHtml = url.searchParams.get('includeHtml') === '1';
      const report = await getAgentReport(env, accountId, reportId, includeHtml);
      if (!report) return withCors(json({ ok: false, error: 'Not found' }, 404));
      return withCors(json({ ok: true, report }));
    }
    return withCors(json({ error: 'Method not allowed' }, 405));
  }

  // APS: API keys for MCP
  if (path === '/api-keys' || path.startsWith('/api-keys/')) {
    const who = await identify(request, env);
    if (who.error || !who.user) {
      return withCors(json({ ok: false, error: who.error || 'Unauthorized', code: 'AUTH_REQUIRED' }, 401));
    }
    const sub = await getActiveSubscription(env, who.user);
    const caps = planCapsFor(sub?.plan);
    if (!caps.mcpAccess) {
      return withCors(
        json(
          { ok: false, error: 'API keys require Growth or Agency', code: 'MCP_ACCESS_REQUIRED' },
          403,
        ),
      );
    }
    if (path === '/api-keys' && request.method === 'GET') {
      return withCors(json({ ok: true, keys: await listApiKeys(env, who.user), tools: listMcpToolCatalogue() }));
    }
    if (path === '/api-keys' && request.method === 'POST') {
      const dual = await enforceDualKeySlidingLimit(env, {
        action: 'api_key_create',
        uid: billingId(who.user),
        ip,
        maxRequests: 10,
        windowSeconds: 60 * 60 * 24,
      });
      if (!dual.ok) return withCors(dual.response);
      const body = await readBody(request, MAX_SMALL_BODY_BYTES);
      if (!body.ok) return withCors(json({ error: body.error }, body.status));
      const raw = JSON.parse(body.text || '{}') as { name?: string };
      const created = await createApiKey(env, who.user, raw.name || 'MCP key');
      if (!created.ok) return withCors(json({ ok: false, error: created.error }, created.status));
      return withCors(withRateLimitHeaders(json({ ok: true, key: created.key, meta: created.meta }), dual.headers));
    }
    const keyMatch = path.match(/^\/api-keys\/([^/]+)$/);
    if (keyMatch && request.method === 'DELETE') {
      const revokeLimit = await enforceDualKeySlidingLimit(env, {
        action: 'api_key_revoke',
        uid: billingId(who.user),
        ip,
        maxRequests: 20,
        windowSeconds: 60 * 60 * 24,
      });
      if (!revokeLimit.ok) return withCors(revokeLimit.response);
      const ok = await revokeApiKey(env, who.user, decodeURIComponent(keyMatch[1]));
      if (!ok) {
        return withCors(json({ ok: false, error: 'API key not found', code: 'NOT_FOUND' }, 404));
      }
      return withCors(withRateLimitHeaders(json({ ok: true }), revokeLimit.headers));
    }
    return withCors(json({ error: 'Method not allowed' }, 405));
  }

  // Agency API: Oracle SSE + audit queue (feature-flagged). Auth + apiAccess enforced above.
  if (path === '/oracle/chat' && request.method === 'POST') {
    if (!isOracleServerEnabled(env)) {
      return withCors(
        json(
          {
            ok: false,
            error: 'Server Oracle disabled. Set ORACLE_SERVER_ENABLED=true after staging soak.',
            code: 'ORACLE_DISABLED',
          },
          503,
        ),
      );
    }
    const who = await identify(request, env);
    if (who.error || !who.user) return withCors(json({ error: who.error || 'Unauthorized' }, 401));
    const dual = await enforceDualRateLimit(env, {
      action: 'oracle_chat',
      accountId: billingId(who.user),
      ip,
      limitPerKey: RATE_ORACLE_PER_MIN,
      windowSec: 60,
    });
    if (!dual.ok) return withCors(dual.response);
    return withCors(await handleOracleChatSse(request, env, who.user));
  }

  if (path === '/audit/run' && request.method === 'POST') {
    if (!isAuditQueueEnabled(env)) {
      return withCors(
        json(
          {
            ok: false,
            error: 'Audit queue disabled. Set AUDIT_QUEUE_ENABLED=true after staging soak.',
            code: 'AUDIT_DISABLED',
          },
          503,
        ),
      );
    }
    const who = await identify(request, env);
    if (who.error || !who.user) return withCors(json({ error: who.error || 'Unauthorized' }, 401));
    const dual = await enforceDualRateLimit(env, {
      action: 'audit_run',
      accountId: billingId(who.user),
      ip,
      limitPerKey: RATE_AUDIT_PER_MIN,
      windowSec: 60,
    });
    if (!dual.ok) return withCors(dual.response);
    return withCors(await enqueueAuditRun(request, env, who.user));
  }

  const auditGet = path.match(/^\/audit\/runs\/([^/]+)$/);
  if (auditGet && request.method === 'GET') {
    const who = await identify(request, env);
    if (who.error || !who.user) return withCors(json({ error: who.error || 'Unauthorized' }, 401));
    return withCors(await getAuditRun(env, who.user, decodeURIComponent(auditGet[1]!)));
  }

  if (
    path === '/oracle/chat' ||
    path.startsWith('/oracle/') ||
    path === '/audit/run' ||
    path.startsWith('/audit/') ||
    path === '/tools' ||
    path.startsWith('/tools/')
  ) {
    return withCors(
      json(
        {
          ok: false,
          error: 'Not implemented yet. Agency Oracle/audit APIs ship behind feature flags.',
          code: 'NOT_IMPLEMENTED',
        },
        501,
      ),
    );
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

    if (
      url.pathname === '/terms' ||
      url.pathname === '/terms/' ||
      url.pathname === '/terms.html' ||
      url.pathname === '/terms-of-service' ||
      url.pathname === '/terms-of-service/' ||
      url.pathname === '/tos' ||
      url.pathname === '/tos/'
    ) {
      return withSecurityHeaders(
        new Response(TERMS_HTML, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        }),
      );
    }

    // Crawl surfaces must never fall through to the SPA HTML shell.
    if (url.pathname === '/robots.txt') {
      return withSecurityHeaders(
        new Response(ROBOTS_TXT, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        }),
      );
    }
    if (url.pathname === '/sitemap.xml') {
      return withSecurityHeaders(
        new Response(SITEMAP_XML, {
          status: 200,
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        }),
      );
    }
    if (url.pathname === '/llms.txt') {
      return withSecurityHeaders(
        new Response(LLMS_TXT, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        }),
      );
    }

    // Windows desktop installer: R2 mirror when bound, otherwise GitHub Releases.
    if (url.pathname === '/desktop/windows' || url.pathname === '/desktop/windows/') {
      return withSecurityHeaders(await desktopWindowsDownload(env, request));
    }

    // Marketing paths: SPA shell with path-specific title, description, canonical and JSON-LD.
    const marketingHtml = await maybeServeMarketingHtml(request, env.ASSETS);
    if (marketingHtml) {
      return withSecurityHeaders(marketingHtml);
    }

    // Static assets with SPA fallback (configured in wrangler.jsonc); security headers + CSP on the HTML shell.
    const assetResponse = await env.ASSETS.fetch(request);
    // Hashed chunks under /assets/ and non-HTML static files (.ico, .png, .svg, .webmanifest, ...)
    // must never fall through to the SPA index.html shell. Returning 200 text/html for a
    // missing icon poisons Googlebot, Apple, and social crawlers with HTML bodies.
    const contentType = assetResponse.headers.get('content-type') || '';
    const isStaticFile =
      url.pathname.startsWith('/assets/') ||
      /\.(ico|png|jpe?g|gif|svg|webp|avif|webmanifest|json|xml|txt|map|css|js|woff2?|ttf|otf|eot|wasm)$/i.test(
        url.pathname,
      );
    if (isStaticFile && assetResponse.ok && contentType.includes('text/html')) {
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
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    await processAuditQueueBatch(batch as MessageBatch<{ runId: string; accountId: string; targetUrl: string; projectId?: string | null }>, env);
  },
} satisfies ExportedHandler<Env>;
