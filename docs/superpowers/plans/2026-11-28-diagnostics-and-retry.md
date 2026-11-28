# Diagnostics, failure memory and critical-block retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make quick checks explain which targets failed, stop passive mode from cycling recently failed profiles, quarantine broken BAT files, freeze full-run settings, and retry once with a clear warning when a critical target is blocked under every profile.

**Architecture:** Small pure helpers are added beside existing modules; storage keeps failure metadata in `stats.profiles`; the full-run wrapper in `profile-matrix.js` owns the single retry; `main.js` owns the frozen settings snapshot and deferred monitor restart.

**Tech Stack:** Node.js 20+ built-in `node:test`, Electron IPC, existing CommonJS modules.

**Spec:** `docs/superpowers/specs/2026-11-28-diagnostics-and-retry-design.md`

## Global Constraints
- Strict `2xx` checks and the 60% non-critical threshold do not change.
- No raw bodies, secrets, tokens, passwords, authorization or cookie values in logs/telemetry.
- Portable app stays in `portable-zapret-tg/`; root `.bat` files unchanged.
- Manual apply, voice deferral, cooldown and cancel semantics remain intact.
- Baseline suite: `node --test tests/*.test.js` = 84 passing.

## Review Focus
- A critical target failing under every profile → one warning and exactly one retry; no winner applied if still blocked.
- A BAT with `could not read ^!` → marked invalid, excluded from passive candidates, still manually applicable.
- Settings changed during a full run → persisted but monitor restart deferred until the run ends.
- Quick check with mixed statuses → failed target names present in check/summary/log.
- Repeated winws hostlist lines → collapsed in the log without losing the count.

---

### Task 1: Per-target failure metadata and quieter winws logs

**Files:**
- Create: `app/src/log-throttle.js`
- Modify: `app/src/monitor.js`, `app/src/winws.js`
- Test: `app/tests/log-throttle.test.js`, `app/tests/monitor-diagnostics.test.js`

**Interfaces:**
- Produces: `createLogThrottle(windowMs = 2000)` returning `{ line(text) -> {text, count} | null }`.
- Produces: `check.failedTargets: string[]` and `check_summary.failedTargets`.

- [x] **Step 1: Add failing tests for throttle and failedTargets**

```js
test('createLogThrottle collapses identical lines inside the window', () => {
  const t = createLogThrottle(2000);
  assert.deepEqual(t.line('hostlist: added 1'), { text: 'hostlist: added 1', count: 1 });
  assert.equal(t.line('hostlist: added 1'), null);
});
test('probeOnce exposes failed critical target names', async () => { /* 503 server */ assert.deepEqual(check.failedTargets, ['YouTubeWeb']); });
```

- [x] **Step 2: Run the tests and watch them fail**

Run: `node --test tests/log-throttle.test.js tests/monitor-diagnostics.test.js`
Expected: FAIL for missing module/field.

- [x] **Step 3: Implement `createLogThrottle` and wire winws/monitor**

Use a `Map<text, {count, last}>`; emit only the first line. In `probeOnce`, collect `failedTargets` and include them in `check`, `check_summary` and one `warn` log line.

- [x] **Step 4: Run tests**

Run: `node --test tests/log-throttle.test.js tests/monitor-diagnostics.test.js`
Expected: PASS.

### Task 2: Failure memory and invalid-profile quarantine

**Files:**
- Create: `app/src/profile-health.js`, `app/tests/profile-health.test.js`
- Modify: `app/src/monitor.js`, `app/src/winws.js`, `app/tests/monitor-matrix-ranking.test.js`

**Interfaces:**
- Produces: `looksInvalidApplyResult(res) -> boolean`, `recentlyFailed(profileStats, now, windowMs, threshold) -> boolean`, `isInvalidProfile(profileStats) -> boolean`.
- Consumes: `stats.profiles[name]` fields `failCount`, `lastFailTs`, `invalid`, `invalidReason`.

- [x] **Step 1: Write failing tests**

```js
test('looksInvalidApplyResult detects caret parse error', () => {
  assert.equal(looksInvalidApplyResult({ ok: false, exitCode: 1, stderrTail: '[winws_err] could not read ^!' }), true);
});
test('recentlyFailed requires two failures inside the window', () => {
  assert.equal(recentlyFailed({ failCount: 2, lastFailTs: new Date().toISOString() }), true);
});
test('invalid profiles are excluded from passive candidates', () => { /* stats with invalid flag */ assert.ok(!got.includes(broken)); });
```

- [x] **Step 2: Verify RED**

Run: `node --test tests/profile-health.test.js tests/monitor-matrix-ranking.test.js`

- [x] **Step 3: Implement helpers and wire ranking/apply**

Record failure memory in `autoSwitch`; mark invalid on bad apply; demote/exclude in `rankCandidates`. `winws.startUser` returns `stderrTail`/`exitCode`.

- [x] **Step 4: Verify GREEN and full suite**

Run: `node --test tests/*.test.js`

### Task 3: Frozen full-run settings and one critical-block retry

**Files:**
- Modify: `app/src/monitor.js`, `app/src/profile-matrix.js`, `app/main.js`, `app/tests/run-all-profiles.test.js`, `app/tests/main-profile-run.test.js`
- Test: `app/tests/full-run-retry.test.js`

**Interfaces:**
- Produces: `runFullSelection({ ...runAllProfiles options, maxAttempts = 2 })` returning `runAllProfiles` result plus `criticalBlocked`, `blockedTargets`, `attempts`.
- Consumes: `probe(reason, runId, profile, settings)`, `apply(profile, { transient: true, settings })`.
- Produces: `applyProfileTransient(profileName, settings)`, `probeOnce(reason, runId, profileName, settings)`.

- [x] **Step 1: Write failing tests**

```js
test('retries once and warns when a critical target failed in every profile', async () => {
  const r = await runFullSelection(h.ctx);
  assert.equal(r.attempts, 2);
  assert.equal(r.criticalBlocked, true);
  assert.deepEqual(r.blockedTargets, ['YouTubeWeb']);
  assert.ok(h.events.some(e => /Все таргеты провалены/.test(e.message)));
});
test('does not retry when one profile passes all critical targets', async () => { assert.equal(r.attempts, 1); });
```

- [x] **Step 2: Verify RED**

Run: `node --test tests/full-run-retry.test.js`

- [x] **Step 3: Implement frozen settings and retry wrapper**

Add optional settings argument to probe/apply paths. `runFullSelection` loops up to `maxAttempts`, emits the exact warning, and never applies a winner on a blocked final attempt.

- [x] **Step 4: Verify GREEN and full suite**

Run: `node --test tests/*.test.js`

### Task 4: Renderer feedback for invalid profiles and block warnings

**Files:**
- Modify: `app/main.js`, `app/renderer/renderer.js`, `app/renderer/index.html`, `app/tests/ui-contract.test.js`

**Interfaces:**
- Consumes: `status.invalidProfiles: string[]`, `status` IPC messages.

- [x] **Step 1: Write failing UI contract test**

```js
test('banner treats blocked-target warnings as errors', () => {
  assert.match(renderer, /провал\|заблокир/);
});
test('matrix marks invalid profiles', () => {
  assert.match(index, /id="blockedBanner"/);
});
```

- [x] **Step 2: Verify RED**

Run: `node --test tests/ui-contract.test.js`

- [x] **Step 3: Add blocked banner and invalid row marker**

Add `#blockedBanner`, populate from `status.invalidProfiles`, and broaden status-message severity matching. Update hover help with the new warning and retry.

- [x] **Step 4: Verify GREEN and full suite**

Run: `node --test tests/*.test.js`

### Task 5: Verification and handoff

- [x] **Step 1: Syntax checks**

Run: `node --check src/monitor.js && node --check src/profile-matrix.js && node --check src/winws.js && node --check main.js && node --check renderer/renderer.js`

- [x] **Step 2: Full suite**

Run: `node --test tests/*.test.js`
Expected: all green, no skipped tests.

- [x] **Step 3: Report changes without committing or pushing**

Summarize files, behavior, and remaining manual verification (rebuild `dist8` only on request).
