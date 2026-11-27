const test = require('node:test');
const assert = require('node:assert/strict');
const { Monitor } = require('../src/monitor');

test('auto-switch defers while voice active', async () => {
  const voice = { isActive: () => true, check: async () => ({}), snapshot: () => ({ active: true }) };
  const storage = {
    loadSettings: () => ({ autoSwitchEnabled: true, cooldownSec: 0 }),
    log: () => {},
    appendEvent: () => {},
    loadStats: () => ({ profiles: {} }),
    saveStats: () => {},
  };
  const m = new Monitor({ runtimeDir: '.', storage, voice, emit: () => {} });
  const r = await m.autoSwitch('degradation');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'discord-voice-active');
});

test('manual auto-switch bypasses voice block', async () => {
  const voice = { isActive: () => true, check: async () => ({}), snapshot: () => ({ active: true }) };
  const storage = {
    loadSettings: () => ({ autoSwitchEnabled: false, cooldownSec: 0 }),
    log: () => {},
    appendEvent: () => {},
    loadStats: () => ({ profiles: {} }),
    saveStats: () => {},
  };
  const m = new Monitor({ runtimeDir: '.', storage, voice, emit: () => {} });
  // no candidates in empty runtimeDir; should not be blocked by voice, but by no candidates
  const r = await m.autoSwitch('manual');
  assert.equal(r.reason, 'no candidates');
});
