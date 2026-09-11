#!/usr/bin/env python3
"""
compute_hwang_scoring_adp.py

Hwang Adjusted Positional ADP: shift best-ball ADP for RB/WR to reflect
that the Hwang league scores RB/WR without PPR while TE gets half-PPR.

Method:
  1. Build positional stack ranks on best-ball, half-PPR, and standard (overall) boards.
  2. scoring_rank_shift = std_stack_rank - half_stack_rank (RB/WR only).
  3. When shift == 0: pass through raw best-ball avg ADP (no OVR eff-rank adjustment).
  4. When shift != 0: bb_eff_rank = OVR-implied fractional rank on the BB board;
     hwang_eff_rank = bb_eff_rank + shift; hwang_adjusted_adp = interpolate BB curve.
  QB/TE always pass through unchanged (raw best-ball avg ADP).

Reads:
  site/public/data/adp/final_closing/{year}/…  (pinned closing season, if present)
  site/public/data/adp/fantasypros_adp_bestball_{year}.csv
  site/public/data/adp/fantasypros_adp_overall_{year}.csv  (standard scoring)
  site/public/data/adp/fantasypros_adp_half_{year}.csv

Closed seasons are frozen by scripts/freeze_final_closing_hwang_adp.py into
site/public/data/adp/final_closing/{year}/. Those snapshots are the historical
source of truth: all_updates may keep scraping live current-year ADP, but this
script loads the pinned computed rows for any year that has been closed.

Writes:
  site/public/data/hwang_adjusted_positional_adp.csv  (all seasons, year column)

Usage (from project root):
  python3 scripts/compute_hwang_scoring_adp.py                  # all available years
  python3 scripts/compute_hwang_scoring_adp.py 2024            # single year only
  python3 scripts/compute_hwang_scoring_adp.py --recompute-closed
      # rebuild closed years from pinned FantasyPros inputs with current method
"""

from __future__ import annotations

import csv
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ADP_DIR = PROJECT_ROOT / "site/public/data/adp"
FINAL_CLOSING_DIR = ADP_DIR / "final_closing"
OUTPUT_CSV = PROJECT_ROOT / "site/public/data/hwang_adjusted_positional_adp.csv"

POSITIONS = ("QB", "RB", "WR", "TE")
SCORING_SHIFT_POSITIONS = frozenset({"RB", "WR"})
HWANG_SOURCE_TYPES = ("bestball", "half", "overall")
DEFAULT_ADP_YEAR = 2026
YEAR_RANGE = range(2020, 2027)

OUTPUT_FIELDNAMES = [
    "year",
    "name",
    "position",
    "team",
    "sleeper_id",
    "overall_rank",
    "bb_avg_adp",
    "bb_stack_rank",
    "bb_eff_rank",
    "half_stack_rank",
    "std_stack_rank",
    "scoring_rank_shift",
    "hwang_eff_rank",
    "hwang_adjusted_adp",
    "hwang_pos_rank",
    "adp_delta",
    "adp_source",
    "scoring_source",
]


def normalize_name(name: str) -> str:
    if not name:
        return ""
    name = unicodedata.normalize("NFKD", name)
    name = name.encode("ascii", "ignore").decode("ascii")
    name = re.sub(r"[^a-z ]", "", name.lower())
    name = re.sub(r"\s+(jr|sr|ii|iii|iv|v)$", "", name)
    return re.sub(r"\s+", " ", name).strip()


def parse_csv_row(line: str) -> list[str]:
    fields: list[str] = []
    current = ""
    in_quotes = False
    for i, c in enumerate(line):
        if in_quotes:
            if c == '"':
                if i + 1 < len(line) and line[i + 1] == '"':
                    current += '"'
                else:
                    in_quotes = False
            else:
                current += c
        elif c == '"':
            in_quotes = True
        elif c == ",":
            fields.append(current)
            current = ""
        else:
            current += c
    fields.append(current)
    return fields


def assign_stack_ranks(
    rows: list[dict],
) -> tuple[dict[str, dict[int, dict]], list[dict]]:
    by_pos: dict[str, list[dict]] = {p: [] for p in POSITIONS}
    for row in rows:
        by_pos[row["position"]].append(row)

    boards: dict[str, dict[int, dict]] = {p: {} for p in POSITIONS}
    ranked_rows: list[dict] = []

    for pos in POSITIONS:
        sorted_rows = sorted(
            by_pos[pos],
            key=lambda r: (r["adp_avg"], r["adp_overall_rank"], r["name"]),
        )
        for stack_rank, row in enumerate(sorted_rows, start=1):
            enriched = {**row, "adp_stack_rank": stack_rank}
            boards[pos][stack_rank] = enriched
            ranked_rows.append(enriched)

    return boards, ranked_rows


def final_closing_dir(year: int) -> Path:
    return FINAL_CLOSING_DIR / str(year)


def frozen_computed_path(year: int) -> Path:
    return final_closing_dir(year) / "hwang_adjusted_positional_adp.csv"


def frozen_source_path(adp_type: str, year: int) -> Path:
    return final_closing_dir(year) / f"fantasypros_adp_{adp_type}.csv"


def live_source_path(adp_type: str, year: int) -> Path:
    return ADP_DIR / f"fantasypros_adp_{adp_type}_{year}.csv"


def year_has_frozen_computed(year: int) -> bool:
    return frozen_computed_path(year).is_file()


def resolve_adp_path(adp_type: str, year: int) -> Path:
    frozen = frozen_source_path(adp_type, year)
    if frozen.is_file():
        return frozen
    return live_source_path(adp_type, year)


def load_adp(adp_type: str, year: int) -> tuple[dict[tuple[str, str], dict], dict[str, dict], dict[str, dict[int, dict]], list[dict]]:
    adp_path = resolve_adp_path(adp_type, year)
    if not adp_path.is_file():
        sys.exit(f"ERROR: missing {adp_path}")

    text = adp_path.read_text(encoding="utf-8").strip()
    lines = text.split("\n")
    headers = parse_csv_row(lines[0])
    idx = {name: headers.index(name) for name in headers}

    parsed: list[dict] = []
    for line in lines[1:]:
        cols = parse_csv_row(line)
        position = (cols[idx["position"]] or "").strip().upper()
        if position not in POSITIONS:
            continue
        name = (cols[idx["name"]] or "").strip()
        if not name:
            continue
        try:
            overall_rank = int(cols[idx["rank"]])
            overall_avg = float(cols[idx["avg"]])
        except (KeyError, ValueError, TypeError):
            continue

        parsed.append({
            "name": name,
            "position": position,
            "team": (cols[idx["team"]] or "").strip(),
            "adp_overall_rank": overall_rank,
            "adp_avg": overall_avg,
            "sleeper_id": (cols[idx["sleeper_id"]] if "sleeper_id" in idx else "").strip(),
            "norm_name": normalize_name(name),
        })

    boards, ranked_rows = assign_stack_ranks(parsed)

    by_name: dict[tuple[str, str], dict] = {}
    by_sleeper: dict[str, dict] = {}
    duplicates: set[tuple[str, str]] = set()

    for row in ranked_rows:
        key = (row["norm_name"], row["position"])
        if key in by_name:
            duplicates.add(key)
        by_name[key] = row
        if row["sleeper_id"]:
            by_sleeper[row["sleeper_id"]] = row

    for key in duplicates:
        del by_name[key]

    return by_name, by_sleeper, boards, ranked_rows


def ovr_implied_frac_rank(stack_rank: int, board: dict[int, dict]) -> float:
    ranks = sorted(board)
    if stack_rank not in board:
        return float(stack_rank)
    if len(ranks) == 1:
        return float(stack_rank)

    idx_pos = ranks.index(stack_rank)
    a = board[stack_rank]["adp_avg"]

    if idx_pos == 0:
        return float(stack_rank)

    if idx_pos == len(ranks) - 1:
        a_prev = board[ranks[idx_pos - 1]]["adp_avg"]
        span = max(a - a_prev, 1e-9)
        return (stack_rank - 1) + min(1.0, max(0.0, (a - a_prev) / span))

    a_prev = board[ranks[idx_pos - 1]]["adp_avg"]
    a_next = board[ranks[idx_pos + 1]]["adp_avg"]
    span = max(a_next - a_prev, 1e-9)
    frac = (a - a_prev) / span
    return (stack_rank - 1) + frac * 2.0


def compute_eff_ranks(board: dict[int, dict]) -> dict[int, float]:
    return {
        stack_rank: round(ovr_implied_frac_rank(stack_rank, board), 2)
        for stack_rank in sorted(board)
    }


def interpolate_adp(board: dict[int, dict], eff_rank: float) -> float | None:
    if not board or eff_rank < 1:
        return None

    max_rank = max(board)
    eff_rank = max(1.0, float(eff_rank))

    rank_low = int(eff_rank)
    if rank_low >= max_rank:
        if max_rank == 1:
            return board[1]["adp_avg"]
        a_prev = board[max_rank - 1]["adp_avg"]
        a_last = board[max_rank]["adp_avg"]
        span = max(a_last - a_prev, 1e-9)
        extra = eff_rank - max_rank
        return a_last + extra * span

    rank_high = rank_low + 1
    frac = eff_rank - rank_low
    a_low = board[rank_low]["adp_avg"]
    a_high = board[rank_high]["adp_avg"]
    return a_low + frac * (a_high - a_low)


def find_row(
    row: dict,
    by_name: dict[tuple[str, str], dict],
    by_sleeper: dict[str, dict],
) -> dict | None:
    direct = by_name.get((row["norm_name"], row["position"]))
    if direct:
        return direct
    if row.get("sleeper_id"):
        return by_sleeper.get(row["sleeper_id"])
    return None


def compute_pos_ranks(rows: list[dict]) -> None:
    by_pos: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_pos[row["position"]].append(row)

    for pos_rows in by_pos.values():
        pos_rows.sort(key=lambda r: (r["hwang_adjusted_adp"], r["name"]))
        for i, row in enumerate(pos_rows, start=1):
            row["hwang_pos_rank"] = i


def discover_live_years() -> list[int]:
    years: list[int] = []
    for year in YEAR_RANGE:
        if all(live_source_path(adp_type, year).is_file() for adp_type in HWANG_SOURCE_TYPES):
            years.append(year)
    return years


def discover_frozen_years() -> list[int]:
    if not FINAL_CLOSING_DIR.is_dir():
        return []
    years: list[int] = []
    for child in sorted(FINAL_CLOSING_DIR.iterdir()):
        if not (child.is_dir() and child.name.isdigit()):
            continue
        year = int(child.name)
        if year_has_frozen_computed(year) or all(
            frozen_source_path(adp_type, year).is_file() for adp_type in HWANG_SOURCE_TYPES
        ):
            years.append(year)
    return years


def available_hwang_years() -> list[int]:
    return sorted(set(discover_live_years()) | set(discover_frozen_years()))


def load_frozen_hwang_rows(adp_year: int) -> list[dict]:
    path = frozen_computed_path(adp_year)
    if not path.is_file():
        sys.exit(f"ERROR: missing frozen Hwang ADP snapshot {path}")

    rows: list[dict] = []
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for raw in reader:
            row = {name: (raw.get(name) or "") for name in OUTPUT_FIELDNAMES}
            row["year"] = adp_year
            if not (row.get("name") or "").strip():
                continue
            rows.append(row)
    if not rows:
        sys.exit(f"ERROR: no rows in frozen Hwang ADP snapshot {path}")
    return rows


def hwang_rows_for_year(adp_year: int, *, recompute_closed: bool = False) -> tuple[list[dict], str]:
    if year_has_frozen_computed(adp_year) and not recompute_closed:
        return load_frozen_hwang_rows(adp_year), "final closing snapshot"
    rows = compute_hwang_rows(adp_year)
    origin = "frozen FantasyPros inputs" if frozen_source_path("bestball", adp_year).is_file() else "live FantasyPros inputs"
    return rows, origin


def compute_hwang_rows(adp_year: int) -> list[dict]:
    bb_by_name, bb_by_sleeper, bb_boards, bb_rows = load_adp("bestball", adp_year)
    half_by_name, half_by_sleeper, _, _ = load_adp("half", adp_year)
    std_by_name, std_by_sleeper, _, _ = load_adp("overall", adp_year)

    eff_ranks_by_pos = {
        pos: compute_eff_ranks(board)
        for pos, board in bb_boards.items()
    }

    output_rows: list[dict] = []

    for row in bb_rows:
        pos = row["position"]
        bb_stack = row["adp_stack_rank"]
        bb_avg = row["adp_avg"]
        bb_eff = eff_ranks_by_pos[pos].get(bb_stack, float(bb_stack))

        half_row = find_row(row, half_by_name, half_by_sleeper) if pos in SCORING_SHIFT_POSITIONS else None
        std_row = find_row(row, std_by_name, std_by_sleeper) if pos in SCORING_SHIFT_POSITIONS else None

        if pos in SCORING_SHIFT_POSITIONS and half_row and std_row:
            shift = std_row["adp_stack_rank"] - half_row["adp_stack_rank"]
        else:
            shift = 0

        if pos in SCORING_SHIFT_POSITIONS and shift != 0:
            hwang_eff = max(1.0, bb_eff + shift)
            hwang_adp = interpolate_adp(bb_boards[pos], hwang_eff)
            if hwang_adp is None:
                hwang_adp = bb_avg
                hwang_eff = bb_eff
        elif pos in SCORING_SHIFT_POSITIONS:
            hwang_eff = float(bb_stack)
            hwang_adp = bb_avg
        else:
            hwang_eff = float(bb_stack)
            hwang_adp = bb_avg

        hwang_adp = round(hwang_adp, 1)
        adp_delta = round(hwang_adp - bb_avg, 1)

        output_rows.append({
            "name": row["name"],
            "position": pos,
            "team": row["team"],
            "sleeper_id": row.get("sleeper_id") or "",
            "overall_rank": row["adp_overall_rank"],
            "bb_avg_adp": round(bb_avg, 1),
            "bb_stack_rank": bb_stack,
            "bb_eff_rank": bb_eff,
            "half_stack_rank": half_row["adp_stack_rank"] if half_row else "",
            "std_stack_rank": std_row["adp_stack_rank"] if std_row else "",
            "scoring_rank_shift": shift if pos in SCORING_SHIFT_POSITIONS else "",
            "hwang_eff_rank": round(hwang_eff, 2),
            "hwang_adjusted_adp": hwang_adp,
            "hwang_pos_rank": "",
            "adp_delta": adp_delta if pos in SCORING_SHIFT_POSITIONS else "",
            "adp_source": (
                f"fantasypros_bestball_{adp_year}_final_closing"
                if frozen_source_path("bestball", adp_year).is_file()
                else f"fantasypros_bestball_{adp_year}"
            ),
            "scoring_source": (
                f"fantasypros_half_{adp_year}_final_closing"
                if frozen_source_path("half", adp_year).is_file()
                else f"fantasypros_half_{adp_year}"
            ),
        })

    output_rows.sort(key=lambda r: (r["hwang_adjusted_adp"], r["name"]))
    for i, row in enumerate(output_rows, start=1):
        row["overall_rank"] = i

    compute_pos_ranks(output_rows)
    return output_rows


def write_output(all_rows: list[dict]) -> None:
    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_FIELDNAMES, extrasaction="ignore")
        writer.writeheader()
        for row in all_rows:
            writer.writerow(row)


def parse_args(argv: list[str]) -> tuple[int | None, bool]:
    recompute_closed = False
    year: int | None = None
    for arg in argv[1:]:
        if arg == "--recompute-closed":
            recompute_closed = True
            continue
        if arg.startswith("-"):
            sys.exit(f"Unknown option: {arg}")
        try:
            year = int(arg)
        except ValueError:
            sys.exit(f"Invalid year: {arg}")
    return year, recompute_closed


def main() -> None:
    year_arg, recompute_closed = parse_args(sys.argv)
    years = available_hwang_years()
    if year_arg is not None:
        years = [year_arg]

    if not years:
        sys.exit("ERROR: no ADP seasons with bestball + half + overall files found")

    all_rows: list[dict] = []
    for adp_year in years:
        rows, origin = hwang_rows_for_year(adp_year, recompute_closed=recompute_closed)
        for row in rows:
            row["year"] = adp_year
        all_rows.extend(rows)

        print(f"\n=== {adp_year} ({origin}) ===")
        print(f"  {len(rows):,} players")
        if origin != "final closing snapshot":
            rb_wr = [r for r in rows if r["position"] in SCORING_SHIFT_POSITIONS]
            nonzero = [r for r in rb_wr if r["scoring_rank_shift"] != 0]
            shifted_count = len([r for r in rb_wr if r["scoring_rank_shift"] != 0])
            print(f"  RB/WR with scoring shift applied: {shifted_count:,} / {len(rb_wr):,}")
            print(f"  RB/WR with non-zero shift: {len(nonzero):,}")

    write_output(all_rows)
    print(f"\nWrote {len(all_rows):,} rows → {OUTPUT_CSV}")
    print(f"Seasons: {years[0]}–{years[-1]}" if len(years) > 1 else f"Season: {years[0]}")


if __name__ == "__main__":
    main()
