# Public release and in-app updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the repo for public visibility, add a safe in-app updater, rebuild, publish a release asset and push.

**Architecture:** Pure helpers in `src/updater.js`; Electron IPC orchestration in `main.js`; a detached PowerShell swap script that preserves local data. Release ZIP and checksum live on GitHub Releases; git holds source only.

**Tech Stack:** Node 20+ built-in `node:test`, Electron 33 IPC, PowerShell 5.1, `tar.exe`, GitHub REST API.

**Spec:** `docs/superpowers/specs/2026-11-28-public-release-and-updater-design.md`

## Global Constraints
- No installer; root `.bat` files unchanged.
- `dist*` ignored; no binaries committed to git.
- Never put tokens/passwords/secrets in logs, UI or updater command lines.
- Preserve `config/`, `history/`, `logs/`, `RUN_AS_ADMIN.txt` across updates.
- Linux source copy untouched in this round.
- Existing 108 tests stay green.

## Review Focus
- A release without `SHA256:` in its body must be rejected — pinned by a `parseLatestRelease` test.
- A ZIP with a wrong hash must never be extracted — pinned by `downloadUpdate` hash test.
- Preserved paths must not be overwritten by archive entries — pinned by `planUpdate` test.
- The apply script must not embed a token or secret — pinned by a script-content test.
- History must not expose the old secret/IP/user after rewrite — pinned by a `git grep --all` audit.

---

### Task 1: Security scrub and history rewrite

**Files:**
- Modify: `app/src/storage.js`, `app/tests/telemetry.test.js`, `app/tests/run-all-profiles.test.js`, `app/tests/tgproxy-health.test.js`, `scripts/copy_to_linux.py`, `scripts/verify_linux_copy.py`, `docs/superpowers/**`

- [ ] **Step 1: Replace the default secret with '' in storage and fixtures with TEST_SECRET_VALUE**
- [ ] **Step 2: Replace internal IPs/users/paths in docs and scripts with placeholders**
- [ ] **Step 3: Run `node --test tests/*.test.js` — all green**
- [ ] **Step 4: Rewrite history with a backup ref; verify `git grep` across all commits is clean**
- [ ] **Step 5: Commit the scrub**

### Task 2: Update helpers

**Files:**
- Create: `app/src/updater.js`, `app/tests/updater.test.js`

**Interfaces:**
- `compareVersions(a, b) -> number`
- `parseLatestRelease(payload) -> { version, assetUrl, sha256, notes }` (throws without SHA256)
- `verifySha256(buffer, expected) -> boolean`
- `planUpdate(entries, preserve) -> { replace: string[], preserve: string[] }`
- `buildApplyScript({ appRoot, stagingDir, exeName, parentPid }) -> string`

- [ ] **Step 1: Write failing tests for all five helpers**
- [ ] **Step 2: Run tests and watch them fail**
- [ ] **Step 3: Implement helpers**
- [ ] **Step 4: Run tests green**

### Task 3: IPC and UI

**Files:**
- Modify: `app/main.js`, `app/preload.js`, `app/renderer/index.html`, `app/renderer/renderer.js`, `app/tests/main-update.test.js`, `app/tests/ui-contract.test.js`

- [ ] **Step 1: Write failing IPC/UI contract tests**
- [ ] **Step 2: Implement check/download/apply IPC with progress events**
- [ ] **Step 3: Add button, banner and hover help**
- [ ] **Step 4: Run full suite and `node --check`**

### Task 4: Release and push

- [ ] **Step 1: Bump `app/package.json` version to 1.2.0**
- [ ] **Step 2: Rebuild `dist8` via sibling `dist8-icon`, preserving live config/history/logs/RUN_AS_ADMIN.txt and locked TgWsProxy**
- [ ] **Step 3: Create `ZapretTG-1.2.0-win-x64.zip` with SHA256 in release body**
- [ ] **Step 4: Flip repo to public via GitHub API**
- [ ] **Step 5: Commit, annotated tag v1.2.0, push branch and tags**
- [ ] **Step 6: Upload release asset**
- [ ] **Step 7: Verify latest-release API response is consumable by the updater**
