/**
 * Public /win/:id page. One D1 row. The PNG is cached in the Cache API, not KV.
 */
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from './env';
import { billingId, identify, json } from './workerUtils';
import { renderWinPng } from './winPng';
import {
  canonicalWinUrl,
  escapeHtml,
  parseWinCreate,
  publicWin,
  WIN_CTA,
  type WinClaim,
} from '../services/share/winShare';

const WIN_ID = /^\/win\/([a-f0-9]{32})(\/og\.png)?$/i;
const API_ID = /^\/wins\/([a-f0-9]{32})$/i;
const DAILY_CAP = 20;
const MAX_BODY = 2000;

type WinEnv = { DB?: D1Database; WEBAPP_URL?: string };

type WinRow = {
  id: string;
  owner_id: string;
  agency_name: string;
  claim_kind: string;
  passed: number | null;
  total: number | null;
  fixes_done: number;
  hide_score: number;
  created_at: number;
};

function originOf(env: WinEnv, request: Request): string {
  try {
    if (env.WEBAPP_URL) return new URL(env.WEBAPP_URL).origin;
  } catch {
    /* use the request host */
  }
  return new URL(request.url).origin;
}

function newWinId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function claimFromRow(row: WinRow): WinClaim | null {
  const fixesDone = Number.isInteger(row.fixes_done) ? row.fixes_done : 0;
  if (row.claim_kind === 'improvement') return { kind: 'improvement', fixesDone };
  const passed = row.passed;
  const total = row.total;
  if (
    row.claim_kind === 'score'
    && typeof passed === 'number'
    && typeof total === 'number'
    && Number.isInteger(passed)
    && Number.isInteger(total)
  ) {
    return { kind: 'score', passed, total, fixesDone };
  }
  return null;
}

async function loadRow(db: D1Database, id: string): Promise<WinRow | null> {
  const row = await db.prepare(
    `SELECT id, owner_id, agency_name, claim_kind, passed, total, fixes_done, hide_score, created_at
     FROM win_shares WHERE id = ? LIMIT 1`,
  ).bind(id).first<WinRow>();
  return row ?? null;
}

function unavailable(): Response {
  return new Response(
    '<!doctype html><html><head><meta charset="utf-8"><title>Page not available</title></head><body><p>This page is not available.</p></body></html>',
    {
      status: 404,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex',
      },
    },
  );
}

function pageHtml(origin: string, id: string, row: WinRow, claim: WinClaim): string {
  const win = publicWin({
    agencyName: row.agency_name,
    claim,
    hideScore: row.hide_score === 1,
    createdAt: row.created_at,
  });
  const canonical = canonicalWinUrl(origin, id);
  const image = `${canonical}/og.png`;
  const cta = `${origin}/?utm_source=win&utm_medium=share&utm_campaign=win_page`;
  const description = [win.agency, win.result, win.date, win.footer].filter(Boolean).join('. ');
  const result = win.result ? `<p class="result">${escapeHtml(win.result)}</p>` : '';
  const date = win.date ? `<p class="date">${escapeHtml(win.date)}</p>` : '';
  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(win.agency)} | ${escapeHtml(win.footer)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(win.agency)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <style>
    @font-face { font-family: Outfit; font-style: normal; font-weight: 100 900; font-display: swap; src: url('/fonts/outfit-latin.woff2') format('woff2'); }
    @font-face { font-family: 'Instrument Serif'; font-style: normal; font-weight: 400; font-display: swap; src: url('/fonts/instrument-serif-latin.woff2') format('woff2'); }
    body { margin: 0; background: #12100A; color: #f1f1f1; font-family: 'Instrument Serif', Georgia, serif; }
    main { max-width: 40rem; margin: 0 auto; padding: 4rem 1.25rem; }
    p { font-size: 1.25rem; line-height: 1.5; }
    .kicker, .footer, a { font-family: Outfit, system-ui, sans-serif; }
    .kicker { color: #BF953F; letter-spacing: 0.08em; text-transform: uppercase; font-size: 0.8rem; }
    h1 { font-size: clamp(2.2rem, 8vw, 3.25rem); font-weight: 400; line-height: 1.1; margin: 0.5rem 0 1rem; }
    .date, .footer { color: #a8a8a8; }
    a.cta { display: inline-flex; min-height: 2.75rem; align-items: center; margin-top: 1.5rem; padding: 0 1rem; background: #BF953F; color: #000; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <main>
    <p class="kicker">Luminara Suite</p>
    <h1>${escapeHtml(win.agency)}</h1>
    ${result}
    ${date}
    <p class="footer">${escapeHtml(win.footer)}</p>
    <a class="cta" href="${escapeHtml(cta)}">${escapeHtml(WIN_CTA)}</a>
  </main>
</body>
</html>`;
}

async function rememberView(db: D1Database, id: string): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO product_analytics_events
        (id, account_id, session_id, event_type, path, payload_json, created_at)
       VALUES (?, NULL, NULL, 'share_page_view', ?, '{}', ?)`,
    ).bind(crypto.randomUUID(), `/win/${id}`, Date.now()).run();
  } catch {
    /* the page still renders */
  }
}

async function pngResponse(request: Request, win: ReturnType<typeof publicWin>): Promise<Response> {
  try {
    const hit = await caches.default.match(request);
    if (hit) return hit;
  } catch {
    /* local tests have no Cache API */
  }
  const png = await renderWinPng(win);
  const response = new Response(png, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=300',
    },
  });
  try {
    await caches.default.put(request, response.clone());
  } catch {
    /* local tests have no Cache API */
  }
  return response;
}

export async function maybeServeWinHtml(request: Request, env: WinEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const match = url.pathname.replace(/\/+$/, '').match(WIN_ID);
  if (!match) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (!env.DB) return unavailable();
  const id = match[1].toLowerCase();
  const row = await loadRow(env.DB, id);
  const claim = row ? claimFromRow(row) : null;
  if (!row || !claim) return unavailable();
  const win = publicWin({
    agencyName: row.agency_name,
    claim,
    hideScore: row.hide_score === 1,
    createdAt: row.created_at,
  });
  if (match[2]) {
    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    return pngResponse(request, win);
  }
  if (request.method === 'GET') await rememberView(env.DB, id);
  const html = pageHtml(originOf(env, request), id, row, claim);
  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function handleWinRoute(request: Request, env: Env, path: string): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database not configured', code: 'DB_UNAVAILABLE' }, 503);
  const idMatch = path.match(API_ID);
  if (request.method === 'DELETE' && idMatch) {
    const who = await identify(request, env);
    if (!who.user) return json({ ok: false, error: who.error || 'Sign in to revoke a public page.', code: 'AUTH_REQUIRED' }, 401);
    const result = await env.DB.prepare(`DELETE FROM win_shares WHERE id = ? AND owner_id = ?`)
      .bind(idMatch[1].toLowerCase(), billingId(who.user))
      .run();
    if (!result.meta.changes) return json({ ok: false, error: 'Public page not found', code: 'WIN_NOT_FOUND' }, 404);
    return json({ ok: true });
  }
  if (request.method !== 'POST' || path !== '/wins') return json({ ok: false, error: 'Method not allowed' }, 405);
  const who = await identify(request, env);
  if (!who.user) return json({ ok: false, error: who.error || 'Sign in to publish a public page.', code: 'AUTH_REQUIRED' }, 401);
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ ok: false, error: 'That request is too large.', code: 'WIN_SHAPE' }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ ok: false, error: 'Send the agency name and the measured result.', code: 'WIN_SHAPE' }, 400);
  }
  const parsed = parseWinCreate(raw);
  if (!parsed.ok) return json({ ok: false, error: parsed.error, code: parsed.code }, 400);
  const owner = billingId(who.user);
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM win_shares WHERE owner_id = ? AND created_at > ?`,
  ).bind(owner, since).first<{ n: number }>();
  if ((count?.n ?? 0) >= DAILY_CAP) {
    return json({ ok: false, error: 'This account already has 20 public pages from the last day.', code: 'WIN_CAP' }, 429);
  }
  const id = newWinId();
  const claim = parsed.claim;
  await env.DB.prepare(
    `INSERT INTO win_shares
      (id, owner_id, agency_name, claim_kind, passed, total, fixes_done, hide_score, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    owner,
    parsed.agencyName,
    claim.kind,
    claim.kind === 'score' ? claim.passed : null,
    claim.kind === 'score' ? claim.total : null,
    claim.fixesDone,
    parsed.hideScore ? 1 : 0,
    Date.now(),
  ).run();
  const url = canonicalWinUrl(originOf(env, request), id);
  return json({ ok: true, id, url });
}
