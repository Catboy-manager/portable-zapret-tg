const { execFile } = require('child_process');

function defaultRun(cmd) {
  return new Promise((resolve) => {
    const isTasklist = String(cmd).toLowerCase().includes('tasklist');
    const file = isTasklist ? 'tasklist.exe' : 'netstat.exe';
    const args = isTasklist
      ? ['/FI', 'IMAGENAME eq Discord.exe', '/FO', 'CSV', '/NH']
      : ['-ano', '-p', 'udp'];
    execFile(file, args, { timeout: 5000, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function remotePort(addr) {
  const m = String(addr || '').match(/:(\d+)$/);
  return m ? Number(m[1]) : null;
}

function isNonLocalForeign(addr) {
  if (!addr) return false;
  const value = String(addr).trim();
  if (!value || value === '*:*' || value === '0.0.0.0:0' || value === '0.0.0.0' || value === '*' ) return false;
  if (/^(127\.|localhost:|\[::1\]|::1)/i.test(value)) return false;
  const host = value.replace(/:(\d+)$/, '').replace(/^\[|\]$/g, '');
  if (/^(0\.0\.0\.0|::|\*)$/i.test(host)) return false;
  return true;
}

function isDiscordVoiceEndpoint(addr) {
  if (!isNonLocalForeign(addr)) return false;
  // Discord voice/media uses UDP 50000-65535. UDP/443 is QUIC/HTTP3 for normal
  // Discord API traffic and must not suppress automatic switching.
  const port = remotePort(addr);
  return port !== null && port >= 50000 && port <= 65535;
}

class VoiceDetector {
  constructor({ run, clearMs = 180000, minHits = 2 } = {}) {
    this.run = run || defaultRun;
    this.clearMs = Number(clearMs) || 180000;
    this.minHits = Math.max(1, Number(minHits) || 2);
    this.active = false;
    this.hits = 0;
    this.pids = [];
    this.endpointCount = 0;
    this.lastActiveAt = 0;
    this.lastError = null;
  }

  parsePids(output) {
    const pids = new Set();
    for (const line of String(output || '').split(/\r?\n/)) {
      const m = line.match(/"Discord(?:Canary|PTB)?\.exe"\s*,\s*"(\d+)"/i);
      if (m) pids.add(Number(m[1]));
    }
    return [...pids];
  }

  countEndpoints(output, pids) {
    const pidSet = new Set(pids.map(Number));
    let count = 0;
    for (const line of String(output || '').split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      if (!/^udp/i.test(parts[0])) continue;
      const pid = Number(parts[parts.length - 1]);
      const foreign = parts[parts.length - 2];
      if (pidSet.has(pid) && isDiscordVoiceEndpoint(foreign)) count++;
    }
    return count;
  }

  async check() {
    try {
      const tasklist = await this.run('tasklist');
      const pids = this.parsePids(tasklist.stdout);
      let endpointCount = 0;
      if (pids.length) {
        const netstat = await this.run('netstat');
        endpointCount = this.countEndpoints(netstat.stdout, pids);
      }
      const now = Date.now();
      this.pids = pids;
      this.endpointCount = endpointCount;
      this.lastError = null;
      if (endpointCount > 0) {
        this.hits += 1;
        this.lastActiveAt = now;
        if (this.hits >= this.minHits) this.active = true;
      } else {
        this.hits = 0;
        if (this.active && now - this.lastActiveAt >= this.clearMs) this.active = false;
      }
    } catch (e) {
      this.lastError = e && e.message ? e.message : String(e);
      this.hits = 0;
      this.endpointCount = 0;
      if (this.active && Date.now() - this.lastActiveAt >= this.clearMs) this.active = false;
    }
    return this.snapshot();
  }

  isActive() {
    return !!this.active && Date.now() - this.lastActiveAt < this.clearMs;
  }

  snapshot() {
    return {
      active: this.isActive(),
      pids: [...this.pids],
      endpointCount: this.endpointCount,
      lastActiveAt: this.lastActiveAt,
      hits: this.hits,
      reason: this.lastError,
    };
  }
}

module.exports = { VoiceDetector, isNonLocalForeign, isDiscordVoiceEndpoint };
