# SDD ledger — plan: docs/superpowers/plans/2026-11-27-icon-help-release.md

Spec: docs/superpowers/specs/2026-11-27-icon-help-release-design.md
Execution: inline (executing-plans), local Git release, no remote push.

Setup: 2026-11-27. Read plan + spec. Existing repo on `master` at da079c1 with uncommitted source changes from the profile-matrix work. No remote, no `gh` CLI. User approved hover panel and local commit/tag `v1.1.0`.

Pre-flight shared interfaces:
- Task 1 produces `windowIconPath()` and packaged `resources/icon.ico`; Task 3 consumes both when verifying the rebuilt app. Match: extraFiles maps `build/icon.ico` → `icon.ico`, main.js reads `process.resourcesPath/icon.ico` when packaged.
- Task 2 produces ids `btnHelp`/`helpPanel` and CSS `.help-*`; Task 3 visually verifies them. Match: no renderer.js dependency, CSS-only hover/focus.
- Task 3 produces verified built files; Task 4 stages source/docs only, not dist outputs. Match: `.gitignore` updated before `git add -A`.
- Ruling: build to sibling `dist8-icon` and copy into `dist8` while preserving the locked TgWsProxy binary — direct clean of `dist8` fails with Access denied while TgWsProxy runs, and killing TgWsProxy would disrupt the user's Telegram proxy. Cost: one extra build folder until cleanup.

Task 1: complete (tests: `node --test tests/icon-contract.test.js` RED 2/2 fail → GREEN 2/2 pass; full suite `node --test tests/*.test.js` 76/76 pass). `windowIconPath()` reads `process.resourcesPath/icon.ico` when packaged and `build/icon.ico` in dev; `app.setName('ZapretTG')` and `icon:` added to BrowserWindow; extraFiles maps `build/icon.ico` → `icon.ico`.

Task 2: complete (tests: `node --test tests/ui-contract.test.js` RED 1/8 fail → GREEN 8/8 pass; full suite 77/77 pass; `node --check main.js/preload.js/renderer/renderer.js` clean). Hover `?` added to `.hero-actions` with `btnHelp`/`helpPanel`; CSS-only reveal on `:hover` and `:focus-within`; panel contains the 7-step workflow, full button map, voice-Discord caveat and cancelled-run caveat. No renderer.js change.

Task 3: Ruling: electron-builder `extraFiles.to` is relative to the output root, not to `resources/` — the first build put `icon.ico` in `win-unpacked/` while `main.js` reads `process.resourcesPath/icon.ico`, so the file was missing at runtime. Changed mapping to `resources/icon.ico`; test `packaged resources include icon.ico` went RED after pinning the correct path and GREEN after the config fix. Cost: one extra rebuild.

Task 3: Ruling/correction: earlier claim that the EXE icon was already updated was wrong. Direct extraction showed the EXE icon pixel `(192,192,192)` versus our `(8,30,61)`. Root cause: `build.win.signAndEditExecutable: false` disables electron-builder's EXE resource editing, so the ICO was never written into the executable. Removed the flag; new test `electron builder is allowed to edit the EXE icon resource` went RED against `false` and GREEN after removal. Cost: one more rebuild, but this is the only way Explorer/taskbar shows the ZT icon.

Task 3: complete. Build to `dist8-icon` required elevation to unpack winCodeSign symlinks; the resulting EXE icon shape matches `build/icon.ico` with IoU 0.926 (previous grey Electron icon had no match). Copied EXE + `resources` into `dist8`, copied `runtime` excluding the locked `TgWsProxy_windows.exe`, restored config/history/logs/RUN_AS_ADMIN from backup. Verified 22 `general*.bat`, 27 `runtime/bin` files, `resources/icon.ico` 54285 bytes, and live `history/diagnostics.jsonl`. Restarted elevated: ZapretTG and winws running, TgWsProxy PIDs 6904/31500 untouched.

Task 3: CDP visual verification at port 9223: `#helpPanel` has `role=tooltip`, correct aria-label, all required text; before hover `opacity:0 / visibility:hidden / pointer-events:none`; after `Input.dispatchMouseEvent(mouseMoved)` the `:hover` selector matched; `document.visibilityState` was `hidden` (window minimised), which pauses CSS transitions. Focusing `#btnHelp` produced `opacity:1 / visibility:visible / pointer-events:auto` via `:focus-within`, confirming the CSS reveal works. Ruling: the hidden-window transition pause is a capture artifact, not an app defect. Full suite `node --test tests/*.test.js` 78/78 pass; `node --check main.js/preload.js/renderer/renderer.js` clean.

Task 4: complete. Added `.gitignore` for `dist*/`, `dist*-backup*/`, `node_modules/`, `__pycache__/`, `*.pyc`. Staged 40 source/docs files; verified no `dist*`, `config/`, `history/`, `logs/`, `settings.json` or `.pyc` staged. Scanned staged sources for secrets: only the pre-existing default TgWsProxy secret in `storage.js` (already in the initial commit) and redaction-test fixtures in tests; telemetry redaction tests pass and no telemetry/log/history files are versioned. Commit `release: v1.1.0 icon, hover help and profile matrix`; annotated tag `v1.1.0`. No remote configured and `gh` absent, so no push was attempted. Working tree clean after commit.
