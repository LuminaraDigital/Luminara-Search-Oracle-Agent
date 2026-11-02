import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarketingFooter } from '../components/marketing/MarketingFooter';
import { PlatformHeroLinks, PlatformSurfaces } from '../components/marketing/PlatformSurfaces';
import { MARKETING_FAQ } from '../services/marketing/marketingFaqContent';
import {
  PLATFORM_SURFACES,
  PLAY_STORE_URL,
  TELEGRAM_BOT_URL,
  TELEGRAM_MINI_APP_PUBLIC_URL,
} from '../services/marketing/platformSurfaces';
import { LLMS_TXT } from '../worker/crawlDocuments';

describe('platform surfaces', () => {
  it('uses the production Mini App, bot, and Play listing', () => {
    expect(TELEGRAM_MINI_APP_PUBLIC_URL).toBe('https://t.me/LuminaraSuiteBot/app');
    expect(TELEGRAM_BOT_URL).toBe('https://t.me/LuminaraSuiteBot');
    expect(`${TELEGRAM_BOT_URL}/app`).toBe(TELEGRAM_MINI_APP_PUBLIC_URL);
    expect(PLAY_STORE_URL).toBe('https://play.google.com/store/apps/details?id=com.luminarasuite.app');
  });

  it('sells web, Telegram, and Android without counts or dashes', () => {
    const where = MARKETING_FAQ.find((item) => item.question === 'Where can I use Luminara Suite?');
    const copy = [...PLATFORM_SURFACES.map((surface) => `${surface.title}\n${surface.body}`), where?.answer ?? ''].join('\n');
    expect(where?.answer).toContain(TELEGRAM_MINI_APP_PUBLIC_URL);
    expect(where?.answer).toContain(PLAY_STORE_URL);
    expect(copy).not.toMatch(/\d/);
    expect(copy).not.toMatch(/users|downloads|installs|ratings|reviews/i);
    expect(copy).not.toContain('\u2014');
    expect(copy).not.toContain('\u2013');
    expect(copy).toMatch(/Stars/);
    expect(copy).toMatch(/free companion/i);
    expect(copy).toMatch(/card/i);
  });

  it('puts the links on the hero, the pitch, and the footer', () => {
    const hero = renderToStaticMarkup(createElement(PlatformHeroLinks));
    const section = renderToStaticMarkup(createElement(PlatformSurfaces, { onCheckSite: () => {} }));
    const footer = renderToStaticMarkup(createElement(MarketingFooter));
    for (const html of [hero, section, footer]) {
      expect(html).toContain(TELEGRAM_MINI_APP_PUBLIC_URL);
      expect(html).toContain(PLAY_STORE_URL);
    }
    expect(hero).toContain('Available on');
    expect(section).toContain('Get it on Google Play');
    expect(section).toContain('Open the Mini App');
    expect(section).toContain(TELEGRAM_BOT_URL);
    expect(section).not.toContain('\u2014');
    expect(section).not.toContain('\u2013');
    expect(LLMS_TXT).toContain(PLAY_STORE_URL);
    expect(LLMS_TXT).toContain(`Bot: ${TELEGRAM_BOT_URL}`);
    const desktop = readFileSync('public/desktop/index.html', 'utf8');
    expect(desktop).toContain(PLAY_STORE_URL);
    expect(desktop).toContain(TELEGRAM_MINI_APP_PUBLIC_URL);
  });
});
