import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MARKETING_SHELL_BY_PATH } from '../services/marketing/pageMeta';
import { HOME_HERO, PRICING_HERO } from '../services/marketing/marketingHeroCopy';
import { applyMarketingDocument, deferRenderBlockingCss } from '../worker/marketingShell';

const SHELL = `<!DOCTYPE html><html lang="en"><head>
  <title>Old</title>
  <meta name="description" content="old">
  <link rel="stylesheet" crossorigin href="/assets/index-abc.css">
</head><body>
  <div id="boot-splash"><img src="/boot-mark.webp" alt=""></div>
  <div id="root"></div>
</body></html>`;

describe('marketing first paint', () => {
  it('paints the pricing lede before JS and stops the splash and the CSS from blocking', () => {
    const out = applyMarketingDocument(SHELL, MARKETING_SHELL_BY_PATH['/pricing']);
    expect(out).toContain('class="lx-fp-live lx-skip-splash"');
    expect(out).toContain('id="lx-first-paint"');
    expect(out).toContain(`<p class="lx-lede">${PRICING_HERO.lede}</p>`);
    expect(out).not.toContain('boot-mark.webp');
    expect(out).toContain('rel="preload" as="style" href="/assets/index-abc.css" data-defer-css crossorigin');
    expect(out).toContain('<noscript><link rel="stylesheet" href="/assets/index-abc.css" crossorigin></noscript>');
    expect(out).toContain('luminara-crawler-body');
  });

  it('paints the home hero and leaves other marketing pages on the splash', () => {
    const home = applyMarketingDocument(SHELL, MARKETING_SHELL_BY_PATH['/']);
    expect(home).toContain(HOME_HERO.titleLead);
    expect(home).toContain(HOME_HERO.titleEm);
    expect(home).toContain('data-path="/"');
    const how = applyMarketingDocument(SHELL, MARKETING_SHELL_BY_PATH['/how-it-works']);
    expect(how).not.toContain('id="lx-first-paint"');
    expect(how).toContain('rel="stylesheet"');
  });

  it('does not rewrite a Google Fonts stylesheet', () => {
    const html = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit">';
    expect(deferRenderBlockingCss(html)).toBe(html);
  });

  it('keeps the public shell off Google Fonts and the Telegram bridge', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('telegram-web-app.js');
    expect(html).toContain('/fonts/outfit-latin.woff2');
    expect(html).toContain('font-display: swap');
    expect(html).toContain('html.lx-fp-live .lx-fp-text { visibility: hidden; }');
  });
});
