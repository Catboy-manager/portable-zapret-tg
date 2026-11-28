#!/usr/bin/env python3
"""Read-only verification for the Linux copy, with explicit optional cleanup."""
from __future__ import annotations

import argparse
import os
import sys

import paramiko

DEFAULT_HOST = os.environ.get("ZAPRET_LINUX_HOST", "")
DEFAULT_USER = os.environ.get("ZAPRET_LINUX_USER", "")
DEFAULT_REMOTE = os.environ.get("ZAPRET_LINUX_REMOTE", "~/Documents/portable-zapret-tg")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=22)
    parser.add_argument("--user", default=DEFAULT_USER)
    parser.add_argument("--remote", default=DEFAULT_REMOTE)
    parser.add_argument("--cleanup-backup", action="store_true", help="Remove the known old dist3 backup directory after confirmation")
    parser.add_argument("--cleanup-docs-superpowers", action="store_true", help="Remove local-only docs/superpowers notes from the remote copy after confirmation")
    parser.add_argument("--yes", action="store_true", help="Skip cleanup confirmation")
    args = parser.parse_args()

    if not args.host or not args.user:
        raise SystemExit("Set ZAPRET_LINUX_HOST and ZAPRET_LINUX_USER (or pass --host/--user)")
    password = os.environ.get("ZAPRET_LINUX_PASSWORD")
    if not password:
        raise SystemExit("Password not provided: set ZAPRET_LINUX_PASSWORD")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            args.host, args.port, args.user, password,
            timeout=10, look_for_keys=False, allow_agent=False,
        )
    except Exception as exc:
        print(f"SSH connection failed: {exc}", file=sys.stderr)
        raise SystemExit(2)

    backup = f"{args.remote}/dist3-backup-before-rebuild"
    docs_notes = f"{args.remote}/docs/superpowers"
    commands = [
        f"find {args.remote} -type f | wc -l",
        f"test -f {args.remote}/app/src/voice.js && echo voice.js=ok",
        f"test ! -d {args.remote}/docs/superpowers && echo docs-superpowers=absent",
        f"find {args.remote}/runtime -maxdepth 1 -type f -name 'general*.bat' | wc -l",
        f"find {args.remote}/runtime/bin -maxdepth 1 -type f | wc -l",
        f"test -f {args.remote}/runtime/TgWsProxy_windows.exe && echo tgproxy=ok",
    ]

    try:
        cleanup_targets = []
        if args.cleanup_backup:
            cleanup_targets.append(backup)
        if args.cleanup_docs_superpowers:
            cleanup_targets.append(docs_notes)
        for target in cleanup_targets:
            print(f"Cleanup target: {target}")
            if not args.yes and input("Type 'yes' to delete this directory: ").strip().lower() != "yes":
                print("Cleanup skipped")
                continue
            _, stdout, stderr = client.exec_command(f"rm -rf {target}", timeout=20)
            stdout.read(); stderr.read()
            print("Cleanup done")
        for command in commands:
            _, stdout, stderr = client.exec_command(command, timeout=20)
            out = stdout.read().decode("utf-8", errors="replace").strip()
            err = stderr.read().decode("utf-8", errors="replace").strip()
            print(f"$ {command}\n{out}")
            if err:
                print(err, file=sys.stderr)
    finally:
        client.close()


if __name__ == "__main__":
    main()
