const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProfileMatrix } = require('../src/profile-matrix');

const TARGETS = ['YouTubeWeb', 'DiscordMedia', 'RuTrackerMain', 'YouTubeImage'];
const PROFILES = Array.from({ length: 22 }, (_, i) => `general (ALT${i}).bat`);

function row(ts, profile, target, extra = {}) {
  return { kind: 'check', ts, profile, target, ...extra };
}

test('matrix has one row per profile and marks untested profiles', () => {
  const rows = [
    row('2026-11-27T10:00:00.000Z', PROFILES[3], 'YouTubeWeb', { ok: true, status: 200, ms: 120 }),
  ];
  const m = buildProfileMatrix({ rows, profiles: PROFILES, targets: TARGETS });
  assert.equal(m.profiles.length, 22);
  assert.equal(m.testedCount, 1);
  assert.equal(m.profiles[3].name, PROFILES[3]);
  assert.equal(m.profiles[3].cells.YouTubeWeb.ok, true);
  assert.equal(m.profiles[0].tested, false);
  for (const t of TARGETS) assert.equal(m.profiles[0].cells[t], null);
});

test('newest result wins while counts accumulate over all rows', () => {
  const rows = [
    row('2026-11-27T10:00:00.000Z', PROFILES[0], 'YouTubeWeb', { ok: false, error: 'timeout', errorCode: 'NO_CODE', ms: 12000 }),
    row('2026-11-27T10:05:00.000Z', PROFILES[0], 'YouTubeWeb', { ok: true, status: 200, ms: 140 }),
  ];
  const m = buildProfileMatrix({ rows, profiles: PROFILES, targets: TARGETS });
  const cell = m.profiles[0].cells.YouTubeWeb;
  assert.equal(cell.ok, true);
  assert.equal(cell.status, 200);
  assert.equal(cell.ms, 140);
  assert.equal(m.profiles[0].okCount, 1);
  assert.equal(m.profiles[0].failCount, 1);
});

test('legacy non-2xx rows are re-graded as failures', () => {
  const rows = [row('2026-11-27T10:00:00.000Z', PROFILES[0], 'RuTrackerMain', { ok: true, status: 404, ms: 90 })];
  const m = buildProfileMatrix({ rows, profiles: PROFILES, targets: TARGETS });
  assert.equal(m.profiles[0].cells.RuTrackerMain.ok, false);
  assert.equal(m.profiles[0].okCount, 0);
  assert.equal(m.profiles[0].failCount, 1);
});

test('critical counts use the critical target list', () => {
  const rows = [
    row('2026-11-27T10:00:00.000Z', PROFILES[0], 'YouTubeWeb', { ok: true, status: 200 }),
    row('2026-11-27T10:00:00.000Z', PROFILES[0], 'DiscordMedia', { ok: true, status: 200 }),
    row('2026-11-27T10:00:00.000Z', PROFILES[0], 'RuTrackerMain', { ok: true, status: 301 }),
    row('2026-11-27T10:00:00.000Z', PROFILES[0], 'YouTubeImage', { ok: true, status: 200 }),
  ];
  const m = buildProfileMatrix({ rows, profiles: PROFILES, targets: TARGETS });
  assert.equal(m.profiles[0].criticalOk, 2);
  assert.equal(m.profiles[0].criticalTotal, 3);
});

test('rows with unknown profile or target are ignored', () => {
  const rows = [
    row('2026-11-27T10:00:00.000Z', 'unknown.bat', 'YouTubeWeb', { ok: true, status: 200 }),
    row('2026-11-27T10:00:00.000Z', PROFILES[0], 'UnknownTarget', { ok: true, status: 200 }),
  ];
  const m = buildProfileMatrix({ rows, profiles: PROFILES, targets: TARGETS });
  assert.equal(m.testedCount, 0);
  assert.deepEqual(m.targets, TARGETS);
});

test('runId from the newest row is exposed in the cell', () => {
  const rows = [row('2026-11-27T10:00:00.000Z', PROFILES[0], 'YouTubeWeb', { ok: true, status: 200, runId: 'run-42' })];
  const m = buildProfileMatrix({ rows, profiles: PROFILES, targets: TARGETS });
  assert.equal(m.profiles[0].cells.YouTubeWeb.runId, 'run-42');
});
