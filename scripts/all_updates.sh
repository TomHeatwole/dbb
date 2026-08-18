#!/bin/bash
# Runs every scrape/update in sequence.
#
# Default: quiet mode — a progress bar while running, a ✓/✗ line per scrape as
# it finishes, and a success count at the end. Full output of every scrape is
# written to update_report.txt (gitignored).
#
# Usage (run from project root):
#   ./scripts/all_updates.sh                 quiet run with progress bar
#   ./scripts/all_updates.sh --verbose       stream all scrape output live
#   ./scripts/all_updates.sh --retry-failed  re-run only the scrapes marked FAIL
#                                            in the most recent update_report.txt
#
# Exits non-zero if any scrape failed.

set -uo pipefail

cd "$(cd "$(dirname "$0")/.." && pwd)"

REPORT="update_report.txt"
LOG_DIR="$(mktemp -d /tmp/all_updates_XXXXXX)"
trap 'rm -rf "$LOG_DIR"' EXIT

VERBOSE=0
RETRY_FAILED=0
for arg in "$@"; do
  case "$arg" in
    --verbose)      VERBOSE=1 ;;
    --retry-failed) RETRY_FAILED=1 ;;
    -h|--help)
      echo "Usage: ./scripts/all_updates.sh [--verbose] [--retry-failed]"
      echo ""
      echo "  --verbose       stream all scrape output live (instead of progress bar)"
      echo "  --retry-failed  re-run only the scrapes marked FAIL in the most recent"
      echo "                  $REPORT"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

# ── Task registry (bash 3.2: parallel arrays, no associative arrays) ──────────

TASK_NAMES=()
TASK_CMDS=()
add_task() { TASK_NAMES+=("$1"); TASK_CMDS+=("$2"); }

HAVE_DBBP=0
[ -d dbbp/scripts ] && HAVE_DBBP=1

add_task fantasycalc       "node scripts/process_fantasycalc_rankings.js"
if [ "$HAVE_DBBP" -eq 1 ]; then
  # Cookie-based scrapes that live in the private dbbp repo.
  add_task ffb             "node dbbp/scripts/process_ffb_rankings.js"
  add_task ffb_udk         "node dbbp/scripts/process_udk_rankings.js"
  add_task etr             "node dbbp/scripts/process_etr_rankings.js"
fi
add_task fantasypros       "bash scripts/download_fantasypros.sh"
add_task ktc_values        "bash scripts/fetch_ktc_values.sh"
add_task ktc_sf_historical "bash scripts/fetch_sf_non_tep_ktc_historical.sh"
add_task adp               "./scrape_adp"
add_task player_ids        "bash scripts/update_player_ids.sh"
add_task players           "bash scripts/update_players.sh"
add_task gibbs_deltas      "node scripts/process_gibbs_deltas.js"
add_task yafsb_adp         "node scripts/process_yafsb_adp.js"
if [ "$HAVE_DBBP" -eq 1 ]; then
  # DBB custom redraft board — blends the private + public boards refreshed
  # above, so it must run last. The snapshot strips per-source ranks and
  # writes the aggregated board into site/public/data for the live site.
  add_task custom_rankings         "node dbbp/scripts/build_custom_rankings.js"
  add_task redraft_dash_snapshot   "node scripts/build_redraft_dash_snapshot.js"
fi

if [ "$HAVE_DBBP" -eq 0 ]; then
  echo "dbbp/ not checked out — skipping ffb, ffb_udk, etr, custom_rankings, redraft_dash_snapshot."
fi

# ── --retry-failed: keep only the scrapes that failed in the last report ──────

MODE="full"
if [ "$RETRY_FAILED" -eq 1 ]; then
  MODE="retry-failed"
  if [ ! -f "$REPORT" ]; then
    echo "ERROR: --retry-failed needs $REPORT, but it doesn't exist. Run a full update first." >&2
    exit 2
  fi
  # Status lines live in the header section of the report, before the first
  # blank line — stop there so scrape output can't be misread as a status.
  FAILED_NAMES="$(awk '/^$/{exit} /^FAIL /{print $2}' "$REPORT")"
  if [ -z "$FAILED_NAMES" ]; then
    echo "Nothing to retry — no FAIL entries in $REPORT."
    exit 0
  fi
  KEPT_NAMES=()
  KEPT_CMDS=()
  for i in "${!TASK_NAMES[@]}"; do
    if printf '%s\n' "$FAILED_NAMES" | grep -qx "${TASK_NAMES[$i]}"; then
      KEPT_NAMES+=("${TASK_NAMES[$i]}")
      KEPT_CMDS+=("${TASK_CMDS[$i]}")
    fi
  done
  if [ "${#KEPT_NAMES[@]}" -eq 0 ]; then
    echo "ERROR: FAIL entries in $REPORT don't match any known scrape names." >&2
    exit 2
  fi
  TASK_NAMES=("${KEPT_NAMES[@]}")
  TASK_CMDS=("${KEPT_CMDS[@]}")
  echo "Retrying ${#TASK_NAMES[@]} failed scrape(s): ${TASK_NAMES[*]}"
fi

TOTAL="${#TASK_NAMES[@]}"

# ── Output helpers ─────────────────────────────────────────────────────────────

IS_TTY=0
[ -t 1 ] && IS_TTY=1

if [ "$IS_TTY" -eq 1 ]; then
  GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  GREEN=""; RED=""; DIM=""; RESET=""
fi

BAR_WIDTH=30
draw_bar() { # $1 = completed count, $2 = currently running scrape
  local completed=$1 current=$2 filled bar="" i
  filled=$(( completed * BAR_WIDTH / TOTAL ))
  for (( i = 0; i < BAR_WIDTH; i++ )); do
    if [ "$i" -lt "$filled" ]; then bar+="█"; else bar+="░"; fi
  done
  printf '\r\033[K[%s] %d/%d %s' "$bar" "$completed" "$TOTAL" "$current"
}

# ── Run ────────────────────────────────────────────────────────────────────────

STATUSES=()
DURATIONS=()

for i in "${!TASK_NAMES[@]}"; do
  name="${TASK_NAMES[$i]}"
  cmd="${TASK_CMDS[$i]}"
  log="$LOG_DIR/$name.log"
  t0="$(date +%s)"

  if [ "$VERBOSE" -eq 1 ]; then
    echo "━━━ $name ━━━ ${DIM}($cmd)${RESET}"
    if bash -c "$cmd" 2>&1 | tee "$log"; then ok=1; else ok=0; fi
  else
    [ "$IS_TTY" -eq 1 ] && draw_bar "$i" "$name"
    if bash -c "$cmd" > "$log" 2>&1; then ok=1; else ok=0; fi
  fi

  dur=$(( $(date +%s) - t0 ))
  DURATIONS+=("$dur")
  if [ "$ok" -eq 1 ]; then
    STATUSES+=("PASS")
    line="${GREEN}✓${RESET} $name ${DIM}(${dur}s)${RESET}"
  else
    STATUSES+=("FAIL")
    line="${RED}✗${RESET} $name ${DIM}(${dur}s)${RESET}"
  fi

  if [ "$IS_TTY" -eq 1 ] && [ "$VERBOSE" -eq 0 ]; then
    printf '\r\033[K%s\n' "$line"
  else
    printf '%s\n' "$line"
  fi
done

# ── Summary ────────────────────────────────────────────────────────────────────

pass_count=0
fail_count=0
for i in "${!STATUSES[@]}"; do
  if [ "${STATUSES[$i]}" = "PASS" ]; then
    pass_count=$(( pass_count + 1 ))
  else
    fail_count=$(( fail_count + 1 ))
  fi
done

echo ""
echo "$pass_count/$TOTAL scrapes succeeded"
if [ "$fail_count" -gt 0 ]; then
  for i in "${!STATUSES[@]}"; do
    [ "${STATUSES[$i]}" = "FAIL" ] && echo "  ${RED}✗${RESET} ${TASK_NAMES[$i]}"
  done
  echo ""
  echo "Full output in $REPORT — retry with: ./scripts/all_updates.sh --retry-failed"
fi

# ── Write update_report.txt ────────────────────────────────────────────────────

{
  echo "# all_updates report"
  echo "# generated: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "# mode: $MODE"
  echo "# result: $pass_count/$TOTAL scrapes succeeded"
  for i in "${!TASK_NAMES[@]}"; do
    echo "${STATUSES[$i]} ${TASK_NAMES[$i]} ${DURATIONS[$i]}s"
  done
  echo ""
  for i in "${!TASK_NAMES[@]}"; do
    echo "═════ ${TASK_NAMES[$i]} (${STATUSES[$i]}) ═════"
    cat "$LOG_DIR/${TASK_NAMES[$i]}.log"
    echo ""
  done
} > "$REPORT"

[ "$fail_count" -eq 0 ]
