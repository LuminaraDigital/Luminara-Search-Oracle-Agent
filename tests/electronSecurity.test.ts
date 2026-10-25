import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createShellPolicy } = require('../electron/security.cjs') as {
  createShellPolicy: (options: {
    webappUrl: string;
    isDev: boolean;
    firebaseAuthDomain?: string;
    shellPageUrls: string[];
  }) => {
    isAllowedNavigation: (url: string) => boolean;
    windowOpenAction: (url: string) => 'child' | 'external' | 'deny';
    isTrustedSender: (frameUrl: string | undefined) => boolean;
  };
};

const SPLASH = 'file:///C:/Program%20Files/Luminara/resources/app.asar/electron/splash.html';
const OFFLINE = 'file:///C:/Program%20Files/Luminara/resources/app.asar/electron/offline.html';

const packaged = createShellPolicy({
  webappUrl: 'https://luminarasuite.com/?client=desktop',
  isDev: false,
  shellPageUrls: [SPLASH, OFFLINE],
});

describe('desktop main window navigation', () => {
  it.each([
    ['https://luminarasuite.com/app?client=desktop', true],
    ['https://www.luminarasuite.com/pricing', true],
    ['https://evil.web.app/phish', false],
    ['https://attacker.firebaseapp.com/__/auth/handler', false],
    ['https://sites.google.com/view/phish', false],
    ['https://luminarasuite.com.evil.example/', false],
    ['http://luminarasuite.com/', false],
    ['http://localhost:3000/', false],
    ['http://localhost:8080/', false],
    ['file:///C:/Users/Public/phish.html', false],
    ['javascript:alert(1)', false],
  ])('%s allowed: %s', (url, allowed) => {
    expect(packaged.isAllowedNavigation(url)).toBe(allowed);
  });

  it('allows the dev server only in a dev build, and a configured app origin', () => {
    const dev = createShellPolicy({ webappUrl: 'http://localhost:3000/?client=desktop', isDev: true, shellPageUrls: [] });
    expect(dev.isAllowedNavigation('http://localhost:3000/app')).toBe(true);
    expect(dev.isAllowedNavigation('http://localhost:3001/')).toBe(false);
    const staging = createShellPolicy({ webappUrl: 'https://staging.luminarasuite.com/', isDev: false, shellPageUrls: [] });
    expect(staging.isAllowedNavigation('https://staging.luminarasuite.com/app')).toBe(true);
    expect(staging.isAllowedNavigation('http://localhost:3000/')).toBe(false);
  });
});

describe('desktop window.open', () => {
  it.each([
    ['https://luminara-suite.firebaseapp.com/__/auth/handler?apiKey=x', 'child'],
    ['https://luminara-suite.web.app/__/auth/handler', 'child'],
    ['about:blank', 'child'],
    ['https://accounts.google.com/o/oauth2/auth', 'external'],
    ['https://evil.web.app/phish', 'external'],
    ['http://example.com/', 'external'],
    ['mailto:hello@luminara.digital', 'external'],
    ['search-ms:query=x&crumb=location:\\\\evil.example\\share', 'deny'],
    ['file:///C:/Windows/System32/calc.exe', 'deny'],
    ['ms-msdt:/id PCWDiagnostic', 'deny'],
    ['javascript:alert(1)', 'deny'],
    ['not a url', 'deny'],
  ])('%s opens as %s', (url, action) => {
    expect(packaged.windowOpenAction(url)).toBe(action);
  });

  it('opens the build\'s own Firebase auth domain as the sign-in popup', () => {
    const staging = createShellPolicy({
      webappUrl: 'https://staging.luminarasuite.com/',
      isDev: false,
      firebaseAuthDomain: 'luminara-suite-staging.firebaseapp.com',
      shellPageUrls: [],
    });
    expect(staging.windowOpenAction('https://luminara-suite-staging.firebaseapp.com/__/auth/handler')).toBe('child');
    expect(packaged.windowOpenAction('https://luminara-suite-staging.firebaseapp.com/__/auth/handler')).toBe('external');
  });
});

describe('desktop bridge senders', () => {
  it.each([
    ['https://luminarasuite.com/app?client=desktop', true],
    ['https://www.luminarasuite.com/', true],
    [SPLASH, true],
    [OFFLINE, true],
    ['file:///C:/Users/Public/offline.html', false],
    [`${OFFLINE}.evil`, false],
    ['https://luminara-suite.firebaseapp.com/__/auth/iframe', false],
    ['https://evil.example/', false],
    ['about:blank', false],
    [undefined, false],
  ])('%s trusted: %s', (frameUrl, trusted) => {
    expect(packaged.isTrustedSender(frameUrl)).toBe(trusted);
  });

  it('every IPC handler in the main process goes through the sender check', () => {
    const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
    const raw = main.match(/ipcMain\.handle\(/g) ?? [];
    expect(raw).toHaveLength(1);
    expect(main).toMatch(/function handleTrusted\(channel, listener\) \{\n\s+ipcMain\.handle\(channel,/);
  });
});
