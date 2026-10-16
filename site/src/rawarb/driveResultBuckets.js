/**
 * Normalize drive-result runners (TD / FG / Punt / Other) across FD and DK.
 */

import { parseSignedAmerican } from './rawArbModel.js';
import { teamsMatch } from './teamMatch.js';

export const DRIVE_OUTCOME_KEYS = ['td', 'fg', 'punt', 'other'];

export function isDriveResultMarket(name) {
  const n = String(name ?? '').toLowerCase();
  if (!n.includes('drive')) return false;
  if (/\bdrive\s+\d+\s*[-–:]\s*result\b/.test(n)) return true;
  if (n.includes('drive sgp') && n.includes('result')) return true;
  return n.includes('drive result') || (n.includes('result') && /(?:1st|first|next|\d+(?:st|nd|rd|th))\s/.test(n));
}

export function bucketFromRunnerName(runnerName) {
  const n = String(runnerName ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!n) return null;
  if (n === 'punt' || n.startsWith('punt')) return 'punt';
  if (n.includes('passing touchdown') || n.includes('rushing touchdown')) return 'td';
  if (n.includes('field goal made') || n.includes('field goal missed')) return 'fg';
  if (n.includes('interception') || n.includes('fumble')) return 'other';
  if (n.includes('field goal attempt') || n === 'fg attempt') return 'fg';
  if (n.includes('offensive touchdown') || n === 'offensive td') return 'td';
  if (n.includes('turnover') || n.includes('safety')) return 'other';
  if (n === 'other' || n === 'any other') return 'other';
  if (n === 'touchdown' || n === 'td') return 'td';
  if (n === 'field goal' || n === 'fg') return 'fg';
  return null;
}

function impliedFromAmerican(american) {
  if (!Number.isFinite(american) || american === 0) return null;
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

function americanFromImplied(prob) {
  if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) return null;
  if (prob >= 0.5) return Math.round(-(100 * prob) / (1 - prob));
  return Math.round((100 * (1 - prob)) / prob);
}

/** DK granular splits (FG made + missed) → one bucket price via implied sum cap. */
export function combineExclusiveQuotes(legs) {
  const ps = (legs ?? []).map((leg) => impliedFromAmerican(leg.american)).filter((p) => Number.isFinite(p));
  if (!ps.length) return null;
  return americanFromImplied(Math.min(0.999, ps.reduce((a, b) => a + b, 0)));
}

export function driveNFromName(name) {
  const raw = String(name ?? '');
  const leading = raw.match(/^(\d+)(?:st|nd|rd|th)\b/i);
  if (leading) return Number(leading[1]);
  const numbered = raw.match(/\bdrive\s+(\d+)\b/i);
  return numbered ? Number(numbered[1]) : null;
}

export function offenseTeamFromDriveName(name) {
  return String(name ?? '')
    .replace(/^\d+(?:st|nd|rd|th)\s+/i, '')
    .replace(/^next\s+/i, '')
    .replace(/^1st\s+/i, '')
    .replace(/\s+drive result(?:\s+(?:grouped|granular))?$/i, '')
    .replace(/\s+drive\s+\d+\s*[-–:]\s*result$/i, '')
    .replace(/\bdrive result$/i, '')
    .trim();
}

export function driveResultSide(teamName, teams) {
  if (!teamName || teamName.toLowerCase() === 'drive') return null;
  if (teams?.away && teamsMatch(teamName, teams.away)) return 'away';
  if (teams?.home && teamsMatch(teamName, teams.home)) return 'home';
  return null;
}

export function driveResultSubject(name, teams) {
  const team = offenseTeamFromDriveName(name);
  const side = driveResultSide(team, teams);
  const driveN = driveNFromName(name);
  const nPart = Number.isFinite(driveN) && driveN >= 1 ? `d${driveN}` : 'next';
  const teamPart = side || (team ? team.toLowerCase().replace(/\s+/g, '_').slice(0, 32) : 'unknown');
  return `${teamPart}|${nPart}`;
}

export function quotesToDriveOutcomes(quotes) {
  const buckets = { td: [], fg: [], punt: [], other: [] };
  for (const q of quotes ?? []) {
    const label = q.name || q.label || '';
    const key = bucketFromRunnerName(label);
    const american = parseSignedAmerican(q.american);
    if (!key || american == null) continue;
    buckets[key].push({ american, label });
  }
  const out = {};
  for (const key of DRIVE_OUTCOME_KEYS) {
    const legs = buckets[key];
    if (!legs.length) continue;
    if (legs.length === 1) {
      out[key] = { american: legs[0].american, label: legs[0].label };
    } else {
      const american = combineExclusiveQuotes(legs);
      if (american != null) {
        out[key] = {
          american,
          label: legs.map((l) => l.label).join(' + '),
        };
      }
    }
  }
  return out;
}
