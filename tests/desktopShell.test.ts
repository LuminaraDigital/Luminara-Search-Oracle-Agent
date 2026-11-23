import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppView } from '../types';
import { isDesktopShell, isDesktopSurface } from '../services/desktop/desktopShell';
import {
  CONTACT_URL,
  DESKTOP_DOWNLOAD_URL,
  DESKTOP_EXTERNAL_LINKS,
  FAQ_URL,
  PLAY_STORE_URL,
  TELEGRAM_BOT_URL,
  TELEGRAM_MINI_APP_PUBLIC_URL,
  WEBSITE_URL,
} from '../services/marketing/platformSurfaces';
import { PRODUCTION_MINI_APP_URL } from '../services/referrals/rules';
import { DesktopUpdatesPanel } from '../components/desktop/DesktopUpdatesPanel';
import { DesktopExternalLinks } from '../components/desktop/DesktopExternalLinks';
import { AuthRequiredScreen } from '../components/auth/AuthRequiredScreen';
import { ApiKeyModal } from '../components/ApiKeyModal';
import { PUBLIC_PRIVACY_URL, PUBLIC_TERMS_URL } from '../services/legal/privacyCopy';
import type { AppAuthState } from '../services/auth/useAppAuth';

function makeDesktopBridge() {
  return {
    getInfo: async () => ({
      shellVersion: '1.0.4',
      webappUrl: 'https://www.luminarasuite.com/?client=desktop',
      platform: 'win32',
      packaged: true,
      autoUpdateEnabled: true,
    }),
    openExternal: async () => {},
    getUpdatePrefs: async () => ({ autoUpdateEnabled: true, packaged: true, shellVersion: '1.0.4' }),
    setAutoUpdate: async () => ({ autoUpdateEnabled: true }),
    checkForUpdates: async () => ({ ok: true }),
    installUpdate: async () => ({ ok: true }),
    onUpdateStatus: () => () => {},
  };
}

const SIGNED_OUT_AUTH: AppAuthState = {
  loading: false,
  authenticated: false,
  source: null,
  label: null,
  reason: null,
};

function anchorTags(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
}

describe('Windows desktop native shell', () => {
  const MARKETING_VIEWS = new Set<AppView>([
    AppView.LANDING,
    AppView.INFRASTRUCTURE,
    AppView.INTELLIGENCE,
    AppView.WHY_US,
    AppView.PRICING,
  ]);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects the Electron preload bridge and excludes Telegram', () => {
    vi.stubGlobal('window', {
      luminaraDesktop: makeDesktopBridge(),
      location: { search: '' },
    });
    expect(isDesktopShell()).toBe(true);
    expect(isDesktopSurface(false)).toBe(true);
    expect(isDesktopSurface(true)).toBe(false);
  });

  it('detects client=desktop query fallback', () => {
    vi.stubGlobal('window', {
      location: { search: '?client=desktop' },
    });
    expect(isDesktopShell()).toBe(true);
    expect(isDesktopSurface(false)).toBe(true);
  });

  it('does not treat a normal browser session as desktop', () => {
    vi.stubGlobal('window', {
      location: { search: '' },
    });
    expect(isDesktopShell()).toBe(false);
    expect(isDesktopSurface(false)).toBe(false);
  });

  it('bypasses marketing views the same way Telegram does', () => {
    expect(MARKETING_VIEWS.has(AppView.LANDING)).toBe(true);
    expect(MARKETING_VIEWS.has(AppView.PRICING)).toBe(true);
    expect(MARKETING_VIEWS.has(AppView.INSTANT_AUDIT)).toBe(false);
    expect(MARKETING_VIEWS.has(AppView.ORACLE_AGENT)).toBe(false);
  });

  it('derives canonical URLs from electron/externalLinks.json and keeps Mini App aligned', () => {
    expect(WEBSITE_URL).toBe('https://www.luminarasuite.com/');
    expect(FAQ_URL).toBe('https://www.luminarasuite.com/faq');
    expect(CONTACT_URL).toBe('https://www.luminarasuite.com/contact');
    expect(DESKTOP_DOWNLOAD_URL).toBe('https://www.luminarasuite.com/desktop');
    expect(TELEGRAM_BOT_URL).toBe('https://t.me/LuminaraSuiteBot');
    expect(TELEGRAM_MINI_APP_PUBLIC_URL).toBe('https://t.me/LuminaraSuiteBot/app');
    expect(TELEGRAM_MINI_APP_PUBLIC_URL).toBe(PRODUCTION_MINI_APP_URL);
    expect(PLAY_STORE_URL).toBe('https://play.google.com/store/apps/details?id=com.luminarasuite.app');
    expect(DESKTOP_EXTERNAL_LINKS).toHaveLength(6);
  });

  it('renders every desktop link externally in Settings, More menu helper, and full-page Sign-in', () => {
    vi.stubGlobal('window', { luminaraDesktop: makeDesktopBridge(), location: { search: '' } });

    const updatesHtml = renderToStaticMarkup(createElement(DesktopUpdatesPanel));
    const menuHtml = renderToStaticMarkup(createElement(DesktopExternalLinks, { variant: 'menu', excludeIds: ['faq'] }));
    const desktopAuthHtml = renderToStaticMarkup(
      createElement(AuthRequiredScreen, { auth: SIGNED_OUT_AUTH, onBackToMarketing: () => {} }),
    );
    const modalAuthHtml = renderToStaticMarkup(
      createElement(AuthRequiredScreen, { auth: SIGNED_OUT_AUTH, isModal: true, onClose: () => {} }),
    );
    const settingsHtml = renderToStaticMarkup(
      createElement(ApiKeyModal, { isOpen: true, onClose: () => {}, onKeySaved: () => {} }),
    );

    // Every desktop link in Updates panel and full-page Sign-in opens externally in browser.
    for (const html of [updatesHtml, desktopAuthHtml]) {
      const anchors = anchorTags(html);
      expect(anchors).toHaveLength(DESKTOP_EXTERNAL_LINKS.length);
      for (const link of DESKTOP_EXTERNAL_LINKS) {
        const match = anchors.find((tag) => tag.includes(`href="${link.href}"`));
        expect(match, `missing ${link.href}`).toBeDefined();
        expect(match).toContain('target="_blank"');
        expect(match).toContain('rel="noopener noreferrer"');
      }
    }

    // Full-page desktop Sign-in has one nav landmark, back button to Instant Audit, and mentions Android.
    expect(desktopAuthHtml.match(/aria-label="Luminara links"/g)).toHaveLength(1);
    expect(desktopAuthHtml).toContain('Back to Instant Audit');
    expect(desktopAuthHtml).toContain('Android');

    // Login modal stays focused with zero outbound links at every viewport width.
    expect(modalAuthHtml).not.toContain('aria-label="Luminara links"');

    // More menu helper excludes FAQ (already shown at top of More menu).
    expect(anchorTags(menuHtml)).toHaveLength(DESKTOP_EXTERNAL_LINKS.length - 1);
    expect(menuHtml).not.toContain(`href="${FAQ_URL}"`);

    // Settings opens on Account tab with Windows desktop panel + external Privacy/Terms links.
    expect(settingsHtml).toContain('Windows desktop app');
    const privacyAnchor = anchorTags(settingsHtml).find((tag) => tag.includes(`href="${PUBLIC_PRIVACY_URL}"`));
    const termsAnchor = anchorTags(settingsHtml).find((tag) => tag.includes(`href="${PUBLIC_TERMS_URL}"`));
    expect(privacyAnchor).toContain('target="_blank"');
    expect(termsAnchor).toContain('target="_blank"');

    // ?client=desktop without preload bridge still shows links in Settings without throwing.
    vi.stubGlobal('window', { location: { search: '?client=desktop' } });
    const queryDesktopHtml = renderToStaticMarkup(createElement(DesktopUpdatesPanel));
    expect(anchorTags(queryDesktopHtml)).toHaveLength(DESKTOP_EXTERNAL_LINKS.length);
    expect(queryDesktopHtml).not.toContain('Automatic shell updates');

    // Normal browser sessions never render the desktop panel or desktop-only auth links.
    vi.stubGlobal('window', { location: { search: '' } });
    expect(renderToStaticMarkup(createElement(DesktopUpdatesPanel))).toBe('');
    const webAuthHtml = renderToStaticMarkup(
      createElement(AuthRequiredScreen, { auth: SIGNED_OUT_AUTH, onBackToMarketing: () => {} }),
    );
    expect(webAuthHtml).toContain('Back to home');
    expect(webAuthHtml).not.toContain('aria-label="Luminara links"');
    expect(webAuthHtml).not.toContain(`href="${PLAY_STORE_URL}"`);
  });
});
