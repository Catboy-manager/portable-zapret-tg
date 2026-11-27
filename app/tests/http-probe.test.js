const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { httpProbe } = require('../src/monitor');

test('httpProbe treats 5xx as failed but still records status, latency and content-length', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(503, { 'Content-Length': '5' });
    res.end('error');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/probe`;
    const r = await httpProbe(url, 2000);
    assert.equal(r.ok, false);
    assert.equal(r.status, 503);
    assert.equal(r.bytes, 5);
    assert.ok(typeof r.ms === 'number' && r.ms >= 0);
  } finally {
    server.close();
  }
});

test('httpProbe accepts only 2xx responses', async () => {
  const statuses = [301, 303, 404, 200];
  const server = http.createServer((req, res) => {
    const status = Number(req.url.slice(1));
    res.writeHead(status, { 'Content-Length': '0' });
    res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}/`;
    const results = [];
    for (const status of statuses) results.push(await httpProbe(base + status, 2000));
    assert.deepEqual(results.map(r => r.ok), [false, false, false, true]);
    assert.deepEqual(results.map(r => r.status), statuses);
  } finally {
    server.close();
  }
});

test('httpProbe records error code on refused connection', async () => {
  const r = await httpProbe('http://127.0.0.1:1/nope', 1000);
  assert.equal(r.ok, false);
  assert.ok(r.errorCode);
});
