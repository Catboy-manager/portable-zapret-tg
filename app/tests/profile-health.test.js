const test = require('node:test');
const assert = require('node:assert/strict');
const {
  looksInvalidApplyResult,
  recentlyFailed,
  isInvalidProfile,
  recordFailedProfile,
  markInvalidProfile,
} = require('../src/profile-health');

test('looksInvalidApplyResult detects caret parse error', () => {
  const res = { ok: false, exitCode: 1, stderrTail: '[winws_err] could not read ^!' };
  assert.equal(looksInvalidApplyResult(res), true);
});

test('looksInvalidApplyResult ignores access errors', () => {
  const res = { ok: false, code: 'EACCES', message: 'Нужны права администратора' };
  assert.equal(looksInvalidApplyResult(res), false);
});

test('recentlyFailed requires two failures inside the window', () => {
  const now = Date.now();
  assert.equal(recentlyFailed({ failCount: 2, lastFailTs: new Date(now - 1000).toISOString() }, now), true);
  assert.equal(recentlyFailed({ failCount: 1, lastFailTs: new Date(now - 1000).toISOString() }, now), false);
});

test('recentlyFailed ignores stale failures', () => {
  const now = Date.now();
  assert.equal(recentlyFailed({ failCount: 5, lastFailTs: new Date(now - 31 * 60 * 1000).toISOString() }, now), false);
});

test('isInvalidProfile reads the persisted flag', () => {
  assert.equal(isInvalidProfile({ invalid: true }), true);
  assert.equal(isInvalidProfile({ invalid: false }), false);
  assert.equal(isInvalidProfile(undefined), false);
});

test('recordFailedProfile accumulates count and failed target names', () => {
  const stats = { profiles: {} };
  const check = { failedTargets: ['YouTubeWeb'], ts: '2026-11-28T12:00:00.000Z' };
  recordFailedProfile(stats, 'general (A).bat', check, Date.parse(check.ts));
  recordFailedProfile(stats, 'general (A).bat', check, Date.parse(check.ts) + 1000);
  const p = stats.profiles['general (A).bat'];
  assert.equal(p.failCount, 2);
  assert.deepEqual(p.failedTargets, ['YouTubeWeb']);
  assert.equal(p.lastFailTs, check.ts);
});

test('markInvalidProfile stores a redacted reason', () => {
  const stats = { profiles: {} };
  markInvalidProfile(stats, 'general (FAKE TLS AUTO).bat', {
    ok: false, exitCode: 1, stderrTail: '[winws_err] could not read ^!', message: 'winws не запустился',
  }, Date.now());
  const p = stats.profiles['general (FAKE TLS AUTO).bat'];
  assert.equal(p.invalid, true);
  assert.match(p.invalidReason, /could not read \^!/);
});
