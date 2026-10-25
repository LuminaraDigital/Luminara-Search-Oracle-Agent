import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type ShellPolicy = {
  isAllowedNavigation: (url: string) => boolean;
  windowOpenAction: (url: string) => 'child' | 'external' | 'deny';
  isPermissionGranted: (permission: string, details: { externalURL?: string }) => boolean;
  isTrustedSender: (frameUrl: string | undefined) => boolean;
};
type IpcListener = (event: { senderFrame: { url: string } | null }, ...args: unknown[]) => unknown;

const require = createRequire(import.meta.url);
const { createShellPolicy, createTrustedIpc } = require('../electron/security.cjs') as {
  createShellPolicy: (options: {
    webappUrl: string;
    isDev: boolean;
    firebaseAuthDomain?: string;
    shellPageUrls: string[];
  }) => ShellPolicy;
  createTrustedIpc: (
    ipcMain: { handle: (channel: string, listener: IpcListener) => void },
    policy: ShellPolicy,
  ) => (channel: string, listener: IpcListener) => void;
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

  it('trusts the shell pages however Chromium and Node spell the drive letter and spaces', () => {
    const lowercaseDirname = createShellPolicy({
      webappUrl: 'https://luminarasuite.com/',
      isDev: false,
      shellPageUrls: ['file:///c:/Users/Ada/AppData/Local/Programs/Luminara%20Suite/resources/app.asar/electron/offline.html'],
    });
    expect(lowercaseDirname.isTrustedSender('file:///C:/Users/Ada/AppData/Local/Programs/Luminara%20Suite/resources/app.asar/electron/offline.html')).toBe(true);
    expect(lowercaseDirname.isTrustedSender('file:///C:/Users/Ada/AppData/Local/Programs/Luminara Suite/resources/app.asar/electron/offline.html')).toBe(true);
    expect(lowercaseDirname.isTrustedSender('file:///C:/Users/Ada/Downloads/offline.html')).toBe(false);
  });

  it('a bridge channel answers the app and refuses any other sender', () => {
    const registered = new Map<string, IpcListener>();
    const handleTrusted = createTrustedIpc({ handle: (channel, listener) => { registered.set(channel, listener); } }, packaged);
    const getInfo = vi.fn((_event: unknown, flag: unknown) => ({ shellVersion: '1.0.2', flag }));
    handleTrusted('desktop:get-info', getInfo);
    const call = registered.get('desktop:get-info')!;

    expect(call({ senderFrame: { url: 'https://luminarasuite.com/app?client=desktop' } }, 'x')).toEqual({ shellVersion: '1.0.2', flag: 'x' });
    expect(() => call({ senderFrame: { url: 'https://evil.example/' } })).toThrow('Refused desktop:get-info from an untrusted page');
    expect(() => call({ senderFrame: null })).toThrow('Refused desktop:get-info from an untrusted page');
    expect(getInfo).toHaveBeenCalledTimes(1);
  });
});

describe('desktop external app launches from frames and popups', () => {
  it.each([
    ['search-ms:query=x&crumb=location:\\\\evil.example\\share', false],
    ['ms-msdt:/id PCWDiagnostic', false],
    ['file:///C:/Windows/System32/calc.exe', false],
    ['mailto:hello@luminara.digital', true],
    [undefined, false],
  ])('%s granted: %s', (externalURL, granted) => {
    expect(packaged.isPermissionGranted('openExternal', { externalURL })).toBe(granted);
  });

  it('leaves every other permission at the Electron default', () => {
    expect(packaged.isPermissionGranted('notifications', {})).toBe(true);
  });
});
