#!/bin/bash

# Quick Validation Script
# Run common validation scenarios with a simple command

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║         Fantasy Score Validation Tool                 ║"
echo "╔════════════════════════════════════════════════════════╗"
echo ""

# Change to the script directory
cd "$(dirname "$0")"

# Function to run validation
run_validation() {
  local description="$1"
  shift
  echo -e "${YELLOW}Running: $description${NC}"
  echo ""
  
  if node run_validation.js "$@"; then
    echo ""
    echo -e "${GREEN}✅ PASSED${NC}"
  else
    echo ""
    echo -e "${RED}❌ FAILED${NC}"
    return 1
  fi
  echo ""
  echo "────────────────────────────────────────────────────────"
  echo ""
}

# Parse command line argument for which test to run
TEST_CASE="${1:-all}"

case "$TEST_CASE" in
  "quick")
    echo "🔍 Quick Test: Validating 2024 Week 1 only"
    run_validation "Quick validation (Week 1 only)" 2024 --weeks 1
    ;;
  
  "recent")
    echo "🔍 Recent Weeks: Validating last 4 weeks of 2024"
    run_validation "Recent weeks validation" 2024 --weeks 14-17
    ;;
  
  "2024")
    echo "🔍 Full 2024 Season"
    run_validation "Full 2024 season validation" 2024
    ;;
  
  "2025")
    echo "🔍 Full 2025 Season"
    run_validation "Full 2025 season validation" 2025
    ;;
  
  "both")
    echo "🔍 Both Seasons: 2024 & 2025"
    run_validation "Both seasons validation" 2024 2025
    ;;
  
  "first-diff")
    echo "🔍 Stop on First Difference"
    run_validation "Stop on first difference" 2024 2025 --stop-on-diff
    ;;
  
  "all")
    echo "🔍 Running all validation tests..."
    echo ""
    
    run_validation "Quick smoke test" 2024 --weeks 1 || true
    run_validation "First 4 weeks of 2024" 2024 --weeks 1-4 || true
    run_validation "Full 2024 season" 2024 || true
    
    echo ""
    echo -e "${GREEN}All tests complete!${NC}"
    ;;
  
  "help"|"-h"|"--help")
    echo "Usage: ./quick_validate.sh [test_case]"
    echo ""
    echo "Available test cases:"
    echo "  quick       - Validate only week 1 of 2024 (fastest)"
    echo "  recent      - Validate weeks 14-17 of 2024"
    echo "  2024        - Validate all weeks of 2024"
    echo "  2025        - Validate all weeks of 2025"
    echo "  both        - Validate both 2024 and 2025 seasons"
    echo "  first-diff  - Run validation and stop on first difference"
    echo "  all         - Run multiple validation scenarios (default)"
    echo "  help        - Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./quick_validate.sh quick"
    echo "  ./quick_validate.sh 2024"
    echo "  ./quick_validate.sh first-diff"
    echo ""
    exit 0
    ;;
  
  *)
    echo -e "${RED}Unknown test case: $TEST_CASE${NC}"
    echo "Run './quick_validate.sh help' for available options"
    exit 1
    ;;
esac

echo ""
echo "╚════════════════════════════════════════════════════════╝"
echo ""
