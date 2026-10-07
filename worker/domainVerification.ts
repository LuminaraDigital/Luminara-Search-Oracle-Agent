/**
 * Domain control verification (Trust Network TN2).
 *
 * The owner publishes a per-account token by one of three methods; the Worker
 * finds it and, on success, issues a `domain_control` Trust Receipt:
 *   dns_txt     TXT `luminara-verify=<token>` on `_luminara-verify.<domain>` or the apex
 *   well_known  https://<domain>/.well-known/luminara-verify.txt containing the token
 *   meta_tag    <meta name="luminara-verify" content="<token>"> on https://<domain>/
 *
 * The token is stored hashed. Checks extract candidate tokens from what the
 * domain serves and compare hashes, so the plaintext never has to be stored or
 * re-sent. A token only verifies the account it was issued to.
 *
 * HTTP proof must come from the domain itself: redirects are followed through
 * the SSRF guard, but the final host must be the domain or its www twin.
 * A resolver or network failure is `unreachable`, never counted as a failed check.
 *
 * Routes (404 unless DOMAIN_VERIFY_ENABLED):
 *   GET    /trust/domains
 *   POST   /trust/domains                  { domain }  -> token + instructions
 *   POST   /trust/domains/:domain/check
 *   DELETE /trust/domains/:domain
 */
import type { Env } from './env';
import { auditOrgIdFor, recordAuditLogBestEffort } from './auditLog';
import { MAX_SMALL_BODY_BYTES, fetchPublicUrl, readBody, safePublicHostname, type DohFetch } from './security';
import { billingId, identify, json, sha256Hex } from './workerUtils';
import { issueTrustReceipt, isTrustReceiptsEnabled, revokeTrustReceipt, trustFlagEnabled } from './trustReceipts';
import { ReceiptSigningUnavailable } from './receiptSigning';

export const DOMAIN_TOKEN_TTL_DAYS = 7;
export const DOMAIN_RECHECK_INTERVAL_DAYS = 7;
export const DOMAIN_LAPSE_AFTER_FAILURES = 2;
export const DOMAIN_RECHECK_BATCH = 25;
export const MAX_DOMAINS_PER_ACCOUNT = 20;
const MAX_HTML_BYTES = 256_000;
const FETCH_TIMEOUT_MS = 5_000;
const TOKEN_RE = /\blv_[a-f0-9]{32}\b/g;
const DEFAULT_DOH = 'https://cloudflare-dns.com/dns-query';

export type DomainProofMethod = 'dns_txt' | 'well_known' | 'meta_tag';

export type DomainCheckResult =
  | { status: 'found'; method: DomainProofMethod; evidenceUrl: string; evidenceSha256: string; httpStatus?: number }
  | { status: 'not_found'; tried: DomainProofMethod[] }
  | { status: 'unreachable'; error: string };

export type DomainCheckDeps = {
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  dohFetcher?: DohFetch;
  dohUrl?: string;
};

export function isDomainVerifyEnabled(env: Pick<Env, 'ENVIRONMENT' | 'DOMAIN_VERIFY_ENABLED'>): boolean {
  return trustFlagEnabled(env, env.DOMAIN_VERIFY_ENABLED);
}

export function normalizeVerifiableDomain(input: string): string | null {
  return safePublicHostname(String(input || ''));
}

function wwwTwin(domain: string): string {
  return domain.startsWith('www.') ? domain.slice(4) : `www.${domain}`;
}

export function newDomainToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `lv_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function hashDomainToken(token: string): Promise<string> {
  return sha256Hex(`luminara-domain-token:${token}`);
}

export function domainInstructions(domain: string, token: string) {
  return {
    dns_txt: {
      type: 'TXT',
      name: `_luminara-verify.${domain}`,
      value: `luminara-verify=${token}`,
      note: 'You can also add the same TXT value on the root of the domain. DNS changes can take a few minutes to appear.',
    },
    well_known: {
      url: `https://${domain}/.well-known/luminara-verify.txt`,
      content: token,
    },
    meta_tag: {
      url: `https://${domain}/`,
      tag: `<meta name="luminara-verify" content="${token}">`,
    },
  };
}

async function tokensMatch(candidates: Iterable<string>, tokenHash: string): Promise<boolean> {
  for (const c of new Set(candidates)) {
    if ((await hashDomainToken(c)) === tokenHash) return true;
  }
  return false;
}

function extractTokens(text: string): string[] {
  return Array.from(text.matchAll(TOKEN_RE), (m) => m[0]);
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.byteLength;
    if (total >= maxBytes) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const merged = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, merged.byteLength - offset);
    merged.set(c.subarray(0, take), offset);
    offset += take;
    if (offset >= merged.byteLength) break;
  }
  return new TextDecoder().decode(merged);
}

type DnsLookup = { ok: true; values: string[] } | { ok: false };

async function lookupTxt(name: string, deps: DomainCheckDeps): Promise<DnsLookup> {
  const doh = deps.dohFetcher ?? (deps.fetcher as DohFetch | undefined) ?? fetch;
  const base = deps.dohUrl || DEFAULT_DOH;
  try {
    const res = await doh(`${base}?name=${encodeURIComponent(name)}&type=TXT`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false };
    const data = (await res.json()) as { Status?: number; Answer?: Array<{ type: number; data: string }> };
    if (data.Status === 3) return { ok: true, values: [] }; // NXDOMAIN: a real "not there"
    if (data.Status !== 0) return { ok: false };
    // TXT data arrives as one or more quoted strings: "part1" "part2"
    const values = (data.Answer || [])
      .filter((a) => a.type === 16)
      .map((a) => String(a.data || '').replace(/"\s+"/g, '').replace(/^"|"$/g, ''));
    return { ok: true, values };
  } catch {
    return { ok: false };
  }
}

async function fetchFromDomain(
  url: string,
  domain: string,
  deps: DomainCheckDeps,
): Promise<{ ok: true; status: number; body: string; finalUrl: string } | { ok: false; unreachable: boolean }> {
  const result = await fetchPublicUrl(
    url,
    { headers: { 'user-agent': 'LuminaraVerify/1.0 (+https://luminarasuite.com/verify)' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    { fetcher: deps.fetcher, dohFetcher: deps.dohFetcher, maxRedirects: 3 },
  );
  if (!result.ok) return { ok: false, unreachable: true };
  const finalHost = new URL(result.finalUrl).hostname.toLowerCase();
  if (finalHost !== domain && finalHost !== wwwTwin(domain)) {
    await result.response.body?.cancel().catch(() => undefined);
    return { ok: false, unreachable: false }; // proof served from another host does not count
  }
  if (!result.response.ok) {
    await result.response.body?.cancel().catch(() => undefined);
    return { ok: false, unreachable: false };
  }
  const body = await readCapped(result.response, MAX_HTML_BYTES);
  return { ok: true, status: result.response.status, body, finalUrl: result.finalUrl };
}

const META_RE = /<meta\b[^>]*>/gi;

function metaTokens(html: string): string[] {
  const out: string[] = [];
  for (const tag of html.match(META_RE) || []) {
    if (!/\bname\s*=\s*["']?luminara-verify["']?/i.test(tag)) continue;
    const content = tag.match(/\bcontent\s*=\s*["']?([^"'\s>]+)/i);
    if (content) out.push(...extractTokens(content[1]));
  }
  return out;
}

/**
 * Looks for the account's token on the domain. Tries DNS first (cheapest, most
 * durable), then the well-known file, then the home page meta tag.
 */
export async function checkDomainProof(domain: string, tokenHash: string, deps: DomainCheckDeps = {}): Promise<DomainCheckResult> {
  let anyReachable = false;

  for (const name of [`_luminara-verify.${domain}`, domain]) {
    const txt = await lookupTxt(name, deps);
    if (!txt.ok) continue;
    anyReachable = true;
    for (const value of txt.values) {
      if (!value.startsWith('luminara-verify=')) continue;
      if (await tokensMatch(extractTokens(value), tokenHash)) {
        return {
          status: 'found',
          method: 'dns_txt',
          evidenceUrl: `dns:TXT:${name}`,
          evidenceSha256: await sha256Hex(value),
        };
      }
    }
  }

  const wellKnown = await fetchFromDomain(`https://${domain}/.well-known/luminara-verify.txt`, domain, deps);
  if (wellKnown.ok || !wellKnown.unreachable) anyReachable = true;
  if (wellKnown.ok && (await tokensMatch(extractTokens(wellKnown.body.slice(0, 4096)), tokenHash))) {
    return {
      status: 'found',
      method: 'well_known',
      evidenceUrl: wellKnown.finalUrl,
      evidenceSha256: await sha256Hex(wellKnown.body),
      httpStatus: wellKnown.status,
    };
  }

  const home = await fetchFromDomain(`https://${domain}/`, domain, deps);
  if (home.ok || !home.unreachable) anyReachable = true;
  if (home.ok && (await tokensMatch(metaTokens(home.body), tokenHash))) {
    return {
      status: 'found',
      method: 'meta_tag',
      evidenceUrl: home.finalUrl,
      evidenceSha256: await sha256Hex(home.body),
      httpStatus: home.status,
    };
  }

  if (!anyReachable) return { status: 'unreachable', error: 'DNS and the site could not be reached. Try again shortly.' };
  return { status: 'not_found', tried: ['dns_txt', 'well_known', 'meta_tag'] };
}

type DomainRow = {
  account_id: string;
  domain: string;
  token_hash: string;
  token_hint: string;
  method: string | null;
  status: 'pending' | 'verified' | 'lapsed' | 'revoked';
  receipt_id: string | null;
  token_expires_at: string;
  verified_at: string | null;
  last_checked_at: string | null;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
};

function publicRow(row: DomainRow) {
  return {
    domain: row.domain,
    status: row.status,
    method: row.method,
    tokenHint: row.token_hint,
    tokenExpiresAt: row.token_expires_at,
    receiptId: row.receipt_id,
    verifiedAt: row.verified_at,
    lastCheckedAt: row.last_checked_at,
  };
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

async function issueDomainReceipt(
  env: Env,
  accountId: string,
  domain: string,
  found: Extract<DomainCheckResult, { status: 'found' }>,
): Promise<{ receiptId: string | null; receiptError?: string }> {
  if (!isTrustReceiptsEnabled(env)) return { receiptId: null, receiptError: 'Trust receipts are not enabled on this deployment.' };
  try {
    const receipt = await issueTrustReceipt(env, {
      accountId,
      subject: { kind: 'domain', id: domain },
      claim: 'domain_control',
      level: 'worker_verified',
      method: found.method,
      evidence: [
        {
          ref: 'proof',
          url: found.evidenceUrl,
          sha256: found.evidenceSha256,
          fetchedAt: new Date().toISOString(),
          ...(found.httpStatus ? { httpStatus: found.httpStatus } : {}),
        },
      ],
      measurementStatus: 'measured',
    });
    return { receiptId: receipt.id };
  } catch (err) {
    if (err instanceof ReceiptSigningUnavailable) return { receiptId: null, receiptError: err.message };
    throw err;
  }
}

export async function handleDomainVerificationRoute(
  request: Request,
  env: Env,
  path: string,
  deps: DomainCheckDeps = {},
): Promise<Response | null> {
  if (path !== '/trust/domains' && !path.startsWith('/trust/domains/')) return null;
  if (!isDomainVerifyEnabled(env)) return json({ ok: false, error: 'Not found', code: 'DOMAIN_VERIFY_DISABLED' }, 404);
  if (!env.DB) return json({ ok: false, error: 'Domain verification needs D1', code: 'D1_UNAVAILABLE' }, 503);

  const who = await identify(request, env);
  if (!who.user) return json({ ok: false, error: who.error || 'Sign in required', code: 'AUTH_REQUIRED' }, 401);
  const accountId = billingId(who.user);
  const auditOrg = auditOrgIdFor(accountId);
  const effectiveDeps: DomainCheckDeps = { dohUrl: env.DOMAIN_VERIFY_DOH_URL, ...deps };

  if (path === '/trust/domains') {
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT * FROM domain_verifications WHERE account_id = ? ORDER BY created_at DESC`,
      )
        .bind(accountId)
        .all<DomainRow>();
      return json({ ok: true, domains: (results || []).map(publicRow) });
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const read = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!read.ok) return json({ ok: false, error: read.error }, read.status);
    const body = (read.value || {}) as Record<string, unknown>;
    const domain = normalizeVerifiableDomain(typeof body.domain === 'string' ? body.domain : '');
    if (!domain) {
      return json({ ok: false, error: 'Enter a public domain like example.com.', code: 'INVALID_DOMAIN' }, 400);
    }

    const existing = await env.DB.prepare(`SELECT * FROM domain_verifications WHERE account_id = ? AND domain = ?`)
      .bind(accountId, domain)
      .first<DomainRow>();
    if (existing?.status === 'verified') {
      // No silent reissue: the weekly re-check would look for the new, unpublished
      // token and lapse a valid verification. Remove the domain to start over.
      return json({ ok: true, alreadyVerified: true, domain: publicRow(existing) });
    }
    if (!existing) {
      const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM domain_verifications WHERE account_id = ?`)
        .bind(accountId)
        .first<{ n: number }>();
      if (Number(count?.n || 0) >= MAX_DOMAINS_PER_ACCOUNT) {
        return json({ ok: false, error: `You can verify up to ${MAX_DOMAINS_PER_ACCOUNT} domains.`, code: 'DOMAIN_LIMIT' }, 409);
      }
    }

    const token = newDomainToken();
    const now = new Date().toISOString();
    const expires = daysFromNow(DOMAIN_TOKEN_TTL_DAYS);
    await env.DB.prepare(
      `INSERT INTO domain_verifications (account_id, domain, token_hash, token_hint, status, token_expires_at, consecutive_failures, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, 0, ?, ?)
       ON CONFLICT(account_id, domain) DO UPDATE SET
         token_hash = excluded.token_hash,
         token_hint = excluded.token_hint,
         token_expires_at = excluded.token_expires_at,
         status = 'pending',
         consecutive_failures = 0,
         updated_at = excluded.updated_at
       WHERE domain_verifications.status <> 'verified'`,
    )
      .bind(accountId, domain, await hashDomainToken(token), token.slice(0, 9), expires, now, now)
      .run();
    await recordAuditLogBestEffort(env, {
      org_id: auditOrg,
      actor_id: who.user.id,
      action: 'domain_verification_started',
      target_id: domain,
    });
    return json({ ok: true, domain, token, tokenExpiresAt: expires, instructions: domainInstructions(domain, token) });
  }

  const match = path.match(/^\/trust\/domains\/([^/]+)(\/check)?$/);
  if (!match) return json({ ok: false, error: 'Not found' }, 404);
  let rawDomain = match[1];
  try {
    rawDomain = decodeURIComponent(rawDomain);
  } catch {
    return json({ ok: false, error: 'Invalid domain', code: 'INVALID_DOMAIN' }, 400);
  }
  const domain = normalizeVerifiableDomain(rawDomain);
  if (!domain) return json({ ok: false, error: 'Invalid domain', code: 'INVALID_DOMAIN' }, 400);
  const row = await env.DB.prepare(`SELECT * FROM domain_verifications WHERE account_id = ? AND domain = ?`)
    .bind(accountId, domain)
    .first<DomainRow>();
  if (!row) return json({ ok: false, error: 'Start verification for this domain first.', code: 'NOT_STARTED' }, 404);

  if (!match[2]) {
    if (request.method !== 'DELETE') return json({ error: 'Method not allowed' }, 405);
    if (row.receipt_id) await revokeTrustReceipt(env, accountId, row.receipt_id, 'domain removed by owner', who.user.id);
    await env.DB.prepare(`DELETE FROM domain_verifications WHERE account_id = ? AND domain = ?`).bind(accountId, domain).run();
    await recordAuditLogBestEffort(env, { org_id: auditOrg, actor_id: who.user.id, action: 'domain_verification_removed', target_id: domain });
    return json({ ok: true, domain, removed: true });
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (row.status !== 'verified' && Date.parse(row.token_expires_at) < Date.now()) {
    return json({ ok: false, error: 'This token has expired. Start again to get a new one.', code: 'TOKEN_EXPIRED' }, 410);
  }

  const result = await checkDomainProof(domain, row.token_hash, effectiveDeps);
  const now = new Date().toISOString();

  if (result.status === 'unreachable') {
    await env.DB.prepare(`UPDATE domain_verifications SET last_checked_at = ?, updated_at = ? WHERE account_id = ? AND domain = ?`)
      .bind(now, now, accountId, domain)
      .run();
    return json({ ok: false, status: 'unreachable', error: result.error, measurementStatus: 'not_measured' }, 200);
  }

  if (result.status === 'not_found') {
    await env.DB.prepare(`UPDATE domain_verifications SET last_checked_at = ?, updated_at = ? WHERE account_id = ? AND domain = ?`)
      .bind(now, now, accountId, domain)
      .run();
    return json({
      ok: false,
      status: 'not_found',
      tried: result.tried,
      error: 'We could not find your token yet. Check the record or file, then try again.',
    });
  }

  // Found. Re-issue a receipt only when the method changed or none exists yet.
  let receiptId = row.receipt_id;
  let receiptError: string | undefined;
  if (!receiptId || row.method !== result.method || row.status !== 'verified') {
    if (receiptId) await revokeTrustReceipt(env, accountId, receiptId, 'superseded by a newer domain check');
    const issued = await issueDomainReceipt(env, accountId, domain, result);
    receiptId = issued.receiptId;
    receiptError = issued.receiptError;
  }
  await env.DB.prepare(
    `UPDATE domain_verifications
       SET status = 'verified', method = ?, receipt_id = ?, verified_at = COALESCE(verified_at, ?),
           last_checked_at = ?, consecutive_failures = 0, updated_at = ?
     WHERE account_id = ? AND domain = ?`,
  )
    .bind(result.method, receiptId, now, now, now, accountId, domain)
    .run();
  if (row.status !== 'verified') {
    await recordAuditLogBestEffort(env, {
      org_id: auditOrg,
      actor_id: who.user.id,
      action: 'domain_verified',
      target_id: domain,
      details: { method: result.method, receiptId },
    });
  }
  return json({
    ok: true,
    status: 'verified',
    domain,
    method: result.method,
    receiptId,
    receiptIssued: Boolean(receiptId),
    ...(receiptError ? { receiptError } : {}),
  });
}

/**
 * Daily cron: re-check verified domains not checked for DOMAIN_RECHECK_INTERVAL_DAYS.
 * Two consecutive `not_found` results lapse the verification and revoke its
 * receipt. `unreachable` never counts against the owner.
 */
export async function recheckVerifiedDomains(env: Env, deps: DomainCheckDeps = {}): Promise<{ checked: number; lapsed: number }> {
  if (!env.DB || !isDomainVerifyEnabled(env)) return { checked: 0, lapsed: 0 };
  const cutoff = new Date(Date.now() - DOMAIN_RECHECK_INTERVAL_DAYS * 86_400_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT * FROM domain_verifications
      WHERE status = 'verified' AND (last_checked_at IS NULL OR last_checked_at < ?)
      ORDER BY last_checked_at ASC LIMIT ?`,
  )
    .bind(cutoff, DOMAIN_RECHECK_BATCH)
    .all<DomainRow>();

  let checked = 0;
  let lapsed = 0;
  const effectiveDeps: DomainCheckDeps = { dohUrl: env.DOMAIN_VERIFY_DOH_URL, ...deps };
  for (const row of results || []) {
    checked++;
    const now = new Date().toISOString();
    try {
      const result = await checkDomainProof(row.domain, row.token_hash, effectiveDeps);
      if (result.status === 'found') {
        await env.DB.prepare(
          `UPDATE domain_verifications SET last_checked_at = ?, consecutive_failures = 0, updated_at = ? WHERE account_id = ? AND domain = ?`,
        )
          .bind(now, now, row.account_id, row.domain)
          .run();
        continue;
      }
      if (result.status === 'unreachable') {
        await env.DB.prepare(`UPDATE domain_verifications SET last_checked_at = ?, updated_at = ? WHERE account_id = ? AND domain = ?`)
          .bind(now, now, row.account_id, row.domain)
          .run();
        continue;
      }
      const failures = Number(row.consecutive_failures || 0) + 1;
      if (failures >= DOMAIN_LAPSE_AFTER_FAILURES) {
        await env.DB.prepare(
          `UPDATE domain_verifications SET status = 'lapsed', consecutive_failures = ?, last_checked_at = ?, updated_at = ? WHERE account_id = ? AND domain = ?`,
        )
          .bind(failures, now, now, row.account_id, row.domain)
          .run();
        if (row.receipt_id) await revokeTrustReceipt(env, row.account_id, row.receipt_id, 'domain proof no longer found');
        await recordAuditLogBestEffort(env, {
          org_id: auditOrgIdFor(row.account_id),
          actor_id: 'system:trust',
          action: 'domain_verification_lapsed',
          target_id: row.domain,
        });
        lapsed++;
      } else {
        await env.DB.prepare(
          `UPDATE domain_verifications SET consecutive_failures = ?, last_checked_at = ?, updated_at = ? WHERE account_id = ? AND domain = ?`,
        )
          .bind(failures, now, now, row.account_id, row.domain)
          .run();
      }
    } catch (err) {
      console.error('[domain-recheck] check failed', row.domain, err instanceof Error ? err.message : err);
    }
  }
  return { checked, lapsed };
}
