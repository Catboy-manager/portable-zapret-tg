const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const updater = fs.readFileSync(path.join(__dirname, '..', 'src', 'updater.js'), 'utf8');

function functionBody(source, name) {
  const marker = `async function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

test('main registers update IPC channels and emits progress', () => {
  for (const channel of ['getUpdateState', 'checkForUpdates', 'downloadUpdate', 'applyUpdate']) {
    assert.match(main, new RegExp(`registerHandler\\('${channel}'`));
  }
  assert.match(main, /emit\('update-progress'/);
});

test('preload exposes the update methods', () => {
  for (const name of ['getUpdateState', 'checkForUpdates', 'downloadUpdate', 'applyUpdate', 'onUpdateProgress']) {
    assert.match(preload, new RegExp(`${name}:`));
  }
});

test('update check uses the public releases endpoint without credentials', () => {
  const body = functionBody(main, 'checkForUpdates');
  assert.match(main, /RELEASES_URL = 'https:\/\/api\.github\.com\/repos\/Catboy-manager\/portable-zapret-tg\/releases\/latest'/);
  assert.match(body, /RELEASES_URL/);
  assert.match(body, /parseLatestRelease/);
  assert.match(body, /compareVersions/);
  assert.doesNotMatch(body, /Authorization|Bearer|token|password|secret/i);
});

test('download verifies the checksum before extracting', () => {
  const body = functionBody(main, 'downloadUpdate');
  assert.match(body, /verifySha256/);
  assert.match(body, /MAX_UPDATE_BYTES/);
  assert.match(body, /planUpdate/);
  assert.ok(body.indexOf('verifySha256') < body.indexOf('tar.exe'), 'hash must be checked before extraction');
});

test('download refuses asset hosts outside the GitHub allowlist', () => {
  assert.match(updater, /objects\.githubusercontent\.com/);
  assert.match(updater, /github\.com/);
});

test('apply writes a detached helper and quits the app', () => {
  const body = functionBody(main, 'applyUpdate');
  assert.match(body, /buildApplyScript/);
  assert.match(body, /spawn\(/);
  assert.match(body, /detached:\s*true/);
  assert.match(body, /app\.quit\(/);
});
