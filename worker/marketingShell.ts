import {
  DEFAULT_OG_IMAGE,
  MARKETING_ORIGIN,
  MARKETING_SHELL_BY_PATH,
  marketingShellKey,
  type MarketingShellMeta,
} from '../services/marketing/pageMeta';

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
