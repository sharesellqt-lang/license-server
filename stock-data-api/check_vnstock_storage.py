#!/usr/bin/env python3
"""Safely inspect Vnstock storage metadata without reading file contents."""

import os
from pathlib import Path

def main():
    configured_home = os.environ.get("VNSTOCK_HOME", "").strip()
    home = Path(configured_home).expanduser() if configured_home else Path.home() / ".vnstock"

    print("========== VNSTOCK STORAGE CHECK ==========")
    print("VNSTOCK_HOME source:", "environment variable" if configured_home else "default")
    print("Storage directory:", str(home))
    print("Directory exists:", home.is_dir())

    if not home.exists():
        print("Result: storage directory does not exist.")
        print("===========================================")
        return

    if not home.is_dir():
        print("Result: configured storage path is not a directory.")
        print("===========================================")
        return

    count = 0
    total_bytes = 0

    try:
        for path in sorted(home.rglob("*")):
            try:
                if path.is_symlink():
                    print(f"SYMLINK  {path.relative_to(home)}")
                    continue

                if path.is_dir():
                    print(f"DIR      {path.relative_to(home)}/")
                    continue

                if path.is_file():
                    size = path.stat().st_size
                    total_bytes += size
                    count += 1
                    print(f"FILE     {path.relative_to(home)} | {size} bytes")
            except (OSError, PermissionError):
                print(f"UNREADABLE_METADATA  {path.relative_to(home)}")

    except (OSError, PermissionError) as exc:
        print("SCAN ERROR:", type(exc).__name__)

    print("-------------------------------------------")
    print("File count:", count)
    print("Total file size:", total_bytes, "bytes")
    print("File contents read: NO")
    print("Vnstock login/register called: NO")
    print("===========================================")

if __name__ == "__main__":
    main()
