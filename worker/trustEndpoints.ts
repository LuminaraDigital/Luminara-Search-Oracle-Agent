/**
 * Public trust endpoints served by the Worker: security.txt (RFC 9116), the CSP report sink for the
 * report-only policy, and a deep health check for uptime monitors. None of them reads or returns a secret.
 */
import type { Env } from './env';
import { json } from './workerUtils';

export const SECURITY_CONTACT = 'mailto:security@luminarasuite.com';
export const SECURITY_POLICY_URL = 'https://github.com/LuminaraDigital/Luminara-Search-Oracle-Agent/blob/main/SECURITY.md';
/** RFC 9116 asks for an Expires under a year away; a rolling 180 days never goes stale. */
const SECURITY_TXT_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/** security.txt whose Canonical names the host it is served from, so it never points at a redirect. */
export function securityTxt(host: string, now: number = Date.now()): string {
  const expires = new Date(now + SECURITY_TXT_TTL_MS);
  expires.setUTCHours(0, 0, 0, 0);
  return [
    `Contact: ${SECURITY_CONTACT}`,
    `Expires: ${expires.toISOString().replace('.000Z', 'Z')}`,
    'Preferred-Languages: en',
    `Canonical: https://${host}/.well-known/security.txt`,
    `Policy: ${SECURITY_POLICY_URL}`,
    '',
  ].join('\n');
}

export function handleSecurityTxt(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== '/.well-known/security.txt' && url.pathname !== '/security.txt') return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (url.pathname === '/security.txt') {
    return new Response(null, { status: 301, headers: { Location: `https://${url.host}/.well-known/security.txt` } });
  }
  return new Response(request.method === 'HEAD' ? null : securityTxt(url.host), {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  });
}

const MAX_CSP_REPORT_BYTES = 16_000;

/** Origin only: a blocked URL's path or query could carry a token or personal data. */
function originOnly(raw: unknown): string {
  const value = String(raw || '').trim();
  if (!value) return 'none';
  if (/^(inline|eval|wasm-eval|data|blob|self)$/i.test(value)) return value.toLowerCase();
  try {
    return new URL(value).origin;
  } catch {
    return 'unparsed';
  }
}

export type CspReportSummary = { directive: string; blocked: string; documentPath: string };

/** Accepts the legacy application/csp-report body and the Reporting API application/reports+json list. */
export function summarizeCspReports(body: unknown): CspReportSummary[] {
  const items = Array.isArray(body) ? body : [body];
  const out: CspReportSummary[] = [];
  for (const item of items.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue;
    const legacy = (item as { 'csp-report'?: Record<string, unknown> })['csp-report'];
    const modern = (item as { body?: Record<string, unknown> }).body;
    const r = legacy || modern;
    if (!r || typeof r !== 'object') continue;
    const directive = String(r['effective-directive'] || r['violated-directive'] || r.effectiveDirective || 'unknown').slice(0, 60);
    const blocked = originOnly(r['blocked-uri'] ?? r.blockedURL);
    let documentPath = 'unknown';
    try {
      documentPath = new URL(String(r['document-uri'] ?? r.documentURL ?? '')).pathname.slice(0, 120);
    } catch {
      /* keep unknown */
    }
    out.push({ directive, blocked, documentPath });
  }
  return out;
}

export async function handleCspReport(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_CSP_REPORT_BYTES) return new Response(null, { status: 413 });
  let text = '';
  try {
    text = await request.text();
  } catch {
    return new Response(null, { status: 204 });
  }
  if (text.length > MAX_CSP_REPORT_BYTES) return new Response(null, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 204 });
  }
  for (const r of summarizeCspReports(body)) {
    console.log(JSON.stringify({ event: 'csp_report_only', ...r }));
  }
  return new Response(null, { status: 204 });
}

const DEEP_HEALTH_TIMEOUT_MS = 2_000;

type CheckState = 'ok' | 'fail' | 'unbound';

/** Dependency reachability for uptime monitors. Reports only states and timings, never config values. */
export async function deepHealth(env: Env, now: () => number = Date.now): Promise<Response> {
  const started = now();
  let d1: CheckState = 'unbound';
  let d1Ms: number | null = null;
  if (env.DB) {
    const t0 = now();
    try {
      const ping = env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), DEEP_HEALTH_TIMEOUT_MS));
      const row = await Promise.race([ping, timeout]);
      d1 = row && Number(row.ok) === 1 ? 'ok' : 'fail';
    } catch {
      d1 = 'fail';
    }
    d1Ms = now() - t0;
  }
  let kv: CheckState = 'unbound';
  if (env.LUMINARA_KV) {
    try {
      await env.LUMINARA_KV.get('health:probe');
      kv = 'ok';
    } catch {
      kv = 'fail';
    }
  }
  const auditQueue: 'bound' | 'unbound' = env.AUDIT_JOBS ? 'bound' : 'unbound';
  const ok = d1 === 'ok' && kv !== 'fail';
  return json(
    { ok, checks: { d1, kv, auditQueue }, timingsMs: { d1: d1Ms, total: now() - started } },
    ok ? 200 : 503,
    { 'Cache-Control': 'no-store' },
  );
}
