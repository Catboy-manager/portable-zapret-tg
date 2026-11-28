const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Monitor } = require('../src/monitor');

const TARGETS = ['YouTubeWeb', 'DiscordCDN', 'RuTrackerMain', 'YouTubeImage'];
const RECENT = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const OLD = new Date(Date.now() - 26 * 24 * 60 * 60 * 1000).toISOString();

function makeRuntime(profiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-rank-'));
  for (const p of profiles) fs.writeFileSync(path.join(dir, p), '');
  return dir;
}

function checkRow(profile, target, ok, ts) {
  return { kind: 'check', profile, target, ok, status: ok ? 200 : 503, ts, runId: 'matrix-test' };
}

function rowsFor(profile, ok, ts) {
  return TARGETS.map(t => checkRow(profile, t, ok, ts));
}

function makeStorage({ rows = [], stats = {}, settings = {} } = {}) {
  return {
    readRecentDiagnostics: () => rows,
    loadStats: () => ({ profiles: stats, targets: {} }),
    loadSettings: () => ({ candidateCount: 4, ...settings }),
    log: () => {},
    appendEvent: () => {},
    saveStats: () => {},
    recordDiagnostics: () => {},
  };
}

function makeMonitor(runtimeDir, storage) {
  return new Monitor({
    runtimeDir,
    storage,
    admin: () => true,
    emit: () => {},
    voice: { isActive: () => false },
    tg: { status: async () => ({ running: true, reachable: true }) },
  });
}

test('passive ranking prefers matrix-proven profile over stats-inflated last good', () => {
  const profiles = ['general (A).bat', 'general (B).bat', 'general (C).bat'];
  const dir = makeRuntime(profiles);
  const rows = [...rowsFor(profiles[0], true, RECENT), ...rowsFor(profiles[1], false, RECENT)];
  const st = makeStorage({
    rows,
    stats: { [profiles[1]]: { success: 100, fail: 0, lastSuccessTs: RECENT } },
    settings: { lastGoodProfile: profiles[1], healthTargets: TARGETS },
  });
  const got = makeMonitor(dir, st).getCandidates(st.loadSettings());
  assert.equal(got[0], profiles[0]);
});

test('passive ranking breaks equal matrix scores by newer lastTs', () => {
  const profiles = ['general (A).bat', 'general (B).bat'];
  const dir = makeRuntime(profiles);
  const rows = [...rowsFor(profiles[0], true, OLD), ...rowsFor(profiles[1], true, RECENT)];
  const st = makeStorage({
    rows,
    settings: { lastGoodProfile: profiles[0], healthTargets: TARGETS },
  });
  const got = makeMonitor(dir, st).getCandidates(st.loadSettings());
  assert.equal(got[0], profiles[1]);
});

test('passive ranking puts untested profiles below tested ones even with legacy stats', () => {
  const profiles = ['general (A).bat', 'general (B).bat'];
  const dir = makeRuntime(profiles);
  const st = makeStorage({
    rows: rowsFor(profiles[0], false, RECENT),
    stats: { [profiles[1]]: { success: 100, fail: 0, lastSuccessTs: RECENT } },
    settings: { healthTargets: TARGETS },
  });
  const got = makeMonitor(dir, st).getCandidates(st.loadSettings());
  assert.equal(got[0], profiles[0]);
});

test('passive ranking reads the same 300-row matrix window as the table', () => {
  const dir = makeRuntime(['general (A).bat']);
  const st = makeStorage();
  let seenLimit = null;
  st.readRecentDiagnostics = (max) => { seenLimit = max; return []; };
  makeMonitor(dir, st).getCandidates(st.loadSettings());
  assert.equal(seenLimit, 300);
});

test('passive ranking still caps candidates by candidateCount', () => {
  const profiles = ['general (A).bat', 'general (B).bat', 'general (C).bat'];
  const dir = makeRuntime(profiles);
  const rows = profiles.flatMap((p, i) => rowsFor(p, true, i === 0 ? RECENT : OLD));
  const st = makeStorage({ rows, settings: { healthTargets: TARGETS, candidateCount: 2 } });
  const got = makeMonitor(dir, st).getCandidates(st.loadSettings());
  assert.equal(got.length, 2);
});

test('invalid profiles are excluded from passive candidates', () => {
  const profiles = ['general (A).bat', 'general (B).bat'];
  const dir = makeRuntime(profiles);
  const rows = rowsFor(profiles[0], true, RECENT);
  const st = makeStorage({
    rows,
    stats: { [profiles[1]]: { success: 100, fail: 0, invalid: true, invalidReason: 'could not read ^!' } },
    settings: { healthTargets: TARGETS, candidateCount: 2 },
  });
  const got = makeMonitor(dir, st).getCandidates(st.loadSettings());
  assert.deepEqual(got, [profiles[0]]);
});

test('recently failed profiles rank below untested exploration', () => {
  const profiles = ['general (A).bat', 'general (B).bat'];
  const dir = makeRuntime(profiles);
  const rows = rowsFor(profiles[0], true, RECENT);
  const st = makeStorage({
    rows,
    stats: {
      [profiles[0]]: { failCount: 2, lastFailTs: new Date().toISOString(), lastGoodProfile: profiles[0] },
      [profiles[1]]: { success: 100, fail: 0, lastSuccessTs: RECENT },
    },
    settings: { healthTargets: TARGETS, candidateCount: 2, lastGoodProfile: profiles[0] },
  });
  const got = makeMonitor(dir, st).getCandidates(st.loadSettings());
  assert.equal(got[0], profiles[1]);
});
