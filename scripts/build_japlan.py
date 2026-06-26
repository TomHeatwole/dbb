#!/usr/bin/env python3
"""Fetch JAPLAN Google Sheet tabs and write snapshot.json."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "site/public/c4e8a1f3/data"
CONFIG_PATH = OUT_DIR / "config.json"

SHEET_ID = "1Y1qivGCgrYEGoDAriGrBREDwJ6hR3ON9B8yPUYGa-qg"

TABS = [
    {"id": "itinerary", "gid": 601141568, "title": "Itinerary", "emoji": "🗓️", "renderer": "timeline"},
    {"id": "bookings", "gid": 1616444469, "title": "Booking Checklist", "emoji": "🏷️", "renderer": "hanko"},
    {"id": "packing", "gid": 14521517, "title": "Packing", "emoji": "🎒", "renderer": "checklist"},
    {"id": "flights", "gid": 485014681, "title": "Flights", "emoji": "✈️", "renderer": "boarding-pass"},
    {"id": "ideas", "gid": 0, "title": "Ideas", "emoji": "💡", "renderer": "scrapbook"},
    {"id": "transport", "gid": 1755088975, "title": "Transport Legs", "emoji": "🚃", "renderer": "transit"},
    {"id": "map-routes", "gid": 1218970773, "title": "Map Routes", "emoji": "🗺️", "renderer": "map-routes"},
    {"id": "food", "gid": 2117925570, "title": "Food Ideas", "emoji": "🍜", "renderer": "menu"},
    {"id": "sources", "gid": 1555826150, "title": "Sources", "emoji": "📚", "renderer": "sources"},
]


def fetch_gviz(gid: int) -> dict:
    url = (
        f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/"
        f"gviz/tq?tqx=out:json&gid={gid}&headers=1"
    )
    result = subprocess.run(
        ["curl", "-sS", "--max-time", "30", "-A", "Mozilla/5.0", url],
        capture_output=True,
        text=True,
        check=True,
    )
    raw = result.stdout
    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        raise RuntimeError(f"No JSON in gviz response for gid={gid}")
    return json.loads(m.group())


def cell_value(c: dict | None) -> str:
    if not c:
        return ""
    if c.get("f") is not None:
        return str(c["f"])
    if c.get("v") is not None:
        return str(c["v"])
    return ""


def parse_table(data: dict) -> tuple[list[str], list[dict[str, str]]]:
    table = data.get("table", {})
    cols: list[str] = []
    for i, c in enumerate(table.get("cols", [])):
        label = (c.get("label") or "").strip()
        cols.append(label if label else f"_c{i}")
    rows: list[dict[str, str]] = []
    for row in table.get("rows", []):
        cells = row.get("c") or []
        record: dict[str, str] = {}
        for i, col in enumerate(cols):
            record[col] = cell_value(cells[i] if i < len(cells) else None).strip()
        if any(v for v in record.values()):
            rows.append(record)
    return cols, rows


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    config = {
        "sheetId": SHEET_ID,
        "title": "JAPLAN",
        "subtitle": "私たちの夏",
        "departureDate": "2026-07-25",
        "tabs": TABS,
    }
    CONFIG_PATH.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    sections = []
    for tab in TABS:
        print(f"Fetching {tab['title']} (gid={tab['gid']})...")
        data = fetch_gviz(tab["gid"])
        cols, rows = parse_table(data)
        sections.append({**tab, "columns": cols, "rows": rows})
        print(f"  -> {len(rows)} rows, {len(cols)} columns")

    snapshot = {
        "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "sheetId": SHEET_ID,
        "sections": sections,
    }
    snapshot_path = OUT_DIR / "snapshot.json"
    snapshot_path.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {snapshot_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
