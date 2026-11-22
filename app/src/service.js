const { execFile } = require('child_process');
const path = require('path');

const SERVICE = 'zapret';

function run(file, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const out = String(stdout || '');
      const err = String(stderr || '');
      resolve({
        ok: !error,
        error: error ? error.message : null,
        code: error && typeof error.code !== 'undefined' ? error.code : 0,
        stdout: out,
        stderr: err,
        out: (out + '\n' + err).trim(),
      });
    });
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function queryService() {
  const r = await run('sc.exe', ['query', SERVICE], 10000);
  const out = r.out || '';
  const notInstalled = /specified service does not exist|openservice failed|1060/i.test(out);
  const installed = !notInstalled && (/SERVICE_NAME/i.test(out) || /STATE/i.test(out));
  const running = /\bRUNNING\b/i.test(out);
  const startPending = /START_PENDING/i.test(out);
  const stopPending = /STOP_PENDING/i.test(out);
  const stopped = /\bSTOPPED\b/i.test(out);
  return { installed, running, startPending, stopPending, stopped, raw: out };
}

async function getInstalledStrategy() {
  const r = await run('reg.exe', ['query', 'HKLM\\System\\CurrentControlSet\\Services\\zapret', '/v', 'zapret-discord-youtube'], 10000);
  const m = (r.stdout || '').match(/zapret-discord-youtube\s+REG_SZ\s+(.+)/i);
  return m ? m[1].trim() : null;
}

async function tcpEnable() {
  return await run('netsh.exe', ['interface', 'tcp', 'set', 'global', 'timestamps=enabled'], 15000);
}

async function stopService() {
  const r1 = await run('sc.exe', ['stop', SERVICE], 20000);
  await delay(1200);
  const q = await queryService();
  // if still running try net stop as fallback
  if (q.running || q.stopPending) {
    await run('net.exe', ['stop', SERVICE], 20000);
    await delay(1200);
  }
  const q2 = await queryService();
  return { ok: !q2.running && !q2.startPending, ...r1, state: q2 };
}

async function deleteService() {
  await stopService();
  const r = await run('sc.exe', ['delete', SERVICE], 15000);
  // wait until removed
  for (let i = 0; i < 8; i++) {
    const q = await queryService();
    if (!q.installed) return { ok: true, ...r, state: q };
    await delay(500);
  }
  const q = await queryService();
  return { ok: !q.installed, ...r, state: q };
}

function buildBinPathValue(parsed) {
  // sc expects: binPath= "\"C:\path\winws.exe\" arg1 arg2"
  // The value itself is the command line with quoted exe path.
  const args = parsed.argsString || '';
  return `\\"${parsed.exe}\\"${args ? ' ' + args : ''}`;
}

function isAccessDenied(res) {
  const out = ((res && res.out) || '') + ' ' + ((res && res.error) || '');
  return /access is denied|FAILED\s*5\b|OpenService FAILED\s*5/i.test(out);
}

async function installService(profileName, parsed) {
  await tcpEnable();
  await run('taskkill.exe', ['/IM', 'winws.exe', '/F'], 10000);
  await deleteService();

  const binPathValue = buildBinPathValue(parsed);
  const create = await run('sc.exe', [
    'create', SERVICE,
    'binPath=', binPathValue,
    'DisplayName=', 'zapret',
    'start=', 'auto'
  ], 20000);

  if (isAccessDenied(create)) {
    const q = await queryService();
    return { ok: false, step: 'create', ...create, state: q, hint: 'Administrator rights required to install service' };
  }
  if (!create.ok) {
    // sometimes delete not fully settled; retry once
    await delay(1500);
    await deleteService();
    const create2 = await run('sc.exe', [
      'create', SERVICE,
      'binPath=', binPathValue,
      'DisplayName=', 'zapret',
      'start=', 'auto'
    ], 20000);
    if (!create2.ok) {
      if (isAccessDenied(create2)) {
        const q = await queryService();
        return { ok: false, step: 'create', ...create2, state: q, hint: 'Administrator rights required to install service' };
      }
      const q = await queryService();
      return { ok: false, step: 'create', ...create2, state: q };
    }
  }

  await run('sc.exe', ['description', SERVICE, 'Zapret DPI bypass software'], 10000);
  const start = await run('sc.exe', ['start', SERVICE], 25000);

  const reg = await run('reg.exe', [
    'add', 'HKLM\\System\\CurrentControlSet\\Services\\zapret',
    '/v', 'zapret-discord-youtube',
    '/t', 'REG_SZ',
    '/d', String(profileName).replace(/"/g, ''),
    '/f'
  ], 10000);

  // wait for running
  let q = await queryService();
  for (let i = 0; i < 10 && !q.running && (q.startPending || q.installed); i++) {
    await delay(700);
    q = await queryService();
    if (q.running) break;
  }
  const accessIssue = isAccessDenied(start) || isAccessDenied(reg);
  const ok = q.running || q.startPending;
  return { ok, create, start, reg, state: q, hint: !ok && accessIssue ? 'Administrator rights required to install/start service' : (!ok ? (start.out || start.error || 'Service did not enter RUNNING state') : null) };
}

async function startService() {
  const r = await run('sc.exe', ['start', SERVICE], 25000);
  let q = await queryService();
  for (let i = 0; i < 8 && !q.running && q.startPending; i++) {
    await delay(700);
    q = await queryService();
  }
  return { ok: q.running || q.startPending || r.ok, ...r, state: q };
}

async function removeServicesAndCleanup() {
  await stopService();
  await deleteService();
  await run('taskkill.exe', ['/IM', 'winws.exe', '/F'], 10000);
  await run('sc.exe', ['stop', 'WinDivert'], 10000);
  await delay(500);
  await run('sc.exe', ['delete', 'WinDivert'], 10000);
  return { ok: true, state: await queryService() };
}

module.exports = { queryService, getInstalledStrategy, installService, startService, stopService, deleteService, removeServicesAndCleanup, tcpEnable, run };
