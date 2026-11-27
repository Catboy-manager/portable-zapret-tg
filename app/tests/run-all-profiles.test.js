const test = require('node:test');
const assert = require('node:assert/strict');
const { createRunToken, runAllProfiles } = require('../src/profile-matrix');

const PROFILES = ['general (A).bat', 'general (B).bat', 'general (C).bat'];

function check(criticalOk, okCount, ms) {
  return {
    okCount,
    total: 5,
    criticalOk,
    criticalTotal: 5,
    criticalMissing: [],
    results: [{ name: 'YouTubeWeb', ok: criticalOk > 0, status: 200, ms }],
  };
}

function harness(overrides = {}) {
  const rows = [];
  const events = [];
  const progress = [];
  const applyCalls = [];
  const probeCalls = [];
  let finishes = [];
  const token = overrides.token || createRunToken();
  const ctx = {
    profiles: PROFILES,
    apply: async (p, opts) => { applyCalls.push({ profile: p, opts }); return { ok: true }; },
    probe: async (reason, runId, p) => { probeCalls.push({ reason, runId, profile: p }); return check(3, 4, 1000); },
    voice: { isActive: () => false },
    storage: {
      recordDiagnostics: (r) => rows.push(r),
      appendEvent: (e) => events.push(e),
      log: () => {},
    },
    emit: (channel, payload) => progress.push({ channel, payload }),
    finish: async (p) => { finishes.push(p); },
    token,
    ...overrides,
  };
  return { ctx, rows, events, progress, applyCalls, probeCalls, finishes: () => finishes, token };
}

test('applies every profile transiently and probes with one shared runId', async () => {
  const h = harness();
  const result = await runAllProfiles(h.ctx);
  assert.equal(result.completed, true);
  assert.deepEqual(h.applyCalls.map(c => c.profile), PROFILES);
  assert.ok(h.applyCalls.every(c => c.opts.transient === true));
  assert.deepEqual(h.probeCalls.map(c => c.profile), PROFILES);
  assert.ok(h.probeCalls.every(c => c.reason === 'profile-test'));
  const ids = new Set(h.probeCalls.map(c => c.runId));
  assert.equal(ids.size, 1);
  assert.ok([...ids][0]);
});

test('writes a profile_run row with score and critical counts', async () => {
  const h = harness();
  await runAllProfiles(h.ctx);
  const runRows = h.rows.filter(r => r.kind === 'profile_run');
  assert.equal(runRows.length, 3);
  assert.equal(runRows[0].runId, h.probeCalls[0].runId);
  assert.equal(runRows[0].criticalOk, 3);
  assert.equal(runRows[0].criticalTotal, 5);
  assert.equal(runRows[0].decision, 'applied');
  assert.ok(typeof runRows[0].score === 'number');
});

test('winner is chosen by critical passes, then ok count, then latency', async () => {
  const checks = {
    'general (A).bat': check(2, 4, 1000),
    'general (B).bat': check(3, 3, 2000),
    'general (C).bat': check(3, 4, 1500),
    'general (D).bat': check(3, 4, 700),
  };
  const h = harness({
    profiles: Object.keys(checks),
    probe: async (reason, runId, p) => checks[p],
  });
  const result = await runAllProfiles(h.ctx);
  assert.equal(result.winner, 'general (D).bat');
  assert.deepEqual(h.finishes(), ['general (D).bat']);
});

test('voice active at start aborts without applying or finishing', async () => {
  const h = harness({ voice: { isActive: () => true } });
  const result = await runAllProfiles(h.ctx);
  assert.equal(result.completed, false);
  assert.equal(result.aborted, true);
  assert.equal(result.reason, 'voice-active');
  assert.equal(h.applyCalls.length, 0);
  assert.deepEqual(h.finishes(), []);
});

test('voice starting mid-run stops after the current profile without finishing', async () => {
  let calls = 0;
  const h = harness({ voice: { isActive: () => ++calls === 1 ? false : true } });
  const result = await runAllProfiles(h.ctx);
  assert.equal(result.aborted, true);
  assert.equal(result.reason, 'voice-started');
  assert.equal(h.applyCalls.length, 1);
  assert.equal(result.results.length, 3);
  assert.deepEqual(result.results.slice(1).map(r => r.decision), ['aborted_voice', 'aborted_voice']);
  assert.deepEqual(h.finishes(), []);
});

test('cancellation stops after the current profile without finishing', async () => {
  const h = harness();
  h.ctx.apply = async (p, opts) => {
    h.applyCalls.push({ profile: p, opts });
    h.token.cancel();
    return { ok: true };
  };
  const result = await runAllProfiles(h.ctx);
  assert.equal(result.aborted, true);
  assert.equal(result.reason, 'cancelled');
  assert.equal(h.applyCalls.length, 1);
  assert.deepEqual(result.results.slice(1).map(r => r.decision), ['aborted_user', 'aborted_user']);
  assert.equal(h.token.cancelled, true);
  assert.deepEqual(h.finishes(), []);
});

test('progress events carry profile index/name and no secret', async () => {
  const h = harness();
  await runAllProfiles(h.ctx);
  assert.ok(h.progress.length >= 3);
  assert.ok(h.progress.every(p => p.channel === 'run-progress'));
  assert.deepEqual(h.progress[0].payload.profile, PROFILES[0]);
  assert.equal(h.progress[0].payload.index, 0);
  assert.ok(h.progress[0].payload.result);
  assert.ok(h.progress.every(p => !Object.keys(p.payload).some(k => /secret|token|password|authorization|cookie/i.test(k))));
  assert.ok(!JSON.stringify(h.progress).includes('TEST_SECRET_VALUE'));
});
