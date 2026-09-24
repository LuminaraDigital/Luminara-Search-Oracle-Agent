/**
 * Luminara Stealth Crawler & SERP Runner (Powered by Patchright & Cheerio)
 * 
 * Standalone Node.js microservice providing:
 * 1. Headless Chromium automation with AST-patched CDP communications to bypass
 *    Cloudflare Turnstile, DataDome, and anti-bot heuristics without leaking automation signatures.
 * 2. Multi-tier Google SERP scraping engine (Fast HTTP + Patchright Stealth Fallback)
 *    for zero-cost live SERP grounding, AEO snippet extraction, and ranking intelligence.
 */

import express from 'express';
import * as cheerio from 'cheerio';
import { createHash, timingSafeEqual } from 'node:crypto';
import { assertPublicTarget } from './ssrf.mjs';
import {
  createRateLimiter,
  createSemaphore,
  parseAllowedOrigins,
  parsePositiveInt,
  resolveClientIp,
  resolveCorsOrigin,
} from './limits.mjs';
import {
  ACTION_SNAPSHOT_SOURCE,
  RESOLVE_ACTION_TARGET_SOURCE,
} from './actionSnapshot.mjs';
import { createSessionStore, MAX_SESSIONS } from './sessionStore.mjs';

const app = express();
const PORT = process.env.PORT || 3001;
// Loopback by default: the crawler drives a real browser, so it must not be reachable from the
// network unless you mean it. In Docker the container binds 0.0.0.0 and compose publishes it on
// 127.0.0.1 only. Set HOST=0.0.0.0 to expose it deliberately (and set CRAWLER_TOKEN).
const HOST = process.env.HOST || '127.0.0.1';
// Optional shared secret. When set, every request except /health must send it as
// `x-crawler-token: <token>` (or `Authorization: Bearer <token>`). Required when exposed beyond loopback.
const CRAWLER_TOKEN = (process.env.CRAWLER_TOKEN || '').trim();
// Optional outbound proxy for the headless browser. Callers can no longer pick one per request:
// an attacker with access to the API could otherwise route the browser through their own proxy.
const CRAWLER_PROXY = (process.env.CRAWLER_PROXY || '').trim();
// Browser origins allowed cross-origin (comma-separated, exact). Unset means the local Vite app; empty means none.
const CRAWLER_ALLOWED_ORIGINS = parseAllowedOrigins(
  process.env.CRAWLER_ALLOWED_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000'
);
const CRAWLER_MAX_CONCURRENCY = parsePositiveInt(process.env.CRAWLER_MAX_CONCURRENCY, 2, 1, 32);
const CRAWLER_RATE_LIMIT_PER_MIN = parsePositiveInt(process.env.CRAWLER_RATE_LIMIT_PER_MIN, 30, 1, 10_000);
// Only behind a reverse proxy you control; otherwise X-Forwarded-For is caller-chosen and dodges the limit.
const CRAWLER_TRUST_PROXY = String(process.env.CRAWLER_TRUST_PROXY || '').trim().toLowerCase() === 'true';
const BUSY_RETRY_AFTER_SEC = 5;
const MAX_TIMEOUT_MS = 60_000;
const IS_LOOPBACK_HOST = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';

// Fail closed: a non-loopback bind with no token would let anyone who can reach the port drive a
// real browser (SSRF, credential-stuffing via proxy, etc). Refuse to start rather than warn.
if (!IS_LOOPBACK_HOST && !CRAWLER_TOKEN) {
  console.error(
    '[Luminara Crawler] FATAL: HOST is not loopback and CRAWLER_TOKEN is empty. Refusing to start ' +
      'without a token, since anyone who can reach this port could drive the browser. Set CRAWLER_TOKEN ' +
      'or bind HOST to 127.0.0.1.'
  );
  process.exit(1);
}

app.disable('x-powered-by');

// Preflights from origins outside the allowlist get 403; other requests proceed with no ACAO header.
app.use((req, res, next) => {
  const origin = req.get('origin');
  const allowedOrigin = resolveCorsOrigin(origin, CRAWLER_ALLOWED_ORIGINS);
  if (origin) res.vary('Origin');
  if (allowedOrigin) {
    res.set('Access-Control-Allow-Origin', allowedOrigin);
    res.set('Access-Control-Expose-Headers', 'Retry-After');
  }
  if (req.method !== 'OPTIONS') return next();
  if (!allowedOrigin) return res.status(403).end();
  res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE');
  res.set('Access-Control-Allow-Headers', 'content-type, x-crawler-token, authorization');
  res.set('Access-Control-Max-Age', '600');
  // Chrome Private Network Access: an allowlisted https app calling this loopback port must opt in.
  if (req.get('access-control-request-private-network') === 'true') {
    res.set('Access-Control-Allow-Private-Network', 'true');
  }
  return res.status(204).end();
});

function tokenMatches(presented) {
  // No token configured is only ever reachable here on a loopback bind (enforced at startup above).
  if (!CRAWLER_TOKEN) return true;
  const given = Buffer.from(String(presented || ''));
  const expected = Buffer.from(CRAWLER_TOKEN);
  // Compare byte lengths, not string lengths: multi-byte input would otherwise make timingSafeEqual throw.
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const bearer = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (tokenMatches(req.get('x-crawler-token') || bearer)) return next();
  res.status(401).json({ success: false, error: 'Missing or invalid crawler token' });
});

// Parsed after auth so unauthenticated callers cannot make us buffer request bodies.
app.use(express.json({ limit: '256kb' }));

const clampNumber = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const rateLimiter = createRateLimiter({ limit: CRAWLER_RATE_LIMIT_PER_MIN, windowMs: 60_000 });
const browserSlots = createSemaphore(CRAWLER_MAX_CONCURRENCY);
// Interactive observe/act sessions. Each live session holds one browserSlots entry for its
// lifetime, so CRAWLER_MAX_CONCURRENCY also caps concurrent sessions.
const sessionStore = createSessionStore({ maxSessions: Math.min(MAX_SESSIONS, CRAWLER_MAX_CONCURRENCY) });

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--window-size=1920,1080',
  '--disable-dev-shm-usage',
];

/**
 * Rate-limit + optional browser slot. Session observe/act pass skipSlot because the session
 * already holds a long-lived slot from POST /session.
 *
 * @param {Function} handler
 * @param {{ holdSlot?: boolean, skipSlot?: boolean }} [opts]
 */
function heavyRoute(handler, { holdSlot = false, skipSlot = false } = {}) {
  return async (req, res) => {
    const ip = resolveClientIp(req.socket.remoteAddress, req.get('x-forwarded-for'), CRAWLER_TRUST_PROXY);
    const rate = rateLimiter.hit(ip);
    if (!rate.allowed) {
      res.set('Retry-After', String(rate.retryAfterSec));
      return res.status(429).json({ success: false, error: 'Rate limit exceeded, retry later' });
    }

    let release = null;
    if (!skipSlot) {
      release = browserSlots.tryAcquire();
      if (!release) {
        res.set('Retry-After', String(BUSY_RETRY_AFTER_SEC));
        return res.status(429).json({ success: false, error: 'Crawler is busy, retry later' });
      }
    }

    let retained = false;
    const ctx = holdSlot
      ? {
          keepSlot() {
            if (!release) throw new Error('keepSlot requires an acquired browser slot');
            retained = true;
            return release;
          },
        }
      : undefined;

    const aborter = new AbortController();
    const onClose = () => {
      if (!res.writableFinished) aborter.abort();
    };
    res.on('close', onClose);
    try {
      await handler(req, res, aborter.signal, ctx);
    } catch (err) {
      console.error('[Crawler] Unhandled route error:', err?.message || err);
      if (!res.headersSent) res.status(500).json({ success: false, error: 'Internal crawler error' });
    } finally {
      res.off('close', onClose);
      if (release && !retained) release();
    }
  };
}

function fingerprintMarker(marker) {
  return createHash('sha256').update(JSON.stringify(marker ?? null)).digest('hex');
}

async function closeSessionResources(session) {
  if (!session) return;
  try {
    if (session.context) await session.context.close().catch(() => {});
  } finally {
    try {
      if (session.browser) await session.browser.close().catch(() => {});
    } finally {
      if (typeof session.releaseSlot === 'function') {
        try {
          session.releaseSlot();
        } catch {
          /* slot already freed */
        }
      }
    }
  }
}

async function sweepExpiredSessions() {
  const expired = sessionStore.destroyExpired();
  for (const session of expired) {
    await closeSessionResources(session);
  }
  return expired.length;
}

async function installPublicRouteGuard(context) {
  const hostRoutableCache = new Map();
  async function isRoutableTarget(reqUrl) {
    if (/^(data|blob|about):/i.test(reqUrl)) return true;
    let hostname;
    try {
      hostname = new URL(reqUrl).hostname.toLowerCase();
    } catch {
      return false;
    }
    if (hostRoutableCache.has(hostname)) return hostRoutableCache.get(hostname);
    const verdict = (await assertPublicTarget(reqUrl)).ok;
    hostRoutableCache.set(hostname, verdict);
    return verdict;
  }
  await context.route('**/*', async route => {
    const reqUrl = route.request().url();
    if (await isRoutableTarget(reqUrl)) return route.continue();
    return route.abort('blockedbyclient');
  });
}

/**
 * Run the indexed DOM snapshot on a live page. Browser stays open.
 * @returns {Promise<object|null>}
 */
async function observePage(page, { screenshot = false } = {}) {
  const snapshot = await page.evaluate(ACTION_SNAPSHOT_SOURCE);
  if (!snapshot) return null;
  const observe = {
    ...snapshot,
    fingerprint: fingerprintMarker(snapshot.marker),
  };
  if (screenshot) {
    const buf = await page.screenshot({ type: 'jpeg', quality: 72, fullPage: false });
    observe.screenshot = Buffer.from(buf).toString('base64');
  }
  return observe;
}

/**
 * Execute one observed action (click|fill|select|scroll|wait). Never accepts selectors/JS from the model.
 */
async function executeObservedAction(page, action, text) {
  const kind = action.kind;
  if (kind === 'wait') {
    await page.waitForTimeout(100);
    return { executed: action.id };
  }
  if (kind === 'scroll') {
    const delta = Number(action.delta) || 0;
    await page.mouse.wheel(0, delta);
    return { executed: action.id };
  }
  if (!Number.isInteger(action.node)) {
    throw Object.assign(new Error('Invalid observed node'), { code: 'StalePage' });
  }
  const target = await page.evaluate(RESOLVE_ACTION_TARGET_SOURCE, action);
  if (target == null) {
    throw Object.assign(
      new Error(kind === 'select'
        ? 'Dropdown execution was not confirmed; observe again'
        : 'Target changed or is covered. Observe again.'),
      { code: 'StalePage' }
    );
  }
  if (kind === 'select') {
    return { executed: action.id };
  }
  await page.mouse.click(target.x, target.y);
  if (kind === 'fill') {
    if (typeof text !== 'string') {
      throw Object.assign(new Error('fill actions require a string "text" field'), { code: 'BadRequest' });
    }
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.insertText(text);
  }
  return { executed: action.id };
}

// Health Check Endpoint
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    engine: 'patchright-and-serp',
    version: '1.50.0',
    message: 'Luminara Patchright Stealth Runner & SERP Engine is active',
    uptimeSec: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Dynamic lazy browser pool / launcher
let patchrightLib = null;

async function getPatchright() {
  if (!patchrightLib) {
    try {
      patchrightLib = await import('patchright');
    } catch (e) {
      console.warn('[Crawler] "patchright" package not found. Falling back to playwright or error.');
      try {
        patchrightLib = await import('playwright');
      } catch (err2) {
        throw new Error('Neither "patchright" nor "playwright" is installed in this container/node environment.');
      }
    }
  }
  return patchrightLib;
}

/**
 * Parses Google Search HTML to extract organic results, featured snippets, and People Also Ask.
 */
function parseGoogleSerpHtml(html) {
  const $ = cheerio.load(html);

  const titleText = $('title').text().toLowerCase();
  const isBlocked =
    titleText.includes('sorry...') ||
    titleText.includes('unusual traffic') ||
    $('form#captcha-form').length > 0 ||
    $('div#recaptcha, div.g-recaptcha').length > 0;

  if (isBlocked) {
    return { blocked: true, results: [], peopleAlsoAsk: [] };
  }

  // Extract Featured Snippet / AI Overview
  let featuredSnippet = null;
  const fsEl = $('div.kp-blk, div.xpdopen, [data-attrid="wa:/description"]').first();
  if (fsEl.length) {
    const fsText =
      fsEl.find('.hgKElc, [data-attrid="wa:/description"], .LGOjdf, .VwiC3b, .BNeawe').first().text().trim();
    const fsLink = fsEl.find('a[href^="http"], a[href^="/url?q="]').first();
    let fsUrl = fsLink.attr('href') || '';
    if (fsUrl.includes('/url?q=')) {
      const m = fsUrl.match(/\/url\?q=([^&]+)/);
      if (m) fsUrl = decodeURIComponent(m[1]);
    }
    const fsTitle = fsEl.find('h3, .vvjwJb').first().text().trim() || fsLink.text().trim();
    if (fsText) {
      featuredSnippet = { title: fsTitle, snippet: fsText, url: fsUrl };
    }
  }

  // Extract People Also Ask (PAA)
  const peopleAlsoAsk = [];
  $('div.related-question-pair, [data-q], div[jsname="yE30J"], div.s75Fgc').each((_, el) => {
    const q =
      $(el).attr('data-q') ||
      $(el).find('div[role="button"]').first().text().trim() ||
      $(el).find('span').first().text().trim();
    if (q && q.length > 5 && !peopleAlsoAsk.includes(q)) {
      peopleAlsoAsk.push(q);
    }
  });

  // Extract Organic Results
  const results = [];
  const seenUrls = new Set();

  // Strategy 1: Desktop Hydrated H3 elements (Patchright Stealth mode)
  $('h3').each((_, el) => {
    const $h3 = $(el);
    const title = $h3.text().trim();
    if (!title || title.length < 2) return;

    const container = $h3.closest('div.MjjYud, div.g, div[data-hveid], div.tF2Cxc');
    
    // Resolve URL from cite tag or anchor tag
    let url = '';
    const citeText = container.find('cite').first().text().trim();
    if (citeText) {
      const firstToken = citeText.split(/\s+/)[0];
      if (firstToken.startsWith('http')) {
        url = firstToken.replace(/[›>»].*$/, '').trim();
      } else if (firstToken.includes('.')) {
        url = `https://${firstToken.replace(/[›>»].*$/, '').trim()}`;
      }
    }

    if (!url) {
      const linkEl = $h3.closest('a').length ? $h3.closest('a') : container.find('a').first();
      let rawHref = linkEl.attr('href') || '';
      if (rawHref.includes('/url?q=')) {
        const match = rawHref.match(/\/url\?q=([^&]+)/);
        if (match) url = decodeURIComponent(match[1]);
      } else if (rawHref.startsWith('http') && !rawHref.includes('google.com')) {
        url = rawHref;
      } else if (rawHref.startsWith('/goto?')) {
        url = `https://www.google.com${rawHref}`;
      }
    }

    if (!url || seenUrls.has(url)) return;

    let snippet = '';
    if (container.length) {
      snippet = container.find('.VwiC3b, div[data-sncf], .yXK7lf, .IsZvec, .MUxGbd, .BNeawe').first().text().trim();
    }
    if (!snippet) {
      snippet = $h3.parent().parent().text().replace(title, '').trim();
    }

    seenUrls.add(url);
    results.push({
      rank: results.length + 1,
      title,
      url,
      snippet: (snippet.slice(0, 320) || title).replace(/\s+/g, ' ').trim(),
    });
  });

  // Strategy 2: Fast HTTP Classic / Mobile HTML layout (div.kCrYT, .BNeawe)
  if (results.length === 0) {
    $('div.kCrYT, div.egMi0').each((_, el) => {
      const $el = $(el);
      const linkEl = $el.find('a[href*="/url?q="], a[href^="http"]').first();
      let url = linkEl.attr('href') || '';
      if (url.includes('/url?q=')) {
        const m = url.match(/\/url\?q=([^&]+)/);
        if (m) url = decodeURIComponent(m[1]);
      }
      if (!url || !url.startsWith('http') || url.includes('google.com') || seenUrls.has(url)) {
        return;
      }

      const title = $el.find('.BNeawe.vvjwJb, h3').first().text().trim() || linkEl.text().trim();
      if (!title) return;

      const nextEl = $el.next('.kCrYT');
      const snippet = nextEl.find('.BNeawe.s3v9rd').text().trim() || '';

      seenUrls.add(url);
      results.push({
        rank: results.length + 1,
        title,
        url,
        snippet: (snippet.slice(0, 320) || title).replace(/\s+/g, ' ').trim(),
      });
    });
  }

  return {
    blocked: false,
    results,
    featuredSnippet,
    peopleAlsoAsk: peopleAlsoAsk.slice(0, 6),
  };
}

/**
 * Fast-path HTTP Google SERP request.
 */
async function executeFastHttpSerp(query, { num = 10, hl = 'en', gl = 'us' } = {}) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${num}&hl=${hl}&gl=${gl}&pws=0`;
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': `${hl}-${gl.toUpperCase()},${hl};q=0.9,en;q=0.8`,
    'Cookie': 'CONSENT=PENDING+999; SOCS=CAESHAgBEhJnd3NfMjAyNDA5MDMtMF9SQzIaAmVuIAEaBgiAoeq4Bg;',
    'Sec-Ch-Ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.status === 429 || res.status === 503) {
      console.log(`[SERP Fast] HTTP blocked: ${res.status}`);
      return { blocked: true, status: res.status };
    }

    const html = await res.text();
    const parsed = parseGoogleSerpHtml(html);
    console.log(`[SERP Fast] Status: ${res.status} | Results: ${parsed.results?.length} | Blocked: ${parsed.blocked}`);
    return { ...parsed, status: res.status };
  } catch (err) {
    clearTimeout(timeoutId);
    console.log(`[SERP Fast] Error: ${err.message}`);
    return { blocked: true, error: err.message };
  }
}

/**
 * Stealth-path Patchright Chromium Google SERP request.
 */
async function executePatchrightSerp(query, { num = 10, hl = 'en', gl = 'us', proxy, timeout = 25000, signal } = {}) {
  const pr = await getPatchright();
  const chromium = pr.chromium;

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--window-size=1920,1080',
    '--disable-dev-shm-usage',
  ];

  const launchOptions = {
    headless: true,
    args: launchArgs,
  };

  if (proxy) {
    launchOptions.proxy = { server: proxy };
  }

  let browser = null;
  let context = null;

  try {
    browser = await chromium.launch(launchOptions);
    if (signal?.aborted) throw new Error('Client disconnected');
    signal?.addEventListener('abort', () => browser.close().catch(() => {}), { once: true });
    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      locale: `${hl}-${gl.toUpperCase()}`,
      timezoneId: 'America/New_York',
    });

    await context.addCookies([
      {
        name: 'SOCS',
        value: 'CAESHAgBEhJnd3NfMjAyNDA5MDMtMF9SQzIaAmVuIAEaBgiAoeq4Bg',
        domain: '.google.com',
        path: '/',
      },
      {
        name: 'CONSENT',
        value: 'PENDING+999',
        domain: '.google.com',
        path: '/',
      },
    ]);

    const page = await context.newPage();
    const targetUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${num}&hl=${hl}&gl=${gl}&pws=0`;

    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout,
    });

    // Check if consent button appears and dismiss it if present
    try {
      const consentBtn = await page.$('button:has-text("Accept all"), button:has-text("I agree"), form[action*="consent"] button');
      if (consentBtn) {
        await consentBtn.click();
        await page.waitForTimeout(1000);
      }
    } catch {}

    // Wait for search result settlement
    await page.waitForSelector('h3, div#search, [data-sokoban-container]', { timeout: 4000 }).catch(() => {});

    const currentUrl = page.url();
    const title = await page.title();
    const html = await page.content();
    const parsed = parseGoogleSerpHtml(html);
    console.log(`[SERP Patchright] Query: "${query}" | Extracted results: ${parsed.results?.length}`);
    return parsed;
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

// Scrape Endpoint (Generic Web Page Scraping)
app.post('/scrape', heavyRoute(async (req, res, signal) => {
  const body = req.body || {};
  const url = body.url;
  const waitFor = clampNumber(body.waitFor, 1500, 0, 15_000);
  const timeout = clampNumber(body.timeout, 25_000, 1_000, MAX_TIMEOUT_MS);
  const proxy = CRAWLER_PROXY || undefined;

  if (!url || typeof url !== 'string' || url.length > 2048) {
    return res.status(400).json({ success: false, error: 'A valid "url" parameter is required' });
  }
  // SSRF guard: public http(s) hosts only; loopback, RFC1918, link-local and metadata ranges are refused.
  const target = await assertPublicTarget(url);
  if (!target.ok) {
    return res.status(400).json({ success: false, url, error: target.error });
  }

  const startTime = Date.now();
  let browser = null;
  let context = null;

  try {
    const pr = await getPatchright();
    const chromium = pr.chromium;

    // Launch with stealth arguments
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1920,1080',
      '--disable-dev-shm-usage',
    ];

    const launchOptions = {
      headless: true,
      args: launchArgs,
    };

    if (proxy) {
      launchOptions.proxy = { server: proxy };
    }

    browser = await chromium.launch(launchOptions);
    // A disconnected client should not pin a browser slot until the navigation timeout.
    if (signal.aborted) throw new Error('Client disconnected');
    signal.addEventListener('abort', () => browser.close().catch(() => {}), { once: true });

    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });

    // Redirects and subresources are checked too: a public page must not pull the browser onto a
    // private host. Each distinct hostname is DNS-resolved (not just syntax-checked) so a redirect
    // or subresource pointed at a rebinding domain (e.g. *.nip.io -> 127.0.0.1) is still refused.
    const hostRoutableCache = new Map();
    async function isRoutableTarget(reqUrl) {
      if (/^(data|blob|about):/i.test(reqUrl)) return true;
      let hostname;
      try {
        hostname = new URL(reqUrl).hostname.toLowerCase();
      } catch {
        return false;
      }
      if (hostRoutableCache.has(hostname)) return hostRoutableCache.get(hostname);
      const verdict = (await assertPublicTarget(reqUrl)).ok;
      hostRoutableCache.set(hostname, verdict);
      return verdict;
    }
    await context.route('**/*', async route => {
      const reqUrl = route.request().url();
      if (await isRoutableTarget(reqUrl)) return route.continue();
      return route.abort('blockedbyclient');
    });

    const page = await context.newPage();

    // Navigate
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout,
    });

    // Wait for dynamic hydration or anti-bot challenge settlement
    if (waitFor > 0) {
      await page.waitForTimeout(waitFor);
    }

    const statusCode = response ? response.status() : 200;
    const title = await page.title();
    const html = await page.content();

    // Quick in-browser metadata extraction
    const pageData = await page.evaluate(() => {
      const descEl = document.querySelector('meta[name="description"]') ||
                     document.querySelector('meta[property="og:description"]');
      const desc = descEl ? descEl.getAttribute('content') : '';

      // Simple DOM to text extraction
      const body = document.body ? document.body.innerText : '';
      return { desc, body };
    });

    const latencyMs = Date.now() - startTime;

    res.json({
      success: true,
      url,
      statusCode,
      title,
      description: pageData.desc || '',
      html,
      markdown: pageData.body || '',
      latencyMs,
      antiBotBypassed: true,
    });
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    console.error(`[Crawler] Scrape error for ${url}:`, err.message);
    res.status(500).json({
      success: false,
      url,
      error: err.message,
      latencyMs,
    });
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}));

// SERP Scrape Endpoint (Google Search Grounding & AEO Intelligence)
app.post('/serp', heavyRoute(async (req, res, signal) => {
  const body = req.body || {};
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 500) : '';
  const num = clampNumber(body.num, 10, 1, 20);
  const hl = /^[a-z]{2}$/i.test(String(body.hl || '')) ? String(body.hl).toLowerCase() : 'en';
  const gl = /^[a-z]{2}$/i.test(String(body.gl || '')) ? String(body.gl).toLowerCase() : 'us';
  const preferStealth = body.preferStealth === true;
  const proxy = CRAWLER_PROXY || undefined;

  if (!query) {
    return res.status(400).json({ success: false, error: 'A valid "query" string parameter is required' });
  }

  const startTime = Date.now();
  let tier = 'fast-http';
  let parsed = null;

  try {
    if (!preferStealth) {
      // Tier 1: Fast HTTP
      const fastResult = await executeFastHttpSerp(query, { num, hl, gl });
      if (!fastResult.blocked && fastResult.results && fastResult.results.length > 0) {
        parsed = fastResult;
      } else {
        console.log(`[SERP] Fast HTTP blocked or empty for "${query}". Falling back to Patchright stealth.`);
      }
    }

    // Tier 2: Patchright Stealth Fallback
    if (!parsed) {
      tier = 'patchright-stealth';
      parsed = await executePatchrightSerp(query, { num, hl, gl, proxy, signal });
    }

    const latencyMs = Date.now() - startTime;
    const finalResults = (parsed.results || []).slice(0, num);

    res.json({
      success: true,
      query,
      tier,
      latencyMs,
      featuredSnippet: parsed.featuredSnippet || null,
      aiOverview: parsed.aiOverview || null,
      results: finalResults,
      peopleAlsoAsk: parsed.peopleAlsoAsk || [],
    });
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    console.error(`[SERP] Error for "${query}":`, err.message);
    res.status(500).json({
      success: false,
      query,
      tier,
      error: err.message,
      latencyMs,
      results: [],
    });
  }
}));

// ---------------------------------------------------------------------------
// Indexed DOM action sessions (additive; /health /scrape /serp unchanged)
// ---------------------------------------------------------------------------

app.post('/session', heavyRoute(async (req, res, signal, ctx) => {
  await sweepExpiredSessions();

  const body = req.body || {};
  const url = body.url;
  const accountKey = typeof body.accountKey === 'string' ? body.accountKey.trim().slice(0, 128) : undefined;
  const timeout = clampNumber(body.timeout, 25_000, 1_000, MAX_TIMEOUT_MS);
  const proxy = CRAWLER_PROXY || undefined;

  if (!url || typeof url !== 'string' || url.length > 2048) {
    return res.status(400).json({ success: false, error: 'A valid "url" parameter is required' });
  }
  const target = await assertPublicTarget(url);
  if (!target.ok) {
    return res.status(400).json({ success: false, url, error: target.error });
  }
  if (sessionStore.size >= sessionStore.maxSessions) {
    res.set('Retry-After', String(BUSY_RETRY_AFTER_SEC));
    return res.status(429).json({
      success: false,
      error: 'Session cap reached; CRAWLER_MAX_CONCURRENCY also caps concurrent sessions',
    });
  }

  let browser = null;
  let context = null;
  let kept = false;

  try {
    const pr = await getPatchright();
    const launchOptions = { headless: true, args: LAUNCH_ARGS };
    if (proxy) launchOptions.proxy = { server: proxy };

    browser = await pr.chromium.launch(launchOptions);
    if (signal.aborted) throw new Error('Client disconnected');

    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });
    await installPublicRouteGuard(context);

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForTimeout(400);

    const observe = await observePage(page, { screenshot: false });
    if (!observe) {
      throw new Error('Document is navigating; observe returned null');
    }

    const releaseSlot = ctx.keepSlot();
    kept = true;

    const created = sessionStore.create({
      browser,
      context,
      page,
      accountKey,
      releaseSlot,
      lastObserve: observe,
    });
    if (!created.ok) {
      kept = false;
      releaseSlot();
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      return res.status(429).json({ success: false, error: created.error });
    }

    // Ownership transferred to the session store; do not close here.
    browser = null;
    context = null;

    return res.json({
      success: true,
      sessionId: created.session.id,
      observe,
    });
  } catch (err) {
    console.error('[Crawler] Session create error:', err.message);
    if (!kept) {
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
    return res.status(500).json({ success: false, error: err.message });
  }
}, { holdSlot: true }));

app.post('/session/:id/observe', heavyRoute(async (req, res) => {
  await sweepExpiredSessions();
  const session = sessionStore.get(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Unknown or expired session' });
  }
  sessionStore.touch(session.id);

  const wantScreenshot = req.body?.screenshot === true;
  try {
    const observe = await observePage(session.page, { screenshot: wantScreenshot });
    if (!observe) {
      return res.status(409).json({ success: false, error: 'Document is navigating; observe again' });
    }
    session.lastObserve = observe;
    return res.json({ success: true, sessionId: session.id, observe });
  } catch (err) {
    console.error('[Crawler] Session observe error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}, { skipSlot: true }));

app.post('/session/:id/act', heavyRoute(async (req, res) => {
  await sweepExpiredSessions();
  const session = sessionStore.get(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Unknown or expired session' });
  }
  sessionStore.touch(session.id);

  const body = req.body || {};
  const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint : '';
  const actionId = typeof body.actionId === 'string' ? body.actionId : '';
  const text = body.text;

  if (!fingerprint || !actionId) {
    return res.status(400).json({
      success: false,
      error: 'Both "fingerprint" and "actionId" are required',
    });
  }

  const prior = session.lastObserve;
  if (!prior || prior.fingerprint !== fingerprint) {
    return res.status(409).json({
      success: false,
      error: 'StalePage: fingerprint mismatch; observe again',
      code: 'StalePage',
    });
  }

  const action = (prior.actions || []).find(a => a.id === actionId);
  if (!action) {
    return res.status(400).json({
      success: false,
      error: `Unknown actionId "${actionId}" for the current observe`,
    });
  }

  try {
    const result = await executeObservedAction(session.page, action, text);
    // Brief settle then re-observe (never retry a mutation; only re-predict after observe).
    await session.page.waitForTimeout(80);
    const observe = await observePage(session.page, { screenshot: false });
    if (!observe) {
      return res.status(409).json({
        success: false,
        error: 'Document is navigating after act; observe again',
        code: 'StalePage',
        historyEntry: {
          actionId: action.id,
          kind: action.kind,
          label: action.label,
          executed: result.executed,
          text: action.kind === 'fill' ? '[redacted]' : undefined,
        },
      });
    }
    session.lastObserve = observe;

    const historyEntry = {
      actionId: action.id,
      kind: action.kind,
      label: action.label,
      executed: result.executed,
      at: new Date().toISOString(),
    };
    // Do not echo fill payloads that may contain secrets.
    if (action.kind === 'fill') historyEntry.hadText = typeof text === 'string';

    return res.json({
      success: true,
      sessionId: session.id,
      historyEntry,
      observe,
    });
  } catch (err) {
    const status = err.code === 'BadRequest' ? 400 : err.code === 'StalePage' ? 409 : 500;
    console.error('[Crawler] Session act error:', err.message);
    return res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || undefined,
    });
  }
}, { skipSlot: true }));

app.delete('/session/:id', heavyRoute(async (req, res) => {
  await sweepExpiredSessions();
  const session = sessionStore.destroy(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Unknown or expired session' });
  }
  await closeSessionResources(session);
  return res.json({ success: true, sessionId: session.id, closed: true });
}, { skipSlot: true }));

app.listen(PORT, HOST, () => {
  console.log(`[Luminara Crawler] Patchright Stealth Runner & SERP Engine listening on ${HOST}:${PORT}${CRAWLER_TOKEN ? ' (token required)' : ''}`);
  console.log(
    `[Luminara Crawler] Limits: ${browserSlots.max} concurrent browser slots (also caps /session), ` +
      `${CRAWLER_RATE_LIMIT_PER_MIN} req/min per IP` +
      `${CRAWLER_TRUST_PROXY ? ' (X-Forwarded-For trusted)' : ''}, ${CRAWLER_ALLOWED_ORIGINS.size} CORS origin(s)`
  );
  console.log(`[Luminara Crawler] Health check available at http://localhost:${PORT}/health`);
});
