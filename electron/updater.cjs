'use strict';

/**
 * Shell auto-update via GitHub Releases (electron-updater).
 * App *content* still updates whenever Cloudflare deploys luminarasuite.com.
 */

/** @type {ReturnType<typeof buildApi> | null} */
let cached = null;

/**
 * @param {{ mainWindow: import('electron').BrowserWindow | null, getMainWindow: () => import('electron').BrowserWindow | null }} ctx
 */
function setupAutoUpdater(ctx) {
  if (cached) return cached;
  cached = buildApi(ctx);
  return cached;
}

/**
 * @param {{ mainWindow: import('electron').BrowserWindow | null, getMainWindow: () => import('electron').BrowserWindow | null }} ctx
 */
function buildApi(ctx) {
  const { app } = require('electron');

  function send(status, detail) {
    const win = ctx.getMainWindow?.() || ctx.mainWindow;
    win?.webContents.send('desktop:update-status', { status, detail, at: Date.now() });
  }

  function checkForUpdatesManual() {
    if (!app.isPackaged) {
      send('skipped', 'Updates run only in packaged builds');
      return;
    }
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.checkForUpdates().catch((err) => send('error', String(err?.message || err)));
    } catch (err) {
      send('error', String(err?.message || err));
    }
  }

  if (!app.isPackaged) {
    return { checkForUpdatesManual };
  }

    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'LuminaraDigital',
        repo: 'Luminara-Search-Oracle-Agent',
      });

      autoUpdater.on('checking-for-update', () => send('checking'));
      autoUpdater.on('update-available', (info) => send('available', info?.version));
      autoUpdater.on('update-not-available', () => send('not-available'));
      autoUpdater.on('error', (err) => send('error', String(err?.message || err)));
      autoUpdater.on('download-progress', (p) => send('progress', Math.round(p.percent || 0)));
      autoUpdater.on('update-downloaded', (info) => {
        send('downloaded', info?.version);
      });

      // Quiet check shortly after launch.
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err) => send('error', String(err?.message || err)));
      }, 8_000);
    } catch (err) {
      send('error', String(err?.message || err));
    }

  return { checkForUpdatesManual };
}

module.exports = { setupAutoUpdater };
