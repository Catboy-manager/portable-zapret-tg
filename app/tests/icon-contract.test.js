const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

test('main window uses packaged ZT icon', () => {
  assert.match(main, /function windowIconPath\(\)/);
  assert.match(main, /app\.setName\('ZapretTG'\)/);
  assert.match(main, /path\.join\(process\.resourcesPath, 'icon\.ico'\)/);
  assert.match(main, /path\.join\(__dirname, 'build', 'icon\.ico'\)/);

  const start = main.indexOf('new BrowserWindow({');
  assert.notEqual(start, -1, 'BrowserWindow options not found');
  const end = main.indexOf('});', start);
  assert.match(main.slice(start, end), /icon:\s*windowIconPath\(\)/);
});

test('packaged resources include icon.ico', () => {
  const extraFiles = pkg.build && pkg.build.extraFiles;
  assert.ok(Array.isArray(extraFiles), 'build.extraFiles missing');
  assert.ok(
    extraFiles.some(entry => entry.from === 'build/icon.ico' && entry.to === 'resources/icon.ico'),
    'missing build/icon.ico -> resources/icon.ico mapping',
  );
});
