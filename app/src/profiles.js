const fs = require('fs');
const path = require('path');

function readGameFilter(runtimeDir) {
  const file = path.join(runtimeDir, 'utils', 'game_filter.enabled');
  const res = { mode: 'disabled', tcp: '1024-65535', udp: '1024-65535' };
  if (!fs.existsSync(file)) return { ...res, tcpVal: '12', udpVal: '12', allVal: '12', status: 'disabled' };
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const idx = line.indexOf('=');
      const key = (idx >= 0 ? line.slice(0, idx) : line).trim().toLowerCase();
      const val = (idx >= 0 ? line.slice(idx + 1) : '').trim();
      if (key === 'mode') res.mode = val.toLowerCase() || res.mode;
      else if (key === 'all') res.mode = 'all';
      else if (key === 'tcp') {
        if (!val) res.mode = 'tcp'; else if (/^[0-9][0-9,\-]*$/.test(val)) res.tcp = val;
      } else if (key === 'udp') {
        if (!val) res.mode = 'udp'; else if (/^[0-9][0-9,\-]*$/.test(val)) res.udp = val;
      }
    }
  } catch {}
  let tcpVal = '12', udpVal = '12', allVal = '12', status = 'disabled';
  if (res.mode === 'all') { status = 'enabled (TCP and UDP)'; tcpVal = res.tcp; udpVal = res.udp; allVal = res.tcp; }
  else if (res.mode === 'tcp') { status = 'enabled (TCP)'; tcpVal = res.tcp; udpVal = '12'; allVal = res.tcp; }
  else if (res.mode === 'udp') { status = 'enabled (UDP)'; tcpVal = '12'; udpVal = res.udp; allVal = res.udp; }
  else { res.mode = 'disabled'; }
  return { mode: res.mode, tcpRange: res.tcp, udpRange: res.udp, tcpVal, udpVal, allVal, status };
}

function listProfiles(runtimeDir) {
  const files = fs.readdirSync(runtimeDir).filter(f => /^general.*\.bat$/i.test(f));
  // natural-ish sort
  files.sort((a,b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return files;
}

function readTargets(runtimeDir) {
  const file = path.join(runtimeDir, 'utils', 'targets.txt');
  const targets = [];
  if (!fs.existsSync(file)) return targets;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*"([^"]+)"/);
    if (!m) continue;
    const name = m[1];
    const value = m[2];
    if (/^PING:/i.test(value)) {
      targets.push({ name, type: 'ping', host: value.replace(/^PING:\s*/i, '').trim() });
    } else {
      try {
        const u = new URL(value);
        targets.push({ name, type: 'http', url: value, host: u.hostname, port: u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80), tls: u.protocol === 'https:' });
      } catch {
        targets.push({ name, type: 'http', url: value, host: value });
      }
    }
  }
  return targets;
}

function extractWinwsCommand(text) {
  // join caret continuations
  const rawLines = text.split(/\r?\n/);
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i];
    while (line.trimEnd().endsWith('^') && i + 1 < rawLines.length) {
      line = line.trimEnd().slice(0, -1) + ' ' + rawLines[++i].trimStart();
    }
    lines.push(line);
  }
  for (const line of lines) {
    if (/winws\.exe/i.test(line)) {
      const idx = line.toLowerCase().indexOf('winws.exe');
      if (idx >= 0) {
        // take after winws.exe" or winws.exe
        let rest = line.slice(idx + 'winws.exe'.length);
        rest = rest.replace(/^\s*"?\s*/, ''); // remove leading quote/space after exe
        return rest.trim();
      }
    }
  }
  return null;
}

function splitArgs(str) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '"') { inQ = !inQ; cur += c; }
    else if (!inQ && /\s/.test(c)) { if (cur) { out.push(cur); cur = ''; } }
    else { cur += c; }
  }
  if (cur) out.push(cur);
  return out;
}

function parseProfile(profilePath, runtimeDir) {
  const text = fs.readFileSync(profilePath, 'utf8');
  const gf = readGameFilter(runtimeDir);
  const root = runtimeDir.endsWith(path.sep) ? runtimeDir : runtimeDir + path.sep;
  const bin = path.join(runtimeDir, 'bin') + path.sep;
  const lists = path.join(runtimeDir, 'lists') + path.sep;
  let cmd = extractWinwsCommand(text);
  if (!cmd) throw new Error('winws.exe command not found in ' + profilePath);

  const replacements = new Map([
    ['%~dp0', root],
    ['%dp0', root],
    ['%BIN%', bin],
    ['%BIN_PATH%', bin],
    ['%LISTS%', lists],
    ['%LISTS_PATH%', lists],
    ['%GameFilter%', gf.allVal],
    ['%GameFilterTCP%', gf.tcpVal],
    ['%GameFilterUDP%', gf.udpVal],
  ]);
  for (const [k,v] of replacements) {
    cmd = cmd.split(k).join(v);
  }
  // cleanup any remaining simple %~dp0-like forms
  cmd = cmd.replace(/%~dp0/gi, root);

  const tokens = splitArgs(cmd);
  const args = [];
  for (let t of tokens) {
    if (!t) continue;
    let arg = t.trim();
    // strip outer quotes around whole token
    if (arg.length >= 2 && arg.startsWith('"') && arg.endsWith('"')) arg = arg.slice(1, -1);
    // strip quotes around --flag="value" or --flag=value"..." artifacts
    const eq = arg.indexOf('=');
    if (eq >= 0) {
      const k = arg.slice(0, eq + 1);
      let v = arg.slice(eq + 1);
      if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      v = v.replace(/^"+|"+$/g, '');
      arg = k + v;
    } else {
      arg = arg.replace(/^"+|"+$/g, '');
    }
    // drop empty/stray tokens
    if (!arg || arg === '^') continue;
    args.push(arg);
  }

  const exe = path.join(runtimeDir, 'bin', 'winws.exe');
  // build a windows-safe commandline string for sc/service usage
  const quote = (s) => {
    if (s === '') return '""';
    if (!/[\s"&()^|<>]/.test(s)) return s;
    return '"' + s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/,'$1$1') + '"';
  };
  const argsString = args.map(quote).join(' ');
  return { exe, args, argsString, gameFilter: gf, profileName: path.basename(profilePath) };
}

function ensureUserLists(runtimeDir) {
  const lists = path.join(runtimeDir, 'lists');
  const ensure = (name, content) => {
    const p = path.join(lists, name);
    if (!fs.existsSync(p)) fs.writeFileSync(p, content, 'utf8');
  };
  ensure('ipset-exclude-user.txt', '203.0.113.113/32\n');
  ensure('list-general-user.txt', '# user hostlist\n');
  ensure('list-exclude-user.txt', '# user exclude hostlist\n');
}

module.exports = { listProfiles, readTargets, parseProfile, readGameFilter, ensureUserLists };
