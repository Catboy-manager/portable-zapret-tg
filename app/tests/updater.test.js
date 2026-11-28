const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  compareVersions,
  parseLatestRelease,
  verifySha256,
  planUpdate,
  buildApplyScript,
} = require('../src/updater');

function release(overrides = {}) {
  return {
    tag_name: 'v1.2.0',
    body: 'Portable build.\nSHA256: ' + 'a'.repeat(64) + '\n',
    assets: [{ name: 'ZapretTG-1.2.0-win-x64.zip', browser_download_url: 'https://github.com/Catboy-manager/portable-zapret-tg/releases/download/v1.2.0/ZapretTG-1.2.0-win-x64.zip' }],
    ...overrides,
  };
}

test('compareVersions handles numeric parts and prerelease suffixes', () => {
  assert.equal(compareVersions('1.2.0', '1.1.9'), 1);
  assert.equal(compareVersions('1.1.9', 'v1.2.0'), -1);
  assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('1.2.0-beta', '1.2.0'), 0);
});

test('parseLatestRelease extracts version, asset URL and checksum', () => {
  const r = parseLatestRelease(release());
  assert.equal(r.version, '1.2.0');
  assert.equal(r.assetName, 'ZapretTG-1.2.0-win-x64.zip');
  assert.equal(r.assetUrl, 'https://github.com/Catboy-manager/portable-zapret-tg/releases/download/v1.2.0/ZapretTG-1.2.0-win-x64.zip');
  assert.equal(r.sha256, 'a'.repeat(64));
});

test('parseLatestRelease rejects a release without SHA256 in the body', () => {
  assert.throws(() => parseLatestRelease(release({ body: 'no checksum here' })), /SHA256/);
});

test('parseLatestRelease rejects a non-version tag', () => {
  assert.throws(() => parseLatestRelease(release({ tag_name: 'latest' })), /version/);
});

test('parseLatestRelease rejects asset URLs outside GitHub', () => {
  const bad = release({ assets: [{ name: 'ZapretTG-1.2.0-win-x64.zip', browser_download_url: 'https://evil.test/payload.zip' }] });
  assert.throws(() => parseLatestRelease(bad), /host is not allowed/);
});

test('verifySha256 accepts a matching digest and rejects a mismatch', () => {
  const buf = Buffer.from('portable build');
  const digest = crypto.createHash('sha256').update(buf).digest('hex');
  assert.equal(verifySha256(buf, digest), true);
  assert.equal(verifySha256(buf, 'b'.repeat(64)), false);
  assert.equal(verifySha256(buf, 'short'), false);
});

test('planUpdate never overwrites local state and rejects zip-slip paths', () => {
  const entries = [
    'ZapretTG.exe',
    'resources/app.asar',
    'config/settings.json',
    'history/events.jsonl',
    'logs/app.log',
    'RUN_AS_ADMIN.txt',
    'runtime/general.bat',
  ];
  const plan = planUpdate(entries);
  assert.deepEqual(plan.replace, ['ZapretTG.exe', 'resources/app.asar', 'runtime/general.bat']);
  assert.deepEqual(plan.preserve, ['config/settings.json', 'history/events.jsonl', 'logs/app.log', 'RUN_AS_ADMIN.txt']);
  assert.throws(() => planUpdate(['../evil.exe']), /unsafe/i);
});

test('buildApplyScript waits for exit, retries locked files and relaunches', () => {
  const script = buildApplyScript({
    appRoot: "C:\\Apps\\Zapret'T G",
    stagingDir: 'C:\\Apps\\Zapret\\.updates\\staging',
    exeName: 'ZapretTG.exe',
    parentPid: 4242,
  });
  assert.match(script, /Get-Process -Id 4242/);
  assert.match(script, /Start-Sleep/);
  assert.match(script, /Copy-Item/);
  assert.match(script, /Zapret''T G/);
  assert.match(script, /Start-Process/);
  assert.match(script, /Remove-Item/);
});

test('buildApplyScript contains no token, password or secret', () => {
  const script = buildApplyScript({ appRoot: 'C:\\Apps\\Zapret', stagingDir: 'C:\\Apps\\Zapret\\.updates\\staging', parentPid: 1 });
  assert.doesNotMatch(script, /token|password|secret|authorization/i);
});
