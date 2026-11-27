# Profile Test Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the recent-check tail with a full profile × target test matrix, add an explicit full-run action with best-profile finalization, and make target health reflect real 2xx availability.

**Architecture:** A pure `targets.js` owns strict status/critical-target rules; a pure `profile-matrix.js` builds the UI matrix and orchestrates sequential test runs; `monitor.js` calls the target rules during normal probing; `main.js` wires IPC and transient profile application; the renderer renders the matrix and demotes the event tail. All telemetry stays metadata-only and redacted.

**Tech Stack:** Electron 33, Node.js CommonJS, `node:test`, electron-builder 25, Windows portable x64.

**Spec:** `docs/superpowers/specs/2026-11-27-profile-test-matrix-design.md`

## Global Constraints

- Portable app in `portable-zapret-tg/`; no installer; settings/history/logs stay inside the app folder.
- Root `.bat` and `runtime/service.bat` stay unchanged.
- Use all `general*.bat` profiles and all `lists/*`; keep user-mode winws and Windows service mode.
- Manual profile choice has priority; automatic switching only on sustained degradation or explicit auto-pick.
- Do not disturb stable direct internet or Discord voice calls; full run is explicit, voice-blocked and cancellable.
- TgWsProxy stays external; endpoint `https://t.me/proxy?server=127.0.0.1&port=1080&secret=...` must never be logged, exported or CLI-passed.
- Telemetry is metadata only: no raw packets, response bodies, secret/token/password/authorization/cookie values.
- Rotate JSONL streams at 10 MB with 3 backups; show at most 300 rows in the raw event table; `telemetryEnabled` defaults true.
- No Linux port of winws/WinDivert/TgWsProxy; only source copies to Ubuntu.
- Linux password only via `ZAPRET_LINUX_PASSWORD`; verifier read-only unless cleanup flags are explicit.
- No native Electron menu; standard OS window frame stays.
- No git repo; record task rulings and verification in `docs/superpowers/sdd/2026-11-27-profile-test-matrix/progress.md` instead of commits.
- PowerShell rejects `&&`; run independent test/syntax commands separately.
- Build output for this work is `../dist8`.

## Review Focus

- Legacy `check` rows with `301`, `303` or `404` must not display as OK in the matrix — Task 2 test `legacy redirect and 404 rows are re-graded as failures`.
- Discord voice becoming active mid-run must stop after the current profile and must not apply a winner — Task 3 test `run stops and does not finalize when voice becomes active`.
- Cancel or voice abort must leave the pre-run profile untouched — Task 3 test `aborted run does not apply winner`.
- An inherited `config/settings.json` from `dist7` must gain the new critical targets instead of making health permanently false — Task 1 test `normalizeHealthTargets restores critical targets`.
- New run rows and progress payloads must never carry proxy secret, token, password, authorization or cookie values — Task 4 test `run IPC and matrix payloads are redacted`.

---

### Task 1: Strict target policy and critical health

**Files:**
- Create: `app/src/targets.js`
- Modify: `app/src/monitor.js:9-35,47-58,108-155`
- Modify: `app/src/storage.js:32-57`
- Modify: `runtime/utils/targets.txt`
- Test: `app/tests/http-probe.test.js`
- Test: `app/tests/monitor-diagnostics.test.js`
- Test: `app/tests/targets.test.js`

**Interfaces:**
- Consumes: existing `httpProbe(url, timeoutMs)`, `pickMonitorTargets(runtimeDir, settings)`, `Storage.loadSettings()`.
- Produces: `CRITICAL_TARGETS`, `DEFAULT_HEALTH_TARGETS`, `normalizeHealthTargets(saved)`, `isCriticalTarget(name)`, `effectiveCheckOk(row)`; strict `httpProbe()` with 2xx-only success; `probeOnce()` whose `overallOk` requires all present critical targets and 60% of the rest.

- [ ] **Step 1: Write the failing target-policy tests**

In `app/tests/targets.test.js`, assert:
- `normalizeHealthTargets([])` contains every name in `DEFAULT_HEALTH_TARGETS`.
- `normalizeHealthTargets(['DiscordMain', 'CustomTarget'])` preserves `CustomTarget` and restores missing critical targets.
- `isCriticalTarget('YouTubeWeb') === true` and `isCriticalTarget('YouTubeImage') === false`.
- `effectiveCheckOk({ ok: true, status: 404 }) === false`, `effectiveCheckOk({ ok: true, status: 200 }) === true`, `effectiveCheckOk({ ok: false, status: 200 }) === false`.

In `app/tests/http-probe.test.js`, add a local HTTP server test where `301`, `303` and `404` produce `ok: false` and `200` produces `ok: true`.

In `app/tests/monitor-diagnostics.test.js`, add a test where 5 of 8 targets pass but one critical target fails, and assert `check.overallOk === false`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/targets.test.js tests/http-probe.test.js tests/monitor-diagnostics.test.js` from `app/`
Expected: FAIL because `targets.js` does not exist and current probe/health policy is permissive.

- [ ] **Step 3: Implement `app/src/targets.js`**

Export `CRITICAL_TARGETS`, `DEFAULT_HEALTH_TARGETS`, `normalizeHealthTargets(saved)`, `isCriticalTarget(name)` and `effectiveCheckOk(row)`. Use the exact default targets and critical names from the spec. `effectiveCheckOk` requires both `row.ok === true` and a numeric status in 200..299; a missing status is false.

- [ ] **Step 4: Modify strict probing and settings normalization**

In `monitor.js`, make `httpProbe()` resolve `ok` only for 2xx; keep `ms`, `bytes`, `error`, `errorCode` metadata. Make `pickMonitorTargets()` include all critical targets present in the target file and normalize `settings.healthTargets` with `normalizeHealthTargets`. In `probeOnce()`, compute `criticalResults`, `criticalOk`, `criticalMissing`, `nonCriticalOk`, `nonCriticalTotal` and `overallOk = criticalMissing.length === 0 && criticalOk === criticalTotal && nonCriticalOk >= Math.ceil(nonCriticalTotal * 0.6)`; add those fields to the `check_summary` diagnostic row without adding response bodies.

In `storage.js`, apply `normalizeHealthTargets` in `loadSettings()` before returning settings.

In `runtime/utils/targets.txt`, replace probe URLs exactly as listed in the spec and remove `YouTubeShort` from the default health list.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/targets.test.js tests/http-probe.test.js tests/monitor-diagnostics.test.js` from `app/`
Expected: PASS.

- [ ] **Step 6: Run the full suite and syntax checks**

Run: `node --test tests/*.test.js` from `app/`
Run: `node --check src/targets.js`, `node --check src/monitor.js`, `node --check src/storage.js` separately.
Expected: PASS and no syntax errors.

- [ ] **Step 7: Record the task in the SDD ledger**

Append a Task 1 line to `docs/superpowers/sdd/2026-11-27-profile-test-matrix/progress.md` with test counts and the RED/GREEN result.

---

### Task 2: Pure profile matrix builder

**Files:**
- Create: `app/src/profile-matrix.js`
- Create: `app/tests/profile-matrix.test.js`

**Interfaces:**
- Consumes: `effectiveCheckOk(row)` from Task 1; `listProfiles(runtimeDir)` from `src/profiles.js`.
- Produces: `buildProfileMatrix({ rows, profiles, targets })` returning `{ targets, profiles, testedCount }`. Each profile entry is `{ name, tested, cells, okCount, failCount, criticalOk, criticalTotal, lastTs }`; each cell is `{ ok, status, error, errorCode, ms, ts, runId, okCount, failCount }` or `null`.

- [ ] **Step 1: Write the failing matrix tests**

In `app/tests/profile-matrix.test.js`, assert:
- With 22 profile names and only ALT3 rows, `result.profiles.length === 22`, `testedCount === 1`, and an untested profile has `tested === false` with all cells `null`.
- The newest row per profile/target wins.
- ok/fail counts are accumulated from `effectiveCheckOk`, so a legacy `{ ok: true, status: 404 }` row increments `failCount` and renders `ok: false`.
- Critical targets are counted in `criticalOk`/`criticalTotal` using `isCriticalTarget`.
- Rows with a missing target or profile are ignored.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/profile-matrix.test.js` from `app/`
Expected: FAIL because `profile-matrix.js` does not exist.

- [ ] **Step 3: Implement `buildProfileMatrix`**

Group `rows` by `profile` then `target`, keep the newest row by `ts`, compute counts with `effectiveCheckOk`, and emit one entry for every supplied profile name in the original order. Do not mutate input rows. Include only target names supplied in `targets`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/profile-matrix.test.js` from `app/`
Expected: PASS.

- [ ] **Step 5: Full suite, syntax and ledger**

Run: `node --test tests/*.test.js` and `node --check src/profile-matrix.js` separately.
Append a Task 2 line to the SDD ledger.

---

### Task 3: Sequential full-run orchestration

**Files:**
- Modify: `app/src/profile-matrix.js`
- Create: `app/tests/run-all-profiles.test.js`

**Interfaces:**
- Consumes: `buildProfileMatrix`, `isCriticalTarget`, `effectiveCheckOk`.
- Produces: `createRunToken()` returning `{ cancelled, cancel() }`; `runAllProfiles({ profiles, apply, probe, voice, storage, emit, finish, token })` returning `{ completed, results, winner, aborted, reason }`. `apply(profile, { transient: true }) -> { ok, result }`; `probe(reason, runId) -> check`; `finish(profileName)` persists the winner.

- [ ] **Step 1: Write the failing run tests**

In `app/tests/run-all-profiles.test.js`, assert:
- With three profiles, `apply` and `probe` are called in order with `transient: true`, a shared `runId`, and reason `'profile-test'`.
- `profile_run` rows are written through `storage.recordDiagnostics` with `runId`, score, critical counts and decision.
- The winner is the profile with the most critical passes, then most 2xx results, then lowest total latency; `finish(winner)` is called exactly once.
- `voice.isActive() === true` at start returns `{ completed: false, aborted: true, reason: 'voice-active' }` and calls neither `apply` nor `finish`.
- Voice becoming active after the first profile stops before the second profile, marks remaining results `aborted_voice`, and does not call `finish`.
- `token.cancel()` stops after the current profile, marks remaining results `aborted_user`, and does not call `finish`.
- `emit('run-progress', payload)` is called with profile index, profile name and completed result, and payloads contain no secret field.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/run-all-profiles.test.js` from `app/`
Expected: FAIL because the functions do not exist.

- [ ] **Step 3: Implement `createRunToken` and `runAllProfiles`**

Implement in `app/src/profile-matrix.js`. Pause normal ticks outside this function (Task 4). Scoring is `[criticalPasses, okCount, -totalMs]`; only completed runs with at least one successful apply call `finish`. Aborted runs never call `finish`. Use `storage.appendEvent` for compatibility events and `storage.recordDiagnostics` for `profile_run` rows.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/run-all-profiles.test.js` from `app/`
Expected: PASS.

- [ ] **Step 5: Full suite and ledger**

Run full suite from `app/` and `node --check src/profile-matrix.js` separately; append a Task 3 ledger line.

---

### Task 4: IPC, status matrix and transient apply

**Files:**
- Modify: `app/src/monitor.js`
- Modify: `app/main.js`
- Modify: `app/preload.js`
- Create: `app/tests/main-profile-run.test.js`

**Interfaces:**
- Consumes: `buildProfileMatrix`, `runAllProfiles`, `createRunToken` from Task 2/3; `Storage.readRecentDiagnostics`, `listProfiles`.
- Produces: `getStatus().profileMatrix`; IPC channels `runAllProfiles`, `cancelRunAllProfiles`, `getProfileMatrix`; preload methods of the same names plus `onRunProgress(cb)`; `Monitor.pause()`, `Monitor.resume()`, `Monitor.isPaused()`; `run-progress` renderer channel.

- [ ] **Step 1: Write the failing contract tests**

In `app/tests/main-profile-run.test.js`, assert the main source contains:
- `registerHandler('runAllProfiles'`, `registerHandler('cancelRunAllProfiles'`, `registerHandler('getProfileMatrix'`.
- `profileMatrix: buildProfileMatrix(`.
- a transient apply path that does not call `storage.saveSettings` during each test profile;
- `redact(` on the final full-run result before returning it to the renderer.
- `emit('run-progress'` for progress events.

Assert `preload.js` exposes `runAllProfiles`, `cancelRunAllProfiles`, `getProfileMatrix` and `onRunProgress`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/main-profile-run.test.js` from `app/`
Expected: FAIL because channels and methods are missing.

- [ ] **Step 3: Implement monitor pause/resume**

In `Monitor`, add `paused` state. `tick()` returns immediately while paused. `pause()`/`resume()` log through `storage.log` and do not disturb the normal interval timer.

- [ ] **Step 4: Implement IPC and transient apply**

In `main.js`, add a module-level `runToken = null`. For `runAllProfiles`, refuse if a run is active or `voice.isActive()`; create the token, pause the monitor, call `runAllProfiles` with:
- `profiles: getProfiles()`;
- `apply`: existing winws/service start path that does not write settings;
- `probe`: `(reason, runId) => monitor.probeOnce(reason, runId)`;
- `voice`, `storage`, `emit` wrapper that sends `run-progress`;
- `finish`: existing `applyProfile(winner, { manual: false })` followed by clearing `manualProfileLock`/`manualProfile`.
Use `try/finally` to resume the monitor and clear the token. Return `redact(result)`. `cancelRunAllProfiles` calls `runToken.cancel()`. `getProfileMatrix(n)` builds from `storage.readRecentDiagnostics(n)` and `listProfiles`. Add `profileMatrix` to `getStatus()`.

Update `probeOnce(reason, runId)` to accept and record the optional `runId`.

- [ ] **Step 5: Update preload**

Expose the four new methods through the existing `contextBridge` whitelist. `onRunProgress(cb)` subscribes to `run-progress` and returns an unsubscribe function.

- [ ] **Step 6: Run the tests and syntax checks**

Run: `node --test tests/main-profile-run.test.js`, then full suite, then `node --check main.js` and `node --check preload.js` separately.
Expected: PASS.

- [ ] **Step 7: Ledger**

Append a Task 4 line to the SDD ledger.

---

### Task 5: Matrix UI and event-tail demotion

**Files:**
- Modify: `app/renderer/index.html`
- Modify: `app/renderer/renderer.js`
- Modify: `app/renderer/styles.css`
- Modify: `app/tests/ui-contract.test.js`

**Interfaces:**
- Consumes: `getStatus().profileMatrix`, `getProfileMatrix(n)`, `runAllProfiles()`, `cancelRunAllProfiles()`, `onRunProgress(cb)` from Task 4.
- Produces: matrix DOM with ids `matrixHead`, `matrixBody`, `matrixTested`, `matrixTotal`, `btnRunAll`, `btnCancelRunAll`, `btnMatrixRefresh`, `runProgress`, `eventCard`; functions `renderMatrix(status)`, `renderMatrixCell(cell)`, `setRunProgress(payload)`.

- [ ] **Step 1: Write the failing UI contract test**

In `ui-contract.test.js`, assert `index.html` contains the ten ids above and no longer uses `id="diagCard"` as the primary card. Assert `renderer.js` contains `function renderMatrix`, `function renderMatrixCell`, `function setRunProgress`, `runAllProfiles(`, `cancelRunAllProfiles(` and `onRunProgress(`. Assert `styles.css` contains `.matrix-table`, `.matrix-ok`, `.matrix-fail`, `.matrix-untested` and `.run-progress`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/ui-contract.test.js` from `app/`
Expected: FAIL.

- [ ] **Step 3: Add matrix markup**

In `index.html`, insert the primary **«Матрица конфигов»** card with a header summary, four controls and a table whose header is filled by `matrixHead`. Move the existing diagnostics table into `<details id="eventCard">` with summary **«Лента событий»**; keep `diagFilter`, `btnDiagRefresh`, `diagRows`, `chkTelemetry` and `lastCheckMeta` inside it.

- [ ] **Step 4: Implement renderer matrix behavior**

In `renderer.js`, call `renderMatrix(s)` from `renderStatus()`. Use `esc()` for every cell value and `safeUrl()` for any URL. Show `OK <status> <ms>мс` or `FAIL <error> <ms>мс`; `null` cells show `—` with class `matrix-untested`. Use `title` attributes for counts. Wire the four buttons to the new IPC methods; `btnCancelRunAll` stays disabled until a run starts. `setRunProgress(payload)` writes profile index/name and result into `runProgress`. Subscribe with `onRunProgress` on DOMContentLoaded and unsubscribe on `beforeunload`. Do not log input values.

- [ ] **Step 5: Add CSS**

In `styles.css`, style the matrix table with sticky header, compact cells, green/red/untested states and the progress strip. Keep the existing frame and native-menu state unchanged.

- [ ] **Step 6: Run tests and syntax check**

Run: `node --test tests/ui-contract.test.js`, then full suite, then `node --check renderer/renderer.js` separately.
Expected: PASS.

- [ ] **Step 7: Ledger**

Append a Task 5 line to the SDD ledger.

---

### Task 6: Build `dist8`, inherit history, recopy Linux sources

**Files:**
- Modify: `app/package.json` output to `../dist8`
- Create/prepare: `dist8/win-unpacked/config/`, `dist8/win-unpacked/history/`, `dist8/win-unpacked/logs/`, `dist8/win-unpacked/RUN_AS_ADMIN.txt`
- Modify: `docs/superpowers/sdd/2026-11-27-profile-test-matrix/progress.md`

**Interfaces:**
- Consumes: completed Tasks 1-5; existing `dist7/win-unpacked/config/settings.json`, `history/diagnostics.jsonl`, `history/events.jsonl`, `history/stats.json`.
- Produces: verified `dist8/win-unpacked/ZapretTG.exe`; Linux source copy at `linuxuser@192.0.2.10:/home/linuxuser/Documents/portable-zapret-tg`.

- [ ] **Step 1: Final verification before build**

Run: `node --test tests/*.test.js` from `app/`
Run `node --check` separately for `main.js`, `preload.js`, `src/targets.js`, `src/profile-matrix.js`, `src/monitor.js`, `src/storage.js`, `renderer/renderer.js`.
Expected: all tests pass and no syntax errors.

- [ ] **Step 2: Build**

Run from `app/`: `$env:CSC_IDENTITY_AUTO_DISCOVERY='false'; npx electron-builder --win dir --x64`
If `EBUSY` blocks `dist8`, remove the stale EXE and retry once. Expected: successful packaging.

- [ ] **Step 3: Prepare portable folders and migrate settings**

Create `config`, `history`, `logs`; copy `settings.json`, `diagnostics.jsonl`, `events.jsonl`, `stats.json` from `dist7/win-unpacked`; write `RUN_AS_ADMIN.txt`. Verify `healthTargets` contains all `DEFAULT_HEALTH_TARGETS`, `telemetryEnabled: true`, 22 `general*.bat`, rewritten targets in `runtime/utils/targets.txt`, and that asar contains `targets.js`, `profile-matrix.js`, `monitor.js`, `storage.js`.

- [ ] **Step 4: Recopy Linux sources**

Run with `$env:ZAPRET_LINUX_PASSWORD` set, never as an argument: `python scripts/copy_to_linux.py` and `python scripts/verify_linux_copy.py`. Expected: verifier reports no `docs/superpowers`, 22 profiles, 27 runtime/bin files and TgWsProxy present.

- [ ] **Step 5: Final ledger entry**

Append final verification with exact test count, `dist8` path and any deferred issue. Do not write the Linux password into any file.
