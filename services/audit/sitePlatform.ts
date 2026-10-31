/**
 * Which website platform a homepage runs on, from its HTML and response headers.
 * The page is hostile input, so every check is a linear substring search. Builders are checked
 * first because a page on one can still mention WordPress in its content.
 */
export type SitePlatform = 'wix' | 'shopify' | 'squarespace' | 'webflow' | 'wordpress' | 'other';

const SIGNS: ReadonlyArray<{ platform: SitePlatform; html: string[]; headers: string[] }> = [
  { platform: 'wix', html: ['static.wixstatic.com', 'content="wix.com'], headers: ['x-wix-request-id'] },
  { platform: 'shopify', html: ['cdn.shopify.com', 'shopify.theme'], headers: ['x-shopid'] },
  { platform: 'squarespace', html: ['static1.squarespace.com', 'content="squarespace'], headers: [] },
  { platform: 'webflow', html: ['data-wf-site', 'website-files.com'], headers: [] },
  { platform: 'wordpress', html: ['/wp-content/', '/wp-includes/', 'content="wordpress'], headers: [] },
];

export function detectSitePlatform(html: string, headers: Headers): SitePlatform {
  const lower = html.toLowerCase();
  for (const sign of SIGNS) {
    if (sign.headers.some((name) => headers.has(name)) || sign.html.some((mark) => lower.includes(mark))) {
      return sign.platform;
    }
  }
  return 'other';
}
