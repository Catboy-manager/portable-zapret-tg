# Icon, Hover Help and Local Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the window/taskbar show the new ZT icon, add a top-right hover help panel explaining buttons and the recommended workflow, then rebuild, verify visually and create a local Git commit/tag release.

**Architecture:** Electron main process loads a dedicated ICO from packaged resources; renderer uses a CSS-only hover/focus popover anchored to a `?` button in the hero actions. Build stays portable; dist8 receives only EXE/resources from a clean sibling build while live config/history/logs are preserved. Release is local commit + `v1.1.0` tag because no Git remote exists.

**Tech Stack:** Node.js, Electron 33, electron-builder 25, plain HTML/CSS, node:test, PowerShell, Git.

**Spec:** `docs/superpowers/specs/2026-11-27-icon-help-release-design.md`

## Global Constraints

- Portable app remains under `portable-zapret-tg/`; no installer; settings/history/logs stay in the app folder.
- Root `.bat` and `service.bat` remain unchanged.
- Standard OS window frame remains; no native Electron menu.
- No raw packets, bodies, secrets, tokens, passwords, cookies or authorization values in UI, telemetry or release notes.
- `dist8` is locked while running; never clean it in place. Build to `dist8-icon`, copy `ZapretTG.exe` + `resources`, preserve the locked `TgWsProxy_windows.exe`, then restore backup.
- No Git remote is configured and `gh` CLI is absent; do not attempt a push.

## Review Focus

- Window shows the Electron default icon despite EXE resource → Task 1 test pins `BrowserWindow({ icon: ... })` and packaged resource path.
- Hover panel must also open for keyboard focus → Task 2 test pins `:focus-within`.
- Help text must not imply that a cancelled full run applies a winner → Task 2 test pins the exact caveat text.
- Rebuild must not lose live history or kill TgWsProxy → Task 3 backup/restore and process checks.
- Git commit must not add hundreds of MB of old builds → Task 4 `.gitignore` pins `dist*/`.

---

### Task 1: Runtime window icon

**Files:**
- Modify: `app/main.js:1-20,190-202`
- Modify: `app/package.json:27-45`
- Test: `app/tests/icon-contract.test.js` (new)

**Interfaces:**
- Consumes: existing `path` import in `main.js`; existing `build.win.icon` in `package.json`.
- Produces: `windowIconPath()` helper in `main.js` returning `resources/icon.ico` when packaged and `build/icon.ico` in dev; `extraFiles` entry mapping `build/icon.ico` → `icon.ico`.

- [ ] **Step 1: Write the failing test**

Create `app/tests/icon-contract.test.js` with tests that assert:
- `main.js` contains `function windowIconPath()`;
- `main.js` contains `app.setName('ZapretTG')`;
- `main.js` contains `path.join(process.resourcesPath, 'icon.ico')`;
- `main.js` contains `path.join(__dirname, 'build', 'icon.ico')`;
- the `new BrowserWindow({ ... })` block contains `icon: windowIconPath()`;
- `package.json` `build.extraFiles` contains `{ from: 'build/icon.ico', to: 'icon.ico' }`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/icon-contract.test.js` from `app/`.
Expected: FAIL with missing helper / missing icon option.

- [ ] **Step 3: Implement `windowIconPath()` and wire it**

In `app/main.js`, add:

```js
function windowIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, 'build', 'icon.ico');
}
```

Call `app.setName('ZapretTG')` before `app.whenReady()`. Add `icon: windowIconPath()` to the `BrowserWindow` options beside `title`.

In `app/package.json`, add a second `extraFiles` entry `{ "from": "build/icon.ico", "to": "icon.ico" }` alongside the existing runtime entry.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/icon-contract.test.js` from `app/`.
Expected: PASS.

- [ ] **Step 5: Commit the task**

```bash
git add app/main.js app/package.json app/tests/icon-contract.test.js
git commit -m "fix: show ZT icon in Electron window"
```

### Task 2: Hover help panel

**Files:**
- Modify: `app/renderer/index.html:38-48`
- Modify: `app/renderer/styles.css:42-52`
- Modify: `app/tests/ui-contract.test.js`

**Interfaces:**
- Consumes: existing `.hero-actions` flex container and dark-theme CSS variables.
- Produces: DOM ids `btnHelp`, `helpPanel`; CSS classes `.help-wrap`, `.help-btn`, `.help-panel`, `.help-steps`, `.help-keys`.

- [ ] **Step 1: Write the failing test**

Add a test to `app/tests/ui-contract.test.js` asserting:
- `html` contains `id="btnHelp"` and `id="helpPanel"`;
- `html` contains `aria-label="Подсказка по кнопкам"` and `role="tooltip"`;
- `html` contains `Порядок работы`, `Проверить все профили`, `голос Discord` and `победитель применяется только в конце`;
- `css` contains `.help-wrap`, `.help-btn`, `.help-panel`, `:focus-within` and `position:absolute`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/ui-contract.test.js` from `app/`.
Expected: FAIL with missing ids/classes/text.

- [ ] **Step 3: Add the help markup**

Inside `.hero-actions`, after the existing three buttons, add a `.help-wrap` containing:
- `<button id="btnHelp" class="help-btn" type="button" aria-label="Подсказка по кнопкам" aria-describedby="helpPanel">?</button>`
- `<div id="helpPanel" class="help-panel" role="tooltip">` with headings `Порядок работы` and `Кнопки`, an ordered list, and a definition list.

The ordered list must say, in this order: admin launch/UAC, choose user/service mode, pick and apply profile, quick probe or full matrix, auto-pick/manual lock, TG start/save, logs/export. Include the exact caveats: voice Discord defers automatic switching; a cancelled full run applies no winner and the winner is applied only at the end.

The definition list must map every visible action: Обновить, Экспорт диагностики, Проверить сейчас, Применить профиль, Остановить bypass, Установить/запустить службу, Удалить службу, Авто-подбор, Ручной lock, Запустить/Остановить/Сохранить TG, Сохранить мониторинг, Проверить все профили, Отмена, Обновить матрицы/ленты/логов, фильтры.

- [ ] **Step 4: Add CSS for hover and focus**

Append styles that:
- make `.help-wrap` `position: relative`;
- make `.help-btn` a 34px circular accent button with `cursor: help`;
- make `.help-panel` `position:absolute`, right-aligned, width 440px, `max-height:min(70vh,560px)`, `overflow:auto`, dark panel background, border, shadow, `opacity:0`, `visibility:hidden`, `pointer-events:none`, `transform:translateY(-4px)`;
- reveal it on `.help-wrap:hover .help-panel, .help-wrap:focus-within .help-panel` with `opacity:1`, `visibility:visible`, `pointer-events:auto`, `transform:none`;
- style `.help-steps`, `.help-keys`, `dt`, `dd` for compact readable text.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/ui-contract.test.js` from `app/`.
Expected: PASS.

- [ ] **Step 6: Commit the task**

```bash
git add app/renderer/index.html app/renderer/styles.css app/tests/ui-contract.test.js
git commit -m "feat: add hover help for controls"
```

### Task 3: Rebuild, restore and visually verify

**Files:**
- Modify: none (build artifacts are regenerated).
- Verify: `app/build/icon.ico`, `dist8/win-unpacked/ZapretTG.exe`, `dist8/win-unpacked/resources/icon.ico`, `dist8/win-unpacked/config/settings.json`, `dist8/win-unpacked/history/diagnostics.jsonl`.

**Interfaces:**
- Consumes: Task 1 packaged icon resource; Task 2 markup/styles.
- Produces: running app with visible ZT icon and hover panel; `dist8` restored from backup.

- [ ] **Step 1: Full verification before rebuild**

Run from `app/`:
- `node --test tests/*.test.js`
- `node --check main.js`
- `node --check preload.js`
- `node --check renderer/renderer.js`

Expected: all tests pass and no syntax errors.

- [ ] **Step 2: Back up live portable state**

Copy `dist8/win-unpacked/config`, `history`, `logs`, `RUN_AS_ADMIN.txt` to `C:\Users\<user>\AppData\Local\Temp\opencode\dist8-icon-help-backup`.

- [ ] **Step 3: Close the running app with UAC elevation**

Close ZapretTG via elevated PowerShell; confirm no ZapretTG process remains. Do not stop TgWsProxy.

- [ ] **Step 4: Build clean sibling output**

Run with `CSC_IDENTITY_AUTO_DISCOVERY=false`: `npx electron-builder --win dir --x64` after temporarily setting `build.directories.output` to `../dist8-icon`; restore output to `../dist8` immediately after the build.

- [ ] **Step 5: Copy into dist8 without touching locked TgWsProxy**

Copy `dist8-icon/win-unpacked/ZapretTG.exe` and all of `dist8-icon/win-unpacked/resources` into `dist8/win-unpacked`. For `runtime`, copy everything except `TgWsProxy_windows.exe`. Restore the backup from Step 2.

- [ ] **Step 6: Verify files and restart**

Assert: `ZapretTG.exe`, `resources/app.asar`, `resources/icon.ico`, 22 `general*.bat`, 27 `runtime/bin` files, and live `history/diagnostics.jsonl` are present. Restart `dist8/win-unpacked/ZapretTG.exe` elevated; confirm ZapretTG and winws are running.

- [ ] **Step 7: Visual check**

Capture a screenshot of the running window. Move the cursor over `btnHelp` and capture a second screenshot. Read both images and confirm: the window/taskbar icon is the ZT shield, `?` is visible at top right, and the hover panel shows the ordered steps and button map. Extract the EXE icon resource and confirm it still contains the ZT shield.

### Task 4: Local Git release

**Files:**
- Modify: `.gitignore`
- Verify: `git log`, `git tag`, `git status`.

**Interfaces:**
- Consumes: all committed source changes from Tasks 1–3.
- Produces: local commit and tag `v1.1.0`; no remote push.

- [ ] **Step 1: Ignore build outputs**

Add `dist*/` and `dist*-backup*/` to `.gitignore` so old dist folders and new build output are not committed.

- [ ] **Step 2: Stage source and documentation only**

Run: `git add -A`. Verify with `git status --short` that no `dist*` paths are staged and no secrets/logs/history are staged.

- [ ] **Step 3: Commit and tag**

```bash
git commit -m "release: v1.1.0 icon, hover help and profile matrix"
git tag -a v1.1.0 -m "v1.1.0: profile test matrix, strict 2xx checks, ZT icon, hover help"
```

- [ ] **Step 4: Verify release state**

Run `git log --oneline -3`, `git tag --list`, `git status --short`. Expected: `v1.1.0` present, working tree clean apart from ignored build outputs.

- [ ] **Step 5: Report**

Report in Russian: what changed, verification evidence, local tag, and that no push was attempted because no remote is configured.
