from __future__ import annotations

import argparse
import datetime as dt
import pathlib
import subprocess
import sys

import pandas as pd


def run_scraper(scraper_cmd: list[str]) -> None:
    """Run your chosen KTC scraper/export command."""
    print("Running scraper:", " ".join(scraper_cmd))
    result = subprocess.run(scraper_cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        raise SystemExit(f"Scraper failed with exit code {result.returncode}")
    print(result.stdout)


def normalize_ktc_csv(input_csv: pathlib.Path, output_csv: pathlib.Path) -> None:
    """
    Normalize into a simple schema:
      name, position, team, ktc_value, format, as_of

    Adjust col_map below to match your scraper's actual output column names.
    Common columns from KTC exports: "Player", "Pos", "Team", "Value"
    """
    df = pd.read_csv(input_csv)

    # ---- ADJUST THESE TO MATCH YOUR SCRAPER OUTPUT ----
    col_map = {
        "Player": "name",
        "Pos": "position",
        "Team": "team",
        "Value": "ktc_value",
    }
    for src, dst in col_map.items():
        if src in df.columns:
            df = df.rename(columns={src: dst})

    required = {"name", "position", "team", "ktc_value"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(
            f"Missing expected columns in {input_csv}: {sorted(missing)}. "
            f"Found columns: {list(df.columns)}"
        )

    df["ktc_value"] = pd.to_numeric(df["ktc_value"], errors="coerce")
    df = df.dropna(subset=["ktc_value"])

    # Add metadata
    df["as_of"] = dt.date.today().isoformat()

    # Basic cleanup
    df["name"] = df["name"].astype(str).str.strip()
    df["position"] = df["position"].astype(str).str.strip().str.upper()
    df["team"] = df["team"].astype(str).str.strip().str.upper()

    # De-dupe on name+pos+team (scraper may already be unique)
    df = df.drop_duplicates(subset=["name", "position", "team"], keep="last")

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_csv, index=False)
    print(f"Wrote {len(df):,} rows → {output_csv}")


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Normalize a raw KTC CSV export into a standard schema."
    )
    ap.add_argument(
        "--raw-csv",
        required=True,
        help="Path to the raw CSV produced by your KTC scraper",
    )
    ap.add_argument(
        "--out-csv",
        default="output/ktc_values.csv",
        help="Path for the normalized output CSV (default: output/ktc_values.csv)",
    )
    ap.add_argument(
        "--run",
        action="store_true",
        help="Run the scraper command before normalizing",
    )
    ap.add_argument(
        "--scraper-cmd",
        nargs="+",
        default=[],
        help="Scraper command to run first, e.g. --scraper-cmd python main.py --format SF",
    )
    args = ap.parse_args()

    raw_csv = pathlib.Path(args.raw_csv)
    out_csv = pathlib.Path(args.out_csv)

    if args.run:
        if not args.scraper_cmd:
            raise SystemExit("--run requires --scraper-cmd ...")
        run_scraper(args.scraper_cmd)

    if not raw_csv.exists():
        raise SystemExit(f"Raw CSV not found: {raw_csv}")

    normalize_ktc_csv(raw_csv, out_csv)


if __name__ == "__main__":
    main()
