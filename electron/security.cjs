'use strict';

/**
 * Navigation allowlist for the desktop shell.
 * Blocks drive-by navigations off Luminara + required auth hosts.
 */

const EXTRA_AUTH_HOST_SUFFIXES = [
  'accounts.google.com',
  'google.com',
  'googleapis.com',
  'gstatic.com',
  'firebaseapp.com',
  'web.app',
  'firebase.google.com',
];

/**
 * @param {{ allowedOrigins: string[] }} options
 */
function createNavigationGuard(options) {
  const allowed = new Set(options.allowedOrigins.map((o) => o.replace(/\/$/, '')));

  function isAllowed(rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol === 'file:') return true;
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
      if (allowed.has(url.origin)) return true;

      const host = url.hostname.toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1') return true;
      return EXTRA_AUTH_HOST_SUFFIXES.some(
        (suffix) => host === suffix || host.endsWith(`.${suffix}`),
      );
    } catch {
      return false;
    }
  }

  function attach(win) {
    win.webContents.on('will-navigate', (event, url) => {
      if (!isAllowed(url)) {
        event.preventDefault();
      }
    });

    win.webContents.on('will-redirect', (event, url) => {
      if (!isAllowed(url)) {
        event.preventDefault();
      }
    });
  }

  return { isAllowed, attach };
}

module.exports = { createNavigationGuard };
