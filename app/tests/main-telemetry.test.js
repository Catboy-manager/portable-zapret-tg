const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

test('native menu is disabled without disabling the window frame', () => {
  assert.match(main, /Menu\.setApplicationMenu\(null\)/);
  assert.doesNotMatch(main, /frame\s*:\s*false/);
});

test('IPC wrapper and new channels are registered', () => {
  assert.match(main, /registerHandler\(/);
  assert.match(main, /registerHandler\('getDiagnostics'/);
  assert.match(main, /registerHandler\('trackUi'/);
  assert.match(preload, /getDiagnostics:/);
  assert.match(preload, /trackUi:/);
});

test('export includes diagnostics and telemetry', () => {
  assert.match(main, /diagnostics:\s*storage\.readRecentDiagnostics/);
  assert.match(main, /telemetry:\s*storage\.readRecentTelemetry/);
});

test('export redacts status before writing', () => {
  assert.match(main, /status:\s*redact\(await getStatus\(\)\)/);
});

test('export redacts the final object including logs and events', () => {
  assert.match(main, /JSON\.stringify\(redact\(diag\)/);
});

test('app_start records the packaged flag', () => {
  assert.match(main, /packaged:\s*app\.isPackaged/);
});
