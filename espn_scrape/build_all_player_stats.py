#!/usr/bin/env python3

import argparse
import concurrent.futures
import json
import os
import re
import sys
import uuid
from pathlib import Path
from typing import List, Set, Dict, Any, Optional

# Ensure local imports work when executed from other working directories
CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from parse_team_history import parse_game_history_for_player  # noqa: E402

DEFAULT_2024_IDS = str(CURRENT_DIR / '2024_players.txt')
DEFAULT_2025_IDS = str(CURRENT_DIR / '2025_players.txt')
DUMPS_DIR = CURRENT_DIR / 'dumps'


def read_player_ids(file_path: str) -> Set[str]:
    ids: Set[str] = set()
    p = Path(file_path)
    if not p.exists():
        return ids
    # Read entire file; files may contain a single-line JSON array
    text = p.read_text(encoding='utf-8').strip()
    # Preferred: parse JSON array of { espn_id, name }
    try:
        data = json.loads(text)
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    espn_id = str(item.get('espn_id', '')).strip()
                    if espn_id.isdigit():
                        ids.add(espn_id)
            if ids:
                return ids
    except Exception:
        pass
    # Fallback: extract explicit espn_id fields via regex
    for m in re.finditer(r'"espn_id"\s*:\s*"?(\d+)"?', text):
        ids.add(m.group(1))
    if ids:
        return ids
    # Last resort: scan all digit tokens (avoid years by preferring previous paths)
    for line in text.splitlines():
        for m in re.finditer(r'\b(\d{3,8})\b', line):
            ids.add(m.group(1))
    return ids


def merge_player_ids(paths: List[str]) -> List[str]:
    merged: Set[str] = set()
    for path in paths:
        merged.update(read_player_ids(path))
    # Return sorted for stable ordering
    return sorted(merged, key=lambda x: int(x))


def ensure_dump_dir(dump_id: str) -> Path:
    DUMPS_DIR.mkdir(parents=True, exist_ok=True)
    target = DUMPS_DIR / dump_id
    target.mkdir(parents=True, exist_ok=True)
    return target


def already_done_ids(dump_path: Path) -> Set[str]:
    done: Set[str] = set()
    for child in dump_path.glob('*.txt'):
        stem = child.stem
        if stem.isdigit():
            done.add(stem)
    return done


def write_player_stats(dump_path: Path, player_id: str, data: Dict[str, Any]) -> None:
    out_file = dump_path / f'{player_id}.txt'
    with out_file.open('w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'))


def fetch_one(player_id: str, min_year: Optional[int], max_year: Optional[int], stop_gaps: int) -> Dict[str, Any]:
    return parse_game_history_for_player(player_id, min_year, max_year, stop_gaps)


def render_progress(current: int, total: int, successes: int, failures: int) -> None:
    if total <= 0:
        return
    bar_len = 40
    ratio = current / total
    filled = int(bar_len * ratio)
    bar = '#' * filled + '-' * (bar_len - filled)
    sys.stdout.write(f"\rProgress [{bar}] {current}/{total} ({int(ratio*100)}%) ok={successes} fail={failures}")
    sys.stdout.flush()


def main() -> None:
    parser = argparse.ArgumentParser(description='Build full player game histories for all ESPN IDs from 2024/2025 lists, with concurrency and resume support.')
    parser.add_argument('--ids-2024', type=str, default=DEFAULT_2024_IDS, help='Path to 2024 ESPN IDs file (default: espn_scrape/2024_players.txt)')
    parser.add_argument('--ids-2025', type=str, default=DEFAULT_2025_IDS, help='Path to 2025 ESPN IDs file (default: espn_scrape/2025_players.txt)')
    parser.add_argument('--dump-id', type=str, default='', help='Existing dump ID to resume into (if omitted, a new dump ID is generated)')
    parser.add_argument('--limit', type=int, default=8, help='Max concurrent downloads (default: 8)')
    parser.add_argument('--min-year', type=int, help='Minimum season year to check (default: currentYear-25)')
    parser.add_argument('--max-year', type=int, help='Maximum season year to check (default: currentYear)')
    parser.add_argument('--stop-gaps', type=int, default=3, help='Consecutive missing years after first find before stopping (default: 3)')
    args = parser.parse_args()

    player_ids = merge_player_ids([args.ids_2024, args.ids_2025])
    if not player_ids:
        print('No player IDs found in inputs.', file=sys.stderr)
        sys.exit(1)

    dump_id = args.dump_id.strip() or uuid.uuid4().hex[:16]
    dump_path = ensure_dump_dir(dump_id)
    print(f'dump_id: {dump_id}')

    done = already_done_ids(dump_path)
    to_fetch = [pid for pid in player_ids if pid not in done]
    if not to_fetch:
        print('All players already downloaded for this dump_id.')
        return

    max_workers = max(1, int(args.limit))

    def task(pid: str) -> Optional[str]:
        try:
            data = fetch_one(pid, args.min_year, args.max_year, args.stop_gaps)
            write_player_stats(dump_path, pid, data)
            return pid
        except Exception:
            return None

    completed = 0
    successes = 0
    failures = 0
    failed_ids: List[str] = []
    render_progress(completed, len(to_fetch), successes, failures)

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(task, pid): pid for pid in to_fetch}
        for fut in concurrent.futures.as_completed(futures):
            pid = futures[fut]
            # Swallow exceptions; per-task handling above
            res = fut.result()
            if res is None:
                failures += 1
                failed_ids.append(pid)
            else:
                successes += 1
            completed += 1
            render_progress(completed, len(to_fetch), successes, failures)

    sys.stdout.write('\n')

    total = len(to_fetch)
    overall_done = len(done) + successes
    if failures == 0:
        print(f'SUCCESS: downloaded {successes}/{total} remaining players (overall {overall_done}/{len(player_ids)}). dump_id: {dump_id}')
    else:
        print(f'PARTIAL: {successes}/{total} completed, {failures} failed. dump_id: {dump_id}')
        # Show a small sample of failed IDs to help resume/debug
        sample = ','.join(failed_ids[:10])
        if sample:
            print(f'Failed IDs (first {min(10, len(failed_ids))}): {sample}')
        print(f'Re-run with --dump-id {dump_id} to resume only the missing players.')


if __name__ == '__main__':
    main() 