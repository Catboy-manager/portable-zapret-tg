# SDD ledger — plan: docs/superpowers/plans/2026-11-27-passive-matrix-ranking.md

Spec: docs/superpowers/specs/2026-11-27-passive-matrix-ranking-design.md
Execution: inline, TDD, local release tag `v1.1.1`, no remote push.

Setup: 2026-11-27. User approved option 1: passive auto-pick must iterate the most working/current strategies from the «Профили и результаты тестов» table. Current repo HEAD `f5afd56` / tag `v1.1.0`, working tree clean. App running from `dist8/win-unpacked`.

Shared interfaces:
- `rankCandidates()` consumes `storage.readRecentDiagnostics(300)` + normalized `settings.healthTargets` and produces `{name, score}` entries consumed by `autoSwitch()`. Match: `getStatus()` builds the visible matrix from the same rows/limit/targets.
- `autoSwitch()` still prepends `settings.activeProfile`, so active stays first regardless of rank; all guards remain upstream of candidate iteration.
- Help text lives in `index.html` only; CSS reveal unchanged; `ui-contract.test.js` pins the wording.

Rulings:
- Keep `scoreProfile()` as a fallback for profiles with no matrix rows so a fresh install keeps sensible behaviour. Cost: two scoring paths, but the matrix path always dominates tested profiles.
- Do not add a passive full sweep: it transiently applies all 22 profiles and can disturb stable internet or Discord voice. Cost: passive explores only the top `candidateCount` strategies instead of all of them.

Task 1 + 2: complete. RED: 5 failures in `monitor-matrix-ranking.test.js` + `ui-contract.test.js` for the expected reasons (stats-inflated `lastGoodProfile` won, stale profile won on ties, untested profile won over a tested one, `readRecentDiagnostics` never called, help text missing); the `candidateCount` cap test passed as a regression guard. GREEN: `rankCandidates()` now builds the matrix from `readRecentDiagnostics(300)` with normalized health targets, scores tested profiles by `1e6 + criticalOk*1e4 + currentOk*10 + freshness`, keeps `scoreProfile()` as untested fallback, and uses `lastGoodProfile` only as a tiebreaker. `autoSwitch()` still prepends `activeProfile` and keeps every guard. One test failure was a typo in the assertion (`таблице` vs `из таблицы`), fixed in the test, not in production code. Full suite `node --test tests/*.test.js` 84/84 pass; `node --check src/monitor.js/main.js/preload.js/renderer/renderer.js` clean.

Task 3: complete. Backed up `dist8/win-unpacked/{config,history,logs,RUN_AS_ADMIN.txt}`, closed ZapretTG elevated without touching TgWsProxy (PIDs 14112/16264 alive), built clean sibling `dist8-icon` elevated, copied EXE + resources + runtime except `TgWsProxy_windows.exe`, restored live data, restarted elevated. Verified EXE icon shape IoU 0.926, `app.asar` 184870 bytes, 22 `general*.bat`, 27 `runtime/bin` files, live `diagnostics.jsonl` 751960 bytes. CDP check of the packaged app confirmed the new help text (`из таблицы «Профили и результаты тестов»`, `критические цели`, `свежесть`) and then the app was restarted without the debug port; winws running.

Task 4: complete. Seven source/test/doc files staged; no `dist*`, `config/`, `history/`, `logs/` or bytecode staged. Commit `feat: rank passive auto-pick by profile matrix`, annotated tag `v1.1.1`; no push (no remote, no `gh`). Working tree clean after commit.
