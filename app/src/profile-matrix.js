const { isCriticalTarget, effectiveCheckOk } = require('./targets');

function buildProfileMatrix({ rows = [], profiles = [], targets = [] } = {}) {
  const grouped = new Map();
  for (const r of rows) {
    if (!r || r.kind !== 'check' || !r.profile || !r.target) continue;
    if (!profiles.includes(r.profile) || !targets.includes(r.target)) continue;
    if (!grouped.has(r.profile)) grouped.set(r.profile, new Map());
    const byTarget = grouped.get(r.profile);
    if (!byTarget.has(r.target)) byTarget.set(r.target, []);
    byTarget.get(r.target).push(r);
  }

  const outProfiles = profiles.map((name) => {
    const byTarget = grouped.get(name) || new Map();
    const cells = {};
    let okCount = 0;
    let failCount = 0;
    let lastTs = null;
    for (const target of targets) {
      const items = byTarget.get(target) || [];
      if (!items.length) {
        cells[target] = null;
        continue;
      }
      let targetOk = 0;
      let targetFail = 0;
      for (const item of items) {
        if (effectiveCheckOk(item)) targetOk++;
        else targetFail++;
        if (!lastTs || String(item.ts || '') > String(lastTs)) lastTs = item.ts || lastTs;
      }
      okCount += targetOk;
      failCount += targetFail;
      const newest = items.reduce((a, b) => (String(b.ts || '') > String(a.ts || '') ? b : a));
      cells[target] = {
        ok: effectiveCheckOk(newest),
        status: newest.status === undefined ? null : newest.status,
        error: newest.error === undefined ? null : newest.error,
        errorCode: newest.errorCode === undefined ? null : newest.errorCode,
        ms: newest.ms === undefined ? null : newest.ms,
        ts: newest.ts === undefined ? null : newest.ts,
        runId: newest.runId === undefined ? null : newest.runId,
        okCount: targetOk,
        failCount: targetFail,
      };
    }
    const criticalTargets = targets.filter(isCriticalTarget);
    return {
      name,
      tested: okCount + failCount > 0,
      cells,
      okCount,
      failCount,
      criticalOk: criticalTargets.filter(t => cells[t] && cells[t].ok).length,
      criticalTotal: criticalTargets.length,
      lastTs,
    };
  });

  return {
    targets: [...targets],
    profiles: outProfiles,
    testedCount: outProfiles.filter(p => p.tested).length,
  };
}

function createRunToken() {
  let cancelled = false;
  return {
    get cancelled() { return cancelled; },
    cancel() { cancelled = true; },
  };
}

async function runAllProfiles({
  profiles = [],
  apply,
  probe,
  voice,
  storage,
  emit = () => {},
  finish,
  token,
  settings = null,
  attempt = 1,
} = {}) {
  const voiceActive = () => !!(voice && typeof voice.isActive === 'function' && voice.isActive());
  if (voiceActive()) {
    return { completed: false, aborted: true, reason: 'voice-active', results: [], winner: null, runId: null };
  }

  const runId = `full-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const results = [];
  let aborted = false;
  let reason = null;

  const writeRow = (result) => {
    if (!storage || typeof storage.recordDiagnostics !== 'function') return;
    storage.recordDiagnostics({
      kind: 'profile_run',
      runId,
      profile: result.profile,
      decision: result.decision,
      ok: !!result.ok,
      score: result.score,
      okCount: result.okCount || 0,
      total: result.total || 0,
      criticalOk: result.criticalOk || 0,
      criticalTotal: result.criticalTotal || 0,
      criticalTargets: result.criticalTargets || [],
      criticalPassedTargets: result.criticalPassedTargets || [],
      totalMs: result.totalMs || 0,
      applyMs: result.applyMs || 0,
      probeMs: result.probeMs || 0,
    });
  };

  for (let i = 0; i < profiles.length; i++) {
    const name = profiles[i];
    let result;
    if (aborted) {
      result = {
        profile: name,
        decision: reason === 'cancelled' ? 'aborted_user' : 'aborted_voice',
        ok: false,
        score: 0,
      };
    } else {
      const applyStarted = Date.now();
      let applied;
      try {
        applied = await apply(name, { transient: true, settings });
      } catch (e) {
        applied = { ok: false, message: e && e.message };
      }
      const applyMs = Date.now() - applyStarted;
      if (!applied || !applied.ok) {
        result = { profile: name, decision: 'apply_failed', ok: false, applyMs, score: 0 };
      } else {
        const probeStarted = Date.now();
        const check = await probe('profile-test', runId, name, settings);
        const probeMs = Date.now() - probeStarted;
        const okCount = Number(check && check.okCount) || 0;
        const total = Number(check && check.total) || 0;
        const criticalOk = Number(check && check.criticalOk) || 0;
        const criticalTotal = Number(check && check.criticalTotal) || 0;
        const targetRows = Array.isArray(check && check.results) ? check.results : [];
        const totalMs = targetRows.reduce((sum, r) => sum + (Number(r && r.ms) || 0), 0);
        const criticalTargets = targetRows.filter(r => r && r.critical).map(r => r.name);
        const criticalPassedTargets = targetRows.filter(r => r && r.critical && r.ok).map(r => r.name);
        // Higher is better: critical passes dominate, then 2xx count, then speed.
        const score = criticalOk * 1e9 + okCount * 1e6 - totalMs;
        result = {
          profile: name, decision: 'applied', ok: true,
          applyMs, probeMs, okCount, total, criticalOk, criticalTotal, totalMs, score,
          criticalTargets, criticalPassedTargets,
        };
      }
    }
    results.push(result);
    writeRow(result);
    if (storage && typeof storage.appendEvent === 'function') {
      storage.appendEvent({ type: 'profile_run', runId, profile: name, decision: result.decision, ok: !!result.ok });
    }
    emit('run-progress', { index: i, total: profiles.length, runId, profile: name, result });

    if (!aborted && token && token.cancelled) {
      aborted = true;
      reason = 'cancelled';
    } else if (!aborted && voiceActive()) {
      aborted = true;
      reason = 'voice-started';
    }
  }

  const applied = results.filter(r => r.decision === 'applied');
  const criticalNames = [...new Set(applied.flatMap(r => Array.isArray(r.criticalTargets) ? r.criticalTargets : []))];
  const blockedTargets = criticalNames.filter(name => applied.every(r => !(r.criticalPassedTargets || []).includes(name)));
  const criticalBlocked = !aborted && applied.length > 0 && blockedTargets.length > 0;
  const winner = aborted || criticalBlocked ? null
    : applied.slice().sort((a, b) => b.score - a.score)[0]?.profile || null;

  if (criticalBlocked) {
    if (storage && typeof storage.log === 'function') {
      storage.log('error', 'All critical targets blocked', { runId, blockedTargets, attempt });
    }
    if (storage && typeof storage.recordDiagnostics === 'function') {
      storage.recordDiagnostics({ kind: 'profile_decision', runId, decision: 'critical-blocked', blockedTargets, attempt });
    }
  }
  if (winner && typeof finish === 'function') await finish(winner);

  return {
    completed: !aborted,
    aborted,
    reason: aborted ? reason : 'completed',
    runId,
    results,
    winner,
    attempts: attempt,
    criticalBlocked,
    blockedTargets,
  };
}

const CRITICAL_BLOCK_MESSAGE = 'все таргеты провалены, провайдер заблокировал все методы обхода';

async function runFullSelection(options = {}) {
  const attempts = Math.max(1, Number(options.maxAttempts) || 2);
  let last = null;
  for (let i = 1; i <= attempts; i++) {
    last = await runAllProfiles({ ...options, attempt: i });
    if (last.aborted || !last.criticalBlocked) return { ...last, attempts: i };
    if (options.storage && typeof options.storage.log === 'function') {
      options.storage.log('error', CRITICAL_BLOCK_MESSAGE, { blockedTargets: last.blockedTargets, attempt: i });
    }
    if (typeof options.emit === 'function') options.emit('status', { message: CRITICAL_BLOCK_MESSAGE });
    if (i >= attempts) return { ...last, attempts: i };
    if (options.storage && typeof options.storage.log === 'function') {
      options.storage.log('info', 'Повторяю полный подбор', { attempt: i + 1, maxAttempts: attempts });
    }
  }
  return { ...last, attempts };
}

module.exports = { buildProfileMatrix, createRunToken, runAllProfiles, runFullSelection, CRITICAL_BLOCK_MESSAGE };
