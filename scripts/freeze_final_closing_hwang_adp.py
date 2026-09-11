#!/usr/bin/env python3
"""
freeze_final_closing_hwang_adp.py

Pin the current season's Hwang ADP (and the FantasyPros boards used to build it)
as that year's final closing snapshot. Later all_updates scrapes keep writing
live site/public/data/adp/fantasypros_adp_*_{year}.csv files; they do not replace
this folder.

Writes site/public/data/adp/final_closing/{year}/:
  fantasypros_adp_bestball.csv
  fantasypros_adp_half.csv
  fantasypros_adp_overall.csv
  fantasypros_adp_ppr.csv                  (copied when present; not required)
  hwang_adjusted_positional_adp.csv        (computed numbers used by sims)
  compute_hwang_scoring_adp.py             (method at freeze time)
  manifest.json

Usage (from project root):
  python3 scripts/freeze_final_closing_hwang_adp.py
  python3 scripts/freeze_final_closing_hwang_adp.py 2026
  python3 scripts/freeze_final_closing_hwang_adp.py 2026 --force
"""

from __future__ import annotations

import csv
import hashlib
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from compute_hwang_scoring_adp import (  # noqa: E402
    DEFAULT_ADP_YEAR,
    HWANG_SOURCE_TYPES,
    OUTPUT_FIELDNAMES,
    PROJECT_ROOT,
    compute_hwang_rows,
    final_closing_dir,
    frozen_computed_path,
    live_source_path,
)

OPTIONAL_SOURCE_TYPES = ("ppr",)
COMPUTE_SCRIPT = SCRIPT_DIR / "compute_hwang_scoring_adp.py"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def csv_data_rows(path: Path) -> int:
    with path.open(encoding="utf-8") as f:
        return max(0, sum(1 for _ in f) - 1)


def git_commit() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=PROJECT_ROOT,
            text=True,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def parse_args(argv: list[str]) -> tuple[int, bool]:
    force = False
    year = DEFAULT_ADP_YEAR
    for arg in argv[1:]:
        if arg in ("-f", "--force"):
            force = True
            continue
        if arg.startswith("-"):
            sys.exit(f"Unknown option: {arg}")
        try:
            year = int(arg)
        except ValueError:
            sys.exit(f"Invalid year: {arg}")
    return year, force


def copy_sources(year: int, dest_dir: Path) -> dict[str, Path]:
    copied: dict[str, Path] = {}
    missing_required: list[str] = []
    for adp_type in HWANG_SOURCE_TYPES:
        src = live_source_path(adp_type, year)
        if not src.is_file():
            missing_required.append(str(src))
            continue
        dest = dest_dir / f"fantasypros_adp_{adp_type}.csv"
        shutil.copy2(src, dest)
        copied[adp_type] = dest
    if missing_required:
        sys.exit("ERROR: missing required live ADP file(s):\n  " + "\n  ".join(missing_required))

    for adp_type in OPTIONAL_SOURCE_TYPES:
        src = live_source_path(adp_type, year)
        if src.is_file():
            dest = dest_dir / f"fantasypros_adp_{adp_type}.csv"
            shutil.copy2(src, dest)
            copied[adp_type] = dest
    return copied


def write_computed(year: int, dest: Path) -> list[dict]:
    rows = compute_hwang_rows(year)
    for row in rows:
        row["year"] = year
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_FIELDNAMES, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    return rows


def source_manifest_entry(adp_type: str, path: Path) -> dict:
    return {
        "file": path.name,
        "sha256": sha256_file(path),
        "rows": csv_data_rows(path),
    }


def main() -> None:
    year, force = parse_args(sys.argv)
    dest_dir = final_closing_dir(year)
    computed_dest = frozen_computed_path(year)

    if dest_dir.exists() and any(dest_dir.iterdir()) and not force:
        sys.exit(
            f"ERROR: {dest_dir} already exists. "
            f"Re-run with --force to replace this year's closing snapshot."
        )

    dest_dir.mkdir(parents=True, exist_ok=True)
    copied = copy_sources(year, dest_dir)

    method_copy = dest_dir / "compute_hwang_scoring_adp.py"
    shutil.copy2(COMPUTE_SCRIPT, method_copy)

    rows = write_computed(year, computed_dest)
    frozen_at = datetime.now(timezone.utc)

    manifest = {
        "year": year,
        "kind": "final_closing_hwang_adp",
        "frozen_at": frozen_at.date().isoformat(),
        "frozen_at_utc": frozen_at.replace(microsecond=0).isoformat(),
        "description": (
            f"Final closing Hwang Adjusted Positional ADP for the {year} season. "
            f"Historical {year} sims and outcome catalogs should keep using these "
            f"numbers. Live FantasyPros scrapes may continue updating "
            f"site/public/data/adp/fantasypros_adp_*_{year}.csv; those files are "
            f"not the historical source once this snapshot exists."
        ),
        "method": {
            "script": "scripts/compute_hwang_scoring_adp.py",
            "script_copy": method_copy.name,
            "script_sha256": sha256_file(COMPUTE_SCRIPT),
            "git_commit": git_commit(),
            "summary": (
                "Shift best-ball ADP for RB/WR by (std_stack_rank - half_stack_rank); "
                "QB/TE pass through raw best-ball avg ADP."
            ),
        },
        "sources": {
            adp_type: source_manifest_entry(adp_type, path)
            for adp_type, path in copied.items()
        },
        "output": {
            "file": computed_dest.name,
            "sha256": sha256_file(computed_dest),
            "rows": len(rows),
        },
        "reconstruct": (
            "To rebuild with a later Hwang ADP method, keep these FantasyPros CSVs "
            "and run: python3 scripts/compute_hwang_scoring_adp.py "
            f"{year} --recompute-closed. That refreshes the combined site CSV only; "
            "this folder stays as the original closing snapshot unless you freeze "
            "again with --force."
        ),
    }
    manifest_path = dest_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    print(f"Froze {year} closing Hwang ADP → {dest_dir}")
    print(f"  {len(rows):,} Hwang rows")
    for adp_type, path in copied.items():
        print(f"  {adp_type}: {csv_data_rows(path):,} rows ({path.name})")
    print(f"  manifest: {manifest_path.name}")

    stitch = SCRIPT_DIR / "compute_hwang_scoring_adp.py"
    print(f"\nStitching pinned {year} into hwang_adjusted_positional_adp.csv …")
    subprocess.check_call([sys.executable, str(stitch)], cwd=PROJECT_ROOT)


if __name__ == "__main__":
    main()
