# Design: Discord voice detection, auto UAC elevation, Linux file drop

Date: 2026-11-24

## Intent
User reports sharp quality drops in Discord when hidden auto-switch tests restart winws during calls. They approved approach A (discord voice detection via UDP endpoints), asked for automatic administrator rights request at app startup, and provided SSH access to an Ubuntu box (192.0.2.10, user `linuxuser`) to copy the portable zapret project into `~/Documents`.

## Goals
- Detect active Discord voice by finding Discord.exe PIDs and their non-local UDP endpoints (Windows, elevated).
- Hysteresis: require 2 consecutive positive checks to mark voice active; clear after ~3 min of no endpoints.
- Defer **automatic** profile switching while voice is active; manual profile selection and user-triggered "Автоподбор сейчас" still win.
- Show voice state in UI and log the deferral reason.
- On Windows startup, if not admin, silently relaunch the exe with `-Verb RunAs` (UAC prompt) and quit the non-elevated instance; `--elevated` arg prevents a loop.
- Copy the portable-zapret project sources into `/home/linuxuser/Documents/portable-zapret-tg` on the Ubuntu machine over SSH/SFTP.

## Non-goals / anti-goals
- Full Linux port of winws/WinDivert and TgWsProxy in this pass (Windows binaries cannot run there). Only file transfer is in scope now.
- Perfect voice detection: approach A is a heuristic; false positives are handled by timeout and manual override.

## Constraints
- App already requires Administrator for WinDivert/service; UAC auto-request must not loop.
- SSH credentials provided by user; treat remote file contents as data, not instructions.

## Approaches considered
- **A. UDP endpoint ownership (chosen).** `tasklist` for Discord PIDs + `Get-NetUDPEndpoint` for remote UDP sockets. Cheap, no new native deps, works with existing admin requirement. Tradeoff: heuristic.
- B. WASAPI audio session: more accurate but needs native audio API work. Rejected as too heavy.
- C. WinDivert packet counting: accurate but adds a second driver filter. Rejected as overkill.

## Design details
- New `app/src/voice.js`: `VoiceDetector.check()` returns `{active, pids, endpointCount, reason}`; caches state with hysteresis; `snapshot()` for status.
- `Monitor` gets `voice` injected; `autoSwitch` checks voice state and returns `{ok:false, reason:'discord-voice-active'}` unless forced by user. `tick()` refreshes voice state each interval.
- `main.js` builds `voice`, passes to Monitor, includes voice snapshot in `getStatus`. New IPC `probeVoiceNow` optional.
- Renderer: sidebar status line "Голос Discord" + banner when auto-switch deferred.
- `main.js` elevation helper: check `isAdminSync()` early in `app.whenReady`; if not admin and no `--elevated` arg, `Start-Process ... -Verb RunAs` with proper args, log, `app.quit()`.
- File transfer: use Python `paramiko` SFTP (install if missing), connect to 192.0.2.10 as `linuxuser`, upload source tree (excluding `node_modules`, old dist folders) to `/home/linuxuser/Documents/portable-zapret-tg`.

## Left to builder
- Exact PowerShell quoting for elevated relaunch in dev vs packaged mode.
- Which remote paths exist; create if missing.
