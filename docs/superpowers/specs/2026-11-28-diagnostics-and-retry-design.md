# Diagnostics, failure memory and critical-block retry — short design

## Intent
The 17:32–22:23 log showed three recurring problems: passive auto-pick kept cycling the same three candidates, per-target failures were invisible, and a critical target could fail under every profile without the app saying so. This change makes failures observable and gives the user one automatic full-run retry when a critical target is blocked everywhere.

## Goals
- Log failed target names with status/latency/error for every quick check.
- Remember recently failed profiles and demote them in passive ranking; never auto-cycle the same failed set indefinitely.
- Mark profiles whose BAT is syntactically broken as `invalid` and keep them out of passive selection.
- Freeze health settings for the duration of a full run; defer monitor restart until it finishes.
- If no profile passes every critical target, show the exact notification `все таргеты провалены, провайдер заблокировал все методы обхода` and run the full selection once more. The retry is logged separately as `Повторяю полный подбор`.
- Reduce repeated winws hostlist lines in the log.

## Non-goals
- No loosening of strict `2xx` health rules or the 60% non-critical threshold.
- No Linux changes, no remote push, no installer.
- No raw packet bodies, secrets, tokens, cookies or authorization values in telemetry.

## Constraints
- Portable layout and root `.bat` files unchanged.
- Manual profile choice keeps priority; voice deferral and cooldown guards remain.
- A cancelled/voice-aborted run still writes no profile winner.
- Existing 84 tests must stay green; new behavior goes test-first.

## Approaches
1. **Centralize in existing modules (chosen).** Extend `monitor.js`, `profile-matrix.js`, `winws.js`, `main.js` and the renderer with small pure helpers. Cheapest, preserves current architecture.
2. **New orchestration service.** Cleaner boundaries but would duplicate storage/monitor wiring; rejected as over-engineering for this codebase.
3. **UI-only warnings.** Would not fix candidate cycling or settings interruption; rejected.

## Design
- `probeOnce()` adds `failedTargets` to its return value and to `check_summary`; `Monitor.log` writes one concise warning line listing failed targets.
- `stats.profiles[name]` gains `failCount`, `lastFailTs`, `failedTargets` and `invalid`/`invalidReason`. `rankCandidates()` penalizes profiles with `failCount >= 2` and `lastFailTs` within 30 minutes, and excludes `invalid` profiles from passive candidates. Manual selection still works.
- `WinwsManager.startUser()` returns `stderrTail` and `exitCode` on failure. `looksInvalidApplyResult()` marks a profile invalid when stderr contains `winws_err`/`could not read ^!` and the process exited non-zero.
- `createLogThrottle()` collapses identical winws lines within 2 seconds into one line with a `xN` suffix.
- `applyProfileTransient(name, settings)` and `probeOnce(reason, runId, profile, settings)` accept a frozen settings snapshot captured at full-run start. `saveSettings` during a run persists the patch but postpones `monitor.stop()/start()` until the run finishes.
- `runFullSelection()` wraps `runAllProfiles()` and retries once when every applied profile missed at least one critical target. It emits a `status` message with the exact wording above before the retry.
- Renderer treats `провал/заблокир` status messages as errors and marks invalid profiles in the matrix.

## Open builder calls
- Retry count is exactly one extra attempt; a second failure leaves the previous active profile untouched and reports the blocked targets.
- Failure memory is advisory only: it never affects manual apply and never deletes history.
