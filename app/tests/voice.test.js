const test = require('node:test');
const assert = require('node:assert/strict');
const { VoiceDetector } = require('../src/voice');

function fakeRunner(map) {
  return (cmd) => {
    const key = String(cmd).toLowerCase().includes('tasklist') ? 'tasklist' : 'netstat';
    return Promise.resolve({ ok: true, stdout: map[key] || '', stderr: '' });
  };
}

test('inactive when no Discord pids', async () => {
  const v = new VoiceDetector({ run: fakeRunner({ tasklist: '', netstat: '' }) });
  const r = await v.check();
  assert.equal(r.active, false);
  assert.deepEqual(r.pids, []);
});

test('requires two consecutive positive checks', async () => {
  const out = {
    tasklist: '"Discord.exe","1234","Console","1","50 MB"\r\n',
    netstat: 'UDP 0.0.0.0:50000 3.5.140.1:50001 1234\r\n',
  };
  const v = new VoiceDetector({ run: fakeRunner(out) });
  assert.equal((await v.check()).active, false);
  assert.equal((await v.check()).active, true);
});

test('clears after timeout when endpoints vanish', async () => {
  const out = {
    tasklist: '"Discord.exe","1234","Console","1","50 MB"\r\n',
    netstat: 'UDP 0.0.0.0:50000 3.5.140.1:50001 1234\r\n',
  };
  const v = new VoiceDetector({ run: fakeRunner(out), clearMs: 10 });
  await v.check(); await v.check();
  assert.equal(v.isActive(), true);
  const v2 = new VoiceDetector({
    run: fakeRunner({ tasklist: out.tasklist, netstat: '' }),
    clearMs: 10,
  });
  v2.lastActiveAt = Date.now() - 20;
  v2.active = true;
  const r = await v2.check();
  assert.equal(r.active, false);
});

test('ignores Discord QUIC on UDP/443', async () => {
  const out = {
    tasklist: '"Discord.exe","1234","Console","1","50 MB"\r\n',
    netstat: 'UDP 0.0.0.0:61957 162.159.135.232:443 1234\r\n',
  };
  const v = new VoiceDetector({ run: fakeRunner(out) });
  await v.check(); await v.check();
  assert.equal(v.isActive(), false);
  assert.equal(v.snapshot().endpointCount, 0);
});

test('parses localized headers, IPv6 voice and ignores wildcard/loopback', async () => {
  const out = {
    tasklist: '"Discord.exe","1234","Console","1","50 MB"\r\n',
    netstat: [
      'Адрес локальный      Адрес удалённый      Состояние  PID',
      'UDP  [::]:62000      [2001:db8::1]:50002  1234',
      'UDP  0.0.0.0:62001   *:*                   1234',
      'UDP  127.0.0.1:62002  127.0.0.1:50003     1234',
    ].join('\r\n'),
  };
  const v = new VoiceDetector({ run: fakeRunner(out) });
  await v.check(); await v.check();
  assert.equal(v.isActive(), true);
  assert.equal(v.snapshot().endpointCount, 1);
});

test('inactive when command runner rejects', async () => {
  const v = new VoiceDetector({ run: () => Promise.reject(new Error('boom')) });
  const r = await v.check();
  assert.equal(r.active, false);
  assert.equal(r.reason, 'boom');
});
