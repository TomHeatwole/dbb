#!/usr/bin/env python3
"""
build_sf_ktc_values_historical_filled.py

Fill missing historical KTC positional slots at scheduled snapshots (2021+).

Snapshots:
  - 10th of each month (resolve forward within month to first date with rank data)
  - Final KTC preseason date per year (from final_ktc_values.csv)
  - Rookie Draft KTC (May 20 per draft class)

Fill tiers:
  1. historical — rank scrape occupant with community-sheet value
  2. adp — greedy startup ADP assignment + ADP-anchored interpolation vs known neighbors
  3. unknown — 2026 slot baseline with monotone clamp vs known neighbors

Writes:
  site/public/data/sf_ktc_values_historical_filled.csv
  site/public/data/sf_ktc_values_historical_filled_metadata.csv

Usage (from project root):
  python3 scripts/build_sf_ktc_values_historical_filled.py
"""

from __future__ import annotations

import calendar
import csv
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "site/public/data"

RANKS_CSV = DATA_DIR / "sf_ktc_pos_ranks_historical.csv"
VALUES_CSV = DATA_DIR / "sf_ktc_values_historical.csv"
FINAL_KTC_CSV = DATA_DIR / "final_ktc_values.csv"
STARTUP_ADP_CSV = DATA_DIR / "ddl_startup_adp_historical.csv"
CURRENT_KTC_CSV = DATA_DIR / "ktc_values.csv"
FILLED_CSV = DATA_DIR / "sf_ktc_values_historical_filled.csv"
METADATA_CSV = DATA_DIR / "sf_ktc_values_historical_filled_metadata.csv"

POSITIONS = ("QB", "RB", "WR", "TE")
SKILL_POSITIONS = set(POSITIONS)
FIRST_YEAR = 2021
LAST_YEAR = 2025
KTC_VALUE_COL = "ktc_value_tep_2qb"
PICK_PREFIXES = ("Early", "Mid", "Late")

FILLED_FIELDS = (
    "snapshot_target",
    "snapshot_kind",
    "snapshot_label",
    "resolved_date",
    "year",
    "name",
    "position",
    "positional_rank",
    "overall_rank",
    "ktc_value",
    "ktc_player_id",
    "sleeper_id",
)

METADATA_FIELDS = (
    "snapshot_target",
    "snapshot_kind",
    "resolved_date",
    "position",
    "positional_rank",
    "fill_source",
    "assigned_name",
    "adp_overall",
    "adp_pos_rank",
    "anchor_upper_slot",
    "anchor_upper_name",
    "anchor_upper_value",
    "anchor_upper_adp",
    "anchor_lower_slot",
    "anchor_lower_name",
    "anchor_lower_value",
    "anchor_lower_adp",
    "interpolate_fraction",
    "baseline_value",
    "raw_computed_value",
    "clamped",
    "clamp_reason",
    "value_resolved_date",
    "rank_resolved_date",
)


@dataclass
class SnapshotTarget:
    target: str
    kind: str
    label: str
    year: int


@dataclass
class SlotMeta:
    fill_source: str
    assigned_name: str = ""
    adp_overall: str = ""
    adp_pos_rank: str = ""
    anchor_upper_slot: str = ""
    anchor_upper_name: str = ""
    anchor_upper_value: str = ""
    anchor_upper_adp: str = ""
    anchor_lower_slot: str = ""
    anchor_lower_name: str = ""
    anchor_lower_value: str = ""
    anchor_lower_adp: str = ""
    interpolate_fraction: str = ""
    baseline_value: str = ""
    raw_computed_value: str = ""
    clamped: str = "0"
    clamp_reason: str = ""
    value_resolved_date: str = ""
    rank_resolved_date: str = ""


@dataclass
class SlotRow:
    name: str
    position: str
    positional_rank: int
    overall_rank: int | None
    ktc_value: int
    ktc_player_id: str = ""
    sleeper_id: str = ""
    meta: SlotMeta = field(default_factory=lambda: SlotMeta(fill_source="historical"))


def parse_int(raw: str | None) -> int | None:
    if raw is None:
        return None
    raw = str(raw).strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def parse_float(raw: str | None) -> float | None:
    if raw is None:
        return None
    raw = str(raw).strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def is_pick_name(name: str) -> bool:
    name = (name or "").strip()
    if not name:
        return True
    if name[:4].isdigit() and len(name) > 5 and name[5:10] in PICK_PREFIXES:
        return True
    return False


def player_key(name: str, position: str, sleeper_id: str = "") -> str:
    sid = (sleeper_id or "").strip()
    if sid:
        return f"sid:{sid}"
    return f"{name.strip().lower()}|{position.upper()}"


def resolve_date_forward_in_month(target: str, available: set[str]) -> tuple[str | None, int]:
    start = date.fromisoformat(target)
    month = start.month
    year = start.year
    d = start
    while d.month == month and d.year == year:
        ds = d.isoformat()
        if ds in available:
            return ds, (d - start).days
        d += timedelta(days=1)
    return None, 0


def load_rank_dates() -> tuple[dict[str, list[dict]], set[str]]:
    by_date: dict[str, list[dict]] = defaultdict(list)
    dates: set[str] = set()
    with RANKS_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            ds = (row.get("date") or "").strip()
            name = (row.get("name") or "").strip()
            position = (row.get("position") or "").strip().upper()
            pos_rank = parse_int(row.get("positional_rank"))
            if not ds or not name or position not in SKILL_POSITIONS or pos_rank is None:
                continue
            if ds[:4].isdigit() and int(ds[:4]) < FIRST_YEAR:
                continue
            entry = {
                "date": ds,
                "name": name,
                "position": position,
                "positional_rank": pos_rank,
                "overall_rank": parse_int(row.get("overall_rank")),
                "ktc_player_id": (row.get("ktc_player_id") or "").strip(),
                "ktc_slug": (row.get("ktc_slug") or "").strip(),
                "sleeper_id": (row.get("sleeper_id") or "").strip(),
            }
            by_date[ds].append(entry)
            dates.add(ds)
    return by_date, dates


def load_values_by_date() -> tuple[dict[str, dict[str, int]], set[str]]:
    by_date: dict[str, dict[str, int]] = defaultdict(dict)
    dates: set[str] = set()
    with VALUES_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            ds = (row.get("date") or "").strip()
            name = (row.get("name") or "").strip()
            value = parse_int(row.get("ktc_value"))
            if not ds or not name or value is None:
                continue
            if ds[:4].isdigit() and int(ds[:4]) < FIRST_YEAR:
                continue
            by_date[ds][name] = value
            dates.add(ds)
    return by_date, dates


def lookup_value_forward_in_month(
    values_by_date: dict[str, dict[str, int]],
    value_dates: set[str],
    name: str,
    target: str,
) -> tuple[int | None, str | None]:
    resolved, _ = resolve_date_forward_in_month(target, value_dates)
    if resolved is None:
        return None, None
    month_start = date.fromisoformat(target)
    month = month_start.month
    year = month_start.year
    d = date.fromisoformat(resolved)
    while d.month == month and d.year == year:
        ds = d.isoformat()
        val = values_by_date.get(ds, {}).get(name)
        if val is not None:
            return val, ds
        d += timedelta(days=1)
    return None, None


def load_final_ktc_dates() -> dict[int, str]:
    by_year: dict[int, str] = {}
    with FINAL_KTC_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            year = parse_int(row.get("year"))
            ds = (row.get("date") or "").strip()
            if year is None or not ds or year in by_year:
                continue
            by_year[year] = ds
    return by_year


def load_startup_adp() -> dict[int, list[dict]]:
    by_season: dict[int, list[dict]] = defaultdict(list)
    with STARTUP_ADP_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            season = parse_int(row.get("season"))
            name = (row.get("name") or "").strip()
            position = (row.get("position") or "").strip().upper()
            adp = parse_float(row.get("adp"))
            pos_rank = parse_int(row.get("pos_rank"))
            if season is None or not name or position not in SKILL_POSITIONS:
                continue
            if adp is None or pos_rank is None:
                continue
            by_season[season].append(
                {
                    "name": name,
                    "position": position,
                    "adp": adp,
                    "overall_rank": parse_int(row.get("overall_rank")),
                    "pos_rank": pos_rank,
                    "sleeper_id": (row.get("sleeper_id") or "").strip(),
                }
            )
    for season in by_season:
        by_season[season].sort(key=lambda r: (r["adp"], r["pos_rank"]))
    return by_season


def load_current_slot_values() -> dict[str, dict[int, int]]:
    """Positional rank slot -> current KTC TE+ SF value."""
    by_pos: dict[str, list[tuple[str, int]]] = {p: [] for p in POSITIONS}
    with CURRENT_KTC_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = (row.get("name") or "").strip()
            position = (row.get("position") or "").strip().upper()
            value = parse_int(row.get(KTC_VALUE_COL))
            if not name or position not in SKILL_POSITIONS or value is None:
                continue
            if is_pick_name(name):
                continue
            by_pos[position].append((name, value))

    slot_values: dict[str, dict[int, int]] = {p: {} for p in POSITIONS}
    for pos in POSITIONS:
        ranked = sorted(by_pos[pos], key=lambda item: item[1], reverse=True)
        for idx, (_name, val) in enumerate(ranked, start=1):
            slot_values[pos][idx] = val
    return slot_values


def build_snapshot_targets(final_ktc_dates: dict[int, str]) -> list[SnapshotTarget]:
    targets: list[SnapshotTarget] = []
    seen: set[tuple[str, str]] = set()

    def add(target: str, kind: str, label: str) -> None:
        key = (target, kind)
        if key in seen:
            return
        seen.add(key)
        targets.append(
            SnapshotTarget(
                target=target,
                kind=kind,
                label=label,
                year=int(target[:4]),
            )
        )

    for year in range(FIRST_YEAR, LAST_YEAR + 1):
        for month in range(1, 13):
            day = 10
            last_day = calendar.monthrange(year, month)[1]
            if day > last_day:
                day = last_day
            ds = f"{year}-{month:02d}-{day:02d}"
            add(ds, "monthly", f"Monthly ({ds})")

        if year in final_ktc_dates:
            fk = final_ktc_dates[year]
            add(fk, "final_ktc", f"Final KTC ({fk})")

        add(f"{year}-05-20", "rookie_draft", f"Rookie Draft ({year}-05-20)")

    targets.sort(key=lambda s: (s.target, s.kind))
    return targets


def build_adp_index(adp_rows: list[dict]) -> dict[str, dict]:
    index: dict[str, dict] = {}
    for row in adp_rows:
        index[player_key(row["name"], row["position"], row["sleeper_id"])] = row
        name_key = player_key(row["name"], row["position"])
        if name_key not in index:
            index[name_key] = row
    return index


def lookup_adp(adp_index: dict[str, dict], name: str, position: str, sleeper_id: str = "") -> dict | None:
    sid = (sleeper_id or "").strip()
    if sid:
        hit = adp_index.get(f"sid:{sid}")
        if hit:
            return hit
    return adp_index.get(player_key(name, position))


def interpolate_adp_value(
    slot: int,
    adp_player: dict,
    known_values: dict[int, int],
    known_names: dict[int, str],
    adp_index: dict[str, dict],
) -> tuple[int, SlotMeta]:
    adp_ovr = adp_player["adp"]
    upper_slot = max((s for s in known_values if s < slot), default=None)
    lower_slot = min((s for s in known_values if s > slot), default=None)

    meta = SlotMeta(
        fill_source="adp",
        assigned_name=adp_player["name"],
        adp_overall=f"{adp_ovr:.2f}",
        adp_pos_rank=str(adp_player["pos_rank"]),
    )

    if upper_slot is None and lower_slot is None:
        baseline = adp_player.get("_fallback_value")
        val = baseline if baseline is not None else 0
        meta.baseline_value = str(val)
        meta.raw_computed_value = str(val)
        meta.clamp_reason = "no_anchors"
        return val, meta

    if upper_slot is None:
        val = known_values[lower_slot]
        meta.anchor_lower_slot = str(lower_slot)
        meta.anchor_lower_name = known_names.get(lower_slot, "")
        meta.anchor_lower_value = str(val)
        lower_adp = lookup_adp(adp_index, known_names[lower_slot], adp_player["position"])
        if lower_adp:
            meta.anchor_lower_adp = f"{lower_adp['adp']:.2f}"
        meta.clamp_reason = "floor_lower_anchor_only"
        meta.raw_computed_value = str(val)
        return val, meta

    if lower_slot is None:
        val = known_values[upper_slot]
        meta.anchor_upper_slot = str(upper_slot)
        meta.anchor_upper_name = known_names.get(upper_slot, "")
        meta.anchor_upper_value = str(val)
        upper_adp = lookup_adp(adp_index, known_names[upper_slot], adp_player["position"])
        if upper_adp:
            meta.anchor_upper_adp = f"{upper_adp['adp']:.2f}"
        meta.clamp_reason = "cap_upper_anchor_only"
        meta.raw_computed_value = str(val)
        return val, meta

    upper_val = known_values[upper_slot]
    lower_val = known_values[lower_slot]
    upper_name = known_names[upper_slot]
    lower_name = known_names[lower_slot]
    upper_adp_row = lookup_adp(adp_index, upper_name, adp_player["position"])
    lower_adp_row = lookup_adp(adp_index, lower_name, adp_player["position"])

    meta.anchor_upper_slot = str(upper_slot)
    meta.anchor_upper_name = upper_name
    meta.anchor_upper_value = str(upper_val)
    meta.anchor_lower_slot = str(lower_slot)
    meta.anchor_lower_name = lower_name
    meta.anchor_lower_value = str(lower_val)
    if upper_adp_row:
        meta.anchor_upper_adp = f"{upper_adp_row['adp']:.2f}"
    if lower_adp_row:
        meta.anchor_lower_adp = f"{lower_adp_row['adp']:.2f}"

    if upper_adp_row and lower_adp_row:
        upper_adp = upper_adp_row["adp"]
        lower_adp = lower_adp_row["adp"]
        if adp_ovr <= upper_adp:
            meta.clamp_reason = "cap_above_upper_adp"
            meta.raw_computed_value = str(upper_val)
            return upper_val, meta
        if adp_ovr >= lower_adp:
            meta.clamp_reason = "floor_below_lower_adp"
            meta.raw_computed_value = str(lower_val)
            return lower_val, meta
        span = upper_adp - lower_adp
        if span != 0:
            frac = (adp_ovr - lower_adp) / span
        else:
            frac = 0.5
        meta.interpolate_fraction = f"{frac:.4f}"
        val = int(round(lower_val + frac * (upper_val - lower_val)))
        meta.raw_computed_value = str(val)
        meta.clamp_reason = "interpolated"
        return val, meta

    # Missing ADP on anchors — fall back to upper cap / lower floor by slot proximity
    meta.clamp_reason = "anchor_adp_missing_used_upper"
    meta.raw_computed_value = str(upper_val)
    return upper_val, meta


def clamp_monotone(
    slot: int,
    raw_value: int,
    known_values: dict[int, int],
) -> tuple[int, bool, str]:
    reasons: list[str] = []
    value = raw_value
    clamped = False

    upper_caps = [known_values[s] for s in known_values if s < slot]
    if upper_caps:
        cap = min(upper_caps)
        if value > cap:
            value = cap
            clamped = True
            reasons.append(f"cap_vs_better_slots<={cap}")

    lower_floors = [known_values[s] for s in known_values if s > slot]
    if lower_floors:
        floor = max(lower_floors)
        if value < floor:
            value = floor
            clamped = True
            reasons.append(f"floor_vs_worse_slots>={floor}")

    return value, clamped, "; ".join(reasons)


def fill_position_board(
    position: str,
    rank_rows: list[dict],
    values_by_date: dict[str, dict[str, int]],
    value_dates: set[str],
    snapshot_target: str,
    rank_resolved: str,
    adp_rows: list[dict],
    current_slot_values: dict[str, dict[int, int]],
) -> tuple[list[SlotRow], list[dict]]:
    pos_rows = [r for r in rank_rows if r["position"] == position]
    by_slot: dict[int, dict] = {}
    for row in pos_rows:
        slot = row["positional_rank"]
        if slot not in by_slot:
            by_slot[slot] = row

    max_rank = max(by_slot) if by_slot else 0
    if max_rank == 0:
        return [], []

    adp_index = build_adp_index(adp_rows)
    assigned_keys: set[str] = set()
    for row in by_slot.values():
        assigned_keys.add(player_key(row["name"], position, row.get("sleeper_id", "")))

    slots: dict[int, SlotRow] = {}
    metadata_rows: list[dict] = []

    # Tier 1 — historical occupants with values
    for slot in range(1, max_rank + 1):
        occupant = by_slot.get(slot)
        if not occupant:
            continue
        val, val_date = lookup_value_forward_in_month(
            values_by_date, value_dates, occupant["name"], snapshot_target
        )
        if val is None:
            continue
        meta = SlotMeta(
            fill_source="historical",
            assigned_name=occupant["name"],
            value_resolved_date=val_date or "",
            rank_resolved_date=rank_resolved,
        )
        slots[slot] = SlotRow(
            name=occupant["name"],
            position=position,
            positional_rank=slot,
            overall_rank=occupant.get("overall_rank"),
            ktc_value=val,
            ktc_player_id=occupant.get("ktc_player_id", ""),
            sleeper_id=occupant.get("sleeper_id", ""),
            meta=meta,
        )

    known_values = {s: slots[s].ktc_value for s in slots}
    known_names = {s: slots[s].name for s in slots}

    # Tier 1b — rank occupant without value: keep name, impute like ADP if in ADP else unknown
    for slot in range(1, max_rank + 1):
        if slot in slots:
            continue
        occupant = by_slot.get(slot)
        if not occupant:
            continue
        adp_player = lookup_adp(adp_index, occupant["name"], position, occupant.get("sleeper_id", ""))
        if adp_player:
            val, meta = interpolate_adp_value(slot, adp_player, known_values, known_names, adp_index)
            meta.assigned_name = occupant["name"]
            meta.rank_resolved_date = rank_resolved
            val, clamped, clamp_reason = clamp_monotone(slot, val, known_values)
            if clamped:
                meta.clamped = "1"
                meta.clamp_reason = (meta.clamp_reason + "; " + clamp_reason).strip("; ")
            slots[slot] = SlotRow(
                name=occupant["name"],
                position=position,
                positional_rank=slot,
                overall_rank=occupant.get("overall_rank"),
                ktc_value=val,
                ktc_player_id=occupant.get("ktc_player_id", ""),
                sleeper_id=occupant.get("sleeper_id", ""),
                meta=meta,
            )
            known_values[slot] = val
            known_names[slot] = occupant["name"]
            assigned_keys.add(player_key(occupant["name"], position, occupant.get("sleeper_id", "")))

    # Tier 2 — greedy ADP for empty slots
    missing_slots = [s for s in range(1, max_rank + 1) if s not in slots]
    available_adp = [
        r for r in adp_rows
        if r["position"] == position
        and player_key(r["name"], position, r.get("sleeper_id", "")) not in assigned_keys
    ]
    available_adp.sort(key=lambda r: (r["adp"], r["pos_rank"]))

    for slot in missing_slots:
        if not available_adp:
            break
        adp_player = available_adp.pop(0)
        adp_player = dict(adp_player)
        adp_player["_fallback_value"] = current_slot_values.get(position, {}).get(slot, 0)
        val, meta = interpolate_adp_value(slot, adp_player, known_values, known_names, adp_index)
        meta.rank_resolved_date = rank_resolved
        val, clamped, clamp_reason = clamp_monotone(slot, val, known_values)
        if clamped:
            meta.clamped = "1"
            extra = clamp_reason
            meta.clamp_reason = (meta.clamp_reason + "; " + extra).strip("; ") if meta.clamp_reason else extra

        adp_match = lookup_adp(adp_index, adp_player["name"], position, adp_player.get("sleeper_id", ""))
        overall = adp_match["overall_rank"] if adp_match else None

        slots[slot] = SlotRow(
            name=adp_player["name"],
            position=position,
            positional_rank=slot,
            overall_rank=overall,
            ktc_value=val,
            sleeper_id=adp_player.get("sleeper_id", ""),
            meta=meta,
        )
        known_values[slot] = val
        known_names[slot] = adp_player["name"]
        assigned_keys.add(player_key(adp_player["name"], position, adp_player.get("sleeper_id", "")))

    # Tier 3 — Unknown remainder
    for slot in range(1, max_rank + 1):
        if slot in slots:
            continue
        baseline = current_slot_values.get(position, {}).get(slot, 0)
        raw_value = baseline
        val, clamped, clamp_reason = clamp_monotone(slot, raw_value, known_values)
        meta = SlotMeta(
            fill_source="unknown",
            assigned_name="Unknown",
            baseline_value=str(baseline),
            raw_computed_value=str(raw_value),
            rank_resolved_date=rank_resolved,
            clamped="1" if clamped else "0",
            clamp_reason=clamp_reason or "baseline_current_slot",
        )
        slots[slot] = SlotRow(
            name="Unknown",
            position=position,
            positional_rank=slot,
            overall_rank=None,
            ktc_value=val,
            meta=meta,
        )
        known_values[slot] = val
        known_names[slot] = "Unknown"

    ordered = [slots[s] for s in sorted(slots)]
    return ordered, metadata_rows


def fill_snapshot(
    snapshot: SnapshotTarget,
    ranks_by_date: dict[str, list[dict]],
    rank_dates: set[str],
    values_by_date: dict[str, dict[str, int]],
    value_dates: set[str],
    adp_by_season: dict[int, list[dict]],
    current_slot_values: dict[str, dict[int, int]],
) -> tuple[list[dict], list[dict]] | None:
    rank_resolved, rank_offset = resolve_date_forward_in_month(snapshot.target, rank_dates)
    if rank_resolved is None:
        return None

    rank_rows = ranks_by_date[rank_resolved]
    adp_season = snapshot.year if snapshot.year in adp_by_season else None
    adp_rows = adp_by_season.get(adp_season, []) if adp_season else []

    filled_rows: list[dict] = []
    meta_rows: list[dict] = []

    for position in POSITIONS:
        slot_rows, _ = fill_position_board(
            position,
            rank_rows,
            values_by_date,
            value_dates,
            snapshot.target,
            rank_resolved,
            adp_rows,
            current_slot_values,
        )
        for slot_row in slot_rows:
            filled_rows.append(
                {
                    "snapshot_target": snapshot.target,
                    "snapshot_kind": snapshot.kind,
                    "snapshot_label": snapshot.label,
                    "resolved_date": rank_resolved,
                    "year": snapshot.year,
                    "name": slot_row.name,
                    "position": slot_row.position,
                    "positional_rank": slot_row.positional_rank,
                    "overall_rank": slot_row.overall_rank if slot_row.overall_rank is not None else "",
                    "ktc_value": slot_row.ktc_value,
                    "ktc_player_id": slot_row.ktc_player_id,
                    "sleeper_id": slot_row.sleeper_id,
                }
            )
            m = slot_row.meta
            meta_rows.append(
                {
                    "snapshot_target": snapshot.target,
                    "snapshot_kind": snapshot.kind,
                    "resolved_date": rank_resolved,
                    "position": slot_row.position,
                    "positional_rank": slot_row.positional_rank,
                    "fill_source": m.fill_source,
                    "assigned_name": m.assigned_name or slot_row.name,
                    "adp_overall": m.adp_overall,
                    "adp_pos_rank": m.adp_pos_rank,
                    "anchor_upper_slot": m.anchor_upper_slot,
                    "anchor_upper_name": m.anchor_upper_name,
                    "anchor_upper_value": m.anchor_upper_value,
                    "anchor_upper_adp": m.anchor_upper_adp,
                    "anchor_lower_slot": m.anchor_lower_slot,
                    "anchor_lower_name": m.anchor_lower_name,
                    "anchor_lower_value": m.anchor_lower_value,
                    "anchor_lower_adp": m.anchor_lower_adp,
                    "interpolate_fraction": m.interpolate_fraction,
                    "baseline_value": m.baseline_value,
                    "raw_computed_value": m.raw_computed_value,
                    "clamped": m.clamped,
                    "clamp_reason": m.clamp_reason,
                    "value_resolved_date": m.value_resolved_date,
                    "rank_resolved_date": m.rank_resolved_date or rank_resolved,
                }
            )

    return filled_rows, meta_rows


def top300_sum(rows: list[dict]) -> int:
    values = sorted(
        (parse_int(r.get("ktc_value")) or 0 for r in rows if not is_pick_name(r.get("name", ""))),
        reverse=True,
    )
    return sum(values[:300])


def main() -> int:
    for path in (RANKS_CSV, VALUES_CSV, FINAL_KTC_CSV, CURRENT_KTC_CSV):
        if not path.is_file():
            sys.exit(f"ERROR: missing {path}")

    ranks_by_date, rank_dates = load_rank_dates()
    values_by_date, value_dates = load_values_by_date()
    final_ktc_dates = load_final_ktc_dates()
    adp_by_season = load_startup_adp()
    current_slot_values = load_current_slot_values()
    snapshots = build_snapshot_targets(final_ktc_dates)

    all_filled: list[dict] = []
    all_meta: list[dict] = []
    skipped: list[str] = []

    for snapshot in snapshots:
        result = fill_snapshot(
            snapshot,
            ranks_by_date,
            rank_dates,
            values_by_date,
            value_dates,
            adp_by_season,
            current_slot_values,
        )
        if result is None:
            skipped.append(f"{snapshot.kind}:{snapshot.target}")
            continue
        filled, meta = result
        all_filled.extend(filled)
        all_meta.extend(meta)

    FILLED_CSV.parent.mkdir(parents=True, exist_ok=True)
    with FILLED_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FILLED_FIELDS)
        writer.writeheader()
        writer.writerows(all_filled)

    with METADATA_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=METADATA_FIELDS)
        writer.writeheader()
        writer.writerows(all_meta)

    # Top-300 report for Final KTC snapshots + raw historical comparison
    print(f"Wrote {len(all_filled):,} filled rows -> {FILLED_CSV.relative_to(PROJECT_ROOT)}")
    print(f"Wrote {len(all_meta):,} metadata rows -> {METADATA_CSV.relative_to(PROJECT_ROOT)}")
    if skipped:
        print(f"Skipped {len(skipped)} snapshots (no rank data in target month): {skipped[:5]}...")

    print("\n=== Top-300 value sums (Final KTC snapshots, filled board) ===")
    by_snapshot: dict[str, list[dict]] = defaultdict(list)
    for row in all_filled:
        if row["snapshot_kind"] == "final_ktc":
            key = row["snapshot_target"]
            by_snapshot[key].append(row)

    raw_by_date: dict[str, list[int]] = defaultdict(list)
    with VALUES_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            ds = (row.get("date") or "").strip()
            name = (row.get("name") or "").strip()
            val = parse_int(row.get("ktc_value"))
            if not ds or not name or val is None or is_pick_name(name):
                continue
            if ds[:4].isdigit() and int(ds[:4]) < FIRST_YEAR:
                continue
            raw_by_date[ds].append(val)

    live_values: list[int] = []
    with CURRENT_KTC_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = (row.get("name") or "").strip()
            val = parse_int(row.get(KTC_VALUE_COL))
            if name and val is not None and not is_pick_name(name):
                live_values.append(val)
    live_top300 = sum(sorted(live_values, reverse=True)[:300])

    print(f"{'Year':<6} {'Filled':>12} {'Raw CSV':>12} {'Inflated':>12} {'Live ref':>12}")
    print("-" * 58)
    for year in range(FIRST_YEAR, LAST_YEAR + 1):
        fk_target = final_ktc_dates.get(year)
        if not fk_target:
            continue
        filled_rows = by_snapshot.get(fk_target, [])
        if not filled_rows:
            # fallback: any final_ktc row for year
            filled_rows = [r for r in all_filled if r["snapshot_kind"] == "final_ktc" and r["year"] == year]
        filled_sum = top300_sum(filled_rows)

        resolved, _ = resolve_date_forward_in_month(fk_target, set(raw_by_date))
        raw_sum = 0
        if resolved:
            raw_sum = sum(sorted(raw_by_date[resolved], reverse=True)[:300])
        inflated = int(round(raw_sum * (live_top300 / raw_sum))) if raw_sum > 0 else 0

        print(
            f"{year:<6} {filled_sum:>12,} {raw_sum:>12,} {inflated:>12,} {live_top300:>12,}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
