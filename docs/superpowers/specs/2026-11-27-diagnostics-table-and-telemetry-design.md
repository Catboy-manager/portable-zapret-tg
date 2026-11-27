# Design: menu-free UI, diagnostics table, detailed local telemetry

Date: 2026-11-27

## Intent
The user asked for three changes:
1. Remove the old native top menu (`file`, `edit`, `view`, ...).
2. Add a diagnostics table where each target probe and profile-selection attempt is visible.
3. Add as much useful local logging as practical so future debugging can be done from the logs: traffic availability, profile selection, packet/connection metadata, clicks, window sizes, system language, etc.

Approved approach: option 2 — keep the standard OS window frame, remove only Electron's native menu, add an append-only diagnostics history plus detailed structured telemetry. Approved traffic depth: metadata only, never packet payloads.

## Goals
- Call `Menu.setApplicationMenu(null)` so no native menu bar is created.
- Replace the current last-check cards and the free-form diagnostic blob with one filterable table using the newest-first history.
- Record one row per target probe, per probe summary, and per profile decision/attempt, including why automatic switching was skipped or deferred.
- Record structured telemetry for app startup, IPC timings, UI clicks, window bounds, system language/locale, monitor checks, TgWsProxy health, voice state, winws/service actions.
- Keep all data inside the portable folder: `logs/` and `history/`.
- Export diagnostics should include the new history and telemetry tails.

## Non-goals / anti-goals
- No full packet capture and no payload/body logging. “Traffic/packets” means metadata: HTTP status, latency, error codes, content-length when already available, TCP states and counts by process.
- No custom frameless window or hand-drawn titlebar in this pass.
- No changes to root `.bat` files or `service.bat`.
- No Linux port of winws/WinDivert/TgWsProxy; only source copying remains as before.
- No secret/token/password values in any log, diagnostics row, export, or IPC telemetry event.

## Constraints
- The app is portable; `BASE_DIR` is the folder next to `ZapretTG.exe` when packaged and the project root in dev.
- Existing manual-priority and Discord-voice rules must not change: manual profile choice wins; auto-switch is deferred during voice and while manual lock is active.
- Logs must stay bounded: append-only JSONL with rotation, not an ever-growing single file.
- Renderer runs with `contextIsolation: true`; all new UI telemetry must go through `preload.js` IPC, not direct Node access.

## Design details

### 1. Native menu
- In `main.js`, import `Menu` from Electron and call `Menu.setApplicationMenu(null)` before creating the window.
- Keep the normal resizable OS window frame; only the old menu bar disappears.

### 2. Storage additions
- `Storage` gains:
  - `diagnosticsFile = history/diagnostics.jsonl`
  - `telemetryFile = logs/telemetry.jsonl`
  - `recordDiagnostics(row)`, `recordTelemetry(scope, event)`, `readRecentDiagnostics(n)`, `readRecentTelemetry(n)`.
- Each append writes one compact JSON line with a server-side `ts`.
- Rotation: when a file exceeds 10 MB, rename existing `.2 → .3`, `.1 → .2`, current → `.1`, then create a fresh file. Keep 3 rotated files.
- Redaction helper recursively removes or masks keys matching `/secret|token|password|authorization|cookie/i` and redacts sensitive query parameters in URLs. The Telegram proxy link and secret must never appear in telemetry.
- Default settings gain `telemetryEnabled: true` and a checkbox in the monitoring card. Old settings files are merged with defaults, so existing configs work.

### 3. Diagnostics row schema
Common fields: `ts`, `kind` (`check`, `check_summary`, `profile_decision`, `profile_attempt`, `watchdog`, `voice`), `reason`, `level` (`ok`, `fail`, `warn`, `info`).

Per `check` row: `target`, `url` (redacted), `ok`, `httpStatus`, `ms`, `error`, `errorCode`, `bytes`, `activeProfile`, `mode`, `admin`, `voiceActive`.

Per `profile_decision` row: `decision` (`applied`, `skipped-cooldown`, `skipped-manual-lock`, `deferred-voice`, `no-candidates`, `rolled-back`), `reason`, `from`, `to`, `manual`, `voiceActive`, `candidates` with score, `ms`.

Per `profile_attempt` row: `from`, `to`, `ok`, `reason`, `applyMs`, `probeMs`, `postCheckOk`, `postCheckCount`, `applyResult` (code/message only), `admin`, `voiceActive`.

Per `watchdog` row: `pids`, `synSent`, `established`, `healthy`, `unhealthyHits`, `restarted`.

### 4. Probe changes
- `httpProbe()` returns `ms`, `errorCode` and `bytes` in addition to `ok`/`status`.
- `probeOnce()` records one `check` row per target plus one `check_summary` row; the existing `stats.json` and `events.jsonl` behavior remains for compatibility.
- `pickMonitorTargets()` remains the source of target selection, so `healthTargets` still controls what is probed.
- The current 403/404-as-success caveat remains documented; changing that policy is not part of this UI/logging pass.

### 5. Profile-selection instrumentation
- `Monitor.autoSwitch()` records every early exit with its exact reason, voice/manual-lock state, and candidate list.
- Each candidate loop iteration records a `profile_attempt` with apply duration and post-switch check summary.
- Successful and failed selections record a `profile_decision` row; existing `events.jsonl` records stay unchanged.

### 6. Main-process telemetry
- At startup, log one `app_start` telemetry event: app version, Electron/Node/Chrome versions, platform/arch, system locale and language, timezone, packaged flag, elevated flag, `BASE_DIR`, screen size.
- Log `window_bounds` on `resize`, `move`, `focus` and `close` (debounced where practical).
- Wrap every `ipcMain.handle` with duration/success/failure telemetry: channel name, duration, error code/message, no argument payload.
- Log TgWsProxy health fields from `ensureHealthy()` and voice snapshot fields from `VoiceDetector`.
- `getStatus()` includes `diagnostics` rows and a small telemetry summary so the renderer can populate the table without extra calls.

### 7. Renderer/UI
- Replace the current `checkResults` card markup and the duplicated `diagCard` block with one wide card containing:
  - a compact filter row: `Все / Цели / Подбор / События`, `Обновить`;
  - a `<table>` with columns: время, тип, цель/профиль, результат, детали;
  - newest rows first, max ~300 rows in the DOM, full history still on disk;
  - row expansion or title attributes for long error strings.
- Add a `Подробные логи` checkbox next to monitoring settings.
- Add generic click telemetry for buttons and segmented controls: element id, action, and resulting banner kind; never log input values, especially the proxy secret.
- Keep existing status pills and banners unchanged.

### 8. IPC/preload
- Add `getDiagnostics(limit)`, `trackUi(meta)` and expose them in `preload.js`.
- Extend `exportDiagnostics()` to include `diagnostics.jsonl` and `telemetry.jsonl` tails plus current status.

### 9. Tests and verification
- New `tests/telemetry.test.js`: redaction (secret/password never survives), rotation with a small temp file, diagnostics-row creation.
- Keep existing 19 tests passing: `voice`, `monitor-voice`, `elevation`, `tgproxy-health`.
- `node --check` on all changed main/src files.
- Rebuild to a fresh `dist7/win-unpacked/ZapretTG.exe`; verify `runtime/`, `config/`, `history/`, `logs/`, `RUN_AS_ADMIN.txt`, 22 profiles, and asar contents.
- Recopy sources to Ubuntu and run the read-only verifier.

## Acceptance criteria
- Launching the app shows no `file/edit/view` menu bar.
- The diagnostics table shows both target probes and profile-selection decisions with reasons.
- New JSONL files appear under `history/` and `logs/`, remain bounded by rotation, contain no proxy secret, and are included in exported diagnostics.
- Manual priority, voice deferral, TgWsProxy watchdog and all existing behavior remain intact.
- Full test suite and build verification pass.

## Risks / deferred
- Very verbose logging can fill disk; mitigated by 10 MB × 4 files per stream and a user toggle.
- Renderer click telemetry may be noisy; only explicit interactive controls are tracked.
- Diagnostics table uses existing IPC status polling; no live streaming is added in this pass.
