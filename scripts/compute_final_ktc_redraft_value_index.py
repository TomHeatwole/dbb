#!/usr/bin/env python3
"""
compute_final_ktc_redraft_value_index.py

Per-season Redraft Adjusted Value using each year's preseason SF TE+ KTC board
(final_ktc_values.csv) and that season's FantasyPros best-ball ADP.

Same pipeline as compute_redraft_value_index.py (ApproachH eff rank + ApproachG
competitor value + rebuilder adjusted), except the rank-slot lookup blends:
  50% year-weighted historical rank averages (2021–2025)
  50% that year's final KTC value at each positional rank
Historical rank-slot values are inflation-scaled to each target season's own
final KTC top-300 total (not the live 2026 board).

Reads:
  site/public/data/final_ktc_values.csv
  site/public/data/sf_ktc_values_historical_filled.csv
  site/public/data/adp/fantasypros_adp_bestball_{year}.csv

Writes:
  site/public/data/final_ktc_redraft_value_index.csv
  site/public/data/final_ktc_redraft_rank_lookup.csv

Usage (from project root):
  python3 scripts/compute_final_ktc_redraft_value_index.py
"""

from __future__ import annotations

import csv
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

import compute_redraft_value_index as rvi  # noqa: E402

FINAL_KTC_CSV = PROJECT_ROOT / "site/public/data/final_ktc_values.csv"
OUTPUT_CSV = PROJECT_ROOT / "site/public/data/final_ktc_redraft_value_index.csv"
LOOKUP_CSV = PROJECT_ROOT / "site/public/data/final_ktc_redraft_rank_lookup.csv"

FINAL_KTC_YEARS = (2020, 2021, 2022, 2023, 2024, 2025)
HIST_BLEND_WEIGHT = 0.50
YEAR_KTC_BLEND_WEIGHT = 0.50


def final_ktc_top300_sum(year: int) -> int:
    """Top-300 KTC value sum for a season's final snapshot (inflation anchor)."""
    players, _ = load_final_ktc_players(year)
    values = sorted((p["ktc_value"] for p in players), reverse=True)
    return sum(values[: rvi.TOP300_INFLATION_TARGET_COUNT])


def compute_season_weighted_hist(
    target_year: int,
) -> tuple[dict[str, dict[int, float]], dict[int, float], int]:
    """Year-weighted hist rank slots from imputed Final KTC boards (no inflation)."""
    target_sum = final_ktc_top300_sum(target_year)
    return rvi.compute_weighted_historical_rank_values(target_sum=target_sum)


def load_final_ktc_players(year: int) -> tuple[list[dict], str]:
    if not FINAL_KTC_CSV.is_file():
        sys.exit(f"ERROR: missing {FINAL_KTC_CSV}")

    rows_for_year: list[dict] = []
    snapshot_date = ""

    with FINAL_KTC_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                row_year = int((row.get("year") or "").strip())
            except ValueError:
                continue
            if row_year != year:
                continue

            name = (row.get("name") or "").strip()
            position = (row.get("position") or "").strip().upper()
            if not name or position not in rvi.POSITIONS:
                continue
            try:
                value = int((row.get("ktc_value") or "").strip())
            except ValueError:
                continue
            if value <= 0:
                continue

            if not snapshot_date:
                snapshot_date = (row.get("date") or "").strip()

            rows_for_year.append({
                "name": name,
                "position": position,
                "team": "",
                "ktc_value": value,
                "norm_name": rvi.normalize_name(name),
                "sleeper_id": (row.get("sleeper_id") or "").strip(),
            })

    if not rows_for_year:
        sys.exit(f"ERROR: no final KTC rows for {year}")

    by_position: dict[str, list[dict]] = {p: [] for p in rvi.POSITIONS}
    for player in rows_for_year:
        by_position[player["position"]].append(player)

    ranked: list[dict] = []
    overall_sorted = sorted(rows_for_year, key=lambda r: (-r["ktc_value"], r["name"]))
    overall_rank_by_name = {
        (player["name"], player["position"]): i + 1
        for i, player in enumerate(overall_sorted)
    }

    for pos in rvi.POSITIONS:
        rows = sorted(by_position[pos], key=lambda r: r["ktc_value"], reverse=True)
        for i, row in enumerate(rows, start=1):
            ranked.append({
                **row,
                "ktc_pos_rank": i,
                "ktc_overall_rank": overall_rank_by_name[(row["name"], row["position"])],
            })

    return ranked, snapshot_date


def build_season_blended_rank_lookup(
    weighted_hist: dict[str, dict[int, float]],
    year_by_rank: dict[str, dict[int, int]],
) -> dict[str, dict[int, float]]:
    blended: dict[str, dict[int, float]] = {p: {} for p in rvi.POSITIONS}
    for pos in rvi.POSITIONS:
        ranks = set(weighted_hist[pos]) | set(year_by_rank[pos])
        for rank in ranks:
            hist_val = weighted_hist[pos].get(rank)
            year_val = year_by_rank[pos].get(rank)
            if hist_val is not None and year_val is not None:
                blended[pos][rank] = (
                    HIST_BLEND_WEIGHT * hist_val
                    + YEAR_KTC_BLEND_WEIGHT * float(year_val)
                )
            elif hist_val is not None:
                blended[pos][rank] = hist_val
            elif year_val is not None:
                blended[pos][rank] = float(year_val)
    return blended


def compute_season_redraft_values(
    year: int,
    weighted_hist: dict[str, dict[int, float]],
    sleeper_by_name: dict[tuple[str, str], str],
    sleeper_by_last: dict[tuple[str, str], str],
) -> tuple[list[dict], dict[str, dict[int, float]], str, int, int]:
    ktc_players, snapshot_date = load_final_ktc_players(year)
    year_by_rank = rvi.current_ktc_values_by_pos_rank(ktc_players)
    rank_lookup = build_season_blended_rank_lookup(weighted_hist, year_by_rank)

    adp_by_name, adp_by_sleeper, adp_boards, _ranked_adp_rows = rvi.load_hwang_adp(year)
    adp_source = f"hwang_adjusted_positional_adp_{year}"

    eff_ranks_by_pos = {
        pos: rvi.compute_effective_ranks_for_board(board, rank_lookup.get(pos))
        for pos, board in adp_boards.items()
    }

    calibration_rows: list[dict] = []
    for player in ktc_players:
        adp = rvi.find_adp_row(
            player,
            adp_by_name,
            adp_by_sleeper,
            sleeper_by_name,
            sleeper_by_last,
        )
        if not adp or adp.get("adp_stack_rank") is None:
            continue
        adp_eff_rank = eff_ranks_by_pos[player["position"]].get(adp["adp_stack_rank"])
        if adp_eff_rank is None:
            continue
        adjusted, _ = rvi.ApproachG(
            player["ktc_value"],
            adp_eff_rank,
            player["position"],
            rank_lookup,
        )
        if adjusted is None or adjusted <= 0:
            continue
        calibration_rows.append({
            "ktc_value": player["ktc_value"],
            "ktc_pos_rank": player["ktc_pos_rank"],
            "adp_eff_rank": adp_eff_rank,
            "adjusted": adjusted,
            "position": player["position"],
        })

    flip_friendliness = 0.0
    if rvi.REBUILD_AUTO_MIDPOINT_ANCHOR and calibration_rows:
        flip_friendliness = rvi.calibrate_rebuild_flip_friendliness(
            calibration_rows,
            rank_lookup,
        )

    unranked_config = rvi.DEFAULT_UNRANKED_ADP
    output_rows: list[dict] = []
    matched = 0
    synthetic = 0

    for player in sorted(ktc_players, key=lambda r: (-r["ktc_value"], r["name"])):
        adp = rvi.find_adp_row(
            player,
            adp_by_name,
            adp_by_sleeper,
            sleeper_by_name,
            sleeper_by_last,
        )

        stack_rank = adp["adp_stack_rank"] if adp else None
        adp_eff_rank = None
        adjusted = None
        index = None
        rebuilder = None
        rebuild_index = None
        adp_synthetic = False

        if adp and stack_rank is not None:
            adp_eff_rank = eff_ranks_by_pos[player["position"]].get(stack_rank)
            if adp_eff_rank is not None:
                adjusted, index = rvi.ApproachG(
                    player["ktc_value"],
                    adp_eff_rank,
                    player["position"],
                    rank_lookup,
                )
                if adjusted is not None:
                    matched += 1

            if adjusted is not None and adjusted > 0:
                rebuilder, rebuild_index = rvi.compute_rebuilder_adjusted(
                    player["ktc_value"],
                    player["ktc_pos_rank"],
                    adp_eff_rank,
                    adjusted,
                    rank_lookup,
                    player["position"],
                    flip_friendliness=flip_friendliness,
                )
            elif adjusted is None or adjusted == 0:
                rebuilder, rebuild_index = rvi.compute_rebuilder_at_zero_redraft(
                    player["ktc_value"],
                    player["ktc_pos_rank"],
                    adp_eff_rank,
                    rank_lookup,
                    player["position"],
                )
        else:
            unranked = rvi.apply_unranked_redraft_adjustments(
                player,
                adp_boards,
                eff_ranks_by_pos,
                rank_lookup,
                unranked_config,
            )
            stack_rank = unranked["stack_rank"]
            adp_eff_rank = unranked["adp_eff_rank"]
            adjusted = unranked["adjusted"]
            index = unranked["index"]
            rebuilder = unranked["rebuilder"]
            rebuild_index = unranked["rebuild_index"]
            adp_synthetic = unranked["adp_synthetic"]
            if adp_synthetic and adjusted is not None:
                synthetic += 1

        output_rows.append({
            "year": year,
            "ktc_snapshot_date": snapshot_date,
            "name": player["name"],
            "position": player["position"],
            "team": player["team"],
            "ktc_value": player["ktc_value"],
            "ktc_pos_rank": player["ktc_pos_rank"],
            "adp_stack_rank": stack_rank if stack_rank is not None else "",
            "adp_eff_rank": adp_eff_rank if adp_eff_rank is not None else "",
            "bb_avg_adp": (
                round(adp["bb_avg_adp"], 1)
                if adp and adp.get("bb_avg_adp") is not None
                else round(adp["adp_avg"], 1) if adp and adp.get("adp_avg") is not None else ""
            ),
            "adp_avg": round(adp["adp_avg"], 1) if adp and adp.get("adp_avg") is not None else "",
            "competitor_adjusted_value": adjusted if adjusted is not None else "",
            "redraft_value_index": index if index is not None else "",
            "rebuilder_adjusted_value": rebuilder if rebuilder is not None else "",
            "rebuild_value_index": rebuild_index if rebuild_index is not None else "",
            "adp_synthetic": 1 if adp_synthetic else "",
            "adp_source": adp_source,
        })

    return output_rows, rank_lookup, snapshot_date, matched, synthetic


def write_outputs(
    all_rows: list[dict],
    lookup_rows: list[dict],
) -> None:
    player_fields = [
        "year",
        "ktc_snapshot_date",
        "name",
        "position",
        "team",
        "ktc_value",
        "ktc_pos_rank",
        "adp_stack_rank",
        "adp_eff_rank",
        "bb_avg_adp",
        "adp_avg",
        "competitor_adjusted_value",
        "redraft_value_index",
        "rebuilder_adjusted_value",
        "rebuild_value_index",
        "adp_synthetic",
        "adp_source",
    ]
    lookup_fields = [
        "year",
        "position",
        "rank",
        "weighted_hist_avg",
        "final_ktc_at_rank",
        "blended_lookup_value",
    ]

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=player_fields)
        writer.writeheader()
        writer.writerows(all_rows)

    with LOOKUP_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=lookup_fields)
        writer.writeheader()
        writer.writerows(lookup_rows)


def main() -> None:
    hwang_script = PROJECT_ROOT / "scripts/compute_hwang_scoring_adp.py"
    print("Regenerating Hwang adjusted ADP (all available seasons)…")
    subprocess.run([sys.executable, str(hwang_script)], check=True)

    sleeper_by_name, sleeper_by_last = rvi.load_sleeper_ids_by_player()
    current_target_sum = rvi.current_live_top300_sum()

    all_rows: list[dict] = []
    lookup_rows: list[dict] = []

    for year in FINAL_KTC_YEARS:
        print(f"\n=== {year} ===")
        weighted_hist, inflation, target_sum = compute_season_weighted_hist(year)
        print(
            f"  hist rank slots: imputed Final KTC ({rvi.HISTORICAL_VALUES_CSV.name}), "
            f"no inflation (reference {year} final top-300 = {target_sum:,}; "
            f"live 2026 = {current_target_sum:,})"
        )

        rows, rank_lookup, snapshot_date, matched, synthetic = compute_season_redraft_values(
            year,
            weighted_hist,
            sleeper_by_name,
            sleeper_by_last,
        )
        all_rows.extend(rows)
        print(
            f"  snapshot {snapshot_date}: {len(rows):,} KTC players, "
            f"{matched:,} ADP-matched, {synthetic:,} synthetic ceiling"
        )

        year_by_rank = rvi.current_ktc_values_by_pos_rank(load_final_ktc_players(year)[0])

        for pos in rvi.POSITIONS:
            ranks = sorted(
                set(weighted_hist[pos]) | set(year_by_rank[pos]) | set(rank_lookup[pos])
            )
            for rank in ranks:
                lookup_rows.append({
                    "year": year,
                    "position": pos,
                    "rank": rank,
                    "weighted_hist_avg": round(weighted_hist[pos].get(rank, 0), 2)
                    if rank in weighted_hist[pos]
                    else "",
                    "final_ktc_at_rank": year_by_rank[pos].get(rank, ""),
                    "blended_lookup_value": round(rank_lookup[pos][rank], 2)
                    if rank in rank_lookup[pos]
                    else "",
                })

    write_outputs(all_rows, lookup_rows)

    print(f"\nWrote {len(all_rows):,} player rows → {OUTPUT_CSV}")
    print(f"Wrote {len(lookup_rows):,} rank-slot lookups → {LOOKUP_CSV}")
    print(
        f"Lookup blend: {HIST_BLEND_WEIGHT:.0%} year-weighted hist + "
        f"{YEAR_KTC_BLEND_WEIGHT:.0%} that season's final KTC @ rank"
    )
    print(
        "Historical inflation: each season's hist curve scaled to that season's "
        f"final KTC top-{rvi.TOP300_INFLATION_TARGET_COUNT} total (not live 2026)"
    )


if __name__ == "__main__":
    main()
