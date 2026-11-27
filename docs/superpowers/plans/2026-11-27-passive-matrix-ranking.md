# Passive matrix ranking implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:test-driven-development`. Steps use checkbox syntax.

**Goal:** make passive auto-pick rank profiles by the visible «Профили и результаты тестов» matrix.
**Spec:** `docs/superpowers/specs/2026-11-27-passive-matrix-ranking-design.md`

## Global constraints
- Portable app in `portable-zapret-tg/`; no installer; live config/history/logs stay in the app folder.
- Root `.bat`/`service.bat` unchanged; no Linux port.
- Preserve voice deferral, manual lock, cooldown, `autoSwitchEnabled` and manual priority.
- No secrets/tokens/bodies in UI, telemetry or release notes.

### Task 1: RED tests for matrix ranking
- [ ] **Step 1:** Create `app/tests/monitor-matrix-ranking.test.js` with a fake storage exposing `readRecentDiagnostics` and a runtime dir with profiles. Assert:
  - a profile with more latest critical 2xx cells outranks one inflated in `stats.profiles`;
  - equal critical/ok counts are broken by newer `lastTs`;
  - untested profiles rank below tested ones even with a high legacy stats score;
  - `candidateCount` still caps the result.
- [ ] **Step 2:** Add a UI-contract assertion that the hover help mentions the matrix-driven passive order.
- [ ] **Step 3:** Run `node --test tests/monitor-matrix-ranking.test.js tests/ui-contract.test.js`, confirm RED for the expected reasons (ranking still stats-based, help text missing).

### Task 2: GREEN implementation
- [ ] **Step 1:** In `app/src/monitor.js`, import `buildProfileMatrix` and add `readMatrixRows()`/`scoreMatrixProfile()`; rewrite `rankCandidates()` to rank by matrix with the legacy score as untested fallback and `lastGoodProfile` as tiebreaker.
- [ ] **Step 2:** Update the `Авто-подбор` help entry in `app/renderer/index.html` with the exact matrix-order explanation.
- [ ] **Step 3:** Run both test files, confirm GREEN; run the full suite and `node --check`.

### Task 3: Rebuild and verify
- [ ] **Step 1:** Back up `dist8/win-unpacked/{config,history,logs,RUN_AS_ADMIN.txt}`.
- [ ] **Step 2:** Close ZapretTG elevated (do not kill TgWsProxy), build to `dist8-icon`, copy EXE/resources/runtime except `TgWsProxy_windows.exe`, restore backup, restart elevated.
- [ ] **Step 3:** Verify icon, 22 profiles, 27 bin files, live history, and the new help text via CDP DOM evaluation.

### Task 4: Local release
- [ ] **Step 1:** Commit source/docs/tests.
- [ ] **Step 2:** Create annotated tag `v1.1.1`; no push.
- [ ] **Step 3:** Verify `git log`, `git tag`, clean `git status`.
