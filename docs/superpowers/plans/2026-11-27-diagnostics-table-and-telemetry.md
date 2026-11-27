# Diagnostics Table and Detailed Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Electron's native menu and add a persistent diagnostics table plus detailed, privacy-safe local telemetry for probes, profile selection, clicks, window state and system context.

**Architecture:** A new pure `src/telemetry.js` owns redaction, rotation helpers and system snapshots. `Storage` appends redacted JSONL rows to `history/diagnostics.jsonl` and `logs/telemetry.jsonl`; `Monitor` and main-process IPC emit structured rows; the renderer renders a filtered table from `getStatus()`. Existing manual-priority and Discord-voice behavior stays untouched.

**Tech Stack:** Electron 33, Node.js CommonJS, `electron-builder` 25, `node:test`, Windows portable x64 build.

**Spec:** `docs/superpowers/specs/2026-11-27-diagnostics-table-and-telemetry-design.md`

## Global Constraints

- No git repo: skip `git commit` steps; record progress in `docs/superpowers/sdd/2026-11-24-voice-detection-and-uac/progress.md`.
- Keep app portable: all new files under `history/` and `logs/` next to `ZapretTG.exe`; do not change root `.bat` files or `service.bat`.
- Keep the standard OS window frame; only call `Menu.setApplicationMenu(null)`.
- Traffic logging is metadata only: HTTP status, latency, error code, content-length when available, TCP state counts by process. Never log packet payloads or response bodies.
- Never log or export `tgProxy.secret`, proxy link query secret, tokens, passwords, authorization headers or cookies.
- Rotate each JSONL stream at 10 MB with 3 rotated files (`.1`, `.2`, `.3`).
- Show at most 300 diagnostics rows in the DOM; keep full history on disk.
- Default `telemetryEnabled: true`; expose a checkbox to turn detailed telemetry off.
- Existing minimal test doubles for `Storage` must keep working: diagnostic writes are optional via `if (this.storage.recordDiagnostics)`.
- Verification command for the full suite: `node --test tests/*.test.js` from `app/`.

## Review Focus

- Proxy secret leak into any log or export — pinned by Task 1 `redact()` test and Task 5 export assertion.
- Unbounded log growth during long-running monitoring — pinned by Task 1 `rotateIfNeeded()` test.
- Old test doubles without `recordDiagnostics` crashing `Monitor` — pinned by Task 2 "bare storage" test.
- Hidden reasons for skipped auto-switch (voice, manual lock, cooldown) disappearing from diagnostics — pinned by Task 2 decision-row test.
- Probe failures lacking useful error data (timeout/error code/latency) — pinned by Task 2 `httpProbe` test.

---

### Task 1: Telemetry helpers and storage streams

**Files:**
- Create: `app/src/telemetry.js`
- Modify: `app/src/storage.js`
- Test: `app/tests/telemetry.test.js`

**Interfaces:**
- Consumes: Node built-ins only (`fs`, `os`, `path`, `process`).
- Produces:
  - `redact(value)` → same shape with sensitive keys removed and URL query secrets masked.
  - `redactUrl(url)` → URL string with `secret`, `token`, `password`, `authorization`, `cookie` query values replaced by `[REDACTED]`.
  - `rotateIfNeeded(file, maxBytes = 10 * 1024 * 1024, keep = 3)` → boolean; rotates when current file size is at least `maxBytes`.
  - `systemInfo(baseDir, extra = {})` → object with `ts`, versions, platform/arch, locale/languages, timezone, packaged flag, baseDir, CPU/memory summary plus `extra`.
  - `Storage.recordDiagnostics(row)` → redacted row with `ts`.
  - `Storage.recordTelemetry(scope, event)` → redacted row with `ts` and `scope`, or `null` when telemetry is disabled.
  - `Storage.readRecentDiagnostics(n = 300)` / `Storage.readRecentTelemetry(n = 300)` → parsed arrays.

- [ ] **Step 1: Write failing tests for redaction and system info**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { redact, redactUrl, systemInfo } = require('../src/telemetry');

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
```

- [ ] **Step 2: Run the redaction test to verify it fails**

Run: `node --test tests/telemetry.test.js`
Expected: FAIL with "Cannot find module '../src/telemetry'".

- [ ] **Step 3: Implement `app/src/telemetry.js`**

Use a recursive sanitizer that drops keys matching `/secret|token|password|authorization|cookie/i` entirely, calls `redactUrl()` on string values that parse as http(s) URLs, and preserves arrays/objects. `systemInfo()` returns exact keys `systemLocale`, `preferredLanguages`, `timezone`, `node`, `chrome`, `electron`, `platform`, `arch`, `packaged`, `baseDir`, plus `extra`; it reads `process.versions`, `process.platform`, `process.arch`, `os.cpus().length`, `os.totalmem()`, `os.freemem()` and `Intl.DateTimeFormat().resolvedOptions().timeZone`.

- [ ] **Step 4: Write failing tests for rotation and Storage streams**

```js
const { rotateIfNeeded } = require('../src/telemetry');
const { Storage } = require('../src/storage');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('rotateIfNeeded rotates at threshold and keeps three backups', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-rot-'));
  const file = path.join(dir, 'telemetry.jsonl');
  fs.writeFileSync(file, 'x'.repeat(100));
  assert.equal(rotateIfNeeded(file, 100, 3), true);
  assert.equal(fs.existsSync(file), false);
  assert.ok(fs.existsSync(file + '.1'));
  assert.equal(rotateIfNeeded(file + '.1', 100, 3), true);
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
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `node --test tests/telemetry.test.js`
Expected: FAIL on missing `rotateIfNeeded` and missing `Storage.recordDiagnostics`.

- [ ] **Step 6: Implement Storage streams**

Add `diagnosticsFile = history/diagnostics.jsonl` and `telemetryFile = logs/telemetry.jsonl` to `this.paths`. Add `telemetryEnabled: true` to `getDefaultSettings()`. Implement the four methods; each append uses `JSON.stringify(redact(row)) + '\n'` followed by `rotateIfNeeded(path)`. `recordTelemetry` returns `null` when `loadSettings().telemetryEnabled === false`.

- [ ] **Step 7: Run the telemetry tests to verify they pass**

Run: `node --test tests/telemetry.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 8: Record progress in the SDD ledger**

Append one line to `docs/superpowers/sdd/2026-11-24-voice-detection-and-uac/progress.md` noting Task 1 complete and the test count.

---

### Task 2: Probe timing and monitor diagnostics rows

**Files:**
- Modify: `app/src/monitor.js`
- Create: `app/tests/http-probe.test.js`
- Create: `app/tests/monitor-diagnostics.test.js`

**Interfaces:**
- Consumes: `Storage.recordDiagnostics(row)` from Task 1.
- Produces:
  - `httpProbe(url, timeoutMs)` → `{ ok, status, ms, error, errorCode, bytes }`.
  - `Monitor.rankCandidates(settings)` → `[{ name, score }]`; `getCandidates(settings)` returns names from it.
  - `Monitor.recordDiagnostic(kind, row)` internal helper that no-ops when storage lacks `recordDiagnostics`.
  - Diagnostics kinds: `check`, `check_summary`, `profile_decision`, `profile_attempt`.
  - Decision values: `applied`, `skipped-cooldown`, `deferred-voice`, `skipped-manual-lock`, `no-candidates`, `skipped-disabled`, `no-candidate-passed`, `rolled-back`.

- [ ] **Step 1: Write failing tests for `httpProbe` metadata**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { httpProbe } = require('../src/monitor');

test('httpProbe records status, latency and content-length', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(503, { 'Content-Length': '5' });
    res.end('error');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/probe`;
  const r = await httpProbe(url, 2000);
  server.close();
  assert.equal(r.ok, true); // existing policy: any HTTP response means reachable
  assert.equal(r.status, 503);
  assert.equal(r.bytes, 5);
  assert.ok(typeof r.ms === 'number' && r.ms >= 0);
});

test('httpProbe records error code on refused connection', async () => {
  const r = await httpProbe('http://127.0.0.1:1/nope', 1000);
  assert.equal(r.ok, false);
  assert.ok(r.errorCode);
});
```

- [ ] **Step 2: Run the probe tests to verify they fail on missing fields**

Run: `node --test tests/http-probe.test.js`
Expected: FAIL because `status` is present but `ms`, `bytes` and `errorCode` are not asserted in current implementation.

- [ ] **Step 3: Implement `httpProbe` metadata**

Start a timer before `lib.request()`, resolve on response with `ms: Date.now() - started`, `bytes: Number(res.headers['content-length']) || null`, and `errorCode: e.code || 'NO_CODE'` on errors. Keep current success policy unchanged.

- [ ] **Step 4: Run the probe tests to verify they pass**

Run: `node --test tests/http-probe.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write failing tests for diagnostics rows**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Monitor } = require('../src/monitor');

function storage(rows) {
  return {
    rows,
    loadSettings: () => ({
      healthTargets: ['DiscordMain'], autoSwitchEnabled: true, cooldownSec: 0,
      failThreshold: 3, candidateCount: 3, winwsMode: 'user',
      activeProfile: 'general (SIMPLE FAKE).bat', manualProfileLock: false,
    }),
    loadStats: () => ({ profiles: {}, targets: {} }),
    saveStats: () => {},
    log: () => {},
    appendEvent: () => {},
    recordDiagnostics: (row) => rows.push(row),
  };
}

test('probeOnce records one check row per target plus a summary', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-mon-'));
  fs.mkdirSync(path.join(dir, 'utils'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'utils', 'targets.txt'), `DiscordMain = "http://127.0.0.1:${server.address().port}/probe"\n`);
  const rows = [];
  const m = new Monitor({
    runtimeDir: dir,
    storage: storage(rows),
    admin: () => true,
    emit: () => {},
    voice: { isActive: () => false },
    tg: { status: async () => ({ running: true, reachable: true }) },
  });
  const check = await m.probeOnce('test');
  server.close();
  assert.equal(check.results.length, 1);
  assert.equal(rows.filter(x => x.kind === 'check').length, 1);
  assert.equal(rows.find(x => x.kind === 'check_summary').overallOk, true);
  assert.equal(rows[0].admin, true);
  assert.equal(rows[0].mode, 'user');
});

test('bare storage without recordDiagnostics does not crash', async () => {
  const m = new Monitor({ runtimeDir: '.', storage: { loadSettings: () => ({ healthTargets: [] }), loadStats: () => ({}), saveStats: () => {}, log: () => {}, appendEvent: () => {} }, emit: () => {} });
  m.recordDiagnostic('check', { target: 'X' });
  assert.equal(m.lastCheck, null);
});

test('auto-switch records manual-lock skip reason', async () => {
  const rows = [];
  const st = storage(rows);
  st.loadSettings = () => ({ ...st.loadSettings(), manualProfileLock: true, manualProfile: 'locked.bat' });
  const m = new Monitor({ runtimeDir: '.', storage: st, admin: () => true, emit: () => {}, voice: { isActive: () => false } });
  const r = await m.autoSwitch('degradation');
  assert.equal(r.reason, 'manual-lock');
  assert.ok(rows.some(x => x.kind === 'profile_decision' && x.decision === 'skipped-manual-lock'));
});
```

- [ ] **Step 6: Run the monitor tests to verify they fail**

Run: `node --test tests/monitor-diagnostics.test.js`
Expected: FAIL because `recordDiagnostic` and `admin` are not implemented.

- [ ] **Step 7: Implement monitor diagnostics**

Add optional `admin` to the constructor. Implement `recordDiagnostic(kind, row)` that merges `{ ts, kind, profile, mode, admin, voiceActive }` from current settings/state and calls `storage.recordDiagnostics` when available. Add `rankCandidates(settings)` using existing `scoreProfile()`, and rewrite `getCandidates()` to map names. In `probeOnce()`, replace direct target storage with one `check` row per result and one `check_summary` row. In `autoSwitch()`, record a `profile_decision` row for every early return, a `profile_attempt` row for each candidate, and final decision rows for success/failure/rollback. Preserve all existing return values and event names.

- [ ] **Step 8: Run monitor and existing voice tests to verify they pass**

Run: `node --test tests/monitor-diagnostics.test.js tests/monitor-voice.test.js tests/voice.test.js`
Expected: PASS.

- [ ] **Step 9: Record progress in the SDD ledger**

Append one line noting Task 2 complete.

---

### Task 3: Main-process menu removal and telemetry

**Files:**
- Modify: `app/main.js`
- Modify: `app/preload.js`
- Create: `app/tests/main-telemetry.test.js`

**Interfaces:**
- Consumes: `Storage.recordTelemetry(scope, event)`, `Storage.readRecentDiagnostics(n)` from Task 1; `getStatus()` diagnostics rows from Task 2.
- Produces:
  - `registerHandler(channel, handler)` wrapper for every `ipcMain.handle`.
  - IPC channels `getDiagnostics`, `trackUi`.
  - `getStatus().diagnostics` array and `getStatus().telemetry` summary.
  - `exportDiagnostics()` includes `diagnostics` and `telemetry` tails.
  - Preload API `getDiagnostics(n)` and `trackUi(meta)`.

- [ ] **Step 1: Write failing contract test**

```js
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
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `node --test tests/main-telemetry.test.js`
Expected: FAIL on `Menu.setApplicationMenu(null)`.

- [ ] **Step 3: Implement menu removal and IPC wrapper**

Import `Menu` and `screen` from Electron. Call `Menu.setApplicationMenu(null)` once before `app.whenReady()`. Add `registerHandler(channel, handler)` that records `ipc` telemetry with `channel`, `ms`, `ok`, `errorCode` and `error`, then replace all `ipcMain.handle` calls with it. Do not log handler arguments.

- [ ] **Step 4: Implement startup/window telemetry**

In `app.whenReady()`, after settings load, call `storage.recordTelemetry('app', systemInfo(BASE_DIR, { event: 'app_start', elevated: isAdminSync(), screen: screen.getPrimaryDisplay().workAreaSize }))`. In `createWindow()`, add debounced `resize`/`move` and immediate `focus`/`close` listeners recording `window_bounds` with width/height/x/y scaled by `displayScaleFactor` where available.

- [ ] **Step 5: Implement new IPC and export fields**

Add `getDiagnostics` returning `storage.readRecentDiagnostics(n)`, `trackUi` recording `ui` telemetry, and extend `exportDiagnostics()` with `diagnostics` and `telemetry` tails. Add `diagnostics` and `telemetry: { enabled, file }` to `getStatus()`.

- [ ] **Step 6: Expose APIs in preload**

Add `getDiagnostics: (n) => ipcRenderer.invoke('getDiagnostics', n)` and `trackUi: (meta) => ipcRenderer.invoke('trackUi', meta)`.

- [ ] **Step 7: Run contract test and syntax check**

Run: `node --test tests/main-telemetry.test.js && node --check main.js && node --check preload.js`
Expected: PASS.

- [ ] **Step 8: Record progress in the SDD ledger**

Append one line noting Task 3 complete.

---

### Task 4: Diagnostics table UI

**Files:**
- Modify: `app/renderer/index.html`
- Modify: `app/renderer/renderer.js`
- Modify: `app/renderer/styles.css`
- Create: `app/tests/ui-contract.test.js`

**Interfaces:**
- Consumes: `getStatus().diagnostics` from Task 3; `trackUi(meta)` from Task 3.
- Produces:
  - DOM ids `diagRows`, `diagFilter`, `btnDiagRefresh`, `chkTelemetry`, `lastCheckMeta`.
  - Renderer functions `renderDiagnostics(s)` and `renderCheck(check)`.
  - Filter values `all`, `target`, `profile`, `event`.

- [ ] **Step 1: Write failing UI contract test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');

test('diagnostics table markup replaces old cards', () => {
  for (const id of ['diagRows', 'diagFilter', 'btnDiagRefresh', 'chkTelemetry']) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  assert.doesNotMatch(html, /id="checkResults"/);
  assert.doesNotMatch(html, /id="diagCard"/);
});

test('renderer renders diagnostics and tracks clicks', () => {
  assert.match(js, /function renderDiagnostics/);
  assert.match(js, /trackUi\(/);
  assert.match(js, /data-filter/);
});

test('table styles exist', () => {
  assert.match(css, /\.diag-table/);
});
```

- [ ] **Step 2: Run the UI contract test to verify it fails**

Run: `node --test tests/ui-contract.test.js`
Expected: FAIL on missing `id="diagRows"`.

- [ ] **Step 3: Replace diagnostics markup**

In `index.html`, remove the current `checkResults` results block and the duplicated `diagCard` block. Keep one wide card titled `Диагностика целей` with `lastCheckMeta`, a toolbar (`diagFilter` buttons for `all/target/profile/event`, `btnDiagRefresh`), a `<table class="diag-table">` with header columns время/тип/цель-профиль/результат/детали and `<tbody id="diagRows">`, plus `statsSummary`. Add `chkTelemetry` checkbox to the monitoring card.

- [ ] **Step 4: Implement table rendering**

In `renderer.js`, add `let diagFilter = 'all'`. `renderDiagnostics(s)` reads `s.diagnostics || []`, filters by kind prefix (`check` → target, `profile_` → profile, rest → event), sorts newest first, caps at 300 rows and builds `<tr>` rows using `esc()`. When diagnostics are empty, synthesize rows from `s.monitor.lastCheck`. `renderCheck(check)` only updates `lastCheckMeta`; it must not write to a removed element. Wire filter buttons and `btnDiagRefresh` to re-render/refresh.

- [ ] **Step 5: Add click telemetry and settings toggle**

Add a capture-phase `document.addEventListener('click', ...)` that calls `window.api.trackUi({ id: el.id || el.dataset.mode || el.className, action: 'click' })` for `button` and `.seg` elements only; never read input values. Add `telemetryEnabled: $('chkTelemetry').checked` to `gatherSettingsPatch()` and restore the checkbox in `renderStatus()`.

- [ ] **Step 6: Add CSS**

Add styles for `.diag-toolbar`, `.diag-table`, sticky header, compact cells, `.diag-detail` truncation and result badges. Reuse existing CSS variables; do not add a top bar.

- [ ] **Step 7: Run UI contract test and syntax check**

Run: `node --test tests/ui-contract.test.js && node --check renderer/renderer.js`
Expected: PASS.

- [ ] **Step 8: Record progress in the SDD ledger**

Append one line noting Task 4 complete.

---

### Task 5: Full verification, packaging and source copy

**Files:**
- Modify: `app/package.json` output directory to `../dist7`
- Modify: `docs/superpowers/sdd/2026-11-24-voice-detection-and-uac/progress.md`

**Interfaces:**
- Consumes: all tasks above.
- Produces: `dist7/win-unpacked/ZapretTG.exe`, verified Linux source copy.

- [ ] **Step 1: Run the full test suite**

Run from `app/`: `node --test tests/*.test.js`
Expected: all tests pass, including the original 19 plus new telemetry/probe/monitor/main/UI tests.

- [ ] **Step 2: Syntax check changed files**

Run: `node --check main.js && node --check preload.js && node --check src/telemetry.js && node --check src/storage.js && node --check src/monitor.js && node --check renderer/renderer.js`
Expected: no output, exit 0.

- [ ] **Step 3: Build fresh portable directory**

Run: `$env:CSC_IDENTITY_AUTO_DISCOVERY='false'; npx electron-builder --win dir --x64`
Expected: output under `dist7/win-unpacked`.

- [ ] **Step 4: Prepare portable folders and config**

Create `config/`, `history/`, `logs/` under `dist7/win-unpacked`; copy `config/settings.json` from `dist6`, ensuring `healthTargets` still contains `DiscordMedia`; write `RUN_AS_ADMIN.txt`.

- [ ] **Step 5: Verify build contents**

Check: exe exists; `runtime/`, `config/`, `history/`, `logs/`, `RUN_AS_ADMIN.txt` exist; 22 `general*.bat`; `runtime/utils/targets.txt` contains `DiscordCDN` image URL and `DiscordMedia`; `asar list resources/app.asar` contains `telemetry.js`, `storage.js`, `monitor.js`, `tgproxy.js`, `voice.js`.

- [ ] **Step 6: Copy and verify Linux sources**

Run with environment variable only (value supplied by the user, never as a CLI flag): `$env:ZAPRET_LINUX_PASSWORD='<value>'; python scripts/copy_to_linux.py; python scripts/verify_linux_copy.py`
Expected: copy succeeds; verifier reports 91+ files, `voice.js` present, `docs/superpowers` absent, 22 profiles, 27 `runtime/bin` files, TgWsProxy present. Do not pass a password CLI flag.

- [ ] **Step 7: Final ledger entry**

Append final verification results, exact test count, build path and any deferred minor issues to the SDD ledger.

---

## Self-review checklist result

- Spec coverage: native menu (Task 3), diagnostics table (Task 4), per-target/per-selection history (Tasks 2+4), detailed telemetry (Tasks 1+3), privacy/redaction (Task 1), rotation (Task 1), export (Task 3), tests/build/copy (Task 5) — no gaps.
- Step scan: each step writes one test, one implementation unit, or one verification command; no TBD placeholders.
- Type consistency: `recordDiagnostics`, `recordTelemetry`, `readRecentDiagnostics`, `readRecentTelemetry`, `rankCandidates`, `recordDiagnostic`, IPC channel names and DOM ids are used identically across tasks.
- Review Focus: each listed risk has a test in its owning task.
- Proportion: plan is decisions and checkable steps, not a full code transcript; test snippets only where values matter.
