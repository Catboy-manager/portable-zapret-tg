const https = require('https');
const http = require('http');
const { exec } = require('./winws');
const { readTargets, parseProfile, listProfiles } = require('./profiles');
const { tcpReachable } = require('./tgproxy');

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function httpProbe(url, timeoutMs = 6000) {
  return new Promise((resolve) => {
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
        // any HTTP response means connectivity/TLS handshake succeeded enough
        res.resume();
        resolve({ ok: true, status: res.statusCode });
      });
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.on('error', (e) => resolve({ ok: false, error: e.message }));
      req.end();
    } catch (e) {
      resolve({ ok: false, error: e.message });
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

function pickMonitorTargets(runtimeDir) {
  const targets = readTargets(runtimeDir);
  const pickNames = new Set(['DiscordMain','DiscordGateway','DiscordCDN','YouTubeWeb','YouTubeImage','YouTubeShort','GoogleMain']);
  let picked = targets.filter(t => pickNames.has(t.name));
  // prefer https probes
  picked = picked.filter(t => t.type === 'http');
  if (picked.length < 4) picked = targets.filter(t => t.type === 'http').slice(0, 6);
  return picked.slice(0, 6);
}

class Monitor {
  constructor({ runtimeDir, storage, winws, service, tg, emit }) {
    this.runtimeDir = runtimeDir;
    this.storage = storage;
    this.winws = winws;
    this.service = service;
    this.tg = tg;
    this.emit = emit || (()=>{});
    this.timer = null;
    this.running = false;
    this.busy = false;
    this.consecutiveFails = 0;
    this.lastSwitchAt = 0;
    this.lastCheck = null;
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

  async probeOnce(reason = 'manual') {
    const settings = this.storage.loadSettings();
    const targets = pickMonitorTargets(this.runtimeDir);
    const timeoutMs = Number(settings.probeTimeoutMs) || 6000;
    const results = [];
    for (const t of targets) {
      const r = await httpProbe(t.url, timeoutMs);
      results.push({ name: t.name, url: t.url, ...r });
    }
    const okCount = results.filter(r => r.ok).length;
    const total = results.length || 1;
    // simple health: require majority for overall ok, but track per-service hints
    const overallOk = okCount >= Math.ceil(total * 0.6); // e.g. 4/6
    const tgStatus = await this.tg.status(settings.tgProxy || { host:'127.0.0.1', port:1080, secret:'' });
    const check = {
      ts: new Date().toISOString(),
      reason,
      overallOk,
      okCount, total,
      results,
      telegram: { running: tgStatus.running, reachable: tgStatus.reachable },
    };
    this.lastCheck = check;
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

  getCandidates(settings) {
    const all = listProfiles(this.runtimeDir);
    const stats = this.storage.loadStats();
    const preferred = [];
    if (settings.lastGoodProfile && all.includes(settings.lastGoodProfile)) preferred.push(settings.lastGoodProfile);
    const active = settings.activeProfile;
    if (active && !preferred.includes(active) && all.includes(active)) preferred.push(active);
    const ranked = all
      .filter(p => !preferred.includes(p))
      .map(p => ({ p, s: this.scoreProfile(p, stats) }))
      .sort((a,b) => b.s - a.s)
      .map(x => x.p);
    const out = [...preferred, ...ranked];
    const count = Math.max(1, Number(settings.candidateCount)||3);
    return out.slice(0, count);
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
      this.storage.log('warn', 'Failed to apply profile', { profile: profileName, mode: settings.winwsMode, res });
    }
    return res;
  }

  async autoSwitch(reason) {
    const settings = this.storage.loadSettings();
    if (!settings.autoSwitchEnabled && reason !== 'manual') return { ok: false, reason: 'auto-switch disabled' };
    const now = Date.now();
    const cooldown = Math.max(60, Number(settings.cooldownSec)||600) * 1000;
    if (reason !== 'manual' && now - this.lastSwitchAt < cooldown) {
      this.storage.log('info', 'Auto-switch skipped (cooldown)', { reason });
      return { ok: false, reason: 'cooldown' };
    }

    // User-priority: manual selection locks profile. Auto-switch on degradation
    // is skipped while lock is active, unless user explicitly requested manual auto-switch.
    if (settings.manualProfileLock && reason !== 'manual') {
      this.storage.log('info', 'Auto-switch skipped: manual profile lock active', { reason, manualProfile: settings.manualProfile, activeProfile: settings.activeProfile });
      this.emit('status', { message: `Ручной профиль зафиксирован: ${settings.manualProfile || settings.activeProfile || 'unknown'}. Авто-переключение пропущено.` });
      return { ok: false, reason: 'manual-lock' };
    }

    const prev = settings.activeProfile;
    const candidatesRaw = this.getCandidates(settings);
    let candidates = [prev, ...candidatesRaw.filter(p => p !== prev)].filter(Boolean);
    // If manual auto-switch requested, try current first but allow alternatives.
    if (!candidates.length) return { ok: false, reason: 'no candidates' };

    this.storage.log('warn', 'Starting auto-switch', { reason, from: prev, candidates });
    for (const cand of candidates) {
      this.emit('status', { message: `Пробую профиль: ${cand}` });
      const applyRes = await this.applyProfile(cand, settings);
      if (!applyRes || !applyRes.ok) {
        this.storage.appendEvent({ type: 'switch_attempt', from: prev, to: cand, ok: false, applyRes });
        const accessErr = applyRes && (applyRes.requiresAdmin || applyRes.code === 'EACCES' || applyRes.code === 'EPERM' || /Administrator|EACCES|access/i.test(String(applyRes.message || '')));
        if (accessErr) {
          this.lastSwitchAt = Date.now();
          this.storage.log('warn', 'Auto-switch stopped: admin/access required', { profile: cand, message: applyRes.message });
          this.emit('status', { message: 'Нужны права администратора для запуска winws/службы' });
          return { ok: false, reason: 'admin-required', message: applyRes.message };
        }
        continue;
      }
      await sleep(4500);
      const check = await this.probeOnce('post-switch');
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
        this.storage.appendEvent({ type: 'switch', from: prev, to: cand, ok: true, check: { ok: check.overallOk, okCount: check.okCount, total: check.total } });
        this.storage.log('info', 'Auto-switch succeeded', { to: cand, reason });
        this.emit('status', { message: `??????? ????????: ${cand}` });
        return { ok: true, profile: cand };
      } else {
        ps.fail++; ps.lastFailTs = check.ts; stats.profiles[cand] = ps; this.storage.saveStats(stats);
        this.storage.appendEvent({ type: 'switch_attempt', from: prev, to: cand, ok: false, check: { ok: check.overallOk } });
        this.storage.log('warn', 'Candidate did not pass quick check', { cand });
      }
    }

    if (prev && !candidates.includes(prev)) {
      this.storage.log('warn', 'Rolling back to previous profile', { prev });
      await this.applyProfile(prev, settings);
    }
    this.lastSwitchAt = Date.now();
    return { ok: false, reason: 'no candidate passed' };
  }

  async tick(reason = 'interval') {
    if (!this.running || this.busy) return;
    this.busy = true;
    try {
      const settings = this.storage.loadSettings();
      const check = await this.probeOnce(reason);
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
