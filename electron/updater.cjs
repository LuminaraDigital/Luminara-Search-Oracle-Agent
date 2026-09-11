'use strict';

/**
 * Shell auto-update via GitHub Releases (electron-updater).
 * App *content* still updates whenever Cloudflare deploys luminarasuite.com.
 * Users can toggle automatic shell updates on/off from Settings.
 */

const { readDesktopPrefs, writeDesktopPrefs } = require('./desktopPrefs.cjs');

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
  const userDataDir = app.getPath('userData');

  /** @type {import('electron-updater').AppUpdater | null} */
  let updater = null;
  let wired = false;

  function send(status, detail) {
    const win = ctx.getMainWindow?.() || ctx.mainWindow;
    win?.webContents.send('desktop:update-status', { status, detail, at: Date.now() });
  }

  function getAutoUpdateEnabled() {
    return readDesktopPrefs(userDataDir).autoUpdateEnabled;
  }

  function setAutoUpdateEnabled(enabled) {
    const next = writeDesktopPrefs(userDataDir, { autoUpdateEnabled: Boolean(enabled) });
    applyAutoUpdatePolicy();
    send('preference', next.autoUpdateEnabled ? 'on' : 'off');
    if (next.autoUpdateEnabled && app.isPackaged) {
      checkForUpdatesManual();
    }
    return next;
  }

  function ensureUpdater() {
    if (!app.isPackaged) return null;
    if (updater) return updater;
    try {
      const { autoUpdater } = require('electron-updater');
      updater = autoUpdater;
      updater.setFeedURL({
        provider: 'github',
        owner: 'LuminaraDigital',
        repo: 'Luminara-Search-Oracle-Agent',
      });
      if (!wired) {
        wired = true;
        updater.on('checking-for-update', () => send('checking'));
        updater.on('update-available', (info) => send('available', info?.version));
        updater.on('update-not-available', () => send('not-available'));
        updater.on('error', (err) => send('error', String(err?.message || err)));
        updater.on('download-progress', (p) => send('progress', Math.round(p.percent || 0)));
        updater.on('update-downloaded', (info) => {
          send('downloaded', info?.version);
        });
      }
      applyAutoUpdatePolicy();
      return updater;
    } catch (err) {
      send('error', String(err?.message || err));
      return null;
    }
  }

  function applyAutoUpdatePolicy() {
    const enabled = getAutoUpdateEnabled();
    if (!updater) return;
    // When automatic updates are off, manual checks still work but do not auto-download.
    updater.autoDownload = enabled;
    updater.autoInstallOnAppQuit = enabled;
  }

  function checkForUpdatesManual() {
    if (!app.isPackaged) {
      send('skipped', 'Updates run only in packaged builds');
      return { ok: false, reason: 'not_packaged' };
    }
    const u = ensureUpdater();
    if (!u) return { ok: false, reason: 'updater_unavailable' };
    // Manual checks always download when an update exists, even if auto mode is off.
    u.autoDownload = true;
    u.checkForUpdates().catch((err) => send('error', String(err?.message || err)));
    return { ok: true };
  }

  function quitAndInstall() {
    if (!app.isPackaged) return { ok: false, reason: 'not_packaged' };
    const u = ensureUpdater();
    if (!u) return { ok: false, reason: 'updater_unavailable' };
    try {
      u.quitAndInstall(false, true);
      return { ok: true };
    } catch (err) {
      send('error', String(err?.message || err));
      return { ok: false, reason: String(err?.message || err) };
    }
  }

  function getUpdatePrefs() {
    return {
      autoUpdateEnabled: getAutoUpdateEnabled(),
      packaged: app.isPackaged,
      shellVersion: app.getVersion(),
    };
  }

  if (app.isPackaged) {
    ensureUpdater();
    // Quiet check shortly after launch only when the user left automatic updates on.
    setTimeout(() => {
      if (!getAutoUpdateEnabled()) {
        send('skipped', 'Automatic updates are off');
        return;
      }
      const u = ensureUpdater();
      if (!u) return;
      u.checkForUpdates().catch((err) => send('error', String(err?.message || err)));
    }, 8_000);
  }

  return {
    checkForUpdatesManual,
    quitAndInstall,
    getUpdatePrefs,
    setAutoUpdateEnabled,
    getAutoUpdateEnabled,
  };
}

module.exports = { setupAutoUpdater };
