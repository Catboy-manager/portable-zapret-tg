const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const monitor = fs.readFileSync(path.join(__dirname, '..', 'src', 'monitor.js'), 'utf8');

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return null;
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

test('main registers full-run IPC channels', () => {
  for (const channel of ['runAllProfiles', 'cancelRunAllProfiles', 'getProfileMatrix']) {
    assert.match(main, new RegExp(`registerHandler\\('${channel}'`));
  }
});

test('status embeds a freshly built profile matrix', () => {
  assert.match(main, /profileMatrix:\s*buildProfileMatrix\(/);
});

test('a transient apply path never persists profile settings', () => {
  const body = functionBody(main, 'applyProfileTransient');
  assert.ok(body, 'applyProfileTransient is missing');
  assert.doesNotMatch(body, /storage\.saveSettings/);
  assert.match(body, /parseProfile/);
});

test('full-run result is redacted before it reaches the renderer', () => {
  const handler = main.slice(main.indexOf("registerHandler('runAllProfiles'"));
  const section = handler.slice(0, handler.indexOf("registerHandler('", 1));
  assert.match(section, /redact\(/);
});

test('run progress is emitted to the renderer', () => {
  assert.match(main, /emit\('run-progress'/);
});

test('monitor pause/resume gates normal ticks', () => {
  assert.match(monitor, /pause\(\)/);
  assert.match(monitor, /resume\(\)/);
  assert.match(monitor, /this\.paused/);
});

test('probeOnce accepts runId and profile override', () => {
  assert.match(monitor, /async probeOnce\(reason = 'manual', runId = null, profileName = null\)/);
  assert.match(monitor, /recordDiagnostic\('check',[\s\S]*profileName\)/);
});

test('preload exposes full-run methods and progress subscription', () => {
  for (const name of ['runAllProfiles', 'cancelRunAllProfiles', 'getProfileMatrix', 'onRunProgress']) {
    assert.match(preload, new RegExp(`${name}:`));
  }
});
