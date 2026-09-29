import {
  DEFAULT_OG_IMAGE,
  MARKETING_ORIGIN,
  MARKETING_SHELL_BY_PATH,
  marketingShellKey,
  type MarketingShellMeta,
} from '../services/marketing/pageMeta';
import { sha256Hex } from './workerUtils';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Inject per-path title, description, canonical, OG tags and JSON-LD into the SPA shell. */
export function injectMarketingMeta(html: string, page: MarketingShellMeta): string {
  const url = page.path === '/' ? `${MARKETING_ORIGIN}/` : `${MARKETING_ORIGIN}${page.path}`;
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);
  const canonical = escapeHtml(url);
  const image = escapeHtml(DEFAULT_OG_IMAGE);
  const jsonLd = JSON.stringify(page.jsonLd).replace(/</g, '\\u003c');

  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);
  out = out.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*>/i,
    `<meta name="description" content="${description}">`,
  );
  out = out.replace(
    /<meta\s+property="og:title"\s+content="[^"]*"\s*>/i,
    `<meta property="og:title" content="${title}">`,
  );
  out = out.replace(
    /<meta\s+property="og:description"\s+content="[^"]*"\s*>/i,
    `<meta property="og:description" content="${description}">`,
  );
  out = out.replace(
    /<meta\s+property="og:url"\s+content="[^"]*"\s*>/i,
    `<meta property="og:url" content="${canonical}">`,
  );
  out = out.replace(
    /<meta\s+property="og:image"\s+content="[^"]*"\s*>/i,
    `<meta property="og:image" content="${image}">`,
  );
  out = out.replace(
    /<meta\s+name="twitter:card"\s+content="[^"]*"\s*>/i,
    '<meta name="twitter:card" content="summary_large_image">',
  );
  out = out.replace(
    /<meta\s+name="twitter:title"\s+content="[^"]*"\s*>/i,
    `<meta name="twitter:title" content="${title}">`,
  );
  out = out.replace(
    /<meta\s+name="twitter:description"\s+content="[^"]*"\s*>/i,
    `<meta name="twitter:description" content="${description}">`,
  );
  out = out.replace(
    /<meta\s+name="twitter:image"\s+content="[^"]*"\s*>/i,
    `<meta name="twitter:image" content="${image}">`,
  );

  if (!/<link\s+rel="canonical"/i.test(out)) {
    out = out.replace(
      /<\/head>/i,
      `  <link rel="canonical" href="${canonical}">\n  <script type="application/ld+json" id="luminara-marketing-jsonld">${jsonLd}</script>\n</head>`,
    );
  } else {
    out = out.replace(
      /<link\s+rel="canonical"\s+href="[^"]*"\s*>/i,
      `<link rel="canonical" href="${canonical}">`,
    );
    if (!/id="luminara-marketing-jsonld"/i.test(out)) {
      out = out.replace(
        /<\/head>/i,
        `  <script type="application/ld+json" id="luminara-marketing-jsonld">${jsonLd}</script>\n</head>`,
      );
    }
  }

  const crawlerBlock = `<noscript id="luminara-crawler-body">${page.crawlerBody.trim()}</noscript>`;
  if (/id="luminara-crawler-body"/i.test(out)) {
    out = out.replace(/<noscript id="luminara-crawler-body">[\s\S]*?<\/noscript>/i, crawlerBlock);
  } else {
    out = out.replace(/<\/body>/i, `  ${crawlerBlock}\n</body>`);
  }

  return out;
}

export async function maybeServeMarketingHtml(
  request: Request,
  assets: Fetcher,
): Promise<Response | null> {
  const url = new URL(request.url);
  const key = marketingShellKey(url.pathname);
  if (!key) return null;
  // Only rewrite document navigations; leave asset requests alone.
  const accept = request.headers.get('accept') || '';
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (accept && !accept.includes('text/html') && !accept.includes('*/*')) return null;

  const page = MARKETING_SHELL_BY_PATH[key];
  if (!page) return null;

  const shellReq = new Request(new URL('/', url).toString(), {
    method: 'GET',
    headers: request.headers,
  });
  const assetRes = await assets.fetch(shellReq);
  if (!assetRes.ok) return null;
  const contentType = assetRes.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return null;

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  }

  const html = injectMarketingMeta(await assetRes.text(), page);
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

const SHARE_TOKEN_PATH = /^\/share\/([a-f0-9]{64})$/i;

type ShareOgEnv = {
  ASSETS: Fetcher;
  DB?: D1Database;
};

/**
 * Unlisted share URLs: SPA shell with domain-safe OG for bots.
 * Passworded shares get generic protected copy (never report body in meta).
 */
export async function maybeServeShareHtml(
  request: Request,
  env: ShareOgEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = url.pathname.replace(/\/+$/, '').match(SHARE_TOKEN_PATH);
  if (!match) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const accept = request.headers.get('accept') || '';
  if (accept && !accept.includes('text/html') && !accept.includes('*/*')) return null;
  if (!env.DB || !env.ASSETS) return null;

  const token = match[1].toLowerCase();
  const tokenHash = await sha256Hex(token);
  const row = (await env.DB.prepare(
    `SELECT report_json, password_hash, revoked_at, expires_at FROM shared_reports WHERE token_hash = ? LIMIT 1`,
  )
    .bind(tokenHash)
    .first()) as {
    report_json: string;
    password_hash: string | null;
    revoked_at: number | null;
    expires_at: number | null;
  } | null;

  let title = 'Shared audit | Luminara Suite';
  let description =
    'A Luminara Suite audit report share link. Open in a browser to view. Sample vs Live labels apply in-product.';
  let crawlerBody = `
<section>
  <h1>Shared Luminara audit</h1>
  <p>This link opens a shared Instant Audit report in Luminara Suite.</p>
  <p><a href="/">Home</a> · <a href="/pricing">Pricing</a></p>
</section>`;

  if (!row || row.revoked_at) {
    title = 'Share link unavailable | Luminara Suite';
    description = 'This share link was not found or has been revoked.';
    crawlerBody = `<section><h1>Share unavailable</h1><p>Not found or revoked.</p><p><a href="/">Home</a></p></section>`;
  } else if (row.expires_at && row.expires_at < Date.now()) {
    title = 'Share link expired | Luminara Suite';
    description = 'This share link has expired.';
    crawlerBody = `<section><h1>Share expired</h1><p><a href="/">Home</a></p></section>`;
  } else if (row.password_hash) {
    title = 'Protected audit share | Luminara Suite';
    description =
      'Password-protected Luminara Suite audit share. Unlock in the browser. Report body is not shown in link previews.';
    crawlerBody = `<section><h1>Protected share</h1><p>Password required in the browser.</p><p><a href="/pricing">Pricing</a></p></section>`;
  } else {
    try {
      const report = JSON.parse(row.report_json) as { domain?: string; dnaName?: string };
      const host = String(report.domain || report.dnaName || '').trim().slice(0, 80);
      if (host) {
        title = `Audit: ${host} | Luminara Suite`;
        description = `Shared Luminara Suite audit for ${host}. Open to read the report. No invented SEO scores in previews.`;
        crawlerBody = `<section><h1>Shared audit for ${escapeHtml(host)}</h1><p>Open this link in a browser to view the report.</p><p><a href="/">Home</a> · <a href="/pricing">Pricing</a></p></section>`;
      }
    } catch {
      /* keep generic */
    }
  }

  const page: MarketingShellMeta = {
    path: `/share/${token}`,
    title,
    description,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: title,
      description,
      url: `${MARKETING_ORIGIN}/share/${token}`,
    },
    crawlerBody,
  };

  const shellReq = new Request(new URL('/', url).toString(), {
    method: 'GET',
    headers: request.headers,
  });
  const assetRes = await env.ASSETS.fetch(shellReq);
  if (!assetRes.ok) return null;
  const contentType = assetRes.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return null;

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=120',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  }

  let html = injectMarketingMeta(await assetRes.text(), page);
  if (!/<meta\s+name="robots"/i.test(html)) {
    html = html.replace(/<\/head>/i, '  <meta name="robots" content="noindex, nofollow">\n</head>');
  }
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=120',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

