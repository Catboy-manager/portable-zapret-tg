# Design: profile test matrix, strict target health, explicit full run

Date: 2026-11-27

## Intent

The user asked for a diagnostics table that shows **all configs/profiles and the results of their tests**, not a tail of recent check events. Current logs show why this matters: only `general (ALT3).bat` has any check data at all, while its real YouTube path is failing and the UI still reports health as `overallOk: true` with `okCount: 5/8`.

A fresh read of `dist7/win-unpacked/history/diagnostics.jsonl` and `logs/telemetry.jsonl` found:

- `httpProbe()` treats any HTTP response as success, so `301`, `303` and `404` count as OK (`monitor.js:23-26`).
- `probeOnce()` declares health with `okCount >= ceil(total * 0.6)` (`monitor.js:121`); the latest check was `5/8` and still green.
- `YouTubeWeb` had 0 successes in 8 checks, `DiscordMedia` 0/8, while `YouTubeShort` and `YouTubeImage` were green on redirect/404 responses.
- Direct probes during investigation: `www.youtube.com/watch` timed out, `/youtubei/v1/player` and `redirector.googlevideo.com` reset/timed out; `i.ytimg.com/vi/.../hqdefault.jpg`, `rutracker.org/forum/index.php` and `static.rutracker.cc` returned 200.
- All 21 profiles other than `general (ALT3).bat` have no test rows in diagnostics history.

## Goals

- Present a matrix: every `general*.bat` profile as a row, every configured target as a column, with last result, status/error, latency and ok/fail counts per cell.
- Keep the raw event tail available, but demote it below the matrix so it is no longer the primary diagnostics view.
- Add an explicit user action to test all profiles sequentially and record per-profile results.
- Make health reflect real service availability: concrete URLs, 2xx-only success, and a critical-target requirement.
- After an explicit full run, leave the best-scoring profile applied, with manual lock cleared so automatic monitoring still works.
- Preserve manual priority, voice-call deferral, metadata-only telemetry, redaction and rotation.

## Non-goals

- No packet payloads or response bodies.
- No Linux winws/WinDivert port; Linux gets source copies only.
- No change to TgWsProxy watchdog threshold (60 SYN_SENT) or Telegram endpoint handling.
- No automatic full run on startup; it happens only from an explicit button.

## Constraints and decisions already made with the user

1. Table mode: **both** history-based matrix and explicit active full run.
2. Health policy: **tighten** it — real URLs, 2xx only, separate critical targets.
3. After full run: **leave the best profile**, not the original one.
4. Full run is explicit, but must not disturb an active Discord voice call; it is blocked while voice is active and stops after the current profile if voice starts mid-run.
5. Building goes to a fresh `dist8` directory, because `dist7` is currently running and its EXE can become locked.

### Builder-check rulings

- **Aborted/cancelled run:** no final winner is applied. The run only applies a winner when it completes with at least one tested profile; voice or cancellation stops after the current profile and leaves the profile that was active before the run.
- **Matrix columns:** the targets in `healthTargets` (the targets actually probed), not all 15 HTTP entries in `targets.txt`. Full run also probes exactly this list, so every matrix column can be populated.
- **Intermediate applies:** transient. A test-run apply starts winws/service for that profile but does not write `activeProfile`, `lastGoodProfile` or manual lock. Only the final winner of a completed run is persisted. A crash therefore leaves the original profile in settings.
- **Settings migration:** `loadSettings()` normalizes `healthTargets` by adding missing critical/default target names while preserving any extra user targets. This prevents inherited `dist7` settings from permanently producing `criticalMissing`.
- **Legacy rows:** the matrix re-grades old `check` rows under the new 2xx policy (`effectiveOk = row.ok && status in 200..299`). The raw event tail still shows the original row unchanged.
- **dist8 history:** copy `diagnostics.jsonl`, `events.jsonl`, `stats.json` and the current `config/settings.json` from `dist7`, then normalize settings. The matrix is populated at first launch instead of starting empty.

## Approaches considered

### A. History-only matrix

Build the matrix only from `diagnostics.jsonl`. Safe and instant, but 21 of 22 profiles would be shown as untested until the user manually applies them. Rejected as the only approach because the user wants results for all configs.

### B. Active full run only

Apply each profile and probe all targets when requested. Provides real data, but until the run happens the table is empty, and it repeatedly restarts winws. Rejected as the only approach because there is already useful history to display.

### C. Both — chosen

Show the history matrix immediately; add a separate, explicit full-run button that performs the intrusive test with progress, cancellation and voice protection. This gives value now without surprise profile switching, and gives complete data on demand.

## Design

### 1. Diagnostics data model

Each `check` row already carries `profile`, `target`, `ok`, `status`, `ms`, `error`, `errorCode` and `ts`. Add:

- `runId`: identifier of an explicit full run; absent for normal monitoring.
- `critical`: boolean copied from target metadata, so strict failures are visible in the table.

Add one `profile_run` row per profile in a full run with `applyMs`, `okCount`, `total`, `criticalOk`, `criticalTotal`, `score` and `decision` (`applied` / `apply_failed` / `aborted`).

`Storage.readRecentDiagnostics()` stays bounded to the newest 300 rows for UI use; full history remains on disk with the existing 10 MB × 3-backup rotation.

### 2. Strict target health

`httpProbe()` success becomes `status >= 200 && status < 300`.

Replace root/placeholder probe URLs with concrete endpoints:

- `DiscordMain`: `https://discord.com`
- `DiscordGateway`: `https://discord.com/api/gateway`
- `DiscordCDN`: `https://cdn.discordapp.com/embed/avatars/0.png`
- `DiscordMedia`: `https://media.discordapp.net/embed/avatars/0.png`
- `YouTubeWeb`: `https://www.youtube.com/watch?v=jNQXAC9IVRw`
- `YouTubeVideoRedirect`: `https://redirector.googlevideo.com`
- `YouTubeImage`: `https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg`
- `RuTrackerMain`: `https://rutracker.org/forum/index.php`
- `RuTrackerStatic`: `https://static.rutracker.cc`

`YouTubeShort` is removed from the default `healthTargets` because a short link always answers 303 and would now be a permanent false failure; the target remains in `targets.txt` for manual use.

Default `healthTargets`: `DiscordMain`, `DiscordGateway`, `DiscordCDN`, `DiscordMedia`, `YouTubeWeb`, `YouTubeVideoRedirect`, `YouTubeImage`, `RuTrackerMain`, `RuTrackerStatic`.

Critical targets: `YouTubeWeb`, `YouTubeVideoRedirect`, `DiscordCDN`, `DiscordMedia`, `RuTrackerMain`.

`overallOk` becomes:

```text
critical.every(ok) && nonCriticalOk >= ceil(nonCriticalTotal * 0.6)
```

`pickMonitorTargets()` must keep critical targets when they are present in `healthTargets`; the default `healthTargets` is updated to include the new names. A missing critical target is recorded as `criticalMissing` and makes health false rather than being silently ignored.

### 3. Explicit full run

New IPC `runAllProfiles()` / `cancelRunAllProfiles()` and monitor method `runAllProfiles()`:

- Refuse to start while voice is active or another run is in progress.
- Pause normal monitor ticks for the duration.
- For each profile in `listProfiles()`:
  - apply it through a transient test-run path that starts winws/service but does not persist `activeProfile`, `lastGoodProfile` or manual lock;
  - run `probeOnce('profile-test')` with the new `runId`;
  - record a `profile_run` row with score and decision;
  - emit progress to the renderer.
- If voice becomes active, stop after the current profile and mark remaining profiles `aborted_voice`.
- If cancelled, stop after the current profile and mark remaining profiles `aborted_user`.
- Score is primary critical-pass count, then okCount, then lower total latency.
- Only a completed run with at least one tested profile applies the winner, clearing manual lock and persisting it as active/lastGood. An aborted/cancelled run leaves the profile that was active before the run untouched.

### 4. Renderer matrix

Primary card: **«Матрица конфигов»**.

```text
[Все конфиги: 22] [Протестировано: 1] [Протестировать все] [Отмена] [Обновить]

Профиль              YouTubeWeb   DiscordMedia   RuTrackerMain   ...   Итог
general (ALT3).bat   FAIL timeout FAIL timeout   OK 200 149мс    ...   3/8 крит. 2/5
general (ALT10).bat  —            —              —               ...   не тестировался
...
```

Cell contents are metadata only: `OK <status> <ms>мс` or `FAIL <error> <ms>мс`, plus ok/fail counts in the title attribute. Untested cells show `—`. Newest result per profile/target wins; the matrix is built by grouping `diagnostics.jsonl` rows in the renderer from `getStatus().diagnostics` and `getDiagnostics(300)`. Legacy rows are re-graded with `effectiveOk = row.ok && status >= 200 && status < 300`, so old `OK 404` rows display as failures without rewriting the file.

Below it, keep the existing detailed event table under a collapsed **«Лента событий»** section. Keep the telemetry toggle and filters there.

Text escaping and URL redaction already in `renderer.js` continue to apply.

### 5. Tests

- `http-probe.test.js`: 2xx only; 301/303/404 fail; `critical` metadata survives.
- `monitor-diagnostics.test.js`: critical failure makes `overallOk` false even when 5/8 targets pass; `criticalMissing` is recorded.
- New `profile-matrix.test.js`: grouping produces 22 rows, untested profiles marked, newest result wins, counts correct, legacy 301/303/404 rows are re-graded as failures.
- New `run-all-profiles.test.js` with stubbed apply/probe: sequential execution, `runId` propagation, voice abort, cancellation, best-profile selection and manual-lock clearing.
- `ui-contract.test.js`: matrix ids, full-run/cancel buttons and event-tail section present.
- Full suite, `node --check`, fresh `dist8` build and portable-folder verification.

## Risks / deferred

- A full run applies 22 profiles and restarts winws repeatedly; it is explicit, cancellable and voice-protected.
- Strict 2xx will turn currently ambiguous 301/303/404 checks red; that is intentional, but it may increase auto-switch attempts. The existing sustained-degradation requirement and cooldown still apply.
- The exact failing RuTracker page was not supplied; the chosen probe is the forum index that currently returns 200. Another URL can be added later without changing the matrix.
- `dist7` remains installed locally as the previous build; this change ships as `dist8`.
