# Design: passive auto-pick ranks by the profile matrix

## Problem
`Monitor.rankCandidates()` ranks profiles using `history/stats.json` (`stats.profiles.success/fail`), which is only updated by `autoSwitch` itself after a post-switch probe. The UI table «Профили и результаты тестов» is built from `history/diagnostics.jsonl` `check` rows. The two sources diverge: quiet monitoring ticks never update `stats.profiles`, so passive auto-pick can prefer a profile that the table shows as failing.

## Goal
Passive auto-pick must iterate candidates ordered by the same matrix data the user sees, from most working and most current to least, while preserving all existing safeguards.

## Scope
- Modify `app/src/monitor.js`: `rankCandidates()` builds a matrix from recent diagnostics and ranks by latest per-target results.
- Add `app/tests/monitor-matrix-ranking.test.js`.
- Update `app/renderer/index.html` hover help so the `Авто-подбор` entry explains the matrix-based order.
- Update `app/tests/ui-contract.test.js` to pin the new help text.
- Rebuild the portable `dist8` app; create a local release commit/tag.

## Non-goals
- No full 22-profile sweep in passive mode: it applies every profile and can disturb a stable connection or Discord voice.
- No change to the manual apply path, voice hysteresis, manual lock, cooldown or `autoSwitchEnabled` guard.
- No changes to root `.bat`/`service.bat`, no installer, no Linux port.

## Ranking contract
1. Source: `storage.readRecentDiagnostics(300)` filtered by normalized `settings.healthTargets`, passed to `buildProfileMatrix({ rows, profiles, targets })` — identical to the UI matrix in `getStatus()`.
2. Tested profile score: latest critical 2xx passes dominate, then latest 2xx passes across all health targets, then freshness (`lastTs`, 7-day window). Untested profiles always rank below tested ones.
3. Untested profiles fall back to the existing `scoreProfile()` from `stats.json` so a fresh install still behaves sensibly.
4. `lastGoodProfile` is a tiebreaker only; `activeProfile` stays first because `autoSwitch()` already prepends it.
5. `candidateCount` still caps the list.

## Verification
- RED→GREEN for every new test.
- Full suite `node --test tests/*.test.js` and `node --check` for changed JS.
- Rebuild via sibling `dist8-icon`, preserve locked `TgWsProxy_windows.exe`, restore config/history/logs.
- Local commit + annotated tag; no push (no remote, no `gh`).
