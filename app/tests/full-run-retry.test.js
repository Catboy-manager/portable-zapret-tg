const test = require('node:test');
const assert = require('node:assert/strict');
const { createRunToken, runFullSelection } = require('../src/profile-matrix');

const PROFILES = ['general (A).bat', 'general (B).bat'];
const CRITICAL = ['YouTubeWeb', 'DiscordCDN', 'RuTrackerMain'];

function check(passed = []) {
  return {
    okCount: passed.length + 1,
    total: 5,
    criticalOk: passed.length,
    criticalTotal: CRITICAL.length,
    criticalMissing: [],
    results: CRITICAL.map(name => ({
      name, critical: true, ok: passed.includes(name), status: passed.includes(name) ? 200 : 503, ms: 100,
    })),
  };
}

function harness(probeForProfile = () => check([])) {
  const logs = [];
  const emitted = [];
  const finishes = [];
  const probeCalls = [];
  const applyCalls = [];
  const ctx = {
    profiles: PROFILES,
    apply: async (p, opts) => { applyCalls.push({ p, opts }); return { ok: true }; },
    probe: async (reason, runId, p, settings) => { probeCalls.push({ reason, runId, p, settings }); return probeForProfile(p); },
    voice: { isActive: () => false },
    storage: { recordDiagnostics: () => {}, appendEvent: () => {}, log: (level, message) => logs.push({ level, message }) },
    emit: (channel, payload) => emitted.push({ channel, payload }),
    finish: async (p) => { finishes.push(p); },
    token: createRunToken(),
  };
  return { ctx, logs, emitted, finishes, probeCalls, applyCalls };
}

test('runFullSelection retries once and warns when every critical target is blocked', async () => {
  const h = harness();
  const r = await runFullSelection(h.ctx);
  assert.equal(r.attempts, 2);
  assert.equal(r.criticalBlocked, true);
  assert.deepEqual(r.blockedTargets, CRITICAL);
  assert.deepEqual(h.finishes, []);
  const exact = 'все таргеты провалены, провайдер заблокировал все методы обхода';
  assert.ok(h.logs.some(x => x.message === exact));
  assert.ok(h.emitted.some(x => x.channel === 'status' && x.payload.message === exact));
  assert.ok(h.logs.some(x => /Повторяю полный подбор/.test(x.message)));
});

test('runFullSelection does not retry when one profile passes all critical targets', async () => {
  const h = harness(p => (p === PROFILES[0] ? check(CRITICAL) : check([])));
  const r = await runFullSelection(h.ctx);
  assert.equal(r.attempts, 1);
  assert.equal(r.criticalBlocked, false);
  assert.equal(r.winner, PROFILES[0]);
  assert.deepEqual(h.finishes, [PROFILES[0]]);
});

test('runFullSelection passes frozen settings to apply and probe', async () => {
  const settings = { healthTargets: ['YouTubeWeb'], probeTimeoutMs: 1234 };
  const h = harness(p => (p === PROFILES[0] ? check(CRITICAL) : check([])));
  await runFullSelection({ ...h.ctx, settings });
  assert.ok(h.applyCalls.every(c => c.opts.settings === settings));
  assert.ok(h.probeCalls.every(c => c.settings === settings));
});
