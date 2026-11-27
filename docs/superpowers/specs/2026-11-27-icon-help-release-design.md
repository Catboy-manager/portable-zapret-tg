# Design — visible app icon, hover help, local release

Date: 2026-11-27
Status: approved (user picked the recommended hover panel and local commit/tag)

## Intent

The rebuilt EXE contains the new ZT icon resource, but the running window still shows the default Electron icon because `BrowserWindow` has no `icon` option. The user also wants a `?` at the top right that explains each button and the recommended order of actions on hover. Everything must then be rebuilt and released into Git.

## Goals

- Window and taskbar show the same ZT icon as `app/build/icon.ico`.
- A `?` button in the hero actions reveals, on hover **and keyboard focus**, a compact panel with (1) the recommended sequence of steps and (2) a button-to-action map.
- Existing portable layout, admin rules, voice-delay behavior, and all matrix/full-run behavior stay unchanged.
- A local Git commit and `v1.1.0` tag capture the final state. No remote push is attempted because none is configured.

## Non-goals / anti-goals

- No new native menu; standard OS window frame remains.
- No click-required modal and no one-line `title` tooltip: the user explicitly asked for hover explanation.
- No changes to probing logic, scoring, or TgWsProxy behavior.
- No password or secret values in the help text, telemetry, or release notes.

## Constraints

- App is portable; settings/logs/history stay under `dist8/win-unpacked`.
- `dist8` cannot be cleaned while ZapretTG/TgWsProxy are running. Build to a sibling folder, copy `ZapretTG.exe` + `resources` into `dist8`, preserve the locked TgWsProxy binary, then restore backed-up config/history/logs.
- `package.json` already sets `build.win.icon = build/icon.ico`; only the runtime window icon is missing.
- Git repo has one commit (`da079c1`), no remote, `gh` CLI absent.

## Approaches considered

1. **CSS hover/focus popover (chosen).** A `?` in `.hero-actions`; a sibling absolutely-positioned panel opens on `:hover` and `:focus-within`. Contains an ordered list and a definition list of buttons. Works with mouse and keyboard, no JavaScript, no layout shift, fits current dark theme. Tradeoff: needs careful max-height/overflow so it stays readable.
2. **Native `title` attribute.** Minimal code, but only one line of plain text; cannot carry the sequence and button map. Rejected.
3. **Click-to-open modal.** More room, but contradicts “при наведении” and costs an extra click. Rejected.

## Decisions

- Runtime icon: add `app/build/icon.ico` as an extra file to `resources/icon.ico`; in `main.js`, use `process.resourcesPath/icon.ico` when packaged and `app/build/icon.ico` in dev. Also set `app.setName('ZapretTG')` for a consistent taskbar label.
- Help content: recommended order is admin launch → choose user/service mode → pick and apply profile → quick probe or full matrix → auto-pick/manual lock as needed → TG proxy start/save → logs/export when something looks wrong. The button map explicitly notes that voice Discord defers auto-switching and that a cancelled full run applies no winner.
- Release: commit all source/config/UI changes plus spec/plan/ledger, tag `v1.1.0`, and leave pushing to the user.

## Left to builder

- Implement, add/adjust tests, run full suite and syntax checks.
- Rebuild, restore live data, restart, and visually verify the window icon and hover panel.
- Commit and tag locally.
