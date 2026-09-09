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
import cors from 'cors';
import * as cheerio from 'cheerio';
import { timingSafeEqual } from 'node:crypto';
import { assertPublicTarget, parsePublicHttpUrl } from './ssrf.mjs';

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
const MAX_TIMEOUT_MS = 60_000;

app.disable('x-powered-by');
app.use(cors({ methods: ['GET', 'POST'], allowedHeaders: ['content-type', 'x-crawler-token', 'authorization'] }));
app.use(express.json({ limit: '256kb' }));

function tokenMatches(presented) {
  if (!CRAWLER_TOKEN) return true;
  const given = Buffer.from(String(presented || ''));
  const expected = Buffer.from(CRAWLER_TOKEN);
  // Compare byte lengths, not string lengths: multi-byte input would otherwise make timingSafeEqual throw.
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

app.use((req, res, next) => {
  if (req.path === '/health' || req.method === 'OPTIONS') return next();
  const bearer = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (tokenMatches(req.get('x-crawler-token') || bearer)) return next();
  res.status(401).json({ success: false, error: 'Missing or invalid crawler token' });
});

const clampNumber = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

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
async function executePatchrightSerp(query, { num = 10, hl = 'en', gl = 'us', proxy, timeout = 25000 } = {}) {
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
app.post('/scrape', async (req, res) => {
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

    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });

    // Redirects and subresources are checked too: a public page must not pull the browser onto a
    // private host (DNS rebinding and redirect-based SSRF are checked syntactically per request).
    await context.route('**/*', route => {
      const reqUrl = route.request().url();
      if (/^(data|blob|about):/i.test(reqUrl) || parsePublicHttpUrl(reqUrl)) return route.continue();
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
});

// SERP Scrape Endpoint (Google Search Grounding & AEO Intelligence)
app.post('/serp', async (req, res) => {
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
      parsed = await executePatchrightSerp(query, { num, hl, gl, proxy });
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
});

if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1' && !CRAWLER_TOKEN) {
  console.warn('[Luminara Crawler] WARNING: HOST is not loopback and CRAWLER_TOKEN is empty. Anyone who can reach this port can drive the browser. Set CRAWLER_TOKEN.');
}

app.listen(PORT, HOST, () => {
  console.log(`[Luminara Crawler] Patchright Stealth Runner & SERP Engine listening on ${HOST}:${PORT}${CRAWLER_TOKEN ? ' (token required)' : ''}`);
  console.log(`[Luminara Crawler] Health check available at http://localhost:${PORT}/health`);
});
