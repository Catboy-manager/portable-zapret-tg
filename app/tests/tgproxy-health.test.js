const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TgProxyManager, parseProxyPids, countProxyUpstream } = require('../src/tgproxy');
const { Storage } = require('../src/storage');

const tasklist = '"TgWsProxy_windows.exe","21680"\n"TgWsProxy_windows.exe","35796"\n"Telegram.exe","3532"\n';
const netstat = [
  '  TCP    192.0.2.11   60361   104.21.33.146   443    SYN_SENT    21680',
  '  TCP    192.0.2.11   60884   104.21.33.146   443    ESTABLISHED 21680',
  '  TCP    127.0.0.1        1080    127.0.0.1       55725  ESTABLISHED 21680',
  '  TCP    192.0.2.11   60399  149.154.167.220  443    SYN_SENT    35796',
  '  TCP    192.0.2.11   60400  149.154.167.220  443    ESTABLISHED 9999',
].join('\n');

function makeStorage() {
  const events = [];
  return {
    events,
    loadSettings: () => ({ tgProxy: { host: '127.0.0.1', port: 1080 } }),
    log: (level, message, meta) => events.push({ type: 'log', level, message, meta }),
    appendEvent: (e) => events.push(e),
  };
}

function makeManager(output, maxSynSent = 60) {
  const storage = makeStorage();
  const manager = new TgProxyManager('runtime', storage, {
    maxSynSent,
    run: async (cmd) => ({
      ok: true,
      stdout: cmd === 'tasklist' ? tasklist : netstat,
      stderr: '',
    }),
  });
  return { manager, storage };
}

test('parseProxyPids extracts only TgWsProxy PIDs', () => {
  assert.deepEqual(parseProxyPids(tasklist), [21680, 35796]);
});

test('countProxyUpstream counts only proxy PIDs on remote 443', () => {
  assert.deepEqual(countProxyUpstream(netstat, [21680]), { synSent: 1, established: 1 });
  assert.deepEqual(countProxyUpstream(netstat, [21680, 35796]), { synSent: 2, established: 1 });
});

test('upstreamHealth is healthy when established exists and SYN_SENT is below limit', async () => {
  const { manager } = makeManager(netstat, 60);
  const health = await manager.upstreamHealth();
  assert.equal(health.healthy, true);
  assert.equal(health.synSent, 2);
  assert.equal(health.established, 1);
});

test('idle proxy with no upstream connections is healthy', async () => {
  const storage = makeStorage();
  const manager = new TgProxyManager('runtime', storage, {
    run: async (cmd) => ({
      ok: true,
      stdout: cmd === 'tasklist' ? tasklist : '  TCP    127.0.0.1  1080  127.0.0.1  55725  ESTABLISHED  21680',
      stderr: '',
    }),
  });
  const health = await manager.upstreamHealth();
  assert.equal(health.synSent, 0);
  assert.equal(health.established, 0);
  assert.equal(health.healthy, true);
});

test('ensureHealthy waits for two degraded checks before restarting', async () => {
  const { manager, storage } = makeManager(netstat, 1); // 2 SYN_SENT >= 1 -> degraded
  let restarts = 0;
  manager.stop = async () => { restarts++; return { ok: true }; };
  manager.start = async () => { return { ok: true }; };
  const first = await manager.ensureHealthy();
  assert.equal(first.restarted, false);
  assert.equal(restarts, 0);
  const second = await manager.ensureHealthy();
  assert.equal(second.restarted, true);
  assert.equal(restarts, 1);
  assert.ok(storage.events.some(e => e.message === 'TgWsProxy restarted by watchdog'));
});

test('healthy check resets degraded counter', async () => {
  const { manager } = makeManager(netstat, 1);
  manager.stop = async () => ({ ok: true });
  manager.start = async () => ({ ok: true });
  await manager.ensureHealthy(); // unhealthy hit 1
  manager.maxSynSent = 60;       // recovered
  const recovered = await manager.ensureHealthy();
  assert.equal(recovered.restarted, false);
  assert.equal(manager.unhealthyHits, 0);
});

test('watchdog restart never writes the proxy secret to logs or events', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-watchdog-'));
  const storage = new Storage(dir);
  const secret = 'WATCHDOG_SECRET';
  const manager = new TgProxyManager('runtime', storage, {
    maxSynSent: 1,
    run: async (cmd) => ({ ok: true, stdout: cmd === 'tasklist' ? tasklist : netstat, stderr: '' }),
  });
  manager.stop = async () => ({ ok: true });
  manager.start = async () => ({ ok: true, status: { secret, link: `https://t.me/proxy?secret=${secret}` } });
  await manager.ensureHealthy();
  await manager.ensureHealthy();
  const logs = storage.readRecentLogs(50).join('\n');
  const events = JSON.stringify(storage.readEvents(50));
  assert.equal(logs.includes(secret), false);
  assert.equal(events.includes(secret), false);
});
