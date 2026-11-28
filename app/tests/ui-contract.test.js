const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');

test('diagnostics table markup replaces old cards', () => {
  for (const id of ['diagRows', 'diagFilter', 'btnDiagRefresh', 'chkTelemetry', 'lastCheckMeta']) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  assert.doesNotMatch(html, /id="checkResults"/);
  assert.doesNotMatch(html, /id="diagCard"/);
});

test('profile matrix is the primary card with full-run controls', () => {
  for (const id of [
    'matrixCard', 'matrixHead', 'matrixBody', 'matrixTested', 'matrixTotal',
    'btnRunAll', 'btnCancelRunAll', 'btnMatrixRefresh', 'runProgress', 'eventCard',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /<details[^>]*id="eventCard"/);
  assert.match(html, /Лента событий/);
  assert.match(html, / id="matrixBody"/);
  assert.ok(html.indexOf('id="matrixCard"') < html.indexOf('id="eventCard"'));
});

test('renderer renders diagnostics and tracks clicks', () => {
  assert.match(js, /function renderDiagnostics/);
  assert.match(js, /function renderCheck/);
  assert.match(js, /trackUi\(/);
  assert.match(js, /data-filter/);
  assert.match(js, /telemetryEnabled:/);
});

test('renderer renders the matrix and wires the full run', () => {
  assert.match(js, /function renderMatrix/);
  assert.match(js, /function renderMatrixCell/);
  assert.match(js, /function setRunProgress/);
  assert.match(js, /renderMatrix\(s\)/);
  assert.match(js, /runAllProfiles\(/);
  assert.match(js, /cancelRunAllProfiles\(/);
  assert.match(js, /onRunProgress\(/);
});

test('click telemetry includes the resulting banner kind', () => {
  assert.match(js, /lastBannerKind/);
  assert.match(js, /bannerKind:/);
});

test('table styles exist', () => {
  assert.match(css, /\.diag-table/);
  assert.match(css, /\.diag-toolbar/);
  assert.match(css, /\.diag-detail/);
});

test('matrix styles distinguish ok, fail and untested cells', () => {
  assert.match(css, /\.matrix-table/);
  assert.match(css, /\.matrix-ok/);
  assert.match(css, /\.matrix-fail/);
  assert.match(css, /\.matrix-untested/);
  assert.match(css, /\.run-progress/);
});

test('hover help explains matrix-driven passive ranking', () => {
  for (const text of [
    'из таблицы «Профили и результаты тестов»',
    'критические цели',
    'свежесть',
  ]) {
    assert.ok(html.includes(text), `missing help text: ${text}`);
  }
});

test('hover help explains workflow, buttons and run caveats', () => {
  for (const id of ['btnHelp', 'helpPanel']) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /aria-label="Подсказка по кнопкам"/);
  assert.match(html, /role="tooltip"/);
  for (const text of [
    'Порядок работы',
    'Проверить все профили',
    'голос Discord',
    'победитель применяется только в конце',
  ]) {
    assert.ok(html.includes(text), `missing help text: ${text}`);
  }
  for (const selector of ['.help-wrap', '.help-btn', '.help-panel', ':focus-within', 'position:absolute']) {
    assert.ok(css.includes(selector), `missing CSS: ${selector}`);
  }
});

test('blocked-target warnings are shown as errors', () => {
  assert.match(js, /\/провал\|заблокир\/i/);
  assert.match(js, /blocked \? 'error'/);
  assert.ok(html.includes('id="blockedBanner"'), 'missing #blockedBanner');
});

test('invalid profiles are surfaced in status and matrix', () => {
  assert.match(js, /invalidProfiles/);
  assert.match(js, /matrix-invalid/);
  assert.match(js, /blockedBanner/);
  assert.match(js, /исключены из авто-подбора/);
});

test('hover help explains the critical-block warning and retry', () => {
  assert.ok(html.includes('провайдер заблокировал все методы обхода'), 'missing block warning text');
  assert.ok(html.includes('Повторяю полный подбор'), 'missing retry text');
});
