#!/usr/bin/env python3
"""
Hwang Dynasty 1-for-1 player trades vs KTC (SF TE+) on the trade date.

Pulls every completed Sleeper trade across the Hwang league chain, keeps
strict one-player-for-one-player swaps (no picks, no FAAB, no packages),
looks up SF TE+ KTC on the America/New_York calendar date of the trade,
and writes a JSON payload + stdout summary.
"""

from __future__ import annotations

import csv
import json
import statistics
import subprocess
from bisect import bisect_right
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "site/public/data"
OUT_JSON = PROJECT_ROOT / "example_data/hwang_one_for_one_ktc.json"
PLAYERS_FILE = DATA_DIR / "players.txt"
KTC_HIST_CSV = DATA_DIR / "sf_ktc_values_historical.csv"

SLEEPER = "https://api.sleeper.app/v1"
CURRENT_LEAGUE_ID = "1326575946462920704"
NY = ZoneInfo("America/New_York")
MAX_DATE_SLACK_DAYS = 3
TEP_SCRAPE_MAX = "2026-06-19"
SKILL_POS = {"QB", "RB", "WR", "TE"}


def get_json(url: str):
    raw = subprocess.check_output(["curl", "-fsSL", url], timeout=30)
    return json.loads(raw.decode())


def walk_leagues(start_id: str) -> list[dict]:
    leagues = []
    seen = set()
    lid = start_id
    while lid and lid not in seen:
        seen.add(lid)
        league = get_json(f"{SLEEPER}/league/{lid}")
        leagues.append(league)
        lid = league.get("previous_league_id") or None
    return leagues


def fetch_trades(league_id: str) -> list[dict]:
    txns = get_json(f"{SLEEPER}/league/{league_id}/transactions/1")
    if not isinstance(txns, list):
        return []
    return [t for t in txns if t.get("type") == "trade" and t.get("status") == "complete"]


def user_team_name(user: dict | None, fallback: str) -> str:
    if not user:
        return fallback
    meta = user.get("metadata") or {}
    return (meta.get("team_name") or user.get("display_name") or fallback).strip()


def team_map(league_id: str) -> dict[int, str]:
    users = get_json(f"{SLEEPER}/league/{league_id}/users")
    rosters = get_json(f"{SLEEPER}/league/{league_id}/rosters")
    user_by_id = {u["user_id"]: u for u in users}
    assigned = {str(r.get("owner_id")) for r in rosters if r.get("owner_id")}
    leftover = [u for u in users if str(u.get("user_id")) not in assigned]
    out = {}
    leftover_i = 0
    for r in rosters:
        rid = int(r["roster_id"])
        user = user_by_id.get(str(r.get("owner_id"))) if r.get("owner_id") else None
        if user:
            out[rid] = user_team_name(user, f"Roster {rid}")
            continue
        # Vacant roster_id after an owner left — recover the leftover 2024 user.
        if leftover_i < len(leftover):
            out[rid] = user_team_name(leftover[leftover_i], f"Vacant roster {rid}")
            leftover_i += 1
        else:
            out[rid] = f"Vacant roster {rid}"
    return out


def load_players() -> dict:
    return json.loads(PLAYERS_FILE.read_text(encoding="utf-8"))


def player_meta(players: dict, pid: str) -> dict:
    p = players.get(str(pid)) or {}
    first = (p.get("first_name") or "").strip()
    last = (p.get("last_name") or "").strip()
    name = f"{first} {last}".strip() or p.get("full_name") or f"Player {pid}"
    pos = (p.get("position") or (p.get("fantasy_positions") or [None])[0] or "?").upper()
    team = p.get("team") or ""
    return {"id": str(pid), "name": name, "pos": pos, "nfl_team": team}


def classify_trade(trade: dict) -> str:
    picks = trade.get("draft_picks") or []
    faab = [w for w in (trade.get("waiver_budget") or []) if w and w.get("amount")]
    adds = trade.get("adds") or {}
    roster_ids = [int(x) for x in (trade.get("roster_ids") or [])]
    uniq_rosters = sorted(set(roster_ids))

    if len(uniq_rosters) != 2:
        return "not_two_team"
    if picks:
        return "has_picks"
    if faab:
        return "has_faab"
    received = defaultdict(list)
    for pid, rid in adds.items():
        received[int(rid)].append(str(pid))
    if set(received.keys()) != set(uniq_rosters):
        return "uneven_or_empty_side"
    counts = [len(received[r]) for r in uniq_rosters]
    if counts == [1, 1]:
        return "one_for_one"
    if any(c > 1 for c in counts):
        return "multi_player"
    return "other"


def trade_date_ny(created_ms: int) -> str:
    dt = datetime.fromtimestamp(created_ms / 1000, tz=timezone.utc).astimezone(NY)
    return dt.date().isoformat()


def load_ktc_history() -> tuple[dict[str, list[tuple[str, int]]], set[str]]:
    """sleeper_id -> sorted [(date, value), ...]; also date set."""
    by_id: dict[str, list[tuple[str, int]]] = defaultdict(list)
    dates = set()
    with KTC_HIST_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            d = (row.get("date") or "").strip()
            sid = (row.get("sleeper_id") or "").strip()
            if not d or not sid:
                continue
            try:
                val = int(float(row["ktc_value"]))
            except (TypeError, ValueError):
                continue
            dates.add(d)
            by_id[sid].append((d, val))
    for sid, rows in by_id.items():
        rows.sort()
        # last write wins on duplicate dates
        collapsed = []
        for d, v in rows:
            if collapsed and collapsed[-1][0] == d:
                collapsed[-1] = (d, v)
            else:
                collapsed.append((d, v))
        by_id[sid] = collapsed
    return by_id, dates


def lookup_ktc(series: list[tuple[str, int]], trade_date: str) -> dict | None:
    if not series:
        return None
    dates = [d for d, _ in series]
    i = bisect_right(dates, trade_date) - 1
    if i < 0:
        # nearest future within slack
        d, v = series[0]
        gap = (datetime.fromisoformat(d) - datetime.fromisoformat(trade_date)).days
        if gap <= MAX_DATE_SLACK_DAYS:
            return {"value": v, "as_of": d, "slack_days": gap, "direction": "forward"}
        return None
    d, v = series[i]
    gap = (datetime.fromisoformat(trade_date) - datetime.fromisoformat(d)).days
    if gap <= MAX_DATE_SLACK_DAYS:
        return {"value": v, "as_of": d, "slack_days": gap, "direction": "back"}
    # try a nearby future if back was stale
    if i + 1 < len(series):
        d2, v2 = series[i + 1]
        gap2 = (datetime.fromisoformat(d2) - datetime.fromisoformat(trade_date)).days
        if gap2 <= MAX_DATE_SLACK_DAYS:
            return {"value": v2, "as_of": d2, "slack_days": gap2, "direction": "forward"}
    return None


def pair_label(pos_a: str, pos_b: str) -> str:
    a, b = sorted([pos_a, pos_b])
    return f"{a}–{b}"


def mean(xs: list[float]) -> float | None:
    return statistics.mean(xs) if xs else None


def median(xs: list[float]) -> float | None:
    return statistics.median(xs) if xs else None


def main() -> None:
    players = load_players()
    ktc_by_id, ktc_dates = load_ktc_history()
    ktc_min, ktc_max = min(ktc_dates), max(ktc_dates)

    leagues = walk_leagues(CURRENT_LEAGUE_ID)
    funnel = Counter()
    trades_out = []

    for league in leagues:
        lid = league["league_id"]
        season = str(league["season"])
        names = team_map(lid)
        raw = fetch_trades(lid)
        funnel["completed_trades"] += len(raw)
        for trade in raw:
            kind = classify_trade(trade)
            funnel[kind] += 1
            if kind != "one_for_one":
                continue
            adds = trade["adds"]
            sides = []
            for pid, rid in adds.items():
                meta = player_meta(players, pid)
                sides.append(
                    {
                        "roster_id": int(rid),
                        "team": names.get(int(rid), f"Team {rid}"),
                        **meta,
                    }
                )
            sides.sort(key=lambda s: (s["team"], s["name"]))
            created = int(trade["created"])
            tdate = trade_date_ny(created)
            dt_et = datetime.fromtimestamp(created / 1000, tz=timezone.utc).astimezone(NY)
            for side in sides:
                hit = lookup_ktc(ktc_by_id.get(side["id"], []), tdate)
                side["ktc"] = hit["value"] if hit else None
                side["ktc_as_of"] = hit["as_of"] if hit else None
                side["ktc_slack_days"] = hit["slack_days"] if hit else None
            a, b = sides
            both = a["ktc"] is not None and b["ktc"] is not None
            ktc_diff = (a["ktc"] - b["ktc"]) if both else None
            ktc_abs = abs(ktc_diff) if both else None
            ktc_ratio = (max(a["ktc"], b["ktc"]) / min(a["ktc"], b["ktc"])) if both and min(a["ktc"], b["ktc"]) > 0 else None
            same_pos = a["pos"] == b["pos"]
            cross = a["pos"] in SKILL_POS and b["pos"] in SKILL_POS and not same_pos
            trades_out.append(
                {
                    "season": season,
                    "date": tdate,
                    "time_et": dt_et.strftime("%Y-%m-%d %I:%M %p ET"),
                    "created_iso": datetime.fromtimestamp(created / 1000, tz=timezone.utc).isoformat(),
                    "transaction_id": str(trade["transaction_id"]),
                    "a": a,
                    "b": b,
                    "pair": pair_label(a["pos"], b["pos"]),
                    "same_pos": same_pos,
                    "cross_pos": cross,
                    "ktc_diff_a_minus_b": ktc_diff,
                    "ktc_abs_diff": ktc_abs,
                    "ktc_ratio": ktc_ratio,
                    "has_ktc": both,
                }
            )

    trades_out.sort(key=lambda t: t["date"])
    priced = [t for t in trades_out if t["has_ktc"]]
    unpriced = [t for t in trades_out if not t["has_ktc"]]
    cross = [t for t in priced if t["cross_pos"]]
    same = [t for t in priced if t["same_pos"]]

    pair_counts = Counter(t["pair"] for t in trades_out)
    season_counts = Counter(t["season"] for t in trades_out)

    # Position-level: in a 1-for-1, Hwang market treats the two assets as equal.
    # KTC gap on the position = KTC(this pos) - KTC(other). Positive => this
    # position needed more KTC to clear a 1-for-1 => overvalued on KTC vs Hwang.
    pos_gaps: dict[str, list[float]] = defaultdict(list)
    pair_gaps: dict[str, list[float]] = defaultdict(list)
    for t in cross:
        pa, pb = t["a"]["pos"], t["b"]["pos"]
        va, vb = t["a"]["ktc"], t["b"]["ktc"]
        pos_gaps[pa].append(va - vb)
        pos_gaps[pb].append(vb - va)
        lo, hi = sorted([pa, pb])
        # signed as lo-position KTC minus hi-position KTC
        if pa == lo:
            pair_gaps[f"{lo}–{hi}"].append(va - vb)
        else:
            pair_gaps[f"{lo}–{hi}"].append(vb - va)

    def summarize_gaps(gaps: list[float]) -> dict:
        if not gaps:
            return {"n": 0}
        pos_n = sum(1 for g in gaps if g > 0)
        neg_n = sum(1 for g in gaps if g < 0)
        zero_n = sum(1 for g in gaps if g == 0)
        return {
            "n": len(gaps),
            "mean": round(mean(gaps), 1),
            "median": round(median(gaps), 1),
            "mean_pct_of_other": None,
            "ktc_higher_count": pos_n,
            "ktc_lower_count": neg_n,
            "ktc_tie_count": zero_n,
            "share_ktc_higher": round(pos_n / len(gaps), 3),
        }

    # percent version: (this - other) / other
    pos_pct: dict[str, list[float]] = defaultdict(list)
    for t in cross:
        pa, pb = t["a"]["pos"], t["b"]["pos"]
        va, vb = t["a"]["ktc"], t["b"]["ktc"]
        if vb > 0:
            pos_pct[pa].append((va - vb) / vb)
        if va > 0:
            pos_pct[pb].append((vb - va) / va)

    pos_summary = {}
    for pos in ["QB", "RB", "WR", "TE"]:
        s = summarize_gaps(pos_gaps[pos])
        pcts = pos_pct[pos]
        if pcts:
            s["mean_pct_vs_other"] = round(100 * mean(pcts), 1)
            s["median_pct_vs_other"] = round(100 * median(pcts), 1)
        pos_summary[pos] = s

    pair_summary = {k: summarize_gaps(v) for k, v in sorted(pair_gaps.items())}

    abs_all = [t["ktc_abs_diff"] for t in priced]
    abs_cross = [t["ktc_abs_diff"] for t in cross]
    abs_same = [t["ktc_abs_diff"] for t in same]
    ratio_all = [t["ktc_ratio"] for t in priced if t["ktc_ratio"] is not None]

    payload = {
        "generated_at": datetime.now(tz=timezone.utc).isoformat(),
        "ktc_board": "sf_ktc_values_historical.csv (SF TE+ merged)",
        "ktc_date_range": {"min": ktc_min, "max": ktc_max},
        "tep_scrape_max": TEP_SCRAPE_MAX,
        "funnel": dict(funnel),
        "n_one_for_one": len(trades_out),
        "n_priced": len(priced),
        "n_unpriced": len(unpriced),
        "n_cross_pos": len(cross),
        "n_same_pos": len(same),
        "season_counts": dict(season_counts),
        "pair_counts": dict(pair_counts),
        "ktc_abs_diff": {
            "all_mean": round(mean(abs_all), 1) if abs_all else None,
            "all_median": round(median(abs_all), 1) if abs_all else None,
            "cross_mean": round(mean(abs_cross), 1) if abs_cross else None,
            "cross_median": round(median(abs_cross), 1) if abs_cross else None,
            "same_mean": round(mean(abs_same), 1) if abs_same else None,
            "same_median": round(median(abs_same), 1) if abs_same else None,
        },
        "ktc_ratio_median": round(median(ratio_all), 3) if ratio_all else None,
        "position_gaps": pos_summary,
        "pair_gaps": pair_summary,
        "trades": trades_out,
        "unpriced": unpriced,
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print("FUNNEL", dict(funnel))
    print(f"1-for-1: {len(trades_out)}  priced: {len(priced)}  cross: {len(cross)}  same: {len(same)}")
    print("seasons", dict(season_counts))
    print("pairs", dict(pair_counts))
    print("pos gaps", json.dumps(pos_summary, indent=2))
    print("pair gaps", json.dumps(pair_summary, indent=2))
    print("abs diff", payload["ktc_abs_diff"])
    print("wrote", OUT_JSON)
    print("\n=== ALL 1-FOR-1 TRADES ===")
    for t in trades_out:
        a, b = t["a"], t["b"]
        ktc_s = (
            f"KTC {a['ktc']:,} vs {b['ktc']:,}  Δ{t['ktc_abs_diff']:,}"
            if t["has_ktc"]
            else "KTC missing"
        )
        print(
            f"{t['date']}  {t['season']}  {a['team']} gets {a['name']} ({a['pos']})  "
            f"⇄  {b['team']} gets {b['name']} ({b['pos']})  | {ktc_s}"
        )


if __name__ == "__main__":
    main()
