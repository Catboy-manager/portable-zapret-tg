const https = require('https');
const http = require('http');
const { exec } = require('./winws');
const { readTargets, parseProfile, listProfiles } = require('./profiles');
const { tcpReachable } = require('./tgproxy');
const { CRITICAL_TARGETS, DEFAULT_HEALTH_TARGETS, normalizeHealthTargets, isCriticalTarget } = require('./targets');
const { buildProfileMatrix } = require('./profile-matrix');
const { looksInvalidApplyResult, isInvalidProfile, recentlyFailed, recordFailedProfile, markInvalidProfile } = require('./profile-health');

const MATRIX_ROWS = 300;

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function httpProbe(url, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const started = Date.now();
    try {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request({
        method: 'GET',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + (u.search || '') || '/',
        timeout: timeoutMs,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) zapret-portable-monitor/1.0' }
      }, (res) => {
        // Only a real 2xx document counts as service availability; redirects and
        // error pages are recorded as failures with their metadata.
        const bytes = Number(res.headers['content-length']) || null;
        const status = res.statusCode;
        res.resume();
        resolve({ ok: status >= 200 && status < 300, status, ms: Date.now() - started, bytes });
      });
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.on('error', (e) => resolve({ ok: false, error: e.message, errorCode: e.code || 'NO_CODE', ms: Date.now() - started }));
      req.end();
    } catch (e) {
      resolve({ ok: false, error: e.message, errorCode: e.code || 'NO_CODE', ms: Date.now() - started });
    }
  });
}

async function pingHost(host) {
  // Windows ping: -n 1 -w 2000
  const r = await exec('ping.exe', ['-n', '1', '-w', '2000', host], { timeout: 5000 });
  const ok = r.ok && /ttl=/i.test(r.stdout || '');
  let ms = null;
  const m = (r.stdout || '').match(/time[=<]([\d]+)ms/i);
  if (m) ms = Number(m[1]);
  return { ok, ms };
}

function pickMonitorTargets(runtimeDir, settings) {
  const targets = readTargets(runtimeDir);
  const configured = normalizeHealthTargets(settings?.healthTargets);
  const pickNames = new Set(configured.length ? configured : DEFAULT_HEALTH_TARGETS);
  let picked = targets.filter(t => pickNames.has(t.name) && t.type === 'http');
  // Critical targets must survive the 10-target cap even if the user added extras.
  picked = [...picked.filter(t => isCriticalTarget(t.name)), ...picked.filter(t => !isCriticalTarget(t.name))];
  if (picked.length < 2) {
    const fallback = new Set(DEFAULT_HEALTH_TARGETS);
    picked = targets.filter(t => fallback.has(t.name) && t.type === 'http');
  }
  if (picked.length < 2) picked = targets.filter(t => t.type === 'http').slice(0, 8);
  return picked.slice(0, 10);
}

class Monitor {
  constructor({ runtimeDir, storage, winws, service, tg, emit, voice, admin }) {
    this.runtimeDir = runtimeDir;
    this.storage = storage;
    this.admin = admin || null;
    this.winws = winws;
    this.service = service;
    this.tg = tg;
    this.emit = emit || (()=>{});
    this.voice = voice;
    this.timer = null;
    this.running = false;
    this.busy = false;
    this.paused = false;
    this.consecutiveFails = 0;
    this.lastSwitchAt = 0;
    this.lastCheck = null;
  }

  recordDiagnostic(kind, row, profileOverride) {
    if (!this.storage || typeof this.storage.recordDiagnostics !== 'function') return null;
    const settings = this.storage.loadSettings ? this.storage.loadSettings() : {};
    return this.storage.recordDiagnostics({
      kind,
      ...row,
      profile: profileOverride || settings.activeProfile || null,
      mode: settings.winwsMode || 'user',
      admin: this.admin ? !!this.admin() : null,
      voiceActive: this.voice && typeof this.voice.isActive === 'function' ? !!this.voice.isActive() : null,
    });
  }

  start() {
    if (this.timer) clearInterval(this.timer);
    this.running = true;
    const s = this.storage.loadSettings();
    const interval = Math.max(30, Number(s.monitorIntervalSec)||120) * 1000;
    this.timer = setInterval(() => this.tick('interval'), interval);
    this.storage.log('info', 'Monitor started', { intervalSec: interval/1000 });
    // initial gentle check shortly after start
    setTimeout(() => this.tick('startup'), 8000);
  }

  stop() {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.storage.log('info', 'Monitor stopped');
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.storage.log('info', 'Monitor paused for profile test run');
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.storage.log('info', 'Monitor resumed after profile test run');
  }

  isPaused() {
    return !!this.paused;
  }

  async probeOnce(reason = 'manual', runId = null, profileName = null, settingsOverride = null) {
    const settings = settingsOverride || this.storage.loadSettings();
    const targets = pickMonitorTargets(this.runtimeDir, settings);
    const timeoutMs = Number(settings.probeTimeoutMs) || 6000;
    const runMeta = runId ? { runId } : {};
    const results = [];
    for (const t of targets) {
      const r = await httpProbe(t.url, timeoutMs);
      results.push({ name: t.name, url: t.url, critical: isCriticalTarget(t.name), ...r });
      this.recordDiagnostic('check', { target: t.name, url: t.url, reason, critical: isCriticalTarget(t.name), ...runMeta, ...r }, profileName);
    }
    const okCount = results.filter(r => r.ok).length;
    const failedTargets = results.filter(r => !r.ok).map(r => r.name);
    const total = results.length || 1;
    const criticalResults = results.filter(r => r.critical);
    const criticalOk = criticalResults.filter(r => r.ok).length;
    const criticalTotal = criticalResults.length;
    const criticalMissing = CRITICAL_TARGETS.filter(name => !criticalResults.some(r => r.name === name));
    const nonCritical = results.filter(r => !r.critical);
    const nonCriticalOk = nonCritical.filter(r => r.ok).length;
    const nonCriticalTotal = nonCritical.length;
    // A service is healthy only when every critical target responds 2xx and
    // enough of the informational targets respond 2xx.
    const overallOk = criticalMissing.length === 0 && criticalOk === CRITICAL_TARGETS.length && nonCriticalOk >= Math.ceil(nonCriticalTotal * 0.6);
    const tgStatus = await this.tg.status(settings.tgProxy || { host:'127.0.0.1', port:1080, secret:'' });
    const check = {
      ts: new Date().toISOString(),
      reason,
      ...runMeta,
      overallOk,
      okCount, total,
      criticalOk, criticalTotal, criticalMissing,
      nonCriticalOk, nonCriticalTotal,
      failedTargets,
      results,
      telegram: { running: tgStatus.running, reachable: tgStatus.reachable },
    };
    this.lastCheck = check;
    this.recordDiagnostic('check_summary', {
      reason,
      ...runMeta,
      overallOk,
      okCount,
      total,
      criticalOk,
      criticalTotal,
      criticalMissing,
      nonCriticalOk,
      nonCriticalTotal,
      failedTargets,
      telegramRunning: !!tgStatus.running,
      telegramReachable: !!tgStatus.reachable,
    }, profileName);
    if (failedTargets.length) {
      this.storage.log('warn', 'Quick check failed targets', { reason, ...runMeta, ok: `${okCount}/${total}`, failedTargets });
    }
    // update stats
    const stats = this.storage.loadStats();
    stats.targets = stats.targets || {};
    for (const r of results) {
      const st = stats.targets[r.name] || { ok: 0, fail: 0 };
      if (r.ok) st.ok++; else st.fail++;
      st.last = r.ok ? 'ok' : 'fail';
      st.lastTs = check.ts;
      stats.targets[r.name] = st;
    }
    stats.lastCheck = { ts: check.ts, overallOk, okCount, total };
    this.storage.saveStats(stats);
    this.storage.appendEvent({ type: 'check', ...check });
    this.emit('check', check);
    return check;
  }

  scoreProfile(profileName, stats) {
    const p = (stats.profiles || {})[profileName] || {};
    const success = p.success || 0;
    const fail = p.fail || 0;
    const total = success + fail;
    const rate = total ? success / total : 0.5;
    const recencyBonus = p.lastSuccessTs ? Math.max(0, 1 - (Date.now() - Date.parse(p.lastSuccessTs)) / (7*24*3600*1000)) * 0.2 : 0;
    return rate + recencyBonus;
  }

  readMatrixRows() {
    if (this.storage && typeof this.storage.readRecentDiagnostics === 'function') {
      return this.storage.readRecentDiagnostics(MATRIX_ROWS);
    }
    return [];
  }

  scoreMatrixProfile(row, legacyScore = 0, now = Date.now()) {
    // Profiles without matrix data stay reachable but always rank below tested ones.
    if (!row || !row.tested) return Math.max(0, Number(legacyScore) || 0);
    const currentOk = Object.values(row.cells).filter(c => c && c.ok).length;
    const parsedTs = row.lastTs ? Date.parse(row.lastTs) : NaN;
    const ageDays = Number.isFinite(parsedTs)
      ? Math.max(0, (now - parsedTs) / (24 * 3600 * 1000))
      : 7;
    const freshness = Math.max(0, 1 - ageDays / 7);
    return 1e6 + row.criticalOk * 1e4 + currentOk * 10 + freshness;
  }

  rankCandidates(settings) {
    const all = listProfiles(this.runtimeDir);
    const matrix = buildProfileMatrix({
      rows: this.readMatrixRows(),
      profiles: all,
      targets: normalizeHealthTargets(settings.healthTargets),
    });
    const stats = this.storage.loadStats();
    const profileStats = stats.profiles || {};
    const byName = new Map(matrix.profiles.map(p => [p.name, p]));
    const eligible = all.filter(name => !isInvalidProfile(profileStats[name]));
    const ranked = eligible.map(name => {
      const failedRecently = recentlyFailed(profileStats[name]);
      let score = this.scoreMatrixProfile(byName.get(name), this.scoreProfile(name, stats));
      // Recently failed profiles stay available for manual use but go behind
      // untested exploration in passive mode so the same three never cycle.
      if (failedRecently) score = -1;
      return { name, score, tested: !!(byName.get(name) && byName.get(name).tested), failedRecently };
    }).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.name === settings.lastGoodProfile) return -1;
      if (b.name === settings.lastGoodProfile) return 1;
      return a.name.localeCompare(b.name);
    });
    const count = Math.max(1, Number(settings.candidateCount) || 3);
    return ranked.slice(0, count);
  }

  getCandidates(settings) {
    return this.rankCandidates(settings).map(x => x.name);
  }

  async applyProfile(profileName, settings) {
    const profilePath = require('path').join(this.runtimeDir, profileName);
    const parsed = parseProfile(profilePath, this.runtimeDir);
    let res;
    if (settings.winwsMode === 'service') {
      await this.winws.stopUser();
      res = await this.service.installService(profileName, parsed);
      if (!res.ok) {
        res = await this.service.startService();
      }
    } else {
      try { await this.service.stopService(); } catch {}
      await this.winws.stopUser();
      res = await this.winws.startUser(profileName, parsed);
    }
    if (res && res.ok) {
      settings.activeProfile = profileName;
      settings.lastGoodProfile = profileName;
      this.storage.saveSettings(settings);
      this.storage.log('info', 'Applied profile', { profile: profileName, mode: settings.winwsMode });
    } else {
      if (looksInvalidApplyResult(res)) {
        const stats = this.storage.loadStats();
        markInvalidProfile(stats, profileName, res);
        this.storage.saveStats(stats);
        this.recordDiagnostic('profile_decision', {
          decision: 'invalid-profile', from: settings.activeProfile, to: profileName,
          reason: res && res.message, invalidReason: stats.profiles[profileName].invalidReason,
        });
      }
      this.storage.log('warn', 'Failed to apply profile', { profile: profileName, mode: settings.winwsMode, res });
    }
    return res;
  }

  async autoSwitch(reason, opts = {}) {
    const settings = this.storage.loadSettings();
    const ranked = this.rankCandidates(settings);
    if (!settings.autoSwitchEnabled && reason !== 'manual') {
      this.recordDiagnostic('profile_decision', { decision: 'skipped-disabled', reason, from: settings.activeProfile, candidates: ranked });
      return { ok: false, reason: 'auto-switch disabled' };
    }
    const now = Date.now();
    const cooldown = Math.max(60, Number(settings.cooldownSec)||600) * 1000;
    if (reason !== 'manual' && now - this.lastSwitchAt < cooldown) {
      this.storage.log('info', 'Auto-switch skipped (cooldown)', { reason });
      this.recordDiagnostic('profile_decision', { decision: 'skipped-cooldown', reason, from: settings.activeProfile, candidates: ranked, waitMs: cooldown - (now - this.lastSwitchAt) });
      return { ok: false, reason: 'cooldown' };
    }

    // Discord voice is protected: automatic switching can restart winws and cut audio.
    // Manual choices and explicit "Автоподбор сейчас" always win.
    if (reason !== 'manual' && !opts.force && this.voice && this.voice.isActive()) {
      this.storage.log('info', 'Auto-switch deferred: Discord voice active', { reason });
      this.storage.appendEvent({ type: 'switch_deferred', reason, cause: 'discord-voice-active' });
      this.emit('status', { message: 'Автопереключение отложено: идёт голос в Discord' });
      this.recordDiagnostic('profile_decision', { decision: 'deferred-voice', reason, from: settings.activeProfile, candidates: ranked });
      return { ok: false, reason: 'discord-voice-active' };
    }

    // User-priority: manual selection locks profile. Auto-switch on degradation
    // is skipped while lock is active, unless user explicitly requested manual auto-switch.
    if (settings.manualProfileLock && reason !== 'manual') {
      this.storage.log('info', 'Auto-switch skipped: manual profile lock active', { reason, manualProfile: settings.manualProfile, activeProfile: settings.activeProfile });
      this.emit('status', { message: `Ручной профиль зафиксирован: ${settings.manualProfile || settings.activeProfile || 'unknown'}. Авто-переключение пропущено.` });
      this.recordDiagnostic('profile_decision', { decision: 'skipped-manual-lock', reason, from: settings.activeProfile, to: settings.manualProfile, candidates: ranked });
      return { ok: false, reason: 'manual-lock' };
    }

    const prev = settings.activeProfile;
    const rankedNames = ranked.map(x => x.name);
    const candidates = [prev, ...rankedNames.filter(p => p !== prev)].filter(Boolean);
    // If manual auto-switch requested, try current first but allow alternatives.
    if (!candidates.length) {
      this.recordDiagnostic('profile_decision', { decision: 'no-candidates', reason, from: prev, candidates: ranked });
      return { ok: false, reason: 'no candidates' };
    }

    this.storage.log('warn', 'Starting auto-switch', { reason, from: prev, candidates, ranked });
    for (const cand of candidates) {
      this.emit('status', { message: `Пробую профиль: ${cand}` });
      const applyStarted = Date.now();
      const applyRes = await this.applyProfile(cand, settings);
      const applyMs = Date.now() - applyStarted;
      if (!applyRes || !applyRes.ok) {
        this.storage.appendEvent({ type: 'switch_attempt', from: prev, to: cand, ok: false, applyRes });
        this.recordDiagnostic('profile_attempt', { from: prev, to: cand, ok: false, reason, applyMs, applyResult: { code: applyRes && applyRes.code, message: applyRes && applyRes.message } });
        const accessErr = applyRes && (applyRes.requiresAdmin || applyRes.code === 'EACCES' || applyRes.code === 'EPERM' || /Administrator|EACCES|access/i.test(String(applyRes.message || '')));
        if (accessErr) {
          this.lastSwitchAt = Date.now();
          this.storage.log('warn', 'Auto-switch stopped: admin/access required', { profile: cand, message: applyRes.message });
          this.emit('status', { message: 'Нужны права администратора для запуска winws/службы' });
          this.recordDiagnostic('profile_decision', { decision: 'admin-required', reason, from: prev, to: cand, candidates: ranked });
          return { ok: false, reason: 'admin-required', message: applyRes.message };
        }
        continue;
      }
      await sleep(4500);
      const probeStarted = Date.now();
      const check = await this.probeOnce('post-switch');
      const probeMs = Date.now() - probeStarted;
      const stats = this.storage.loadStats();
      stats.profiles = stats.profiles || {};
      const ps = stats.profiles[cand] || { success: 0, fail: 0 };
      if (check.overallOk) {
        ps.success++; ps.lastSuccessTs = check.ts; stats.profiles[cand] = ps; this.storage.saveStats(stats);
        this.lastSwitchAt = Date.now();
        this.consecutiveFails = 0;
        if (reason === 'manual') {
          settings.manualProfileLock = false;
          settings.manualProfile = null;
          settings.activeProfile = cand;
          settings.lastGoodProfile = cand;
          this.storage.saveSettings(settings);
        }
        this.lastSwitch = { ts: new Date().toISOString(), from: prev, to: cand, ok: true, reason };
        this.storage.appendEvent({ type: 'switch', from: prev, to: cand, ok: true, reason, check: { ok: check.overallOk, okCount: check.okCount, total: check.total } });
        this.storage.log('info', 'Auto-switch succeeded', { to: cand, reason });
        this.emit('status', { message: `Проверка профиля: ${cand}` });
        this.recordDiagnostic('profile_attempt', { from: prev, to: cand, ok: true, reason, applyMs, probeMs, postCheckOk: true, postCheckCount: `${check.okCount}/${check.total}` });
        this.recordDiagnostic('profile_decision', { decision: 'applied', reason, from: prev, to: cand, candidates: ranked });
        return { ok: true, profile: cand };
      } else {
        recordFailedProfile(stats, cand, check);
        this.storage.saveStats(stats);
        this.storage.appendEvent({ type: 'switch_attempt', from: prev, to: cand, ok: false, check: { ok: check.overallOk, failedTargets: check.failedTargets } });
        this.storage.log('warn', 'Candidate did not pass quick check', { cand, ok: `${check.okCount}/${check.total}`, failedTargets: check.failedTargets });
        this.recordDiagnostic('profile_attempt', { from: prev, to: cand, ok: false, reason, applyMs, probeMs, postCheckOk: false, postCheckCount: `${check.okCount}/${check.total}`, failedTargets: check.failedTargets });
      }
    }

    if (prev && !candidates.includes(prev)) {
      this.storage.log('warn', 'Rolling back to previous profile', { prev });
      await this.applyProfile(prev, settings);
      this.recordDiagnostic('profile_decision', { decision: 'rolled-back', reason, from: prev, to: prev, candidates: ranked });
    }
    this.lastSwitchAt = Date.now();
    this.recordDiagnostic('profile_decision', { decision: 'no-candidate-passed', reason, from: prev, candidates: ranked });
    return { ok: false, reason: 'no candidate passed' };
  }

  async tick(reason = 'interval') {
    if (!this.running || this.busy || this.paused) return;
    this.busy = true;
    try {
      if (this.voice) {
        try { await this.voice.check(); } catch (e) { this.storage.log('warn', 'Voice detection failed', { error: e.message }); }
      }
      const settings = this.storage.loadSettings();
      const check = await this.probeOnce(reason);
      // Proxy can stay listening while its upstream is stuck in SYN_SENT.
      // Restart it after two consecutive degraded checks.
      try {
        if (this.tg && this.tg.ensureHealthy) {
          const tg = await this.tg.ensureHealthy();
          if (tg && tg.restarted) {
            this.storage.appendEvent({ type: 'tg_watchdog', health: tg.health, started: tg.started });
            this.emit('status', { message: 'TgWsProxy перезапущен: upstream не отвечал' });
          }
        }
      } catch (e) {
        this.storage.log('warn', 'TgWsProxy watchdog failed', { error: e.message });
      }
      const threshold = Math.max(1, Number(settings.failThreshold)||3);
      if (check.overallOk) {
        if (this.consecutiveFails) this.storage.log('info', 'Targets recovered', { afterFails: this.consecutiveFails });
        this.consecutiveFails = 0;
      } else {
        this.consecutiveFails += 1;
        this.storage.log('warn', 'Targets degraded', { consecutiveFails: this.consecutiveFails, ok: `${check.okCount}/${check.total}` });
      }
      if (this.consecutiveFails >= threshold) {
        await this.autoSwitch('degradation');
        this.consecutiveFails = 0; // reset after attempt cycle
      }
    } catch (e) {
      this.storage.log('error', 'Monitor tick error', { error: e.message, stack: e.stack });
    } finally {
      this.busy = false;
    }
  }

  getSnapshot() {
    return { running: this.running, busy: this.busy, consecutiveFails: this.consecutiveFails, lastSwitchAt: this.lastSwitchAt, lastCheck: this.lastCheck };
  }
}

module.exports = { Monitor, httpProbe, pingHost };
