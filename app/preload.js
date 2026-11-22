const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getStatus: () => ipcRenderer.invoke('getStatus'),
  getLogs: (n) => ipcRenderer.invoke('getLogs', n),
  getEvents: (n) => ipcRenderer.invoke('getEvents', n),
  saveSettings: (patch) => ipcRenderer.invoke('saveSettings', patch),
  applyProfile: (name) => ipcRenderer.invoke('applyProfile', name),
  stopBypass: () => ipcRenderer.invoke('stopBypass'),
  startService: (name) => ipcRenderer.invoke('startService', name),
  removeService: () => ipcRenderer.invoke('removeService'),
  startTg: () => ipcRenderer.invoke('startTg'),
  stopTg: () => ipcRenderer.invoke('stopTg'),
  probeNow: () => ipcRenderer.invoke('probeNow'),
  autoSwitchNow: () => ipcRenderer.invoke('autoSwitchNow'),
  setManualLock: (enabled) => ipcRenderer.invoke('setManualLock', enabled),
  refreshStatus: () => ipcRenderer.invoke('refreshStatus'),
  on: (channel, cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
});
