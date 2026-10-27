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
  retryConnection: () => ipcRenderer.invoke('desktop:retry-connection'),
  getCoordinatorStatus: () => ipcRenderer.invoke('desktop:coordinator:status'),
  checkCrawlerHealth: () => ipcRenderer.invoke('desktop:coordinator:check-crawler'),
  superviseCrawler: (opts) => ipcRenderer.invoke('desktop:coordinator:supervise-crawler', opts),
  resolveProfile: (profileId) => ipcRenderer.invoke('desktop:coordinator:resolve-profile', profileId),
  resolveBrowserProfile: (profileId) => ipcRenderer.invoke('desktop:coordinator:resolve-profile', profileId),
  listRoutines: () => ipcRenderer.invoke('desktop:coordinator:list-routines'),
  upsertRoutine: (spec) => ipcRenderer.invoke('desktop:coordinator:upsert-routine', spec),
  runRoutineOnce: (routineId, mockObservation) =>
    ipcRenderer.invoke('desktop:coordinator:run-routine', routineId, mockObservation),
  validateMcpCall: (payload) => ipcRenderer.invoke('desktop:coordinator:validate-mcp', payload),
  validateMcpInvocation: (payload) => ipcRenderer.invoke('desktop:coordinator:validate-mcp', payload),
  storeSecret: (key, value) => ipcRenderer.invoke('desktop:coordinator:store-secret', { key, value }),
  hasSecret: (key) => ipcRenderer.invoke('desktop:coordinator:has-secret', key),
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('desktop:update-status', listener);
    return () => ipcRenderer.removeListener('desktop:update-status', listener);
  },
});
