const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const { app, BrowserWindow, ipcMain, Menu, screen } = require('electron');
const { shouldElevate, buildElevateCommand } = require('./main-helpers');
const { Storage } = require('./src/storage');
const { listProfiles, parseProfile, ensureUserLists, readGameFilter } = require('./src/profiles');
const { WinwsManager, isWinwsRunning, isAdmin } = require('./src/winws');
const service = require('./src/service');
const { TgProxyManager } = require('./src/tgproxy');
const { Monitor } = require('./src/monitor');
const { VoiceDetector } = require('./src/voice');
const { redact, systemInfo } = require('./src/telemetry');
const { buildProfileMatrix, runAllProfiles, createRunToken } = require('./src/profile-matrix');

Menu.setApplicationMenu(null);
app.setName('ZapretTG');

function windowIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, 'build', 'icon.ico');
}

const BASE_DIR = app.isPackaged
  ? path.dirname(process.execPath)
  : path.resolve(__dirname, '..'); // portable-zapret-tg root (or folder next to exe when packaged)
const RUNTIME_DIR = path.join(BASE_DIR, 'runtime');

let mainWindow = null;
const storage = new Storage(BASE_DIR);
const winws = new WinwsManager(RUNTIME_DIR, storage);
const tg = new TgProxyManager(RUNTIME_DIR, storage);
const voice = new VoiceDetector({});
let monitor = null;
let runToken = null;

function isAdminSync() {
  try {
    execFileSync('net.exe', ['session'], { stdio: 'ignore', timeout: 5000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

const elevating = process.platform === 'win32' && shouldElevate(isAdminSync(), process.argv);
if (elevating) {
  const childArgs = app.isPackaged ? ['--elevated'] : [__dirname, '--elevated'];
  const cmd = buildElevateCommand(process.execPath, childArgs);
  try {
    storage.log('info', 'Requesting administrator rights (UAC)', { command: cmd });
    spawn('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    storage.log('error', 'Failed to request administrator rights', { error: e.message });
  }
  app.quit();
} else {

function emit(channel, data) {
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data); } catch {}
}

function registerHandler(channel, handler) {
  ipcMain.handle(channel, async (...args) => {
    const started = Date.now();
    try {
      const result = await handler(...args);
      storage.recordTelemetry('ipc', { channel, ms: Date.now() - started, ok: true });
      return result;
    } catch (e) {
      storage.recordTelemetry('ipc', {
        channel, ms: Date.now() - started, ok: false,
        errorCode: e && e.code ? e.code : 'NO_CODE',
        error: e && e.message ? e.message : String(e),
      });
      throw e;
    }
  });
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
  let targets = [];
  try { targets = require('./src/profiles').readTargets(RUNTIME_DIR).filter(t=>t.type==='http').map(t=>({name:t.name,url:t.url})); } catch {}
  return {
    baseDir: BASE_DIR,
    runtimeDir: RUNTIME_DIR,
    isAdmin: admin,
    settings,
    profiles,
    targets,
    winws: { running: winwsRunning, ...await winws.status() },
    service: { ...svc, strategy: svcStrategy },
    telegram: tgStatus,
    monitor: mon,
    voice: voice.snapshot(),
    stats,
    gameFilter: readGameFilter(RUNTIME_DIR),
    diagnostics: storage.readRecentDiagnostics(300),
    profileMatrix: buildProfileMatrix({
      rows: storage.readRecentDiagnostics(300),
      profiles,
      targets: settings.healthTargets,
    }),
    telemetry: { enabled: settings.telemetryEnabled !== false, file: storage.telemetryFile },
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

// Starts winws/service for a profile during a full test run without writing
// activeProfile, lastGoodProfile or the manual lock to settings.
async function applyProfileTransient(profileName) {
  const settings = storage.loadSettings();
  if (!profileName) throw new Error('profileName required');
  ensureUserLists(RUNTIME_DIR);
  const parsed = parseProfile(path.join(RUNTIME_DIR, profileName), RUNTIME_DIR);
  let result;
  if (settings.winwsMode === 'service') {
    await winws.stopUser();
    result = await service.installService(profileName, parsed);
  } else {
    try { await service.stopService(); } catch {}
    await winws.stopUser();
    result = await winws.startUser(profileName, parsed);
  }
  storage.log('info', 'Transient profile applied for test run', { profileName, mode: settings.winwsMode, ok: !!(result && result.ok) });
  return { ok: !!(result && result.ok), result };
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

let boundsTimer = null;

function recordWindow(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const b = mainWindow.getBounds();
  let scaleFactor = 1;
  try { scaleFactor = screen.getDisplayMatching(b).scaleFactor || 1; } catch {}
  storage.recordTelemetry('window', { event, width: b.width, height: b.height, x: b.x, y: b.y, scaleFactor });
}

function scheduleWindowBounds() {
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => recordWindow('bounds'), 300);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 980,
    minHeight: 700,
    title: 'Zapret + TG Proxy (Portable)',
    icon: windowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });
  mainWindow.on('resize', scheduleWindowBounds);
  mainWindow.on('move', scheduleWindowBounds);
  mainWindow.on('focus', () => recordWindow('focus'));
  mainWindow.on('close', () => recordWindow('close'));
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  try {
    ensureUserLists(RUNTIME_DIR);
    const settings = storage.loadSettings();
    // Ensure defaults persisted
    storage.saveSettings(settings);
    storage.recordTelemetry('app', systemInfo(BASE_DIR, {
      event: 'app_start',
      packaged: app.isPackaged,
      elevated: isAdminSync(),
      screen: screen.getPrimaryDisplay().workAreaSize,
    }));
    monitor = new Monitor({ runtimeDir: RUNTIME_DIR, storage, winws, service, tg, voice, emit, admin: isAdminSync });
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
registerHandler('getStatus', async () => await getStatus());
registerHandler('getLogs', async (_e, n) => storage.readRecentLogs(Number(n)||300));
registerHandler('getEvents', async (_e, n) => storage.readEvents(Number(n)||400));
registerHandler('getDiagnostics', async (_e, n) => ({
  ts: new Date().toISOString(),
  diagnostics: storage.readRecentDiagnostics(Number(n) || 300),
}));
registerHandler('getProfileMatrix', async (_e, n) => {
  const settings = storage.loadSettings();
  return buildProfileMatrix({
    rows: storage.readRecentDiagnostics(Number(n) || 300),
    profiles: getProfiles(),
    targets: settings.healthTargets,
  });
});
registerHandler('trackUi', async (_e, meta) => {
  storage.recordTelemetry('ui', meta || {});
  return { ok: true };
});
registerHandler('exportDiagnostics', async () => {
  const { dialog } = require('electron');
  const diag = {
    ts: new Date().toISOString(),
    status: redact(await getStatus()),
    logs: storage.readRecentLogs(300),
    events: storage.readEvents(250),
    diagnostics: storage.readRecentDiagnostics(300),
    telemetry: storage.readRecentTelemetry(300),
  };
  const defaultPath = path.join(BASE_DIR, `zaprettg-diagnostics-${Date.now()}.json`);
  const res = await dialog.showSaveDialog(mainWindow, { defaultPath, filters: [{name:'JSON', extensions:['json']}] });
  if (res.canceled || !res.filePath) return { ok:false, canceled:true };
  fs.writeFileSync(res.filePath, JSON.stringify(redact(diag), null, 2), 'utf8');
  return { ok:true, path: res.filePath };
});
registerHandler('saveSettings', async (_e, patch) => {
  const cur = storage.loadSettings();
  const next = { ...cur, ...(patch||{}) , tgProxy: { ...(cur.tgProxy||{}), ...((patch||{}).tgProxy||{}) } };
  storage.saveSettings(next);
  storage.log('info', 'Settings updated');
  if (monitor) { monitor.stop(); monitor.start(); }
  return { ok: true, settings: next };
});
registerHandler('applyProfile', async (_e, profileName, opts) => await applyProfile(profileName, opts || { manual: true }));
registerHandler('setManualLock', async (_e, enabled) => {
  const cur = storage.loadSettings();
  cur.manualProfileLock = !!enabled;
  if (cur.manualProfileLock) cur.manualProfile = cur.activeProfile || cur.manualProfile;
  else cur.manualProfile = null;
  storage.saveSettings(cur);
  storage.log('info', 'Manual profile lock changed', { manualProfileLock: cur.manualProfileLock, manualProfile: cur.manualProfile });
  return { ok: true, status: await getStatus() };
});
registerHandler('stopBypass', async () => await stopBypass());
registerHandler('startService', async (_e, profileName) => {
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
registerHandler('removeService', async () => {
  const r = await service.removeServicesAndCleanup();
  storage.log('info', 'Service remove requested');
  return { ok: !!r.ok, result: r, status: await getStatus() };
});
registerHandler('startTg', async () => {
  const settings = storage.loadSettings();
  const r = await tg.start(settings.tgProxy);
  return { ...r, status: await getStatus() };
});
registerHandler('stopTg', async () => {
  const r = await tg.stop();
  return { ...r, status: await getStatus() };
});
registerHandler('probeNow', async () => {
  if (!monitor) return { ok:false, error:'monitor not ready' };
  const check = await monitor.probeOnce('manual');
  return { ok: true, check, status: await getStatus() };
});
registerHandler('probeVoiceNow', async () => {
  const voiceStatus = await voice.check();
  return { ok: true, voice: voiceStatus, status: await getStatus() };
});
registerHandler('autoSwitchNow', async () => {
  if (!monitor) return { ok:false };
  const r = await monitor.autoSwitch('manual');
  return { ...r, status: await getStatus() };
});
registerHandler('refreshStatus', async () => await getStatus());
registerHandler('runAllProfiles', async () => {
  if (runToken) return { ok: false, reason: 'already-running' };
  if (!monitor) return { ok: false, reason: 'monitor-not-ready' };
  if (voice.isActive()) return { ok: false, reason: 'voice-active' };
  runToken = createRunToken();
  monitor.pause();
  const emitRunProgress = (channel, payload) => {
    if (channel === 'run-progress') emit('run-progress', redact(payload));
    else emit(channel, redact(payload));
  };
  try {
    const result = await runAllProfiles({
      profiles: getProfiles(),
      apply: async (p) => await applyProfileTransient(p),
      probe: (reason, runId, p) => monitor.probeOnce(reason, runId, p),
      voice,
      storage,
      emit: emitRunProgress,
      finish: async (winner) => {
        const settings = storage.loadSettings();
        settings.manualProfileLock = false;
        settings.manualProfile = null;
        storage.saveSettings(settings);
        monitor.consecutiveFails = 0;
        await applyProfile(winner, { manual: false });
        storage.log('info', 'Full run finished; best profile applied', { profile: winner });
      },
      token: runToken,
    });
    return redact(result);
  } finally {
    monitor.resume();
    runToken = null;
  }
});
registerHandler('cancelRunAllProfiles', async () => {
  if (!runToken) return { ok: false, reason: 'no-active-run' };
  runToken.cancel();
  return { ok: true };
});

} // end !elevating

