#!/usr/bin/env python3
"""
compute_redraft_value_index.py

Maps each player's KTC dynasty value to a competitor-adjusted value on the same
KTC scale using FantasyPros redraft ADP (Hwang-adjusted best-ball by default).

Positional ADP rank is derived by sorting players within each position by OVR
avg ADP (ascending). FantasyPros' POS label is kept only for discrepancy reporting.

Method:
  1. adp_stack_rank = integer positional rank by sorting within position on avg ADP.
  2. adp_eff_rank = ApproachH: stack rank corrected by OVR ADP vs positional KTC lookup (λ).
  3. Active approach (ApproachG): rank-slot lookup = 40% year-weighted hist (2021–2025)
     plus 60% current KTC at that positional rank; interpolate at adp_eff_rank.
     Historical years 2022–2025 are scaled so each year's year-end top-300 sum matches
     the current live SF TE+ top-300 total (2021 unscaled).
  4. Rebuilder adjusted = hist@KTC rank + γ×(dynasty−hist) − β×(adjusted−dynasty),
     with γ from max(0, adp_eff_rank − ktc_pos_rank); asymmetric β on redraft flip.
     Flip friendliness is auto-calibrated on the ADP pool so
     sum(rebuild) = 2×sum(ktc) − sum(comp) (comp/rebuild midpoint = dynasty).
  5. Off-ADP KTC players: synthetic rank at positional ADP ceiling (see UNRANKED_ADP).
     Legacy max-rebuild credit available via UNRANKED_ADP.mode = "zero_redraft".
  6. Prior experiments preserved as uncalled ApproachA–G helpers (B = peer exchange).

Reads:
  site/public/data/ktc_values.csv  (ktc_value_tep_2qb = SF TE+ baseline)
  site/public/data/sf_ktc_values_historical.csv  (merged SF TE+: non_tep + TE+ overlay)
  site/public/data/ktc_average_rank_values.csv
  site/public/data/hwang_adjusted_positional_adp.csv  (when USE_HWANG_ADJUSTED_ADP)
  site/public/data/adp/fantasypros_adp_bestball_{year}.csv  (when not)

Writes:
  site/public/data/ktc_redraft_value_index.csv
  site/public/data/ktc_redraft_rank_lookup.csv

Usage (from project root):
  python3 scripts/compute_redraft_value_index.py [year]

  When USE_HWANG_ADJUSTED_ADP is True, run compute_hwang_scoring_adp.py first
  (or let this script regenerate it automatically).
"""

from __future__ import annotations

import csv
import json
import re
import subprocess
import sys
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, replace
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
KTC_CSV = PROJECT_ROOT / "site/public/data/ktc_values.csv"
HISTORICAL_VALUES_CSV = PROJECT_ROOT / "site/public/data/sf_ktc_values_historical.csv"
HISTORICAL_NAME_IDS_CSV = PROJECT_ROOT / "site/public/data/ktc_historical_name_ids.csv"
HIST_RANK_VALUES_CSV = PROJECT_ROOT / "site/public/data/ktc_average_rank_values.csv"
PLAYERS_FILE = PROJECT_ROOT / "site/public/data/players.txt"
ADP_DIR = PROJECT_ROOT / "site/public/data/adp"
HWANG_ADP_CSV = PROJECT_ROOT / "site/public/data/hwang_adjusted_positional_adp.csv"
OUTPUT_CSV = PROJECT_ROOT / "site/public/data/ktc_redraft_value_index.csv"
LOOKUP_CSV = PROJECT_ROOT / "site/public/data/ktc_redraft_rank_lookup.csv"

POSITIONS = ("QB", "RB", "WR", "TE")
DEFAULT_ADP_YEAR = 2026
KTC_VALUE_COL = "ktc_value_tep_2qb"
ADP_TYPE = "bestball"

# Redraft ADP input toggle.
# True  → Hwang Adjusted Positional ADP (best-ball corrected for half→std RB/WR shift).
# False → raw FantasyPros best-ball ADP from site/public/data/adp/.
USE_HWANG_ADJUSTED_ADP = True
PREMIUM_RETENTION = 0.5
PICK_RE = re.compile(r"^\d{4}\s+(Early|Mid|Late)\s+", re.I)

# Year-weighted historical rank-slot averages (must sum to 1.0).
HISTORICAL_YEAR_WEIGHTS: dict[int, float] = {
    2021: 0.13,
    2022: 0.17,
    2023: 0.20,
    2024: 0.235,
    2025: 0.265,
}
# Scale these years' KTC values before rank-slot averaging (2021 stays raw).
HISTORICAL_INFLATION_YEARS = (2022, 2023, 2024, 2025)
TOP300_INFLATION_TARGET_COUNT = 300
REDRAFT_HIST_WEIGHT = 0.40
REDRAFT_CURRENT_WEIGHT = 0.60

# Rebuilder adjusted: γ from KTC vs ADP rank gap + asymmetric damped redraft flip.
REBUILD_BETA_UP = 0.54
REBUILD_BETA_DOWN = 0.77
REBUILD_GAP_SCALE = 11.0
# Extra reduction when ADP rank is better than KTC (redraft delta > 0 and rank_gap < 0).
REBUILD_REDUCE_RANK_BOOST = 0.18
# Depth dynasty-tax: modest β_up boost when ADP rank lags KTC and redraft index crashes.
REBUILD_DEPTH_KTC_RANK_MIN = 40
REBUILD_DEPTH_GAP_MIN = 25.0
REBUILD_DEPTH_GAP_SCALE = 60.0
REBUILD_BETA_UP_DEPTH_BOOST = 0.10
REBUILD_SEV_RVI_FLOOR = 0.55
REBUILD_SEV_RVI_SCALE = 0.40
# Auto-calibrated each run on ADP-matched players so sum(rebuild) = 2×sum(ktc) − sum(comp).
# Scales β up when comp < dynasty and relaxes β down when comp > dynasty (positive inversion).
REBUILD_AUTO_MIDPOINT_ANCHOR = True
REBUILD_FLIP_FRIENDLINESS = 0.0  # set in calibrate_rebuild_flip_friendliness()

# ApproachH: OVR avg ADP → fractional stack rank, invert KTC lookup, blend toward stack (λ).
OVR_KTC_RANK_LAMBDA = 0.40

# --- Off-ADP (unranked) synthetic rank ---------------------------------------
# KTC players missing from FantasyPros ADP get a synthetic redraft slot instead of
# max rebuild credit. Tune here when ceiling treatment over/under-corrects.
#
# mode:
#   "ceiling"      — ApproachG + normal rebuild at synthetic eff rank (default)
#   "zero_redraft" — legacy: competitor=0, max rebuild credit (~1.8×)
#
# use_ktc_pos_rank_floor — eff rank = max(ceiling_eff, ktc_pos_rank) so deep dynasty
#   ranks are not treated more favorably than the last ADP player.
# eff_rank_offset — add to synthetic eff rank (+ = harsher redraft tax / lower comp).
# eff_rank_scale  — multiply synthetic eff rank after offset (1.0 = no change).
UNRANKED_ADP_MODE = "ceiling"
UNRANKED_ADP_USE_KTC_FLOOR = True
UNRANKED_ADP_EFF_RANK_OFFSET = 0.0
UNRANKED_ADP_EFF_RANK_SCALE = 1.0


@dataclass(frozen=True)
class UnrankedAdpConfig:
    mode: str = UNRANKED_ADP_MODE
    use_ktc_pos_rank_floor: bool = UNRANKED_ADP_USE_KTC_FLOOR
    eff_rank_offset: float = UNRANKED_ADP_EFF_RANK_OFFSET
    eff_rank_scale: float = UNRANKED_ADP_EFF_RANK_SCALE

    def describe(self) -> str:
        parts = [f"mode={self.mode}"]
        if self.mode == "ceiling":
            if self.use_ktc_pos_rank_floor:
                parts.append("ktc_floor")
            if self.eff_rank_offset:
                parts.append(f"offset={self.eff_rank_offset:+.2f}")
            if self.eff_rank_scale != 1.0:
                parts.append(f"scale={self.eff_rank_scale:.3f}")
        return ", ".join(parts)


DEFAULT_UNRANKED_ADP = UnrankedAdpConfig()

# --- Peer ADP exchange tuning (adp_eff_rank) ---------------------------------
# All percentages are OVR ADP step-up from the giver: (receiver_adp - giver_adp) / giver_adp
#
# PEER_ADP_FULL_WEIGHT_AT — at/below this gap, exchange weight = 1 (max give toward meeting point)
# PEER_ADP_CUTOFF         — at/above this gap, exchange weight = 0 (no give)
#
# Between those endpoints, weight = f(t) where t = (pct - full) / (cutoff - full) in [0, 1]:
#   linear     — f(t) = 1 - t
#   power      — f(t) = (1 - t) ** PEER_EXCHANGE_CURVE_POWER
#                  power < 1: more generous in the mid-range; > 1: stingier until very close
#   smoothstep — f(t) = 1 - (3t² - 2t³)
#
# Or set PEER_EXCHANGE_WEIGHT_KNOTS to a custom (pct, weight) table (linear interp).
# Knot pct values use the same scale as cutoff (not normalized t).
# Example: [(0.0, 1.0), (0.10, 0.75), (0.20, 0.25), (0.25, 0.0)]
PEER_ADP_FULL_WEIGHT_AT = 0.0
PEER_ADP_CUTOFF = 0.25
PEER_EXCHANGE_CURVE = "power"
PEER_EXCHANGE_CURVE_POWER = 1.0
PEER_EXCHANGE_WEIGHT_KNOTS: list[tuple[float, float]] | None = None

PEER_EXCHANGE_MAX_ITERS = 100
PEER_ADP_EQUAL_EPS = 1e-9
PEER_EXCHANGE_MIN_GIVE = 1e-4


@dataclass(frozen=True)
class PeerExchangeConfig:
    cutoff: float = PEER_ADP_CUTOFF
    full_weight_at: float = PEER_ADP_FULL_WEIGHT_AT
    curve: str = PEER_EXCHANGE_CURVE
    curve_power: float = PEER_EXCHANGE_CURVE_POWER
    weight_knots: tuple[tuple[float, float], ...] | None = None

    @classmethod
    def default(cls) -> PeerExchangeConfig:
        knots = PEER_EXCHANGE_WEIGHT_KNOTS
        return cls(
            weight_knots=tuple(knots) if knots else None,
        )

    def describe(self) -> str:
        if self.weight_knots:
            return f"knots({len(self.weight_knots)} pts, cutoff={self.cutoff:.1%})"
        return (
            f"{self.curve}(power={self.curve_power:g}, "
            f"full@{self.full_weight_at:.1%}, cutoff={self.cutoff:.1%})"
        )


DEFAULT_PEER_EXCHANGE = PeerExchangeConfig.default()


def ovr_adp_step_pct(adp_giver: float, adp_receiver: float) -> float:
    if adp_receiver <= adp_giver:
        return 0.0
    return (adp_receiver - adp_giver) / adp_giver


def _interp_weight_knots(pct: float, knots: tuple[tuple[float, float], ...]) -> float:
    if pct <= knots[0][0]:
        return knots[0][1]
    if pct >= knots[-1][0]:
        return knots[-1][1]
    for (pct_lo, weight_lo), (pct_hi, weight_hi) in zip(knots, knots[1:]):
        if pct_lo <= pct <= pct_hi:
            if pct_hi == pct_lo:
                return weight_hi
            frac = (pct - pct_lo) / (pct_hi - pct_lo)
            return weight_lo + frac * (weight_hi - weight_lo)
    return knots[-1][1]


def peer_exchange_weight_from_pct(pct: float, config: PeerExchangeConfig) -> float:
    """Return exchange weight for an OVR ADP step-up pct from giver to receiver."""
    if pct <= config.full_weight_at:
        return 1.0
    if pct >= config.cutoff:
        return 0.0

    if config.weight_knots:
        return max(0.0, min(1.0, _interp_weight_knots(pct, config.weight_knots)))

    span = config.cutoff - config.full_weight_at
    t = (pct - config.full_weight_at) / span
    curve = config.curve.lower()

    if curve == "linear":
        weight = 1.0 - t
    elif curve == "power":
        weight = (1.0 - t) ** config.curve_power
    elif curve == "smoothstep":
        weight = 1.0 - (3.0 * t * t - 2.0 * t * t * t)
    else:
        sys.exit(f"Unknown PEER_EXCHANGE_CURVE: {config.curve!r} (use linear, power, smoothstep)")

    return max(0.0, min(1.0, weight))


def peer_exchange_weight(
    adp_giver: float,
    adp_receiver: float,
    config: PeerExchangeConfig = DEFAULT_PEER_EXCHANGE,
) -> float:
    return peer_exchange_weight_from_pct(ovr_adp_step_pct(adp_giver, adp_receiver), config)

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


def load_historical_rank_values() -> dict[str, dict[int, float]]:
    if not HIST_RANK_VALUES_CSV.is_file():
        sys.exit(f"ERROR: missing {HIST_RANK_VALUES_CSV}")

    by_position: dict[str, dict[int, float]] = {p: {} for p in POSITIONS}
    text = HIST_RANK_VALUES_CSV.read_text(encoding="utf-8").strip()
    lines = text.split("\n")
    headers = parse_csv_row(lines[0])
    idx = {name: headers.index(name) for name in headers}

    for line in lines[1:]:
        cols = parse_csv_row(line)
        if cols[idx["metric"]] != "positional":
            continue
        position = (cols[idx["position"]] or "").strip().upper()
        if position not in POSITIONS:
            continue
        rank = int(cols[idx["rank"]])
        by_position[position][rank] = float(cols[idx["average_value"]])

    return by_position


def load_historical_position_lookup() -> dict[str, str]:
    by_name: dict[str, str] = {}
    if HISTORICAL_NAME_IDS_CSV.is_file():
        with HISTORICAL_NAME_IDS_CSV.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                pos = (row.get("position") or "").strip().upper()
                name = (row.get("name") or "").strip()
                if name and pos in POSITIONS:
                    by_name[name] = pos
    return by_name


def resolve_historical_position(
    name: str,
    sleeper_id: str,
    by_name: dict[str, str],
    players: dict,
) -> str | None:
    pos = by_name.get(name)
    if pos in POSITIONS:
        return pos
    if sleeper_id and sleeper_id in players:
        player = players[sleeper_id]
        pos = (player.get("position") or (player.get("fantasy_positions") or [""])[0] or "").upper()
        if pos in POSITIONS:
            return pos
    return None


def load_historical_by_date() -> dict[str, list[tuple[str, int]]]:
    if not HISTORICAL_VALUES_CSV.is_file():
        sys.exit(f"ERROR: missing {HISTORICAL_VALUES_CSV}")

    by_name = load_historical_position_lookup()
    players = json.loads(PLAYERS_FILE.read_text(encoding="utf-8")) if PLAYERS_FILE.is_file() else {}
    by_date: dict[str, list[tuple[str, int]]] = defaultdict(list)

    with HISTORICAL_VALUES_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = (row.get("name") or "").strip()
            if not name or PICK_RE.match(name):
                continue
            try:
                value = int(row["ktc_value"])
            except (KeyError, ValueError, TypeError):
                continue
            pos = resolve_historical_position(
                name,
                (row.get("sleeper_id") or "").strip(),
                by_name,
                players,
            )
            if not pos:
                continue
            by_date[row["date"]].append((pos, value))

    return by_date


def last_snapshot_date_by_year(by_date: dict[str, list[tuple[str, int]]]) -> dict[int, str]:
    last: dict[int, str] = {}
    for date_str in by_date:
        year = int(date_str[:4])
        if date_str > last.get(year, ""):
            last[year] = date_str
    return last


def top300_value_sum(entries: list[tuple[str, int]]) -> int:
    values = sorted((value for _pos, value in entries), reverse=True)
    return sum(values[:TOP300_INFLATION_TARGET_COUNT])


def current_live_top300_sum() -> int:
    if not KTC_CSV.is_file():
        sys.exit(f"ERROR: missing {KTC_CSV}")
    values: list[int] = []
    with KTC_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = (row.get("name") or "").strip()
            if not name or PICK_RE.match(name):
                continue
            try:
                values.append(int(row[KTC_VALUE_COL]))
            except (KeyError, ValueError, TypeError):
                continue
    return sum(sorted(values, reverse=True)[:TOP300_INFLATION_TARGET_COUNT])


def compute_historical_inflation_multipliers(
    by_date: dict[str, list[tuple[str, int]]],
    target_sum: int,
    years: tuple[int, ...] = HISTORICAL_INFLATION_YEARS,
) -> dict[int, float]:
    """
    Per-year scalar so year-end top-300 KTC sum matches target_sum (current live board).
    Uniform scaling preserves within-year rank order.
    """
    last_by_year = last_snapshot_date_by_year(by_date)
    multipliers: dict[int, float] = {}
    for year in years:
        date_str = last_by_year.get(year)
        if not date_str:
            continue
        year_sum = top300_value_sum(by_date[date_str])
        if year_sum > 0:
            multipliers[year] = target_sum / year_sum
    return multipliers


def compute_year_rank_slot_averages(
    by_date: dict[str, list[tuple[str, int]]],
    year: int,
    value_multiplier: float = 1.0,
) -> dict[str, dict[int, float]]:
    totals: dict[str, dict[int, float]] = {p: defaultdict(float) for p in POSITIONS}
    counts: dict[str, dict[int, int]] = {p: defaultdict(int) for p in POSITIONS}

    for date_str, entries in by_date.items():
        if not date_str.startswith(str(year)):
            continue
        by_pos: dict[str, list[int]] = {p: [] for p in POSITIONS}
        for pos, value in entries:
            by_pos[pos].append(int(round(value * value_multiplier)))
        for pos in POSITIONS:
            values = sorted(by_pos[pos], reverse=True)
            for i, val in enumerate(values):
                rank = i + 1
                totals[pos][rank] += val
                counts[pos][rank] += 1

    averages: dict[str, dict[int, float]] = {p: {} for p in POSITIONS}
    for pos in POSITIONS:
        for rank, total in totals[pos].items():
            count = counts[pos][rank]
            if count:
                averages[pos][rank] = total / count
    return averages


def compute_weighted_historical_rank_values(
    by_date: dict[str, list[tuple[str, int]]],
) -> tuple[dict[str, dict[int, float]], dict[int, float], int]:
    target_sum = current_live_top300_sum()
    inflation = compute_historical_inflation_multipliers(by_date, target_sum)
    year_avgs = {
        year: compute_year_rank_slot_averages(
            by_date,
            year,
            inflation.get(year, 1.0),
        )
        for year in HISTORICAL_YEAR_WEIGHTS
    }
    weighted: dict[str, dict[int, float]] = {p: {} for p in POSITIONS}

    for pos in POSITIONS:
        ranks: set[int] = set()
        for year_avg in year_avgs.values():
            ranks.update(year_avg[pos])
        for rank in ranks:
            total = 0.0
            weight_sum = 0.0
            for year, weight in HISTORICAL_YEAR_WEIGHTS.items():
                avg = year_avgs[year][pos].get(rank)
                if avg is None:
                    continue
                total += weight * avg
                weight_sum += weight
            if weight_sum > 0:
                weighted[pos][rank] = total / weight_sum

    return weighted, inflation, target_sum


def current_ktc_values_by_pos_rank(ktc_players: list[dict]) -> dict[str, dict[int, int]]:
    current: dict[str, dict[int, int]] = {p: {} for p in POSITIONS}
    for player in ktc_players:
        current[player["position"]][player["ktc_pos_rank"]] = player["ktc_value"]
    return current


def build_blended_rank_lookup(
    weighted_hist: dict[str, dict[int, float]],
    current: dict[str, dict[int, int]],
) -> dict[str, dict[int, float]]:
    blended: dict[str, dict[int, float]] = {p: {} for p in POSITIONS}
    for pos in POSITIONS:
        ranks = set(weighted_hist[pos]) | set(current[pos])
        for rank in ranks:
            hist_val = weighted_hist[pos].get(rank)
            cur_val = current[pos].get(rank)
            if hist_val is not None and cur_val is not None:
                blended[pos][rank] = (
                    REDRAFT_HIST_WEIGHT * hist_val
                    + REDRAFT_CURRENT_WEIGHT * float(cur_val)
                )
            elif hist_val is not None:
                blended[pos][rank] = hist_val
            elif cur_val is not None:
                blended[pos][rank] = float(cur_val)
    return blended


def build_redraft_rank_lookup(ktc_players: list[dict]) -> tuple[
    dict[str, dict[int, float]],
    dict[str, dict[int, int]],
    dict[str, dict[int, float]],
    dict[int, float],
    int,
]:
    by_date = load_historical_by_date()
    weighted_hist, inflation, target_sum = compute_weighted_historical_rank_values(by_date)
    current = current_ktc_values_by_pos_rank(ktc_players)
    blended = build_blended_rank_lookup(weighted_hist, current)
    return weighted_hist, current, blended, inflation, target_sum


def write_redraft_rank_lookup_csv(
    weighted_hist: dict[str, dict[int, float]],
    current: dict[str, dict[int, int]],
    blended: dict[str, dict[int, float]],
) -> int:
    fieldnames = [
        "position",
        "rank",
        "weighted_hist_avg",
        "current_ktc_at_rank",
        "blended_lookup_value",
    ]
    rows: list[dict] = []
    for pos in POSITIONS:
        ranks = sorted(set(weighted_hist[pos]) | set(current[pos]) | set(blended[pos]))
        for rank in ranks:
            rows.append({
                "position": pos,
                "rank": rank,
                "weighted_hist_avg": round(weighted_hist[pos].get(rank, 0), 2)
                if rank in weighted_hist[pos]
                else "",
                "current_ktc_at_rank": current[pos].get(rank, ""),
                "blended_lookup_value": round(blended[pos][rank], 2) if rank in blended[pos] else "",
            })

    LOOKUP_CSV.parent.mkdir(parents=True, exist_ok=True)
    with LOOKUP_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


def load_historical_overall_rank_values() -> dict[int, float]:
    if not HIST_RANK_VALUES_CSV.is_file():
        sys.exit(f"ERROR: missing {HIST_RANK_VALUES_CSV}")

    overall: dict[int, float] = {}
    text = HIST_RANK_VALUES_CSV.read_text(encoding="utf-8").strip()
    lines = text.split("\n")
    headers = parse_csv_row(lines[0])
    idx = {name: headers.index(name) for name in headers}

    for line in lines[1:]:
        cols = parse_csv_row(line)
        if cols[idx["metric"]] != "overall":
            continue
        rank = int(cols[idx["rank"]])
        overall[rank] = float(cols[idx["average_value"]])

    return overall


def interpolate_hist(hist: dict[int, float], rank_eff: float) -> float | None:
    if not hist or rank_eff < 1:
        return None

    max_rank = max(hist)
    rank_eff = max(1.0, min(float(rank_eff), max_rank))

    rank_low = int(rank_eff)
    if rank_eff == max_rank and rank_low == max_rank:
        return hist[max_rank]

    rank_high = min(rank_low + 1, max_rank)
    frac = rank_eff - rank_low
    v_low = hist.get(rank_low)
    v_high = hist.get(rank_high, v_low)
    if v_low is None:
        return None
    if v_high is None:
        return v_low
    return v_low + frac * (v_high - v_low)


def adp_to_frac_stack_rank(adp: float, board: dict[int, dict]) -> float:
    """Invert the stack-rank ↔ OVR avg ADP curve to a fractional stack rank."""
    ranks = sorted(board)
    if not ranks:
        return 1.0
    if len(ranks) == 1:
        return float(ranks[0])

    first, second = ranks[0], ranks[1]
    a_first = board[first]["adp_avg"]
    if adp <= a_first:
        a_second = board[second]["adp_avg"]
        if a_second == a_first:
            return float(first)
        slope = (second - first) / (a_second - a_first)
        return max(1.0, first + (adp - a_first) * slope)

    last, prev = ranks[-1], ranks[-2]
    a_last = board[last]["adp_avg"]
    if adp >= a_last:
        a_prev = board[prev]["adp_avg"]
        if a_last == a_prev:
            return float(last)
        slope = (last - prev) / (a_last - a_prev)
        return last + (adp - a_last) * slope

    for idx in range(len(ranks) - 1):
        r_lo, r_hi = ranks[idx], ranks[idx + 1]
        a_lo = board[r_lo]["adp_avg"]
        a_hi = board[r_hi]["adp_avg"]
        if a_lo <= adp <= a_hi:
            if a_hi == a_lo:
                return (r_lo + r_hi) / 2.0
            frac = (adp - a_lo) / (a_hi - a_lo)
            return r_lo + frac * (r_hi - r_lo)

    return float(ranks[-1])


def ovr_implied_frac_rank(stack_rank: int, board: dict[int, dict]) -> float:
    """
    Fractional stack rank from OVR ADP relative to neighbors (not the knot itself).
    Spans [s-1, s+1] for interior ranks so bunched ADP compresses vs stack slots.
    """
    ranks = sorted(board)
    if stack_rank not in board:
        return float(stack_rank)
    if len(ranks) == 1:
        return float(stack_rank)

    idx = ranks.index(stack_rank)
    a = board[stack_rank]["adp_avg"]

    if idx == 0:
        return float(stack_rank)

    if idx == len(ranks) - 1:
        a_prev = board[ranks[idx - 1]]["adp_avg"]
        span = max(a - a_prev, 1e-9)
        return (stack_rank - 1) + min(1.0, max(0.0, (a - a_prev) / span))

    a_prev = board[ranks[idx - 1]]["adp_avg"]
    a_next = board[ranks[idx + 1]]["adp_avg"]
    span = max(a_next - a_prev, 1e-9)
    frac = (a - a_prev) / span
    return (stack_rank - 1) + frac * 2.0


def invert_lookup_rank(lookup: dict[int, float], target: float) -> float | None:
    """Rank r where blended lookup value equals target (lookup decreases as rank rises)."""
    if not lookup:
        return None
    max_rank = max(lookup)
    v_top = interpolate_hist(lookup, 1.0)
    v_bot = interpolate_hist(lookup, float(max_rank))
    if v_top is None or v_bot is None:
        return None

    clamped = max(v_bot, min(v_top, target))
    lo, hi = 1.0, float(max_rank)
    for _ in range(64):
        mid = (lo + hi) / 2.0
        v_mid = interpolate_hist(lookup, mid)
        if v_mid is None:
            return None
        if v_mid > clamped:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def load_ktc_players() -> tuple[list[dict], str | None]:
    if not KTC_CSV.is_file():
        sys.exit(f"ERROR: missing {KTC_CSV}")

    text = KTC_CSV.read_text(encoding="utf-8").strip()
    lines = text.split("\n")
    headers = lines[0].split(",")
    idx = {name: headers.index(name) for name in headers}

    players: list[dict] = []
    as_of = None

    for line in lines[1:]:
        cols = line.split(",")
        position = (cols[idx["position"]] or "").strip().upper()
        if position not in POSITIONS:
            continue
        name = (cols[idx["name"]] or "").strip()
        try:
            value = int(cols[idx[KTC_VALUE_COL]])
        except (KeyError, ValueError, TypeError):
            continue
        if not name or value <= 0:
            continue
        if not as_of and "as_of" in idx:
            as_of = (cols[idx["as_of"]] or "").strip() or None

        players.append({
            "name": name,
            "position": position,
            "team": (cols[idx["team"]] or "").strip(),
            "ktc_value": value,
            "norm_name": normalize_name(name),
        })

    by_position: dict[str, list[dict]] = {p: [] for p in POSITIONS}
    for player in players:
        by_position[player["position"]].append(player)

    ranked: list[dict] = []
    overall_sorted = sorted(players, key=lambda r: (-r["ktc_value"], r["name"]))
    overall_rank_by_name = {
        (player["name"], player["position"]): i + 1
        for i, player in enumerate(overall_sorted)
    }

    for pos in POSITIONS:
        rows = sorted(by_position[pos], key=lambda r: r["ktc_value"], reverse=True)
        for i, row in enumerate(rows, start=1):
            ranked.append({
                **row,
                "ktc_pos_rank": i,
                "ktc_overall_rank": overall_rank_by_name[(row["name"], row["position"])],
            })

    return ranked, as_of


def load_sleeper_ids_by_player() -> tuple[dict[tuple[str, str], str], dict[tuple[str, str], str]]:
    if not PLAYERS_FILE.is_file():
        return {}, {}

    data = json.loads(PLAYERS_FILE.read_text(encoding="utf-8"))
    by_name: dict[tuple[str, str], str] = {}
    by_last: dict[tuple[str, str], str] = {}
    last_counts: dict[tuple[str, str], int] = {}

    for sleeper_id, player in data.items():
        position = (player.get("position") or "").strip().upper()
        if position not in POSITIONS:
            continue
        full_name = (player.get("full_name") or "").strip()
        if not full_name:
            first = (player.get("first_name") or "").strip()
            last = (player.get("last_name") or "").strip()
            full_name = f"{first} {last}".strip()
        if not full_name:
            continue

        norm = normalize_name(full_name)
        by_name[(norm, position)] = str(sleeper_id)

        parts = norm.split()
        if parts:
            last_key = (parts[-1], position)
            last_counts[last_key] = last_counts.get(last_key, 0) + 1
            by_last[last_key] = str(sleeper_id)

    by_last_unique = {
        key: sid for key, sid in by_last.items() if last_counts.get(key, 0) == 1
    }
    return by_name, by_last_unique


def assign_stack_ranks(
    rows: list[dict],
) -> tuple[dict[str, dict[int, dict]], list[dict]]:
    """Sort each position by avg ADP and assign stack ranks 1..N."""
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
            enriched = {
                **row,
                "adp_stack_rank": stack_rank,
                "adp_fp_pos_rank": row["adp_fp_pos_rank"],
            }
            boards[pos][stack_rank] = enriched
            ranked_rows.append(enriched)

    return boards, ranked_rows


def load_bestball_adp(year: int) -> tuple[dict[tuple[str, str], dict], dict[str, dict], dict[str, dict[int, dict]], list[dict]]:
    adp_path = ADP_DIR / f"fantasypros_adp_{ADP_TYPE}_{year}.csv"
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
            fp_pos_rank = int(cols[idx["pos_rank"]])
            overall_rank = int(cols[idx["rank"]])
            overall_avg = float(cols[idx["avg"]])
        except (KeyError, ValueError, TypeError):
            continue

        parsed.append({
            "name": name,
            "position": position,
            "team": (cols[idx["team"]] or "").strip(),
            "adp_fp_pos_rank": fp_pos_rank,
            "adp_overall_rank": overall_rank,
            "adp_avg": overall_avg,
            "sleeper_id": (cols[idx["sleeper_id"]] if "sleeper_id" in idx else "").strip(),
            "norm_name": normalize_name(name),
        })

    return _finalize_adp_load(parsed)


def load_hwang_adp(year: int) -> tuple[dict[tuple[str, str], dict], dict[str, dict], dict[str, dict[int, dict]], list[dict]]:
    if not HWANG_ADP_CSV.is_file():
        sys.exit(
            f"ERROR: missing {HWANG_ADP_CSV}. "
            f"Run: python3 scripts/compute_hwang_scoring_adp.py {year}"
        )

    text = HWANG_ADP_CSV.read_text(encoding="utf-8").strip()
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
            overall_rank = int(cols[idx["overall_rank"]])
            adp_avg = float(cols[idx["hwang_adjusted_adp"]])
            bb_avg_raw = (cols[idx["bb_avg_adp"]] or "").strip()
            bb_avg = float(bb_avg_raw) if bb_avg_raw else adp_avg
        except (KeyError, ValueError, TypeError):
            continue

        hwang_pos_raw = (cols[idx["hwang_pos_rank"]] or "").strip()
        fp_pos_rank = int(hwang_pos_raw) if hwang_pos_raw.isdigit() else overall_rank

        parsed.append({
            "name": name,
            "position": position,
            "team": (cols[idx["team"]] or "").strip(),
            "adp_fp_pos_rank": fp_pos_rank,
            "adp_overall_rank": overall_rank,
            "adp_avg": adp_avg,
            "bb_avg_adp": bb_avg,
            "sleeper_id": (cols[idx["sleeper_id"]] if "sleeper_id" in idx else "").strip(),
            "norm_name": normalize_name(name),
        })

    return _finalize_adp_load(parsed)


def _finalize_adp_load(
    parsed: list[dict],
) -> tuple[dict[tuple[str, str], dict], dict[str, dict], dict[str, dict[int, dict]], list[dict]]:
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


def load_adp(year: int) -> tuple[dict[tuple[str, str], dict], dict[str, dict], dict[str, dict[int, dict]], list[dict]]:
    if USE_HWANG_ADJUSTED_ADP:
        return load_hwang_adp(year)
    return load_bestball_adp(year)


def adp_source_label(adp_year: int) -> str:
    if USE_HWANG_ADJUSTED_ADP:
        return f"hwang_adjusted_positional_adp_{adp_year}"
    return f"fantasypros_{ADP_TYPE}_{adp_year}"


def report_fp_vs_stack_discrepancies(ranked_rows: list[dict], adp_year: int) -> None:
    total = len(ranked_rows)
    mismatches = [r for r in ranked_rows if r["adp_fp_pos_rank"] != r["adp_stack_rank"]]
    exact = total - len(mismatches)

    label = "Hwang pos rank" if USE_HWANG_ADJUSTED_ADP else "FP POS label"
    source = adp_source_label(adp_year)
    print(f"\n{label} vs avg-ADP stack rank ({source}):")
    print(f"  Total ADP rows:     {total:,}")
    print(f"  Exact match:        {exact:,} ({100 * exact / total:.1f}%)")
    print(f"  Discrepancies:      {len(mismatches):,} ({100 * len(mismatches) / total:.1f}%)")

    by_pos: dict[str, list[dict]] = defaultdict(list)
    for row in mismatches:
        by_pos[row["position"]].append(row)

    print("\n  Discrepancies by position:")
    for pos in POSITIONS:
        pos_rows = by_pos.get(pos, [])
        if not pos_rows:
            print(f"    {pos}: 0")
            continue
        deltas = [abs(r["adp_fp_pos_rank"] - r["adp_stack_rank"]) for r in pos_rows]
        print(
            f"    {pos}: {len(pos_rows):,} "
            f"(median |Δ|={sorted(deltas)[len(deltas) // 2]}, "
            f"max |Δ|={max(deltas)})"
        )

    worst = sorted(
        mismatches,
        key=lambda r: abs(r["adp_fp_pos_rank"] - r["adp_stack_rank"]),
        reverse=True,
    )[:12]
    if worst:
        print("\n  Largest mismatches (FP → stack, avg ADP):")
        for row in worst:
            delta = row["adp_stack_rank"] - row["adp_fp_pos_rank"]
            sign = "+" if delta > 0 else ""
            print(
                f"    {row['name']:22} {row['position']}"
                f" FP{row['adp_fp_pos_rank']} → stack{row['adp_stack_rank']} "
                f"({sign}{delta})  avg={row['adp_avg']}"
            )


def find_adp_row(
    player: dict,
    adp_by_name: dict[tuple[str, str], dict],
    adp_by_sleeper: dict[str, dict],
    sleeper_by_name: dict[tuple[str, str], str],
    sleeper_by_last: dict[tuple[str, str], str],
) -> dict | None:
    direct = adp_by_name.get((player["norm_name"], player["position"]))
    if direct:
        return direct

    sleeper_id = sleeper_by_name.get((player["norm_name"], player["position"]))
    if not sleeper_id:
        parts = player["norm_name"].split()
        if parts:
            sleeper_id = sleeper_by_last.get((parts[-1], player["position"]))

    if sleeper_id:
        return adp_by_sleeper.get(sleeper_id)

    return None


def _approach_a_window_bounds(board: dict[int, dict], stack_rank: int) -> tuple[int, int]:
    window = 12
    return max(1, stack_rank - window), min(max(board), stack_rank + window)


def _approach_a_peer_cluster_in_window(
    board: dict[int, dict],
    stack_rank: int,
    lo: int,
    hi: int,
) -> list[int]:
    gap = 4.0
    peers = {stack_rank}
    rank = stack_rank
    while rank < hi and board[rank + 1]["adp_avg"] - board[rank]["adp_avg"] <= gap:
        rank += 1
        peers.add(rank)
    rank = stack_rank
    while rank > lo and board[rank]["adp_avg"] - board[rank - 1]["adp_avg"] <= gap:
        rank -= 1
        peers.add(rank)
    return sorted(peers)


def _approach_a_cliff_anchor_after(
    board: dict[int, dict],
    start_rank: int,
    hi: int,
) -> tuple[int, float]:
    gap = 4.0
    max_rank = max(board)
    rank = start_rank + 1
    while rank <= hi and rank <= max_rank:
        if board[rank]["adp_avg"] - board[rank - 1]["adp_avg"] > gap:
            return rank, board[rank]["adp_avg"]
        rank += 1
    return hi, board[hi]["adp_avg"]


def _approach_a_cliff_anchor_before(
    board: dict[int, dict],
    start_rank: int,
    lo: int,
) -> tuple[int, float]:
    gap = 4.0
    rank = start_rank - 1
    while rank >= lo and rank >= 1:
        if board[rank + 1]["adp_avg"] - board[rank]["adp_avg"] > gap:
            return rank, board[rank]["adp_avg"]
        rank -= 1
    return lo, board[lo]["adp_avg"]


def _approach_a_compress_peer_rank(
    peers: list[int],
    board: dict[int, dict],
    stack_rank: int,
) -> float:
    within_tier_base = 0.5
    within_tier_spread = 0.1
    avgs = [board[rank]["adp_avg"] for rank in peers]
    a_min = min(avgs)
    a_max = max(avgs)
    span = a_max - a_min
    frac = (board[stack_rank]["adp_avg"] - a_min) / span if span > 0 else 0.0
    tier_start = peers[0]
    peer_bonus = max(0, len(peers) - 2) * 0.5
    return tier_start + within_tier_base + peer_bonus + within_tier_spread * frac


def _approach_a_cluster_cliff_rank(
    board: dict[int, dict],
    stack_rank: int,
    peers: list[int],
    hi: int,
) -> float:
    cluster_start = peers[0]
    avg = board[stack_rank]["adp_avg"]
    r_cliff, o_cliff = _approach_a_cliff_anchor_after(board, peers[-1], hi)
    o_floor = board[cluster_start]["adp_avg"]
    r_floor = float(cluster_start)

    if o_cliff <= o_floor:
        return float(stack_rank)

    rank_eff = r_floor + (avg - o_floor) / (o_cliff - o_floor) * (r_cliff - r_floor)
    max_rank = max(board)
    return max(r_floor, min(rank_eff, max_rank + 0.99))


def _approach_a_cliff_interpolated_rank(
    board: dict[int, dict],
    stack_rank: int,
    lo: int,
    hi: int,
) -> float:
    avg = board[stack_rank]["adp_avg"]
    r_after, o_after = _approach_a_cliff_anchor_after(board, stack_rank, hi)
    r_before, o_before = _approach_a_cliff_anchor_before(board, stack_rank, lo)

    if stack_rank == 1 and r_before == lo and lo == 1:
        o_before = 2.0 * avg - board[2]["adp_avg"] if 2 in board else avg - 1.0
        r_before = 1.0

    if o_after <= o_before:
        return float(stack_rank)

    rank_eff = r_before + (avg - o_before) / (o_after - o_before) * (r_after - r_before)
    max_rank = max(board)
    return max(1.0, min(rank_eff, max_rank + 0.99))


def collapse_identical_adp_peer_groups(
    board: dict[int, dict],
    eff: dict[int, float],
    equal_eps: float = PEER_ADP_EQUAL_EPS,
) -> None:
    """Players with identical OVR avg ADP share the mean of their stack ranks."""
    ranks = sorted(board)
    parent = {rank: rank for rank in ranks}

    def find(rank: int) -> int:
        while parent[rank] != rank:
            parent[rank] = parent[parent[rank]]
            rank = parent[rank]
        return rank

    def union(a: int, b: int) -> None:
        root_a, root_b = find(a), find(b)
        if root_a != root_b:
            parent[root_b] = root_a

    for i, rank in enumerate(ranks):
        adp_rank = board[rank]["adp_avg"]
        for other in ranks[i + 1 :]:
            adp_other = board[other]["adp_avg"]
            if abs(adp_rank - adp_other) <= equal_eps:
                union(rank, other)

    groups: dict[int, list[int]] = defaultdict(list)
    for rank in ranks:
        groups[find(rank)].append(rank)

    for members in groups.values():
        if len(members) < 2:
            continue
        adps = [board[member]["adp_avg"] for member in members]
        if max(adps) - min(adps) > equal_eps:
            continue
        mean_rank = sum(members) / len(members)
        for member in members:
            eff[member] = mean_rank


def apply_peer_exchange_pass(
    board: dict[int, dict],
    eff: dict[int, float],
    config: PeerExchangeConfig = DEFAULT_PEER_EXCHANGE,
) -> bool:
    """One sweep of all within-cutoff pairs; giver moves down, receiver moves up."""
    ranks = sorted(board)
    changed = False

    for i, giver in enumerate(ranks):
        adp_giver = board[giver]["adp_avg"]
        for receiver in ranks[i + 1 :]:
            weight = peer_exchange_weight(adp_giver, board[receiver]["adp_avg"], config)
            if weight <= 0:
                continue

            meeting = (giver + receiver) / 2.0
            give = weight * (meeting - eff[giver])
            max_give = (eff[receiver] - eff[giver]) / 2.0
            give = max(0.0, min(give, max_give))
            if give <= PEER_EXCHANGE_MIN_GIVE:
                continue

            eff[giver] += give
            eff[receiver] -= give
            changed = True

    return changed


def enforce_monotonic_eff_ranks(board: dict[int, dict], eff: dict[int, float]) -> dict[int, float]:
    """Ensure eff rank rises with stack rank (required for hist curve lookup)."""
    ranks = sorted(board)
    adjusted = dict(eff)
    for i in range(1, len(ranks)):
        prev_rank, rank = ranks[i - 1], ranks[i]
        if adjusted[rank] < adjusted[prev_rank]:
            adjusted[rank] = round(adjusted[prev_rank] + 0.01, 2)
    return adjusted


# ApproachA: earlier window/cliff interpolation attempt, preserved for comparison.
def ApproachA(board: dict[int, dict]) -> dict[int, float]:
    if not board:
        return {}

    compress_span = 1.0
    raw: dict[int, float] = {}
    for stack_rank in sorted(board):
        lo, hi = _approach_a_window_bounds(board, stack_rank)
        peers = _approach_a_peer_cluster_in_window(board, stack_rank, lo, hi)
        if len(peers) >= 2:
            avgs = [board[rank]["adp_avg"] for rank in peers]
            if max(avgs) - min(avgs) <= compress_span:
                raw[stack_rank] = round(_approach_a_compress_peer_rank(peers, board, stack_rank), 2)
            else:
                raw[stack_rank] = round(_approach_a_cluster_cliff_rank(board, stack_rank, peers, hi), 2)
        else:
            raw[stack_rank] = round(_approach_a_cliff_interpolated_rank(board, stack_rank, lo, hi), 2)
    return enforce_monotonic_eff_ranks(board, raw)


# ApproachB: zero-sum peer exchange with tunable OVR-ADP gap weighting.
def ApproachB(
    board: dict[int, dict],
    config: PeerExchangeConfig = DEFAULT_PEER_EXCHANGE,
) -> dict[int, float]:
    if not board:
        return {}

    ranks = sorted(board)
    eff = {rank: float(rank) for rank in ranks}
    collapse_identical_adp_peer_groups(board, eff)

    for _ in range(PEER_EXCHANGE_MAX_ITERS):
        if not apply_peer_exchange_pass(board, eff, config):
            break

    rounded = {rank: round(eff[rank], 2) for rank in ranks}
    return enforce_monotonic_eff_ranks(board, rounded)


# ApproachH: OVR ADP geometry + positional KTC lookup invert; λ-blend off integer stack rank.
def ApproachH(
    board: dict[int, dict],
    lookup: dict[int, float],
    lambda_: float = OVR_KTC_RANK_LAMBDA,
) -> dict[int, float]:
    if not board:
        return {}
    if not lookup:
        return ApproachC(board)

    eff: dict[int, float] = {}
    for stack_rank in sorted(board):
        r_ovr = ovr_implied_frac_rank(stack_rank, board)
        v_ovr = interpolate_hist(lookup, r_ovr)
        if v_ovr is None:
            eff[stack_rank] = float(stack_rank)
            continue
        s_star = invert_lookup_rank(lookup, v_ovr)
        if s_star is None:
            s_star = r_ovr
        eff[stack_rank] = stack_rank + lambda_ * (s_star - stack_rank)

    rounded = {rank: round(eff[rank], 2) for rank in eff}
    return enforce_monotonic_eff_ranks(board, rounded)


# ApproachC: current placeholder/no-op; adjusted ADP just equals positional stack rank.
def ApproachC(board: dict[int, dict]) -> dict[int, float]:
    if not board:
        return {}
    return {rank: float(rank) for rank in sorted(board)}


def compute_effective_ranks_for_board(
    board: dict[int, dict],
    rank_lookup: dict[int, float] | None = None,
    config: PeerExchangeConfig = DEFAULT_PEER_EXCHANGE,
) -> dict[int, float]:
    """Adjusted positional ADP via ApproachH (OVR ADP + KTC lookup correction)."""
    if rank_lookup is not None:
        return ApproachH(board, rank_lookup)
    return ApproachB(board, config)


def compute_effective_rank(
    board: dict[int, dict],
    stack_rank: int,
    overall_avg: float,
    config: PeerExchangeConfig = DEFAULT_PEER_EXCHANGE,
) -> float:
    if not board or stack_rank not in board:
        return float(stack_rank)

    return compute_effective_ranks_for_board(board, config).get(stack_rank, float(stack_rank))


# ApproachD: overall ADP slot + historical overall rank values (preserved, uncalled).
def ApproachD(
    ktc_value: int,
    ktc_overall_rank: int,
    adp_overall_rank: float,
    hist_overall: dict[int, float],
    premium_retention: float = PREMIUM_RETENTION,
) -> tuple[int | None, float | None]:
    hist_at_ktc = interpolate_hist(hist_overall, float(ktc_overall_rank))
    hist_at_adp = interpolate_hist(hist_overall, adp_overall_rank)
    if hist_at_ktc is None or hist_at_adp is None:
        return None, None

    dynasty_premium = ktc_value - hist_at_ktc
    adjusted = hist_at_adp + premium_retention * dynasty_premium
    adjusted_int = max(0, round(adjusted))
    index = round(adjusted_int / ktc_value, 4) if ktc_value > 0 else None
    return adjusted_int, index


# ApproachE: integer positional ADP; scale dynasty value by historical rank-slot ratio.
def ApproachE(
    ktc_value: int,
    ktc_pos_rank: int,
    adp_pos_rank: int,
    position: str,
    hist: dict[str, dict[int, float]],
) -> tuple[int | None, float | None]:
    """Example: KTC RB3, ADP RB2 → ktc_value × (hist_RB2 / hist_RB3)."""
    hist_at_ktc = hist[position].get(ktc_pos_rank)
    hist_at_adp = hist[position].get(adp_pos_rank)
    if hist_at_ktc is None or hist_at_adp is None or hist_at_ktc <= 0:
        return None, None

    multiplier = hist_at_adp / hist_at_ktc
    adjusted_int = max(0, round(ktc_value * multiplier))
    index = round(multiplier, 4)
    return adjusted_int, index


# ApproachF: assign historical avg KTC at integer Pos ADP rank; index from value change.
def ApproachF(
    ktc_value: int,
    adp_pos_rank: int,
    position: str,
    hist: dict[str, dict[int, float]],
) -> tuple[int | None, float | None]:
    """Adjusted value is hist at redraft rank slot; index = adjusted / dynasty value."""
    hist_at_adp = hist[position].get(adp_pos_rank)
    if hist_at_adp is None or ktc_value <= 0:
        return None, None

    adjusted_int = max(0, round(hist_at_adp))
    index = round(adjusted_int / ktc_value, 4)
    return adjusted_int, index


# ApproachG: ApproachB eff rank + interpolated blended rank-slot lookup (active).
def ApproachG(
    ktc_value: int,
    adp_eff_rank: float,
    position: str,
    rank_lookup: dict[str, dict[int, float]],
) -> tuple[int | None, float | None]:
    """Lookup = 40% year-weighted hist + 60% current KTC at rank; index = adjusted / dynasty."""
    lookup_at_eff = interpolate_hist(rank_lookup[position], adp_eff_rank)
    if lookup_at_eff is None or ktc_value <= 0:
        return None, None

    adjusted_int = max(0, round(lookup_at_eff))
    index = round(adjusted_int / ktc_value, 4)
    return adjusted_int, index


def compute_competitor_adjusted(
    ktc_value: int,
    ktc_pos_rank: int,
    adp_eff_rank: float,
    position: str,
    hist: dict[str, dict[int, float]],
    premium_retention: float = PREMIUM_RETENTION,
) -> tuple[int | None, float | None]:
    hist_at_ktc = interpolate_hist(hist[position], float(ktc_pos_rank))
    hist_at_eff = interpolate_hist(hist[position], adp_eff_rank)
    if hist_at_ktc is None or hist_at_eff is None:
        return None, None

    dynasty_premium = ktc_value - hist_at_ktc
    adjusted = hist_at_eff + premium_retention * dynasty_premium
    adjusted_int = max(0, round(adjusted))
    index = round(adjusted_int / ktc_value, 4) if ktc_value > 0 else None
    return adjusted_int, index


def effective_rebuild_flip_betas(
    beta_up: float = REBUILD_BETA_UP,
    beta_down: float = REBUILD_BETA_DOWN,
    friendliness: float | None = None,
) -> tuple[float, float]:
    """Relax flip penalties when comp exceeds dynasty; strengthen credit when comp lags."""
    if friendliness is None:
        friendliness = REBUILD_FLIP_FRIENDLINESS
    return beta_up * (1.0 + friendliness), beta_down * (1.0 - friendliness)


def calibrate_rebuild_flip_friendliness(
    calibration_rows: list[dict],
    rank_lookup: dict[str, dict[int, float]],
    beta_up: float = REBUILD_BETA_UP,
    beta_down: float = REBUILD_BETA_DOWN,
) -> float:
    """
    Find flip friendliness so ADP-matched rebuild totals anchor the comp/rebuild midpoint
    to dynasty KTC: sum(rebuild) = 2×sum(ktc) − sum(comp).
    """
    if not calibration_rows:
        return 0.0

    ktc_sum = sum(row["ktc_value"] for row in calibration_rows)
    comp_sum = sum(row["adjusted"] for row in calibration_rows)
    target_rebuild = 2 * ktc_sum - comp_sum

    def rebuild_sum(friendliness: float) -> int:
        up_eff, down_eff = effective_rebuild_flip_betas(beta_up, beta_down, friendliness)
        total = 0
        for row in calibration_rows:
            rebuilder, _ = compute_rebuilder_adjusted(
                row["ktc_value"],
                row["ktc_pos_rank"],
                row["adp_eff_rank"],
                row["adjusted"],
                rank_lookup,
                row["position"],
                beta_up=up_eff,
                beta_down=down_eff,
            )
            total += rebuilder or 0
        return total

    base = rebuild_sum(0.0)
    if base >= target_rebuild:
        return 0.0

    lo, hi = 0.0, 1.0
    if rebuild_sum(hi) < target_rebuild:
        return hi

    for _ in range(48):
        mid = (lo + hi) / 2.0
        if rebuild_sum(mid) < target_rebuild:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def rebuilder_gamma(rank_gap: float, gap_scale: float = REBUILD_GAP_SCALE) -> float:
    """Discount dynasty premium when ADP rank is worse than KTC rank (gap > 0)."""
    gap = max(0.0, rank_gap)
    return 1.0 / (1.0 + (gap / gap_scale) ** 2)


def rebuilder_depth_beta_up_boost(
    rank_gap: float,
    ktc_pos_rank: int,
    redraft_value_index: float | None,
    gap_min: float = REBUILD_DEPTH_GAP_MIN,
    gap_scale: float = REBUILD_DEPTH_GAP_SCALE,
    depth_rank_min: int = REBUILD_DEPTH_KTC_RANK_MIN,
    max_boost: float = REBUILD_BETA_UP_DEPTH_BOOST,
    sev_rvi_floor: float = REBUILD_SEV_RVI_FLOOR,
    sev_rvi_scale: float = REBUILD_SEV_RVI_SCALE,
) -> float:
    """Extra flip credit on deep dynasty-tax players with severe redraft downgrades."""
    if ktc_pos_rank <= depth_rank_min or redraft_value_index is None:
        return 0.0
    gap_frac = min(1.0, max(0.0, rank_gap - gap_min) / gap_scale)
    sev_frac = min(1.0, max(0.0, sev_rvi_floor - redraft_value_index) / sev_rvi_scale)
    return max_boost * gap_frac * sev_frac


def rebuilder_flip_beta(
    redraft_delta: float,
    rank_gap: float,
    ktc_pos_rank: int | None = None,
    redraft_value_index: float | None = None,
    beta_up: float = REBUILD_BETA_UP,
    beta_down: float = REBUILD_BETA_DOWN,
    gap_scale: float = REBUILD_GAP_SCALE,
    reduce_rank_boost: float = REBUILD_REDUCE_RANK_BOOST,
) -> float:
    """Stronger flip when redraft value exceeds dynasty; extra skew if ADP rank beats KTC rank."""
    if redraft_delta <= 0:
        beta = beta_up
        if ktc_pos_rank is not None:
            beta += rebuilder_depth_beta_up_boost(
                rank_gap,
                ktc_pos_rank,
                redraft_value_index,
            )
        return beta
    beta = beta_down
    adp_better_gap = max(0.0, -rank_gap)
    if adp_better_gap > 0:
        beta *= 1.0 + reduce_rank_boost * (adp_better_gap / gap_scale) ** 2
    return beta


def compute_rebuilder_adjusted(
    ktc_value: int,
    ktc_pos_rank: int,
    adp_eff_rank: float,
    adjusted: int,
    rank_lookup: dict[str, dict[int, float]],
    position: str,
    beta_up: float | None = None,
    beta_down: float | None = None,
    gap_scale: float = REBUILD_GAP_SCALE,
    reduce_rank_boost: float = REBUILD_REDUCE_RANK_BOOST,
    flip_friendliness: float | None = None,
) -> tuple[int | None, float | None]:
    """
    rebuild_core = hist@KTC rank + γ × (dynasty − hist@KTC)
    rebuilder = rebuild_core − β_eff × (adjusted − dynasty)
    β_eff is asymmetric: higher when redraft delta > 0, boosted if ADP rank < KTC rank.
    flip_friendliness relaxes β down / strengthens β up for midpoint anchoring.
    """
    if beta_up is None or beta_down is None:
        friendliness = REBUILD_FLIP_FRIENDLINESS if flip_friendliness is None else flip_friendliness
        beta_up, beta_down = effective_rebuild_flip_betas(
            REBUILD_BETA_UP,
            REBUILD_BETA_DOWN,
            friendliness,
        )
    hist_at_ktc = interpolate_hist(rank_lookup[position], float(ktc_pos_rank))
    if hist_at_ktc is None or ktc_value <= 0:
        return None, None

    rank_gap = adp_eff_rank - ktc_pos_rank
    gamma = rebuilder_gamma(rank_gap, gap_scale)
    dynasty_premium = ktc_value - hist_at_ktc
    rebuild_core = hist_at_ktc + gamma * dynasty_premium
    redraft_delta = adjusted - ktc_value
    redraft_index = round(adjusted / ktc_value, 4) if ktc_value > 0 else None
    flip_beta = rebuilder_flip_beta(
        redraft_delta,
        rank_gap,
        ktc_pos_rank,
        redraft_index,
        beta_up,
        beta_down,
        gap_scale,
        reduce_rank_boost,
    )
    rebuilder_int = max(0, round(rebuild_core - flip_beta * redraft_delta))
    rebuild_index = round(rebuilder_int / ktc_value, 4)
    return rebuilder_int, rebuild_index


def compute_rebuilder_at_zero_redraft(
    ktc_value: int,
    ktc_pos_rank: int,
    adp_eff_rank: float | None,
    rank_lookup: dict[str, dict[int, float]],
    position: str,
) -> tuple[int | None, float | None]:
    """Legacy max rebuild credit: run rebuilder formula as if competitor adjusted were 0."""
    eff = adp_eff_rank if adp_eff_rank is not None else float(ktc_pos_rank)
    return compute_rebuilder_adjusted(
        ktc_value,
        ktc_pos_rank,
        eff,
        0,
        rank_lookup,
        position,
    )


def adp_board_ceiling_stack(
    adp_boards: dict[str, dict[int, dict]],
    position: str,
) -> int | None:
    board = adp_boards.get(position) or {}
    return max(board) if board else None


def clip_eff_rank_to_lookup(
    eff_rank: float,
    rank_lookup: dict[str, dict[int, float]],
    position: str,
) -> float:
    lookup = rank_lookup.get(position) or {}
    if not lookup:
        return eff_rank
    return max(1.0, min(float(eff_rank), max(lookup)))


def resolve_unranked_synthetic_ranks(
    ktc_pos_rank: int,
    position: str,
    adp_boards: dict[str, dict[int, dict]],
    eff_ranks_by_pos: dict[str, dict[int, float]],
    rank_lookup: dict[str, dict[int, float]],
    config: UnrankedAdpConfig = DEFAULT_UNRANKED_ADP,
) -> tuple[float | None, int | None]:
    """
    Synthetic ADP slot for KTC players missing from FantasyPros ADP.
    Returns (eff_rank, ceiling_stack_rank) or (None, None) if no ADP board.
    """
    if config.mode != "ceiling":
        return None, None

    ceiling_stack = adp_board_ceiling_stack(adp_boards, position)
    if ceiling_stack is None:
        return None, None

    eff = eff_ranks_by_pos.get(position, {}).get(ceiling_stack, float(ceiling_stack))
    if config.use_ktc_pos_rank_floor:
        eff = max(eff, float(ktc_pos_rank))
    if config.eff_rank_offset:
        eff += config.eff_rank_offset
    if config.eff_rank_scale != 1.0:
        eff *= config.eff_rank_scale
    eff = clip_eff_rank_to_lookup(eff, rank_lookup, position)
    return eff, ceiling_stack


def apply_unranked_redraft_adjustments(
    player: dict,
    adp_boards: dict[str, dict[int, dict]],
    eff_ranks_by_pos: dict[str, dict[int, float]],
    rank_lookup: dict[str, dict[int, float]],
    config: UnrankedAdpConfig = DEFAULT_UNRANKED_ADP,
) -> dict:
    """
    Competitor + rebuild for off-ADP players.
    ceiling mode: normal ApproachG + rebuild at synthetic rank.
    zero_redraft mode: legacy max rebuild, no competitor value.
    """
    if config.mode == "zero_redraft":
        rebuilder, rebuild_index = compute_rebuilder_at_zero_redraft(
            player["ktc_value"],
            player["ktc_pos_rank"],
            None,
            rank_lookup,
            player["position"],
        )
        return {
            "stack_rank": None,
            "adp_eff_rank": None,
            "adjusted": None,
            "index": None,
            "rebuilder": rebuilder,
            "rebuild_index": rebuild_index,
            "adp_synthetic": False,
        }

    adp_eff_rank, ceiling_stack = resolve_unranked_synthetic_ranks(
        player["ktc_pos_rank"],
        player["position"],
        adp_boards,
        eff_ranks_by_pos,
        rank_lookup,
        config,
    )
    if adp_eff_rank is None:
        return {
            "stack_rank": None,
            "adp_eff_rank": None,
            "adjusted": None,
            "index": None,
            "rebuilder": None,
            "rebuild_index": None,
            "adp_synthetic": False,
        }

    adjusted, index = ApproachG(
        player["ktc_value"],
        adp_eff_rank,
        player["position"],
        rank_lookup,
    )
    rebuilder = None
    rebuild_index = None
    if adjusted is not None and adjusted > 0:
        rebuilder, rebuild_index = compute_rebuilder_adjusted(
            player["ktc_value"],
            player["ktc_pos_rank"],
            adp_eff_rank,
            adjusted,
            rank_lookup,
            player["position"],
        )
    return {
        "stack_rank": ceiling_stack,
        "adp_eff_rank": adp_eff_rank,
        "adjusted": adjusted,
        "index": index,
        "rebuilder": rebuilder,
        "rebuild_index": rebuild_index,
        "adp_synthetic": True,
    }


def write_output(rows: list[dict], as_of: str | None, adp_year: int, adp_source: str) -> None:
    fieldnames = [
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
        "as_of",
        "adp_source",
    ]

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({
                **row,
                "as_of": as_of or "",
                "adp_source": adp_source,
            })


def main() -> None:
    adp_year = DEFAULT_ADP_YEAR
    if len(sys.argv) > 1:
        try:
            adp_year = int(sys.argv[1])
        except ValueError:
            sys.exit(f"Invalid year: {sys.argv[1]}")

    ktc_players, as_of = load_ktc_players()
    weighted_hist, current_by_rank, rank_lookup, inflation, inflation_target = (
        build_redraft_rank_lookup(ktc_players)
    )
    lookup_rows = write_redraft_rank_lookup_csv(weighted_hist, current_by_rank, rank_lookup)

    if USE_HWANG_ADJUSTED_ADP:
        hwang_script = PROJECT_ROOT / "scripts/compute_hwang_scoring_adp.py"
        print(f"Regenerating Hwang adjusted ADP for {adp_year}…")
        subprocess.run([sys.executable, str(hwang_script), str(adp_year)], check=True)

    adp_source = adp_source_label(adp_year)
    adp_by_name, adp_by_sleeper, adp_boards, ranked_adp_rows = load_adp(adp_year)
    sleeper_by_name, sleeper_by_last = load_sleeper_ids_by_player()

    report_fp_vs_stack_discrepancies(ranked_adp_rows, adp_year)

    eff_ranks_by_pos = {
        pos: compute_effective_ranks_for_board(board, rank_lookup.get(pos))
        for pos, board in adp_boards.items()
    }

    calibration_rows: list[dict] = []
    for player in ktc_players:
        adp = find_adp_row(player, adp_by_name, adp_by_sleeper, sleeper_by_name, sleeper_by_last)
        if not adp or adp.get("adp_stack_rank") is None:
            continue
        adp_eff_rank = eff_ranks_by_pos[player["position"]].get(adp["adp_stack_rank"])
        if adp_eff_rank is None:
            continue
        adjusted, _ = ApproachG(
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

    global REBUILD_FLIP_FRIENDLINESS
    if REBUILD_AUTO_MIDPOINT_ANCHOR and calibration_rows:
        REBUILD_FLIP_FRIENDLINESS = calibrate_rebuild_flip_friendliness(
            calibration_rows,
            rank_lookup,
        )
        up_eff, down_eff = effective_rebuild_flip_betas()
        print(
            "Rebuild midpoint anchor: "
            f"flip friendliness={REBUILD_FLIP_FRIENDLINESS:.4f} "
            f"(β_up {REBUILD_BETA_UP:.2f}→{up_eff:.3f}, "
            f"β_down {REBUILD_BETA_DOWN:.2f}→{down_eff:.3f} on ADP pool)"
        )
    else:
        REBUILD_FLIP_FRIENDLINESS = 0.0

    unranked_config = DEFAULT_UNRANKED_ADP
    output_rows: list[dict] = []
    matched = 0
    synthetic = 0

    for player in sorted(ktc_players, key=lambda r: (-r["ktc_value"], r["name"])):
        adp = find_adp_row(player, adp_by_name, adp_by_sleeper, sleeper_by_name, sleeper_by_last)

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
                adjusted, index = ApproachG(
                    player["ktc_value"],
                    adp_eff_rank,
                    player["position"],
                    rank_lookup,
                )
                if adjusted is not None:
                    matched += 1

            if adjusted is not None and adjusted > 0:
                rebuilder, rebuild_index = compute_rebuilder_adjusted(
                    player["ktc_value"],
                    player["ktc_pos_rank"],
                    adp_eff_rank,
                    adjusted,
                    rank_lookup,
                    player["position"],
                )
            elif adjusted is None or adjusted == 0:
                rebuilder, rebuild_index = compute_rebuilder_at_zero_redraft(
                    player["ktc_value"],
                    player["ktc_pos_rank"],
                    adp_eff_rank,
                    rank_lookup,
                    player["position"],
                )
        else:
            unranked = apply_unranked_redraft_adjustments(
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
                else ""
            ),
            "adp_avg": round(adp["adp_avg"], 1) if adp and adp.get("adp_avg") is not None else "",
            "competitor_adjusted_value": adjusted if adjusted is not None else "",
            "redraft_value_index": index if index is not None else "",
            "rebuilder_adjusted_value": rebuilder if rebuilder is not None else "",
            "rebuild_value_index": rebuild_index if rebuild_index is not None else "",
            "adp_synthetic": 1 if adp_synthetic else "",
        })

    write_output(output_rows, as_of, adp_year, adp_source)

    print(f"\nWrote {len(output_rows):,} players → {OUTPUT_CSV}")
    print(f"Wrote {lookup_rows:,} rank-slot lookups → {LOOKUP_CSV}")
    print(f"Matched {matched:,} / {len(output_rows):,} KTC players to {adp_source}")
    print(f"Unranked ADP: {unranked_config.describe()} ({synthetic:,} synthetic ceiling rows)")
    for pos in POSITIONS:
        ceiling = adp_board_ceiling_stack(adp_boards, pos)
        if ceiling is not None:
            print(f"  {pos} ADP ceiling stack rank: {ceiling}")
    print(
        f"Redraft ADP input: {'Hwang Adjusted Positional ADP' if USE_HWANG_ADJUSTED_ADP else f'FantasyPros {ADP_TYPE}'} "
        f"({adp_source})"
    )
    print(
        "Adjusted ADP approach: ApproachH "
        f"(λ={OVR_KTC_RANK_LAMBDA:g} OVR ADP + KTC lookup correction on stack rank)"
    )
    print(
        "Competitor value: ApproachG "
        f"(40% year-weighted hist + 60% current KTC @ rank, at Adjusted ADP)"
    )
    print(
        f"Historical inflation target: top-{TOP300_INFLATION_TARGET_COUNT} sum "
        f"{inflation_target:,} (current live SF TE+)"
    )
    for year in sorted(inflation):
        print(f"  {year} multiplier: {inflation[year]:.6f}")
    print("  2021: unscaled (multiplier 1.0)")
    if as_of:
        print(f"KTC as_of: {as_of}")


if __name__ == "__main__":
    main()
