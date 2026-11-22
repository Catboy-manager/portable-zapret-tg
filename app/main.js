const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain } = require('electron');
const { Storage } = require('./src/storage');
const { listProfiles, parseProfile, ensureUserLists, readGameFilter } = require('./src/profiles');
const { WinwsManager, isWinwsRunning, isAdmin } = require('./src/winws');
const service = require('./src/service');
const { TgProxyManager } = require('./src/tgproxy');
const { Monitor } = require('./src/monitor');

const BASE_DIR = app.isPackaged
  ? path.dirname(process.execPath)
  : path.resolve(__dirname, '..'); // portable-zapret-tg root (or folder next to exe when packaged)
const RUNTIME_DIR = path.join(BASE_DIR, 'runtime');

let mainWindow = null;
const storage = new Storage(BASE_DIR);
const winws = new WinwsManager(RUNTIME_DIR, storage);
const tg = new TgProxyManager(RUNTIME_DIR, storage);
let monitor = null;

function emit(channel, data) {
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data); } catch {}
}

function getProfiles() {
  return listProfiles(RUNTIME_DIR);
}

async function getStatus() {
  const settings = storage.loadSettings();
  const profiles = getProfiles();
  const admin = await isAdmin();
  const winwsRunning = await isWinwsRunning();
  const svc = await service.queryService();
  const svcStrategy = await service.getInstalledStrategy();
  const tgStatus = await tg.status(settings.tgProxy || { host:'127.0.0.1', port:1080, secret:'' });
  const stats = storage.loadStats();
  const mon = monitor ? monitor.getSnapshot() : { running: false };
  return {
    baseDir: BASE_DIR,
    runtimeDir: RUNTIME_DIR,
    isAdmin: admin,
    settings,
    profiles,
    winws: { running: winwsRunning, ...await winws.status() },
    service: { ...svc, strategy: svcStrategy },
    telegram: tgStatus,
    monitor: mon,
    stats,
    gameFilter: readGameFilter(RUNTIME_DIR),
  };
}

async function applyProfile(profileName, opts = {}) {
  const settings = storage.loadSettings();
  if (!profileName) throw new Error('profileName required');
  ensureUserLists(RUNTIME_DIR);
  const profilePath = path.join(RUNTIME_DIR, profileName);
  const parsed = parseProfile(profilePath, RUNTIME_DIR);
  let result;
  if (settings.winwsMode === 'service') {
    await winws.stopUser();
    result = await service.installService(profileName, parsed);
  } else {
    try { await service.stopService(); } catch {}
    result = await winws.startUser(profileName, parsed);
  }
  if (result && result.ok) {
    settings.activeProfile = profileName;
    settings.lastGoodProfile = profileName;
    if (opts.manual !== false) {
      settings.manualProfileLock = true;
      settings.manualProfile = profileName;
    }
    storage.saveSettings(settings);
    storage.log('info', 'Profile applied', { profileName, mode: settings.winwsMode, manual: opts.manual !== false });
  } else {
    storage.log('warn', 'Profile apply failed', { profileName, mode: settings.winwsMode, result, manual: opts.manual !== false });
  }
  return { ok: !!(result && result.ok), result, status: await getStatus() };
}

async function stopBypass() {
  const settings = storage.loadSettings();
  let res1 = { ok: true }, res2 = { ok: true };
  try { res1 = await winws.stopUser(); } catch (e) { res1 = { ok:false, error:e.message }; }
  if (settings.winwsMode === 'service') {
    try { res2 = await service.stopService(); } catch (e) { res2 = { ok:false, error:e.message }; }
  }
  storage.log('info', 'Bypass stopped', { mode: settings.winwsMode });
  return { ok: true, user: res1, service: res2, status: await getStatus() };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 980,
    minHeight: 700,
    title: 'Zapret + TG Proxy (Portable)',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  try {
    ensureUserLists(RUNTIME_DIR);
    const settings = storage.loadSettings();
    // Ensure defaults persisted
    storage.saveSettings(settings);
    monitor = new Monitor({ runtimeDir: RUNTIME_DIR, storage, winws, service, tg, emit });
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    // auto start behaviors (non-blocking)
    try {
      if (settings.tgAutoStart) {
        tg.start(settings.tgProxy).catch(e => storage.log('warn', 'TG autostart failed', { error: e && e.message ? e.message : String(e) }));
      }
      if (settings.autoSelect) {
        const p = settings.activeProfile || settings.lastGoodProfile || 'general (SIMPLE FAKE).bat';
        if (p && getProfiles().includes(p)) {
          applyProfile(p, { manual: false }).catch(e => storage.log('warn', 'Auto-apply profile failed', { error: e && e.message ? e.message : String(e), profile: p }));
        }
      }
      if (monitor) monitor.start();
    } catch (e) {
      storage.log('error', 'Startup behaviors error', { error: e && e.message ? e.message : String(e) });
    }
  } catch (e) {
    try { storage.log('error', 'Fatal startup error', { error: e && e.message ? e.message : String(e), stack: e && e.stack }); } catch {}
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try { if (monitor) monitor.stop(); } catch {}
});

// IPC
ipcMain.handle('getStatus', async () => await getStatus());
ipcMain.handle('getLogs', async (_e, n) => storage.readRecentLogs(Number(n)||300));
ipcMain.handle('getEvents', async (_e, n) => storage.readEvents(Number(n)||400));
ipcMain.handle('saveSettings', async (_e, patch) => {
  const cur = storage.loadSettings();
  const next = { ...cur, ...(patch||{}) , tgProxy: { ...(cur.tgProxy||{}), ...((patch||{}).tgProxy||{}) } };
  storage.saveSettings(next);
  storage.log('info', 'Settings updated');
  if (monitor) { monitor.stop(); monitor.start(); }
  return { ok: true, settings: next };
});
ipcMain.handle('applyProfile', async (_e, profileName, opts) => await applyProfile(profileName, opts || { manual: true }));
ipcMain.handle('setManualLock', async (_e, enabled) => {
  const cur = storage.loadSettings();
  cur.manualProfileLock = !!enabled;
  if (cur.manualProfileLock) cur.manualProfile = cur.activeProfile || cur.manualProfile;
  else cur.manualProfile = null;
  storage.saveSettings(cur);
  storage.log('info', 'Manual profile lock changed', { manualProfileLock: cur.manualProfileLock, manualProfile: cur.manualProfile });
  return { ok: true, status: await getStatus() };
});
ipcMain.handle('stopBypass', async () => await stopBypass());
ipcMain.handle('startService', async (_e, profileName) => {
  const settings = storage.loadSettings();
  const p = profileName || settings.activeProfile || settings.lastGoodProfile || 'general (SIMPLE FAKE).bat';
  ensureUserLists(RUNTIME_DIR);
  const parsed = parseProfile(path.join(RUNTIME_DIR, p), RUNTIME_DIR);
  await winws.stopUser();
  const r = await service.installService(p, parsed);
  if (r.ok) { settings.activeProfile = p; settings.lastGoodProfile = p; settings.winwsMode = 'service'; storage.saveSettings(settings); }
  storage.log('info', 'Service install/start requested', { profile: p, ok: r.ok });
  return { ok: !!r.ok, result: r, status: await getStatus() };
});
ipcMain.handle('removeService', async () => {
  const r = await service.removeServicesAndCleanup();
  storage.log('info', 'Service remove requested');
  return { ok: !!r.ok, result: r, status: await getStatus() };
});
ipcMain.handle('startTg', async () => {
  const settings = storage.loadSettings();
  const r = await tg.start(settings.tgProxy);
  return { ...r, status: await getStatus() };
});
ipcMain.handle('stopTg', async () => {
  const r = await tg.stop();
  return { ...r, status: await getStatus() };
});
ipcMain.handle('probeNow', async () => {
  if (!monitor) return { ok:false, error:'monitor not ready' };
  const check = await monitor.probeOnce('manual');
  return { ok: true, check, status: await getStatus() };
});
ipcMain.handle('autoSwitchNow', async () => {
  if (!monitor) return { ok:false };
  const r = await monitor.autoSwitch('manual');
  return { ...r, status: await getStatus() };
});
ipcMain.handle('refreshStatus', async () => await getStatus());
