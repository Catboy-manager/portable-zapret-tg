const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogThrottle } = require('../src/log-throttle');

test('createLogThrottle emits the first line immediately', () => {
  const t = createLogThrottle(2000);
  assert.deepEqual(t.line('hostlist: added 1', 0), { text: 'hostlist: added 1', count: 1 });
});

test('createLogThrottle hides duplicates inside the window', () => {
  const t = createLogThrottle(2000);
  t.line('hostlist: added 1', 0);
  assert.equal(t.line('hostlist: added 1', 1000), null);
});

test('createLogThrottle emits an aggregate after the window', () => {
  const t = createLogThrottle(2000);
  t.line('hostlist: added 1', 0);
  t.line('hostlist: added 1', 1000);
  assert.deepEqual(t.line('hostlist: added 1', 2000), { text: 'hostlist: added 1', count: 2 });
});

test('createLogThrottle tracks different lines separately', () => {
  const t = createLogThrottle(2000);
  t.line('hostlist: added 1', 0);
  assert.deepEqual(t.line('hostlist: added 2', 100), { text: 'hostlist: added 2', count: 1 });
});
