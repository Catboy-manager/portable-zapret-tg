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
