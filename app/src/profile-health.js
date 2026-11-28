const FAILURE_WINDOW_MS = 30 * 60 * 1000;
const FAILURE_THRESHOLD = 2;

function looksInvalidApplyResult(res) {
  if (!res || res.ok === true) return false;
  const text = `${res.stderrTail || ''} ${res.message || ''}`;
  const badExit = res.exitCode === 1 || /\bexit\s*1\b/i.test(text);
  const parseError = /could not read \^!/i.test(text) || /winws_err/i.test(text);
  return !!(badExit && parseError);
}

function isInvalidProfile(stats) {
  return !!(stats && stats.invalid === true);
}

function recentlyFailed(stats, now = Date.now(), windowMs = FAILURE_WINDOW_MS, threshold = FAILURE_THRESHOLD) {
  if (!stats) return false;
  const count = Number(stats.failCount) || 0;
  if (count < threshold) return false;
  const ts = Date.parse(stats.lastFailTs || '');
  if (!Number.isFinite(ts)) return false;
  return now - ts >= 0 && now - ts <= windowMs;
}

function recordFailedProfile(stats, name, check = {}, now = Date.now()) {
  stats.profiles = stats.profiles || {};
  const ps = stats.profiles[name] || { success: 0, fail: 0 };
  const priorFail = Number(ps.fail) || 0;
  ps.fail = priorFail + 1;
  const priorCount = Number.isFinite(Number(ps.failCount)) ? Number(ps.failCount) : priorFail;
  ps.failCount = priorCount + 1;
  ps.lastFailTs = check.ts || new Date(now).toISOString();
  ps.failedTargets = Array.isArray(check.failedTargets) ? [...check.failedTargets] : [];
  stats.profiles[name] = ps;
  return ps;
}

function markInvalidProfile(stats, name, res = {}, now = Date.now()) {
  stats.profiles = stats.profiles || {};
  const ps = stats.profiles[name] || { success: 0, fail: 0 };
  ps.invalid = true;
  ps.invalidReason = String(res.stderrTail || res.message || 'winws apply failed').trim().slice(0, 500);
  ps.invalidTs = new Date(now).toISOString();
  stats.profiles[name] = ps;
  return ps;
}

module.exports = {
  FAILURE_WINDOW_MS,
  FAILURE_THRESHOLD,
  looksInvalidApplyResult,
  isInvalidProfile,
  recentlyFailed,
  recordFailedProfile,
  markInvalidProfile,
};
