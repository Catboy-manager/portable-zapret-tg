const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldElevate, buildElevateCommand } = require('../main-helpers');

test('does not relaunch when --elevated present', () => {
  assert.equal(shouldElevate(false, ['node', 'app', '--elevated']), false);
});

test('does not relaunch when already admin', () => {
  assert.equal(shouldElevate(true, ['node', 'app']), false);
});

test('relaunches when non-admin without guard', () => {
  assert.equal(shouldElevate(false, ['node', 'app']), true);
});

test('buildElevateCommand quotes executable and guard argument', () => {
  const cmd = buildElevateCommand('C:\\Program Files\\ZapretTG.exe', ['--elevated']);
  assert.match(cmd, /Start-Process/);
  assert.match(cmd, /C:\\Program Files\\ZapretTG\.exe/);
  assert.match(cmd, /-Verb RunAs/);
  assert.match(cmd, /--elevated/);
});

test('buildElevateCommand escapes single quotes', () => {
  const cmd = buildElevateCommand("C:\\Bob's\\ZapretTG.exe", ["--flag='x'"]);
  assert.match(cmd, /Bob''s/);
  assert.match(cmd, /--flag=''x''/);
});
