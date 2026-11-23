'use strict';

const { fileURLToPath } = require('node:url');

/**
 * Trust rules for the desktop shell, kept pure so they are tested without Electron.
 * The main window (which carries the preload bridge) only ever shows the app itself;
 * links leave for the system browser.
 */

/**
 * Firebase auth handler origins of Luminara's production and staging projects (the auth domains
 * services/auth/firebasePublicConfig.ts lists). The Google sign-in popup opens on one of these.
 */
const FIREBASE_AUTH_ORIGINS = [
  'https://luminara-suite.firebaseapp.com',
  'https://luminara-suite.web.app',
  'https://luminara-suite-staging.firebaseapp.com',
  'https://luminara-suite-staging.web.app',
];
/**
 * TON Connect wallet deep links (opened with window.open(link, '_self')): the generic tc: and the
 * Telegram tg:, plus the wallet schemes in @tonconnect/sdk's built-in wallet list.
 * shortcut: a wallet added to the remote TON wallets list later is refused until its scheme is listed here.
 */
const TON_WALLET_PROTOCOLS = [
  'tc:', 'tg:',
  'tonkeeper-tc:', 'tonkeeper-pro-tc:', 'mytonwallet-tc:', 'gramwallet-tc:', 'nicegram-tc:', 'safepal-tc:',
  'bitkeep:', 'bnc:', 'bybitapp:', 'echooo:', 'imtokenv2:',
];
const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:', ...TON_WALLET_PROTOCOLS]);

/**
 * Same-origin document/marketing pages that should leave the Electron window for the system browser
 * so users are never stranded inside static HTML or marketing chrome without a Back button.
 */
const EXTERNAL_DOCUMENT_PREFIXES = [
  '/desktop',
  '/faq',
  '/contact',
  '/privacy',
  '/privacy-policy',
  '/terms',
  '/terms-of-service',
  '/tos',
  '/delete-account',
  '/docs',
];

function isExternalDocumentPath(pathname) {
  const normalized = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  return EXTERNAL_DOCUMENT_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`) || normalized === `${prefix}.html`,
  );
}

/** Strip desktop-shell query flags before opening the app URL in the user's system browser. */
function stripDesktopClientParam(rawUrl) {
  const parsed = parseUrl(rawUrl);
  if (!parsed) return rawUrl;
  if (parsed.searchParams.get('client') === 'desktop') parsed.searchParams.delete('client');
  if (parsed.searchParams.get('desktop') === '1') parsed.searchParams.delete('desktop');
  return parsed.toString();
}

/** Build Electron MenuItem templates for Help and Tray from electron/externalLinks.json. */
function buildExternalMenuItems(links, openExternal) {
  const toItem = (link) => ({
    label: link.label,
    click: () => openExternal(link.href),
  });
  const site = links.filter((link) => link.group === 'site').map(toItem);
  const apps = links.filter((link) => link.group === 'apps').map(toItem);
  const help = site.length && apps.length ? [...site, { type: 'separator' }, ...apps] : [...site, ...apps];
  const tray = links.filter((link) => link.tray).map(toItem);
  return { help, tray };
}

function parseUrl(rawUrl) {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

/** Null for unparseable input and opaque origins (file:, about:, mailto:), so they never match a listed origin. */
function originOf(rawUrl) {
  const origin = parseUrl(rawUrl)?.origin;
  return origin && origin !== 'null' ? origin : null;
}

/**
 * A file: URL as a decoded, case-folded path. Node's pathToFileURL and Chromium's frame URL can
 * spell the same Windows file differently (drive letter case, escapes). Null for anything else.
 */
function filePathKey(rawUrl) {
  try {
    return fileURLToPath(rawUrl).toLowerCase();
  } catch {
    return null;
  }
}

/**
 * @param {{ webappUrl: string, isDev: boolean, firebaseAuthDomain?: string, shellPageUrls: string[] }} options
 * shellPageUrls: the file: URLs of the shell's own splash and offline pages.
 */
function createShellPolicy({ webappUrl, isDev, firebaseAuthDomain, shellPageUrls }) {
  const appOrigins = new Set([
    originOf(webappUrl),
    'https://luminarasuite.com',
    'https://www.luminarasuite.com',
    isDev ? 'http://localhost:3000' : null,
  ].filter(Boolean));
  const authOrigins = new Set([
    ...FIREBASE_AUTH_ORIGINS,
    firebaseAuthDomain ? originOf(`https://${firebaseAuthDomain}`) : null,
  ].filter(Boolean));
  const shellPagePaths = new Set(shellPageUrls.map(filePathKey).filter(Boolean));

  function isAllowedNavigation(rawUrl) {
    const parsed = parseUrl(rawUrl);
    if (!parsed || !appOrigins.has(parsed.origin)) return false;
    return !isExternalDocumentPath(parsed.pathname);
  }

  /** 'child': the sign-in popup or a blank print window; 'external': system browser; 'deny': nothing opens. */
  function windowOpenAction(rawUrl) {
    if (rawUrl === 'about:blank' || authOrigins.has(originOf(rawUrl))) return 'child';
    return EXTERNAL_PROTOCOLS.has(parseUrl(rawUrl)?.protocol) ? 'external' : 'deny';
  }

  /**
   * Electron grants every permission by default. Only launching another app is narrowed: a link
   * in a frame or popup to search-ms:, ms-msdt: or file: asks this before Windows opens it.
   */
  function isPermissionGranted(permission, details) {
    return permission !== 'openExternal' || windowOpenAction(details?.externalURL) === 'external';
  }

  function isTrustedSender(frameUrl) {
    return shellPagePaths.has(filePathKey(frameUrl)) || appOrigins.has(originOf(frameUrl));
  }

  return { isAllowedNavigation, windowOpenAction, isPermissionGranted, isTrustedSender };
}

/**
 * A will-navigate / will-redirect listener. A top-frame navigation the window may not make is
 * stopped, and a link the system may open (a web page such as Stripe checkout, mail) goes there
 * instead of doing nothing. Frames are left alone: they get no preload, and a frame's link to
 * another app is decided by isPermissionGranted.
 */
function createNavigationGuard(policy, mayStay, openExternal) {
  return (event) => {
    if (!event.isMainFrame || mayStay(event.url)) return;
    event.preventDefault();
    if (policy.windowOpenAction(event.url) === 'external') void openExternal(event.url);
  };
}

/** ipcMain.handle for bridge channels: a sender the policy does not trust gets an error, never the listener. */
function createTrustedIpc(ipcMain, policy) {
  return function handleTrusted(channel, listener) {
    ipcMain.handle(channel, (event, ...args) => {
      if (!policy.isTrustedSender(event.senderFrame?.url)) throw new Error(`Refused ${channel} from an untrusted page`);
      return listener(event, ...args);
    });
  };
}

module.exports = {
  createShellPolicy,
  createNavigationGuard,
  createTrustedIpc,
  isExternalDocumentPath,
  stripDesktopClientParam,
  buildExternalMenuItems,
};
