const { spawn, execFile } = require('child_process');
const net = require('net');
const path = require('path');

function tcpReachable(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port });
    let done = false;
    const finish = (ok) => { if (done) return; done = true; try { s.destroy(); } catch {} resolve(ok); };
    s.setTimeout(timeoutMs);
    s.on('connect', () => finish(true));
    s.on('timeout', () => finish(false));
    s.on('error', () => finish(false));
    s.on('close', () => finish(false));
  });
}

function isProcessRunning(name) {
  return new Promise((resolve) => {
    execFile('tasklist.exe', ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      const out = String(stdout || '').toLowerCase();
      resolve(out.includes(name.toLowerCase()));
    });
  });
}

function defaultRun(cmd) {
  return new Promise((resolve) => {
    const isTasklist = String(cmd).toLowerCase().includes('tasklist');
    const file = isTasklist ? 'tasklist.exe' : 'netstat.exe';
    const args = isTasklist
      ? ['/FI', 'IMAGENAME eq TgWsProxy_windows.exe', '/FO', 'CSV', '/NH']
      : ['-ano', '-p', 'tcp'];
    execFile(file, args, { timeout: 7000, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function parseProxyPids(output) {
  const pids = new Set();
  for (const line of String(output || '').split(/\r?\n/)) {
    const m = line.match(/"TgWsProxy_windows\.exe"\s*,\s*"(\d+)"/i);
    if (m) pids.add(Number(m[1]));
  }
  return [...pids];
}

function countProxyUpstream(output, pids) {
  const pidSet = new Set(pids.map(Number));
  let synSent = 0;
  let established = 0;
  for (const line of String(output || '').split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || !/^tcp/i.test(parts[0])) continue;
    const pid = Number(parts[parts.length - 1]);
    if (!pidSet.has(pid)) continue;
    const state = String(parts[parts.length - 2] || '').toUpperCase();
    const foreignPort = Number(String(parts[parts.length - 3] || '').replace(/^.*:/, ''));
    if (state === 'SYN_SENT' && foreignPort === 443) synSent++;
    else if (state === 'ESTABLISHED' && foreignPort === 443) established++;
  }
  return { synSent, established };
}

class TgProxyManager {
  constructor(runtimeDir, storage, options = {}) {
    this.runtimeDir = runtimeDir;
    this.storage = storage;
    this.run = options.run || defaultRun;
    this.maxSynSent = Number(options.maxSynSent) || 60;
    this.unhealthyHits = 0;
    this.proc = null;
    this.exeName = 'TgWsProxy_windows.exe';
    this.lastHealth = null;
  }

  proxyLink(cfg) {
    const { host, port, secret } = cfg;
    return `https://t.me/proxy?server=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}&secret=${encodeURIComponent(secret)}`;
  }

  async status(cfg) {
    const running = await isProcessRunning(this.exeName);
    const reachable = await tcpReachable(cfg.host, Number(cfg.port));
    return { running, reachable, host: cfg.host, port: Number(cfg.port), secret: cfg.secret, link: this.proxyLink(cfg) };
  }

  async upstreamHealth() {
    const tasklist = await this.run('tasklist');
    const pids = parseProxyPids(tasklist.stdout);
    let counts = { synSent: 0, established: 0 };
    if (pids.length) {
      const netstat = await this.run('netstat');
      counts = countProxyUpstream(netstat.stdout, pids);
    }
    // Idle proxy legitimately has zero upstream connections; only a pile-up of
    // unanswered SYNs indicates a broken upstream. Requiring established > 0
    // would restart an idle proxy in a loop.
    const healthy = pids.length > 0 && counts.synSent < this.maxSynSent;
    this.lastHealth = { pids, ...counts, healthy, checkedAt: new Date().toISOString() };
    return this.lastHealth;
  }

  async ensureHealthy() {
    let health;
    try {
      health = await this.upstreamHealth();
    } catch (e) {
      this.storage.log('warn', 'TgWsProxy health check failed', { error: e.message });
      return { restarted: false, health: this.lastHealth };
    }
    if (health.healthy) {
      if (this.unhealthyHits) this.storage.log('info', 'TgWsProxy upstream recovered', { afterHits: this.unhealthyHits });
      this.unhealthyHits = 0;
      return { restarted: false, health };
    }
    this.unhealthyHits++;
    this.storage.log('warn', 'TgWsProxy upstream degraded', {
      unhealthyHits: this.unhealthyHits,
      synSent: health.synSent,
      established: health.established,
      pids: health.pids,
    });
    if (this.unhealthyHits < 2) return { restarted: false, health };
    this.unhealthyHits = 0;
    const stopped = await this.stop();
    const cfg = this.storage.loadSettings().tgProxy || { host: '127.0.0.1', port: 1080 };
    const started = await this.start(cfg);
    this.storage.log('warn', 'TgWsProxy restarted by watchdog', { stopped, started });
    return { restarted: true, health, stopped, started };
  }

  async start(cfg) {
    const exe = path.join(this.runtimeDir, this.exeName);
    const already = await isProcessRunning(this.exeName);
    if (already) {
      this.storage.log('info', 'TgWsProxy already running');
      return { ok: true, already: true };
    }
    try {
      const child = spawn(exe, [], {
        cwd: this.runtimeDir,
        windowsHide: false, // may have tray UI
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      this.proc = child;
      this.storage.log('info', 'TgWsProxy started', { exe });
      // wait a bit and check reachability
      await new Promise(r => setTimeout(r, 2000));
      const st = await this.status(cfg);
      return { ok: st.running || st.reachable, status: st };
    } catch (e) {
      this.storage.log('error', 'Failed to start TgWsProxy', { error: e.message });
      return { ok: false, error: e.message };
    }
  }

  async stop() {
    const { execFile } = require('child_process');
    return new Promise((resolve) => {
      execFile('taskkill.exe', ['/IM', this.exeName, '/F'], { windowsHide: true, timeout: 10000 }, (err, stdout, stderr) => {
        const msg = String(stdout || stderr || '');
        const ok = !err || /not found/i.test(msg);
        if (ok) this.storage.log('info', 'TgWsProxy stopped');
        else this.storage.log('warn', 'TgWsProxy stop issue', { error: err && err.message, msg });
        this.proc = null;
        resolve({ ok, message: msg.trim() });
      });
    });
  }
}

module.exports = { TgProxyManager, tcpReachable, parseProxyPids, countProxyUpstream };
