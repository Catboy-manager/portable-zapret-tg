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
  probeVoiceNow: () => ipcRenderer.invoke('probeVoiceNow'),
  autoSwitchNow: () => ipcRenderer.invoke('autoSwitchNow'),
  setManualLock: (enabled) => ipcRenderer.invoke('setManualLock', enabled),
  getDiagnostics: (n) => ipcRenderer.invoke('getDiagnostics', n),
  trackUi: (meta) => ipcRenderer.invoke('trackUi', meta),
  exportDiagnostics: () => ipcRenderer.invoke('exportDiagnostics'),
  refreshStatus: () => ipcRenderer.invoke('refreshStatus'),
  getProfileMatrix: (n) => ipcRenderer.invoke('getProfileMatrix', n),
  runAllProfiles: () => ipcRenderer.invoke('runAllProfiles'),
  cancelRunAllProfiles: () => ipcRenderer.invoke('cancelRunAllProfiles'),
  onRunProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('run-progress', handler);
    return () => ipcRenderer.removeListener('run-progress', handler);
  },
  on: (channel, cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
});
