# Public release hardening and in-app updater — short design

## Intent
The portable ZapretTG repo is about to become public. Before that, published content must not carry a working proxy secret, internal host/user details, or local Windows paths. Users also need a safe way to update the packaged app from inside the app itself, without an installer and without losing their local settings/history/logs.

## Goals
- Purge the bundled MTProto secret, internal IP/user and local paths from the current tree **and** history.
- Flip the GitHub repo to public only after the audit is clean.
- Add an in-app "Проверить обновления" flow: check GitHub `releases/latest`, verify SHA-256 pinned in the release body, download the portable ZIP, stage it, then apply via a detached helper that waits for exit, preserves local state and relaunches.
- Rebuild `dist8`, bump the app version, publish the ZIP as a release asset, commit/tag/push the source.

## Non-goals
- No installer, no silent auto-update, no change to root `.bat` files.
- No Linux source copy in this round.
- No remote push before the security audit is clean.

## Constraints
- Portable layout preserved; `config/`, `history/`, `logs/`, `RUN_AS_ADMIN.txt` must survive an update.
- `dist*` stays ignored; binaries ship as a GitHub release asset, not in git.
- Update helper must never receive secrets or tokens on its command line.
- All existing tests stay green; new behavior goes test-first.

## Approaches
1. **GitHub release asset + detached PowerShell swap (chosen).** One trusted HTTPS endpoint, integrity via SHA-256 in the release body, no new runtime dependencies. The helper needs elevated-free file access only inside the app folder.
2. **`electron-updater` with NSIS.** Rejected: it installs system-wide, which violates the portable requirement.
3. **Fetch raw source files and patch `app.asar`.** Rejected: fragile, cannot update Electron binaries or runtime lists safely.

## Design
- `src/updater.js` — pure helpers: `compareVersions`, `parseLatestRelease` (tag → version, asset → URL, body → `sha256:`), `verifySha256`, `planUpdate` (replace vs preserve paths), `buildApplyScript`.
- `main.js` — IPC `checkForUpdates`, `downloadUpdate`, `applyUpdate`, `getUpdateState`; emits `update-progress`. Download uses Node `fetch` with a size cap; hash checked before staging; extraction via `tar.exe -xf`.
- `renderer` — a "Проверить обновления" button, result banner and progress line; help text explains that local data is preserved and the app restarts.
- Release asset body contains `SHA256: <hex>`; the checker refuses a release without it.
- Security scrub: default secret → empty; test/doc fixtures use `TEST_SECRET_VALUE`; docs/scripts use `192.0.2.10` / `<user>` placeholders; history rewritten with `git filter-branch` and a backup ref kept locally.

## Open builder calls
- Release asset is named `ZapretTG-<version>-win-x64.zip` and contains `win-unpacked/` contents at the root.
- Version becomes `1.2.0`; tag `v1.2.0`.
- If a second blocked full run still fails, no winner is applied (existing behavior).
