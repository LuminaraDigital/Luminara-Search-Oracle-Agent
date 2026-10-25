'use strict';

/**
 * Trust rules for the desktop shell, kept pure so they are tested without Electron.
 * The main window (which carries the preload bridge) only ever shows the app itself;
 * links leave for the system browser.
 */

/** Production Firebase auth handler origins. The Google sign-in popup opens on one of these. */
const FIREBASE_AUTH_ORIGINS = ['https://luminara-suite.firebaseapp.com', 'https://luminara-suite.web.app'];
const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

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
 * @param {{ webappUrl: string, isDev: boolean, firebaseAuthDomain?: string, shellPageUrls: string[] }} options
 * shellPageUrls: the exact file: URLs of the shell's own splash and offline pages.
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

  function isAllowedNavigation(rawUrl) {
    return appOrigins.has(originOf(rawUrl));
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
    return shellPageUrls.includes(frameUrl) || isAllowedNavigation(frameUrl);
  }

  return { isAllowedNavigation, windowOpenAction, isPermissionGranted, isTrustedSender };
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

module.exports = { createShellPolicy, createTrustedIpc };
