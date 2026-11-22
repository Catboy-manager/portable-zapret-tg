const fs = require('fs');
const path = require('path');

class Storage {
  constructor(baseDir) {
    this.baseDir = baseDir; // portable-zapret-tg root
    this.paths = {
      config: path.join(baseDir, 'config'),
      history: path.join(baseDir, 'history'),
      logs: path.join(baseDir, 'logs'),
      runtime: path.join(baseDir, 'runtime'),
    };
    for (const p of Object.values(this.paths)) fs.mkdirSync(p, { recursive: true });
    this.settingsFile = path.join(this.paths.config, 'settings.json');
    this.stateFile = path.join(this.paths.config, 'state.json');
    this.statsFile = path.join(this.paths.history, 'stats.json');
    this.eventsFile = path.join(this.paths.history, 'events.jsonl');
    this.logFile = path.join(this.paths.logs, 'app.log');
  }

  readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  }
  writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }

  getDefaultSettings() {
    return {
      autoSelect: true,
      autoSwitchEnabled: true,
      monitorIntervalSec: 120,
      probeTimeoutMs: 6000,
      failThreshold: 3,
      cooldownSec: 600,
      candidateCount: 3,
      winwsMode: 'user', // 'user' | 'service'
      tgAutoStart: true,
      tgProxy: { host: '127.0.0.1', port: 1080, secret: 'ddbc1753f4dbbe96206ff2bbdbfddbd539' },
      lastGoodProfile: 'general (SIMPLE FAKE).bat',
      activeProfile: null,
      manualProfileLock: false,
      manualProfile: null,
    };
  }

  loadSettings() {
    const d = this.getDefaultSettings();
    const s = this.readJson(this.settingsFile, {});
    return { ...d, ...s, tgProxy: { ...d.tgProxy, ...(s.tgProxy || {}) } };
  }
  saveSettings(settings) { this.writeJson(this.settingsFile, settings); }

  loadState() { return this.readJson(this.stateFile, { running: false }); }
  saveState(state) { this.writeJson(this.stateFile, state); }

  loadStats() { return this.readJson(this.statsFile, { profiles: {}, targets: {} }); }
  saveStats(stats) { this.writeJson(this.statsFile, stats); }

  appendEvent(event) {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
    fs.appendFileSync(this.eventsFile, line, 'utf8');
  }

  log(level, message, meta) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] ${message}${meta ? ' ' + JSON.stringify(meta) : ''}\n`;
    try { fs.appendFileSync(this.logFile, line, 'utf8'); } catch {}
    this.appendEvent({ type: 'log', level, message, meta: meta || null });
    return { ts, level, message, meta: meta || null };
  }

  readRecentLogs(maxLines = 300) {
    try {
      const text = fs.readFileSync(this.logFile, 'utf8');
      const lines = text.trimEnd().split(/\r?\n/);
      return lines.slice(-maxLines);
    } catch { return []; }
  }

  readEvents(max = 500) {
    try {
      const text = fs.readFileSync(this.eventsFile, 'utf8');
      const lines = text.trimEnd().split(/\r?\n/).filter(Boolean);
      return lines.slice(-max).map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
    } catch { return []; }
  }
}

module.exports = { Storage };
