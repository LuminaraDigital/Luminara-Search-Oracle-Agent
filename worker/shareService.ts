/**
 * Tokenized shareable audit reports (Growth+ / Agency).
 * Tokens are random; only SHA-256 hashes are stored in D1.
 */
import type { Env } from './env';
import { MAX_SMALL_BODY_BYTES, readBody, safePublicHostname } from './security';
import { identify, json, billingId, sha256Hex, secretEquals } from './workerUtils';
import { isTeaserFailureCode, teaserFailureLine } from '../services/audit/teaserFailureCodes';
import { getActiveSubscription } from './quotaMiddleware';
import { planCapsFor } from './telegramBot';

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_MARKDOWN_CHARS = 400_000;
const MAX_SOURCES = 50;

export interface SharedReportBranding {
  agencyName?: string;
  logoUrl?: string;
  accentColor?: string;
  preparedBy?: string;
  clientName?: string;
}

export interface SharedReportPublic {
  version: 1;
  domain?: string;
  dnaName?: string;
  markdownText: string;
  sources?: Array<{ uri: string; title: string }>;
  branding?: SharedReportBranding;
  createdAt: number;
  expiresAt: number | null;
  passwordRequired: boolean;
}

type SharedReportRow = {
  id: string;
  token_hash: string;
  owner_account_id: string;
  client_id: string | null;
  report_json: string;
  branding_json: string | null;
  password_hash: string | null;
  expires_at: number | null;
  revoked_at: number | null;
  created_at: number;
};

function randomTokenHex(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomId(): string {
  return `shr_${randomTokenHex(12)}`;
}

const SECRETISH = /^(.*)?(api[_-]?key|password|secret|token|authorization|credential|private[_-]?key)(.*)?$/i;

/** Deep-clone JSON and drop secret-looking keys. */
export function sanitizeSharePayload(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map(sanitizeSharePayload);
  if (typeof input !== 'object') return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SECRETISH.test(k)) continue;
    out[k] = sanitizeSharePayload(v);
  }
  return out;
}

export async function hashSharePassword(password: string): Promise<string> {
  return sha256Hex(`luminara-share-pw:${password}`);
}

/**
 * Salted password hashing for new share links: PBKDF2-SHA-256 via crypto.subtle,
 * 16 random salt bytes, >= 120k iterations, stored as
 *   pbkdf2$<iterations>$<saltB64>$<hashB64>
 * The legacy unsalted SHA-256 format remains verifiable (verifySharePassword) and
 * is upgraded in place after a successful legacy check.
 */
export const SHARE_PW_ITERATIONS = 120_000;

export async function hashSharePasswordSalted(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2Sha256(password, salt, SHARE_PW_ITERATIONS);
  return `pbkdf2$${SHARE_PW_ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(hash)}`;
}

async function pbkdf2Sha256(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function b64ToBytes(value: string): Uint8Array | null {
  try {
    const bin = atob(value);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Verify a presented password against a stored hash, supporting both formats.
 * Returns the upgraded replacement hash when a legacy record verifies, so callers
 * can persist the salted form without changing the request flow.
 */
export async function verifySharePassword(
  password: string,
  stored: string,
): Promise<{ ok: boolean; upgradedHash?: string }> {
  if (stored.startsWith('pbkdf2$')) {
    const parts = stored.split('$');
    if (parts.length !== 4) return { ok: false };
    const iterations = Number(parts[1]);
    const salt = b64ToBytes(parts[2]!);
    const expected = parts[3]!;
    if (!Number.isFinite(iterations) || iterations < 120_000 || !salt) return { ok: false };
    const hash = await pbkdf2Sha256(password, salt, iterations);
    return { ok: secretEquals(bytesToB64(hash), expected) };
  }
  // Legacy unsalted SHA-256: verify, then hand back the salted upgrade.
  const attempt = await hashSharePassword(password);
  if (!secretEquals(attempt, stored)) return { ok: false };
  return { ok: true, upgradedHash: await hashSharePasswordSalted(password) };
}

function webappOrigin(env: Env): string {
  return (env.WEBAPP_URL || 'https://luminarasuite.com').replace(/\/$/, '');
}

/** Redacted scout cards. Not the Growth+ shareLinks entitlement. */
export const TEASER_DAILY_LIMIT = 5;
const TEASER_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const TEASER_CTA = 'https://t.me/LuminaraSuiteBot/app';
const BADGE_STATUS = new Set(['measured', 'estimated', 'not_measured']);
const CHECK_STATUS = new Set(['pass', 'fail', 'not_measured']);

export interface TeaserBadge {
  label: string;
  status: 'measured' | 'estimated' | 'not_measured';
  value?: string;
}

export interface TeaserCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'not_measured';
  detail: string;
}

export interface TeaserPublic {
  version: 1;
  kind: 'teaser';
  domain: string;
  verdict: string;
  topFix: string;
  evidenceNote: string;
  badges: TeaserBadge[];
  crawlerChecks: TeaserCheck[];
  failed: string[];
  createdAt: number;
  /** Always the Mini App. Callers cannot set this. */
  ctaUrl: string;
}

function clipText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/**
 * High-confidence credential shapes. Applied to every string stored for public GET.
 * Key-name stripping in sanitizeSharePayload stays in addition to this value check.
 */
const TEASER_CREDENTIAL_PATTERNS: RegExp[] = [
  /bearer\s+[a-z0-9._~+/-]{12,}/i,
  /sk-[a-z0-9]{12,}/i,
  /gsk_[a-z0-9]{12,}/i,
  /(?:sk|rk)_(?:live|test)_[a-z0-9]{8,}/i,
  /AIza[0-9A-Za-z_-]{20,}/,
  /xox[baprs]-[0-9A-Za-z-]{10,}/i,
  /gh[pousr]_[A-Za-z0-9]{16,}/,
  /github_pat_[A-Za-z0-9_]{16,}/i,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z0-9 ]{0,48}PRIVATE KEY-----/,
  /fc-[a-f0-9]{20,}/i,
];

export function teaserTextLooksLikeCredential(text: string): boolean {
  return TEASER_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text));
}

const TEASER_CREDENTIAL_ERROR = 'Teaser text looks like a credential and was rejected';

export function parseTeaserCreateBody(raw: unknown): { ok: true; payload: TeaserPublic } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Teaser body required' };
  const body = sanitizeSharePayload(raw) as Record<string, unknown>;
  const domain = safePublicHostname(clipText(body.domain, 300)) || '';
  if (!domain) return { ok: false, error: 'A public domain is required' };
  const verdict = clipText(body.verdict, 600);
  const topFix = clipText(body.topFix, 400);
  if (!verdict || !topFix) return { ok: false, error: 'Verdict and next move are required' };
  const evidenceNote = clipText(body.evidenceNote, 400) || 'Evidence note not included.';
  const badgesIn = Array.isArray(body.badges) ? body.badges.slice(0, 8) : [];
  const badges: TeaserBadge[] = [];
  for (const item of badgesIn) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const label = clipText(row.label, 80);
    const status = clipText(row.status, 32);
    if (!label || !BADGE_STATUS.has(status)) continue;
    const badge: TeaserBadge = { label, status: status as TeaserBadge['status'] };
    if (status !== 'not_measured') {
      const value = clipText(row.value, 32);
      if (value) badge.value = value;
    }
    badges.push(badge);
  }
  const checksIn = Array.isArray(body.crawlerChecks) ? body.crawlerChecks.slice(0, 4) : [];
  const crawlerChecks: TeaserCheck[] = [];
  for (const item of checksIn) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = clipText(row.id, 40);
    const label = clipText(row.label, 80);
    const status = clipText(row.status, 32);
    const detail = clipText(row.detail, 240);
    if (!id || !label || !detail || !CHECK_STATUS.has(status)) continue;
    crawlerChecks.push({ id, label, status: status as TeaserCheck['status'], detail });
  }
  const failed: string[] = [];
  for (const item of (Array.isArray(body.failed) ? body.failed : []).slice(0, 6)) {
    const text = clipText(item, 200);
    if (!text) continue;
    if (teaserTextLooksLikeCredential(text)) return { ok: false, error: TEASER_CREDENTIAL_ERROR };
    const line = isTeaserFailureCode(text) ? teaserFailureLine(text) : text;
    if (!failed.includes(line)) failed.push(line);
  }
  const stored = [
    domain,
    verdict,
    topFix,
    evidenceNote,
    ...badges.flatMap((badge) => [badge.label, badge.value || '']),
    ...crawlerChecks.flatMap((check) => [check.id, check.label, check.detail]),
    ...failed,
  ];
  if (stored.some((text) => teaserTextLooksLikeCredential(text))) {
    return { ok: false, error: TEASER_CREDENTIAL_ERROR };
  }
  return {
    ok: true,
    payload: {
      version: 1,
      kind: 'teaser',
      domain,
      verdict,
      topFix,
      evidenceNote,
      badges,
      crawlerChecks,
      failed,
      createdAt: Date.now(),
      ctaUrl: TEASER_CTA,
    },
  };
}

async function meterTeaserCreate(env: Env, accountId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!env.LUMINARA_KV) {
    if (env.REQUIRE_TG_AUTH === 'true') {
      return { ok: false, error: 'Teaser quota store unavailable. Try again later.' };
    }
    return { ok: true };
  }
  const day = new Date().toISOString().slice(0, 10);
  const key = `teaser:${accountId}:${day}`;
  const used = Number((await env.LUMINARA_KV.get(key)) || 0);
  if (used >= TEASER_DAILY_LIMIT) {
    return { ok: false, error: `Daily teaser limit of ${TEASER_DAILY_LIMIT} reached.` };
  }
  await env.LUMINARA_KV.put(key, String(used + 1), { expirationTtl: 2 * 86400 });
  return { ok: true };
}

function parseCreateBody(raw: unknown): {
  ok: true;
  payload: SharedReportPublic;
  password?: string;
  clientId?: string;
  expiresInMs: number;
} | { ok: false; error: string; status: number } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'JSON body required', status: 400 };
  const body = raw as Record<string, unknown>;
  const markdownText = typeof body.markdownText === 'string' ? body.markdownText : '';
  if (!markdownText.trim()) return { ok: false, error: 'markdownText required', status: 400 };
  if (markdownText.length > MAX_MARKDOWN_CHARS) {
    return { ok: false, error: 'markdownText too large', status: 413 };
  }

  let sources: Array<{ uri: string; title: string }> | undefined;
  if (Array.isArray(body.sources)) {
    sources = body.sources
      .slice(0, MAX_SOURCES)
      .map((s) => {
        const row = s as Record<string, unknown>;
        return {
          uri: typeof row.uri === 'string' ? row.uri.slice(0, 2000) : '',
          title: typeof row.title === 'string' ? row.title.slice(0, 300) : '',
        };
      })
      .filter((s) => s.uri);
  }

  let branding: SharedReportBranding | undefined;
  if (body.branding && typeof body.branding === 'object') {
    const b = body.branding as Record<string, unknown>;
    branding = {
      agencyName: typeof b.agencyName === 'string' ? b.agencyName.slice(0, 120) : undefined,
      logoUrl: typeof b.logoUrl === 'string' ? b.logoUrl.slice(0, 2000) : undefined,
      accentColor: typeof b.accentColor === 'string' ? b.accentColor.slice(0, 32) : undefined,
      preparedBy: typeof b.preparedBy === 'string' ? b.preparedBy.slice(0, 120) : undefined,
      clientName: typeof b.clientName === 'string' ? b.clientName.slice(0, 120) : undefined,
    };
  }

  const password = typeof body.password === 'string' && body.password.trim() ? body.password.trim() : undefined;
  if (password && password.length > 128) return { ok: false, error: 'password too long', status: 400 };

  const expiresInMs =
    typeof body.expiresInMs === 'number' && Number.isFinite(body.expiresInMs) && body.expiresInMs > 0
      ? Math.min(body.expiresInMs, 365 * 24 * 60 * 60 * 1000)
      : DEFAULT_TTL_MS;

  const createdAt = Date.now();
  const payload: SharedReportPublic = {
    version: 1,
    domain: typeof body.domain === 'string' ? body.domain.slice(0, 253) : undefined,
    dnaName: typeof body.dnaName === 'string' ? body.dnaName.slice(0, 200) : undefined,
    markdownText,
    sources,
    branding,
    createdAt,
    expiresAt: createdAt + expiresInMs,
    passwordRequired: Boolean(password),
  };

  return {
    ok: true,
    payload: sanitizeSharePayload(payload) as SharedReportPublic,
    password,
    clientId: typeof body.clientId === 'string' ? body.clientId.slice(0, 64) : undefined,
    expiresInMs,
  };
}

export async function handleShareRoute(request: Request, env: Env, path: string): Promise<Response> {
  if (!env.DB) {
    return json({ ok: false, error: 'Database not configured', code: 'DB_UNAVAILABLE' }, 503);
  }

  const teaserGet = path.match(/^\/share\/teasers\/([a-f0-9]{64})$/i);
  if (teaserGet && request.method === 'GET') {
    const token = teaserGet[1].toLowerCase();
    const tokenHash = await sha256Hex(token);
    const row = (await env.DB.prepare(
      `SELECT payload_json, expires_at, revoked_at FROM share_teasers WHERE token_hash = ? LIMIT 1`,
    )
      .bind(tokenHash)
      .first()) as { payload_json: string; expires_at: number; revoked_at: number | null } | null;
    if (!row || row.revoked_at || (row.expires_at && row.expires_at < Date.now())) {
      return json({ ok: false, error: 'Teaser not found or expired', code: 'TEASER_NOT_FOUND' }, 404);
    }
    let teaser: TeaserPublic;
    try {
      teaser = JSON.parse(row.payload_json) as TeaserPublic;
    } catch {
      return json({ ok: false, error: 'Teaser not found or expired', code: 'TEASER_NOT_FOUND' }, 404);
    }
    teaser.ctaUrl = TEASER_CTA;
    return json({ ok: true, teaser });
  }

  if (path === '/share/teasers' && request.method === 'POST') {
    const who = await identify(request, env);
    if (!who.user) return json({ ok: false, error: who.error || 'Sign in required', code: 'AUTH_REQUIRED' }, 401);
    const read = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!read.ok) return json({ error: read.error }, read.status);
    const parsed = parseTeaserCreateBody(read.value);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
    const accountId = billingId(who.user);
    const meter = await meterTeaserCreate(env, accountId);
    if (!meter.ok) {
      return json({ ok: false, error: meter.error, code: 'TEASER_QUOTA' }, 429);
    }
    const token = randomTokenHex(32);
    const tokenHash = await sha256Hex(token);
    const id = `tsz_${randomTokenHex(12)}`;
    const expiresAt = parsed.payload.createdAt + TEASER_TTL_MS;
    await env.DB.prepare(
      `INSERT INTO share_teasers (id, token_hash, owner_account_id, payload_json, expires_at, revoked_at, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    )
      .bind(id, tokenHash, accountId, JSON.stringify(parsed.payload), expiresAt, parsed.payload.createdAt)
      .run();
    const url = `${webappOrigin(env)}/share/teaser/${token}`;
    return json({ ok: true, id, token, url, expiresAt });
  }

  // GET /share/reports/:token (public)
  const getMatch = path.match(/^\/share\/reports\/([a-f0-9]{64})$/i);
  if (getMatch && request.method === 'GET') {
    const token = getMatch[1].toLowerCase();
    const tokenHash = await sha256Hex(token);
    const row = (await env.DB.prepare(
      `SELECT id, token_hash, owner_account_id, client_id, report_json, branding_json, password_hash, expires_at, revoked_at, created_at
       FROM shared_reports WHERE token_hash = ? LIMIT 1`,
    )
      .bind(tokenHash)
      .first()) as SharedReportRow | null;

    if (!row || row.revoked_at) {
      return json({ ok: false, error: 'Share link not found or revoked', code: 'SHARE_NOT_FOUND' }, 404);
    }
    if (row.expires_at && row.expires_at < Date.now()) {
      return json({ ok: false, error: 'Share link expired', code: 'SHARE_EXPIRED' }, 410);
    }

    let report: SharedReportPublic;
    try {
      report = JSON.parse(row.report_json) as SharedReportPublic;
    } catch {
      return json({ ok: false, error: 'Corrupt share payload' }, 500);
    }

    if (row.password_hash) {
      const url = new URL(request.url);
      // Prefer x-share-password (avoids password in query logs / Referer).
      // Query ?password= is rejected in production; allowed only outside prod for legacy clients.
      const headerPw = request.headers.get('x-share-password') || '';
      const queryPw = url.searchParams.get('password') || '';
      const envName = String(env.ENVIRONMENT || '').toLowerCase();
      const prodLike = envName === 'production' || envName === 'prod';
      if (queryPw && prodLike) {
        return json(
          {
            ok: false,
            error: 'Password via query string is disabled. Send x-share-password header.',
            code: 'SHARE_PASSWORD_QUERY_FORBIDDEN',
            passwordRequired: true,
          },
          400,
        );
      }
      const pw = headerPw || queryPw;
      if (!pw) {
        return json(
          {
            ok: false,
            error: 'Password required. Send x-share-password header.',
            code: 'SHARE_PASSWORD_REQUIRED',
            passwordRequired: true,
          },
          401,
        );
      }
      const check = await verifySharePassword(pw, row.password_hash);
      if (!check.ok) {
        return json({ ok: false, error: 'Invalid password', code: 'SHARE_PASSWORD_INVALID' }, 403);
      }
      // Transparent upgrade: a legacy record that verifies is re-stored in salted form.
      if (check.upgradedHash) {
        try {
          await env.DB.prepare(`UPDATE shared_reports SET password_hash = ? WHERE id = ?`)
            .bind(check.upgradedHash, row.id)
            .run();
        } catch (err) {
          // Upgrade failure must not lock the holder out; the legacy hash still verifies.
          console.error('[share] password hash upgrade failed (legacy hash retained):', err instanceof Error ? err.message : err);
        }
      }
    }

    const publicReport: SharedReportPublic = {
      ...report,
      passwordRequired: Boolean(row.password_hash),
      expiresAt: row.expires_at,
    };
    return json({ ok: true, id: row.id, report: publicReport });
  }

  if (path === '/share/reports' && request.method === 'POST') {
    const who = await identify(request, env);
    if (!who.user) return json({ ok: false, error: who.error || 'Sign in required', code: 'AUTH_REQUIRED' }, 401);

    const sub = await getActiveSubscription(env, who.user);
    const caps = planCapsFor(sub?.plan);
    if (!caps.shareLinks) {
      return json(
        {
          ok: false,
          error: 'Share links require a Growth or Agency plan.',
          code: 'SHARE_ENTITLEMENT_REQUIRED',
          requiredPlan: 'growth',
        },
        403,
      );
    }

    const read = await readBody(request, MAX_SMALL_BODY_BYTES * 8);
    if (!read.ok) return json({ error: read.error }, read.status);
    const parsed = parseCreateBody(read.value);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);

    const token = randomTokenHex(32);
    const tokenHash = await sha256Hex(token);
    const id = randomId();
    const accountId = billingId(who.user);
    const passwordHash = parsed.password ? await hashSharePasswordSalted(parsed.password) : null;
    const expiresAt = parsed.payload.expiresAt;

    await env.DB.prepare(
      `INSERT INTO shared_reports
        (id, token_hash, owner_account_id, client_id, report_json, branding_json, password_hash, expires_at, revoked_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
      .bind(
        id,
        tokenHash,
        accountId,
        parsed.clientId ?? null,
        JSON.stringify(parsed.payload),
        parsed.payload.branding ? JSON.stringify(parsed.payload.branding) : null,
        passwordHash,
        expiresAt,
        parsed.payload.createdAt,
      )
      .run();

    const url = `${webappOrigin(env)}/share/${token}`;
    return json({
      ok: true,
      id,
      token,
      url,
      expiresAt,
    });
  }

  const delMatch = path.match(/^\/share\/reports\/([a-z0-9_:-]+)$/i);
  if (delMatch && request.method === 'DELETE') {
    const who = await identify(request, env);
    if (!who.user) return json({ ok: false, error: who.error || 'Sign in required', code: 'AUTH_REQUIRED' }, 401);
    const id = delMatch[1];
    // Avoid treating hex tokens as delete ids when method is wrong; ids are shr_*
    if (/^[a-f0-9]{64}$/i.test(id)) {
      return json({ ok: false, error: 'Use share id to revoke, not the raw token', code: 'USE_SHARE_ID' }, 400);
    }

    const accountId = billingId(who.user);
    const existing = (await env.DB.prepare(
      `SELECT id, owner_account_id, revoked_at FROM shared_reports WHERE id = ? LIMIT 1`,
    )
      .bind(id)
      .first()) as { id: string; owner_account_id: string; revoked_at: number | null } | null;

    if (!existing || existing.owner_account_id !== accountId) {
      return json({ ok: false, error: 'Share not found', code: 'SHARE_NOT_FOUND' }, 404);
    }
    if (existing.revoked_at) {
      return json({ ok: true, revoked: true, id });
    }

    await env.DB.prepare(`UPDATE shared_reports SET revoked_at = ? WHERE id = ? AND owner_account_id = ?`)
      .bind(Date.now(), id, accountId)
      .run();

    return json({ ok: true, revoked: true, id });
  }

  return json({ error: 'Method not allowed' }, 405);
}
