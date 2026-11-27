const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CRITICAL_TARGETS,
  DEFAULT_HEALTH_TARGETS,
  normalizeHealthTargets,
  isCriticalTarget,
  effectiveCheckOk,
} = require('../src/targets');

test('normalizeHealthTargets restores the full default list', () => {
  const normalized = normalizeHealthTargets([]);
  for (const name of DEFAULT_HEALTH_TARGETS) {
    assert.ok(normalized.includes(name), `missing ${name}`);
  }
});

test('normalizeHealthTargets preserves custom targets and restores missing critical ones', () => {
  const normalized = normalizeHealthTargets(['DiscordMain', 'CustomTarget']);
  assert.ok(normalized.includes('CustomTarget'));
  for (const name of CRITICAL_TARGETS) {
    assert.ok(normalized.includes(name), `missing critical ${name}`);
  }
});

test('normalizeHealthTargets drops the legacy redirect-only YouTubeShort', () => {
  const normalized = normalizeHealthTargets(['DiscordMain', 'YouTubeShort']);
  assert.equal(normalized.includes('YouTubeShort'), false);
});

test('isCriticalTarget distinguishes critical from informational targets', () => {
  assert.equal(isCriticalTarget('YouTubeWeb'), true);
  assert.equal(isCriticalTarget('YouTubeImage'), false);
});

test('effectiveCheckOk rejects legacy non-2xx rows', () => {
  assert.equal(effectiveCheckOk({ ok: true, status: 404 }), false);
  assert.equal(effectiveCheckOk({ ok: true, status: 301 }), false);
  assert.equal(effectiveCheckOk({ ok: true, status: 200 }), true);
  assert.equal(effectiveCheckOk({ ok: false, status: 200 }), false);
  assert.equal(effectiveCheckOk({ ok: true }), false);
});
