#!/usr/bin/env node

/**
 * Command-line runner for score validation
 * 
 * Usage:
 *   node run_validation.js                    # Validate 2024 & 2025, all weeks
 *   node run_validation.js 2024               # Validate only 2024
 *   node run_validation.js 2024 2025          # Validate 2024 & 2025
 *   node run_validation.js 2024 --weeks 1-4   # Validate 2024 weeks 1-4
 *   node run_validation.js --stop-on-diff     # Stop on first difference
 */

import { validateScores } from './validate_scores_data.js';

// Parse command line arguments
const args = process.argv.slice(2);
const seasons = [];
let weeks = Array.from({ length: 17 }, (_, i) => i + 1);
let stopOnFirstDifference = false;
let delayMs = 100;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  if (arg === '--weeks' && i + 1 < args.length) {
    const weeksArg = args[++i];
    if (weeksArg.includes('-')) {
      const [start, end] = weeksArg.split('-').map(Number);
      weeks = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    } else {
      weeks = weeksArg.split(',').map(Number);
    }
  } else if (arg === '--stop-on-diff') {
    stopOnFirstDifference = true;
  } else if (arg === '--delay' && i + 1 < args.length) {
    delayMs = Number(args[++i]);
  } else if (arg === '--help' || arg === '-h') {
    process.stdout.write(`
Fantasy Score Validation Tool

Usage:
  node run_validation.js [seasons...] [options]

Examples:
  node run_validation.js                    # Validate 2024 & 2025, all weeks
  node run_validation.js 2024               # Validate only 2024
  node run_validation.js 2024 2025          # Validate both seasons
  node run_validation.js 2024 --weeks 1-4   # Validate 2024 weeks 1-4
  node run_validation.js --stop-on-diff     # Stop on first difference
  node run_validation.js --delay 200        # 200ms delay between API calls

Options:
  --weeks <range>      Weeks to validate (e.g., "1-4" or "1,2,3")
  --stop-on-diff       Stop validation on first difference found
  --delay <ms>         Delay between API calls in milliseconds (default: 100)
  --help, -h           Show this help message

`);
    process.exit(0);
  } else if (!isNaN(arg)) {
    seasons.push(arg);
  }
}

// Default to 2024 and 2025 if no seasons specified
if (seasons.length === 0) {
  seasons.push('2024', '2025');
}

// Run validation
validateScores(seasons, {
  weeks,
  delayMs,
  verbose: true,
  stopOnFirstDifference
}).then(results => {
  if (results.summary.totalDifferences > 0) {
    process.exit(1);
  }
}).catch(() => {
  process.exit(1);
});
