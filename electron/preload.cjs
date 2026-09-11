'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Narrow, typed bridge. Renderer never gets Node or Electron globals.
 */
contextBridge.exposeInMainWorld('luminaraDesktop', {
  getInfo: () => ipcRenderer.invoke('desktop:get-info'),
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('desktop:update-status', listener);
    return () => ipcRenderer.removeListener('desktop:update-status', listener);
  },
});
