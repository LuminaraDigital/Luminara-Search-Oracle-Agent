import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppView } from '../types';
import { isDesktopShell } from '../services/desktop/desktopShell';

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

  it('detects the Electron preload bridge', () => {
    vi.stubGlobal('window', {
      luminaraDesktop: {
        getInfo: async () => ({ shellVersion: '1.0.0', webappUrl: 'https://luminarasuite.com/', platform: 'win32', packaged: true, autoUpdateEnabled: true }),
        openExternal: async () => {},
        getUpdatePrefs: async () => ({ autoUpdateEnabled: true, packaged: true, shellVersion: '1.0.0' }),
        setAutoUpdate: async () => ({ autoUpdateEnabled: true }),
        checkForUpdates: async () => ({ ok: true }),
        installUpdate: async () => ({ ok: true }),
        onUpdateStatus: () => () => {},
      },
      location: { search: '' },
    });
    expect(isDesktopShell()).toBe(true);
  });

  it('detects client=desktop query fallback', () => {
    vi.stubGlobal('window', {
      location: { search: '?client=desktop' },
    });
    expect(isDesktopShell()).toBe(true);
  });

  it('does not treat a normal browser session as desktop', () => {
    vi.stubGlobal('window', {
      location: { search: '' },
    });
    expect(isDesktopShell()).toBe(false);
  });

  it('bypasses marketing views the same way Telegram does', () => {
    expect(MARKETING_VIEWS.has(AppView.LANDING)).toBe(true);
    expect(MARKETING_VIEWS.has(AppView.PRICING)).toBe(true);
    expect(MARKETING_VIEWS.has(AppView.INSTANT_AUDIT)).toBe(false);
    expect(MARKETING_VIEWS.has(AppView.ORACLE_AGENT)).toBe(false);
  });
});
