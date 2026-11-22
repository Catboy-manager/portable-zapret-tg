const { spawn } = require('child_process');
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
    const { execFile } = require('child_process');
    execFile('tasklist.exe', ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      const out = String(stdout || '').toLowerCase();
      resolve(out.includes(name.toLowerCase()));
    });
  });
}

class TgProxyManager {
  constructor(runtimeDir, storage) {
    this.runtimeDir = runtimeDir;
    this.storage = storage;
    this.proc = null;
    this.exeName = 'TgWsProxy_windows.exe';
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

module.exports = { TgProxyManager, tcpReachable };
