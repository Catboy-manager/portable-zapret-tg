const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { createLogThrottle } = require('./log-throttle');

function exec(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 15000, ...opts }, (error, stdout, stderr) => {
      resolve({ ok: !error, error: error ? error.message : null, code: error && error.code, stdout: String(stdout||''), stderr: String(stderr||'') });
    });
  });
}

async function isAdmin() {
  const r = await exec('net', ['session'], { timeout: 5000 });
  return !!r.ok;
}

async function isWinwsRunning() {
  const r = await exec('tasklist.exe', ['/FI', 'IMAGENAME eq winws.exe', '/FO', 'CSV', '/NH']);
  const out = (r.stdout || '').toLowerCase();
  return out.includes('winws.exe');
}

class WinwsManager {
  constructor(runtimeDir, storage) {
    this.runtimeDir = runtimeDir;
    this.storage = storage;
    this.proc = null;
    this.currentProfile = null;
    this.mode = 'stopped'; // 'user' | 'stopped'
    this.logThrottle = createLogThrottle(2000);
  }

  async status() {
    const running = await isWinwsRunning();
    return { running, mode: this.mode, currentProfile: this.currentProfile, pid: this.proc ? this.proc.pid : null };
  }

  async startUser(profile, parsed) {
    const running = await isWinwsRunning();
    if (running) await this.stopUser();

    const admin = await isAdmin();
    if (!admin) {
      const msg = 'Нужны права администратора. Запустите ZapretTG от имени администратора.';
      this.storage.log('warn', 'winws start blocked: no admin', { profile });
      return { ok: false, message: msg, code: 'NO_ADMIN', requiresAdmin: true };
    }
    if (!fs.existsSync(parsed.exe)) {
      const msg = 'winws.exe не найден: ' + parsed.exe;
      this.storage.log('error', 'winws missing', { profile, exe: parsed.exe });
      return { ok: false, message: msg, code: 'MISSING_EXE' };
    }

    return await new Promise((resolve) => {
      try {
        this.logThrottle = createLogThrottle(2000);
        let stderrTail = '';
        let exitCode = null;
        const child = spawn(parsed.exe, parsed.args, {
          cwd: path.join(this.runtimeDir, 'bin'),
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
        });
        this.proc = child;
        this.currentProfile = profile;
        this.mode = 'user';
        let resolved = false;
        const done = (ok, msg, extra) => { if (resolved) return; resolved = true; resolve({ ok, message: msg, ...(extra||{}) }); };

        const logChunk = (level, chunk) => {
          const text = chunk.toString().trim();
          if (level === 'winws_err') stderrTail = `${stderrTail}\n${text}`.slice(-2000);
          const entry = this.logThrottle.line(text);
          if (entry) this.storage.log(level, entry.count > 1 ? `${entry.text} (x${entry.count})` : entry.text);
        };
        child.stdout.on('data', d => logChunk('winws', d));
        child.stderr.on('data', d => logChunk('winws_err', d));
        child.on('error', err => {
          this.storage.log('error', 'winws spawn error', { error: err.message, code: err.code, profile });
          this.proc = null; this.mode = 'stopped';
          const isAccess = err.code === 'EACCES' || err.code === 'EPERM' || /access/i.test(err.message || '');
          const msg = isAccess
            ? 'Нет доступа к winws.exe (EACCES). Запустите приложение от имени администратора и проверьте антивирус/блокировку файла.'
            : err.message;
          done(false, msg, { code: err.code, requiresAdmin: isAccess });
        });
        child.on('exit', (code, sig) => {
          exitCode = code;
          this.storage.log('info', 'winws exited', { code, sig, profile });
          if (this.proc === child) { this.proc = null; this.mode = 'stopped'; }
        });
        setTimeout(async () => {
          const up = await isWinwsRunning();
          if (up) { this.storage.log('info', 'winws started (user mode)', { profile }); done(true, 'started'); }
          else if (!resolved) done(false, 'winws не запустился. Нужны права администратора и доступ к WinDivert/драйверу. Проверьте логи.', { exitCode, stderrTail });
        }, 1500);
      } catch (e) {
        const isAccess = e.code === 'EACCES' || e.code === 'EPERM';
        resolve({ ok: false, message: e.message, code: e.code, requiresAdmin: isAccess });
      }
    });
  }

  async stopUser() {
    try {
      if (this.proc && !this.proc.killed) {
        this.proc.kill();
      }
    } catch {}
    // ensure no stray instances
    await exec('taskkill.exe', ['/IM', 'winws.exe', '/F']);
    this.proc = null;
    this.mode = 'stopped';
    this.storage.log('info', 'winws stopped (user mode)');
    return { ok: true };
  }

  async killAll() {
    await exec('taskkill.exe', ['/IM', 'winws.exe', '/F']);
    return { ok: true };
  }
}

module.exports = { WinwsManager, isWinwsRunning, isAdmin, exec };
