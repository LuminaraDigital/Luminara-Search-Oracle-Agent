'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Narrow, typed bridge. Renderer never gets Node or Electron globals.
 */
contextBridge.exposeInMainWorld('luminaraDesktop', {
  getInfo: () => ipcRenderer.invoke('desktop:get-info'),
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
  getUpdatePrefs: () => ipcRenderer.invoke('desktop:get-update-prefs'),
  setAutoUpdate: (enabled) => ipcRenderer.invoke('desktop:set-auto-update', enabled),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-updates'),
  installUpdate: () => ipcRenderer.invoke('desktop:install-update'),
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('desktop:update-status', listener);
    return () => ipcRenderer.removeListener('desktop:update-status', listener);
  },
});
