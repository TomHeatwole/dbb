#!/bin/bash
# Runs all data refresh scripts (FantasyPros ECR + ROS, KTC, ADP, players, etc.).
#
# Usage (run from project root):
#   ./all_scripts.sh
#   ./all_scripts.sh --verbose
#   ./all_scripts.sh --retry-failed

exec "$(cd "$(dirname "$0")" && pwd)/scripts/all_updates.sh" "$@"
