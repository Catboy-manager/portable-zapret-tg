const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Monitor } = require('../src/monitor');

function storage(rows, healthTargets) {
  return {
    rows,
    loadSettings: () => ({
      healthTargets: healthTargets || ['DiscordMain'], autoSwitchEnabled: true, cooldownSec: 0,
      failThreshold: 3, candidateCount: 3, winwsMode: 'user',
      activeProfile: 'general (SIMPLE FAKE).bat', manualProfileLock: false,
    }),
    loadStats: () => ({ profiles: {}, targets: {} }),
    saveStats: () => {},
    log: () => {},
    appendEvent: () => {},
    recordDiagnostics: (row) => rows.push(row),
  };
}

function makeRuntime(targets) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-mon-'));
  fs.mkdirSync(path.join(dir, 'utils'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'utils', 'targets.txt'),
    targets.map(([name, url]) => `${name} = "${url}"\n`).join('')
  );
  return dir;
}

function makeMonitor(runtimeDir, st, rows) {
  return new Monitor({
    runtimeDir,
    storage: st,
    admin: () => true,
    emit: () => {},
    voice: { isActive: () => false },
    tg: { status: async () => ({ running: true, reachable: true }) },
  });
}

test('probeOnce records one check row per target plus a summary', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/probe`;
  const names = ['DiscordMain', 'DiscordGateway', 'DiscordCDN', 'DiscordMedia', 'YouTubeWeb', 'YouTubeVideoRedirect', 'YouTubeImage', 'RuTrackerMain'];
  const dir = makeRuntime(names.map(n => [n, url]));
  const rows = [];
  const m = makeMonitor(dir, storage(rows, names), rows);
  try {
    const check = await m.probeOnce('test');
    assert.equal(check.results.length, 8);
    assert.equal(rows.filter(x => x.kind === 'check').length, 8);
    assert.equal(rows.find(x => x.kind === 'check_summary').overallOk, true);
    assert.equal(rows[0].admin, true);
    assert.equal(rows[0].mode, 'user');
  } finally {
    server.close();
  }
});

test('critical target failure keeps health false even with 5 of 8 targets passing', async () => {
  const okServer = http.createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  const badServer = http.createServer((_req, res) => { res.writeHead(503); res.end('bad'); });
  await Promise.all([
    new Promise(r => okServer.listen(0, '127.0.0.1', r)),
    new Promise(r => badServer.listen(0, '127.0.0.1', r)),
  ]);
  const ok = `http://127.0.0.1:${okServer.address().port}/probe`;
  const bad = `http://127.0.0.1:${badServer.address().port}/probe`;
  const names = ['DiscordMain', 'DiscordGateway', 'DiscordCDN', 'DiscordMedia', 'YouTubeWeb', 'YouTubeVideoRedirect', 'YouTubeImage', 'RuTrackerMain'];
  const failing = new Set(['YouTubeWeb', 'YouTubeVideoRedirect', 'RuTrackerMain']);
  const dir = makeRuntime(names.map(n => [n, failing.has(n) ? bad : ok]));
  const rows = [];
  const m = makeMonitor(dir, storage(rows, names), rows);
  try {
    const check = await m.probeOnce('test');
    assert.equal(check.okCount, 5);
    assert.equal(check.total, 8);
    assert.equal(check.overallOk, false);
    assert.deepEqual(check.criticalMissing, []);
    assert.equal(check.criticalOk, 2);
    assert.equal(check.criticalTotal, 5);
    const summary = rows.find(x => x.kind === 'check_summary');
    assert.equal(summary.overallOk, false);
    assert.equal(summary.criticalOk, 2);
  } finally {
    okServer.close();
    badServer.close();
  }
});

test('bare storage without recordDiagnostics does not crash', () => {
  const m = new Monitor({
    runtimeDir: '.',
    storage: {
      loadSettings: () => ({ healthTargets: [] }),
      loadStats: () => ({}),
      saveStats: () => {},
      log: () => {},
      appendEvent: () => {},
    },
    emit: () => {},
  });
  m.recordDiagnostic('check', { target: 'X' });
  assert.equal(m.lastCheck, null);
});

test('auto-switch records manual-lock skip reason', async () => {
  const rows = [];
  const st = storage(rows);
  const base = st.loadSettings();
  st.loadSettings = () => ({ ...base, manualProfileLock: true, manualProfile: 'locked.bat' });
  const m = new Monitor({
    runtimeDir: '.',
    storage: st,
    admin: () => true,
    emit: () => {},
    voice: { isActive: () => false },
  });
  const r = await m.autoSwitch('degradation');
  assert.equal(r.reason, 'manual-lock');
  assert.ok(rows.some(x => x.kind === 'profile_decision' && x.decision === 'skipped-manual-lock'));
});
