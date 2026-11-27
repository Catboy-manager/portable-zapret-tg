const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { redact, redactUrl, rotateIfNeeded, systemInfo } = require('../src/telemetry');
const { Storage } = require('../src/storage');

test('redact removes sensitive keys recursively', () => {
  const out = redact({
    secret: 'TEST_SECRET_VALUE',
    nested: { token: 'abc', password: 'pw', host: '127.0.0.1', port: 1080 },
    link: 'https://t.me/proxy?server=127.0.0.1&port=1080&secret=TEST_SECRET_VALUE',
  });
  assert.equal(JSON.stringify(out).includes('TEST_SECRET_VALUE'), false);
  assert.equal(JSON.stringify(out).includes('abc'), false);
  assert.equal(JSON.stringify(out).includes('pw'), false);
  assert.equal(out.nested.host, '127.0.0.1');
  assert.equal(out.nested.port, 1080);
  assert.match(out.link, /secret=\[REDACTED\]/);
});

test('systemInfo contains locale and runtime context', () => {
  const info = systemInfo('C:/app', { event: 'app_start' });
  assert.equal(info.event, 'app_start');
  assert.equal(info.baseDir, 'C:/app');
  assert.ok(info.systemLocale);
  assert.ok(info.preferredLanguages);
  assert.ok(info.node);
  assert.ok(info.platform);
});

test('systemInfo honors an explicit packaged flag', () => {
  assert.equal(systemInfo('C:/app', { packaged: true }).packaged, true);
});

test('redact masks sensitive keys inside stringified log data', () => {
  const secret = 'SECRET_VALUE';
  const json = JSON.stringify({ started: { status: { secret, link: `https://t.me/proxy?secret=${secret}` } } });
  const out = redact(json);
  assert.equal(out.includes(secret), false);
  assert.match(out, /secret=\[REDACTED\]/);
});

test('redact masks secrets embedded in raw log lines', () => {
  const secret = 'RAW_LOG_SECRET';
  const line = `[2026-11-27] [warn] restart {"secret":"${secret}","link":"https://t.me/proxy?secret=${secret}"}`;
  const out = redact(line);
  assert.equal(out.includes(secret), false);
  assert.match(out, /secret=\[REDACTED\]/);
});

test('rotateIfNeeded rotates at threshold and keeps three backups', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-rot-'));
  const file = path.join(dir, 'telemetry.jsonl');
  fs.writeFileSync(file, 'x'.repeat(100));
  assert.equal(rotateIfNeeded(file, 100, 3), true);
  assert.equal(fs.existsSync(file), false);
  assert.ok(fs.existsSync(file + '.1'));
  fs.writeFileSync(file, 'y'.repeat(100));
  assert.equal(rotateIfNeeded(file, 100, 3), true);
  assert.ok(fs.existsSync(file + '.1'));
  assert.ok(fs.existsSync(file + '.2'));
});

test('Storage streams append redacted rows and settings toggle works', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-storage-'));
  const storage = new Storage(dir);
  storage.recordDiagnostics({ kind: 'check', detail: { secret: 'SECRET_VALUE', ok: true } });
  storage.recordTelemetry('ui', { id: 'btnApply', secret: 'SECRET_VALUE' });
  const rows = storage.readRecentDiagnostics();
  const tel = storage.readRecentTelemetry();
  assert.equal(rows.length, 1);
  assert.equal(tel.length, 1);
  assert.equal(JSON.stringify(rows).includes('SECRET_VALUE'), false);
  assert.equal(JSON.stringify(tel).includes('SECRET_VALUE'), false);
  storage.saveSettings({ ...storage.getDefaultSettings(), telemetryEnabled: false });
  assert.equal(storage.recordTelemetry('ui', { id: 'btnRefresh' }), null);
});

test('Storage.log and appendEvent redact secrets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-logs-'));
  const storage = new Storage(dir);
  const secret = 'SECRET_VALUE';
  storage.log('warn', 'TgWsProxy restarted', { started: { status: { secret, link: `https://t.me/proxy?secret=${secret}` } } });
  storage.appendEvent({ type: 'tg_watchdog', started: { secret } });
  const logs = storage.readRecentLogs(10).join('\n');
  const events = JSON.stringify(storage.readEvents(10));
  assert.equal(logs.includes(secret), false);
  assert.equal(events.includes(secret), false);
});
