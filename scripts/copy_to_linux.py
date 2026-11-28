#!/usr/bin/env python3
"""Copy portable-zapret-tg sources to a remote Linux host over SFTP.

Password is read only from ZAPRET_LINUX_PASSWORD, never from argv.
Usage:
  python scripts/copy_to_linux.py --dry-run
  python scripts/copy_to_linux.py --check
  python scripts/copy_to_linux.py
"""
from __future__ import annotations

import argparse
import os
import stat
import sys
from pathlib import Path

import paramiko

DEFAULT_HOST = os.environ.get("ZAPRET_LINUX_HOST", "")
DEFAULT_USER = os.environ.get("ZAPRET_LINUX_USER", "")
DEFAULT_REMOTE = os.environ.get("ZAPRET_LINUX_REMOTE", "~/Documents/portable-zapret-tg")
EXCLUDED_DIRS = {"node_modules", ".git", "__pycache__"}
EXCLUDED_FILE_NAMES = {".env", "settings.json", "state.json", "stats.json", "events.jsonl"}
EXCLUDED_SUFFIXES = {".log", ".tmp", ".key", ".pem", ".pfx"}


def connect(args):
    if not args.host or not args.user:
        raise SystemExit("Set ZAPRET_LINUX_HOST and ZAPRET_LINUX_USER (or pass --host/--user)")
    password = os.environ.get("ZAPRET_LINUX_PASSWORD")
    if not password:
        raise SystemExit("Password not provided: set ZAPRET_LINUX_PASSWORD")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        args.host, port=args.port, username=args.user, password=password,
        timeout=10, look_for_keys=False, allow_agent=False,
    )
    return client


def run_check(client):
    _, stdout, stderr = client.exec_command("echo OK && pwd", timeout=10)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    print(out)
    if err:
        print(err, file=sys.stderr)
    return out.startswith("OK")


def ensure_remote_dir(sftp, path):
    path = path.rstrip("/")
    if not path or path == "/":
        return
    try:
        if stat.S_ISDIR(sftp.stat(path).st_mode):
            return
    except IOError:
        pass
    parent = path.rsplit("/", 1)[0] or "/"
    ensure_remote_dir(sftp, parent)
    sftp.mkdir(path)


def selected_files(local_root: Path):
    for local_path in sorted(local_root.rglob("*")):
        if not local_path.is_file() or local_path.is_symlink():
            continue
        if should_skip(local_path, local_root):
            continue
        yield local_path


def should_skip(path: Path, root: Path) -> bool:
    rel = path.relative_to(root)
    parts = rel.parts
    if any(part in EXCLUDED_DIRS or part.startswith("dist") for part in parts):
        return True
    # Design/plan/ledger docs are local implementation notes and may contain
    # sensitive reproduction details; they are not part of the portable payload.
    if parts[:2] == ("docs", "superpowers"):
        return True
    if path.name in EXCLUDED_FILE_NAMES or path.name.lower().startswith("credentials"):
        return True
    if path.suffix.lower() in EXCLUDED_SUFFIXES:
        return True
    return False


def copy_tree(sftp, local_root: Path, remote_root: str) -> int:
    count = 0
    for local_path in sorted(local_root.rglob("*")):
        if local_path.is_symlink():
            continue
        if should_skip(local_path, local_root):
            continue
        rel = local_path.relative_to(local_root).as_posix()
        remote_path = f"{remote_root}/{rel}" if rel != "." else remote_root
        if local_path.is_dir():
            ensure_remote_dir(sftp, remote_path)
        elif local_path.is_file():
            ensure_remote_dir(sftp, remote_path.rsplit("/", 1)[0] or remote_root)
            sftp.put(str(local_path), remote_path)
            count += 1
    return count


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=22)
    parser.add_argument("--user", default=DEFAULT_USER)
    parser.add_argument("--remote", default=DEFAULT_REMOTE)
    parser.add_argument("--local-root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--check", action="store_true", help="Only test SSH connectivity")
    parser.add_argument("--dry-run", action="store_true", help="List files that would be copied")
    args = parser.parse_args()

    local_root = Path(args.local_root).resolve()
    if args.dry_run:
        files = list(selected_files(local_root))
        print(f"Would copy {len(files)} files to {args.user}@{args.host}:{args.remote}")
        for path in files:
            print(path.relative_to(local_root).as_posix())
        return

    try:
        client = connect(args)
    except Exception as exc:
        print(f"SSH connection failed: {exc}", file=sys.stderr)
        raise SystemExit(2)

    try:
        if args.check:
            if not run_check(client):
                raise SystemExit("Connectivity check failed")
            return
        sftp = client.open_sftp()
        try:
            ensure_remote_dir(sftp, args.remote)
            copied = copy_tree(sftp, local_root, args.remote)
            print(f"Copied {copied} files to {args.user}@{args.host}:{args.remote}")
        finally:
            sftp.close()
        _, stdout, stderr = client.exec_command(
            f"find {args.remote} -maxdepth 2 -type f | sort | head -40", timeout=20
        )
        print(stdout.read().decode("utf-8", errors="replace"))
        err = stderr.read().decode("utf-8", errors="replace").strip()
        if err:
            print(err, file=sys.stderr)
    finally:
        client.close()


if __name__ == "__main__":
    main()
