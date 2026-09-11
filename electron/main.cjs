'use strict';

/**
 * Luminara Suite desktop shell (Electron main process).
 * Loads the same production origin as the web app so Cloudflare deploys
 * update every desktop client without rebuilding the installer.
 */

const { app, BrowserWindow, shell, Menu, Tray, nativeImage, ipcMain, dialog, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { applyWindowsHardening } = require('./windowsHardening.cjs');
const { createNavigationGuard } = require('./security.cjs');
const { setupAutoUpdater } = require('./updater.cjs');

function configureLlmSessionSecurity() {
  if (!session?.defaultSession?.webRequest) return;
  const allowedLlmPatterns = [
    '*://127.0.0.1:11434/*',
    '*://localhost:11434/*',
    '*://*.groq.com/*',
    '*://integrate.api.nvidia.com/*',
    '*://openrouter.ai/*',
    '*://api.tavily.com/*',
    '*://api.exa.ai/*',
    '*://api.firecrawl.dev/*',
    '*://ollama.com/*',
  ];

  session.defaultSession.webRequest.onHeadersReceived(
    { urls: allowedLlmPatterns },
    (details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      responseHeaders['access-control-allow-origin'] = ['*'];
      responseHeaders['access-control-allow-headers'] = ['*'];
      responseHeaders['access-control-allow-methods'] = ['GET, POST, OPTIONS, PUT, DELETE'];
      responseHeaders['access-control-allow-private-network'] = ['true'];
      callback({ responseHeaders });
    },
  );
}

const APP_ID = 'digital.luminara.suite';
const IS_WINDOWS = process.platform === 'win32';
const IS_DEV = !app.isPackaged;

const DEFAULT_WEBAPP_URL = 'https://luminarasuite.com/';
const DEV_WEBAPP_URL = process.env.LUMINARA_DEV_URL || 'http://localhost:3000/';

function resolveWebappUrl() {
  let raw = DEFAULT_WEBAPP_URL;
  if (process.env.LUMINARA_WEBAPP_URL) raw = process.env.LUMINARA_WEBAPP_URL;
  else if (IS_DEV && process.env.LUMINARA_USE_LOCAL !== '0') raw = DEV_WEBAPP_URL;
  return withDesktopClientParam(raw);
}

/** Mark the session as the native shell so the web app skips marketing views. */
function withDesktopClientParam(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!u.searchParams.has('client')) u.searchParams.set('client', 'desktop');
    return u.toString();
  } catch {
    return rawUrl;
  }
}

applyWindowsHardening(app);

if (IS_WINDOWS) {
  app.setAppUserModelId(APP_ID);
}

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Tray | null} */
let tray = null;
let quitting = false;

function iconPath(name) {
  return path.join(__dirname, '..', 'build', name);
}

function createWindow() {
  const webappUrl = resolveWebappUrl();
  const guard = createNavigationGuard({
    allowedOrigins: [
      'https://luminarasuite.com',
      'https://www.luminarasuite.com',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ],
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0a0a0c',
    title: 'Luminara Suite',
    icon: iconPath('icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      webSecurity: true,
    },
  });

  guard.attach(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (guard.isAllowed(url)) {
      return { action: 'allow' };
    }
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    if (IS_WINDOWS && !quitting && tray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const splash = path.join(__dirname, 'splash.html');
  void mainWindow.loadURL(pathToFileURL(splash).href).then(() => {
    const bootDelayMs = IS_DEV ? 200 : 600;
    setTimeout(() => {
      void mainWindow?.loadURL(webappUrl);
    }, bootDelayMs);
  });

  return mainWindow;
}

function buildMenu() {
  const template = [
    {
      label: 'Luminara',
      submenu: [
        {
          label: 'Reload app',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.webContents.reload(),
        },
        {
          label: 'Open in browser',
          click: () => void shell.openExternal(resolveWebappUrl()),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Luminara Suite' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        ...(IS_DEV
          ? [{ type: 'separator' }, { role: 'toggleDevTools' }]
          : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Website',
          click: () => void shell.openExternal('https://luminarasuite.com/'),
        },
        {
          label: 'Check for shell updates',
          click: () => {
            const { checkForUpdatesManual } = setupAutoUpdater({
              mainWindow,
              getMainWindow: () => mainWindow,
            });
            checkForUpdatesManual();
          },
        },
        {
          label: 'About',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'Luminara Suite',
              message: 'Luminara Suite Desktop',
              detail: `Shell version ${app.getVersion()}\nLoads ${resolveWebappUrl()}\nSame product as the web and Telegram apps.`,
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  const image = nativeImage.createFromPath(iconPath('icon.png'));
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 }));
  tray.setToolTip('Luminara Suite');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show Luminara Suite',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function registerIpc() {
  const updaterApi = setupAutoUpdater({
    mainWindow,
    getMainWindow: () => mainWindow,
  });

  ipcMain.handle('desktop:get-info', () => ({
    shellVersion: app.getVersion(),
    webappUrl: resolveWebappUrl(),
    platform: process.platform,
    packaged: app.isPackaged,
    autoUpdateEnabled: updaterApi.getAutoUpdateEnabled(),
  }));

  ipcMain.handle('desktop:open-external', (_event, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new Error('Only http(s) URLs can be opened externally');
    }
    return shell.openExternal(url);
  });

  ipcMain.handle('desktop:get-update-prefs', () => updaterApi.getUpdatePrefs());

  ipcMain.handle('desktop:set-auto-update', (_event, enabled) => {
    return updaterApi.setAutoUpdateEnabled(Boolean(enabled));
  });

  ipcMain.handle('desktop:check-updates', () => updaterApi.checkForUpdatesManual());

  ipcMain.handle('desktop:install-update', () => updaterApi.quitAndInstall());

  return updaterApi;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    configureLlmSessionSecurity();
    registerIpc();
    buildMenu();
    createWindow();
    if (IS_WINDOWS) createTray();
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
}
