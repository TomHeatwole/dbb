import { SIMULATE_MIDWEEK } from '../utils/global_constants';
import { getPlayerInfo } from '../lookups/PlayerLookup';
import { getInjuryAbbreviation } from '../lookups/InjuryLookup';

const REGULATION_SECONDS = 60 * 60;
const QUARTER_SECONDS = 15 * 60;

export function parseGameClockSeconds(clock) {
  if (clock == null) return null;
  if (typeof clock === 'number' && Number.isFinite(clock)) {
    return clock > 100 ? clock : clock * 60;
  }
  const text = String(clock).trim();
  const m = text.match(/^(\d+)\s*:\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Fraction of a 60-minute NFL game still remaining (0–1).
 * OT clocks count as leftover regulation-seconds only (usually a few minutes).
 */
export function nflTimeRemainingFrac(period, clock) {
  const q = Number(period);
  if (!Number.isFinite(q) || q < 1) return 1;
  const clockSec = parseGameClockSeconds(clock);
  if (q > 4) {
    const left = Number.isFinite(clockSec) ? clockSec : 0;
    return clamp01(left / REGULATION_SECONDS);
  }
  const leftInQuarter = Number.isFinite(clockSec)
    ? Math.min(QUARTER_SECONDS, Math.max(0, clockSec))
    : 0;
  const fullQuartersLeft = Math.max(0, 4 - q);
  return clamp01((leftInQuarter + fullQuartersLeft * QUARTER_SECONDS) / REGULATION_SECONDS);
}

export function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export function liveTimeFrac(label) {
  if (!label) return 1;
  if (label.completed) return 0;
  if (!label.live) return 1;
  const raw = Number(label.timeRemainingFrac);
  return Number.isFinite(raw) ? clamp01(raw) : 0.5;
}

export function espnRemainingProj(pregameProj, timeFrac) {
  const proj = Number(pregameProj);
  if (!Number.isFinite(proj) || proj <= 0) return 0;
  return round1(proj * clamp01(timeFrac));
}

/** current + pregame * (time left / total). */
export function espnLiveProjection(actual, pregameProj, timeFrac) {
  return round1(Math.max(0, Number(actual) || 0) + espnRemainingProj(pregameProj, timeFrac));
}

/** current + rolled pregame outcome * (time left / total). */
export function scaledLiveOutcome(actual, rolledPregame, timeFrac) {
  const rolled = Number(rolledPregame);
  const add = Number.isFinite(rolled) ? rolled * clamp01(timeFrac) : 0;
  return Math.max(0, (Number(actual) || 0) + add);
}

export function playerIsRuledOut(playerId, injuriesMap, playersData, playerIdMap) {
  const id = String(playerId);
  const mapped = injuriesMap
    ? (injuriesMap[playerId] || injuriesMap[id] || null)
    : null;
  const info = getPlayerInfo(playerId, playersData, playerIdMap)
    || (playersData && (playersData[playerId] || playersData[id]))
    || null;
  const status = mapped
    || (info && (info.injury_status || info.injury_notes
      || (info.status && /out|pup|ir|injured reserve/i.test(info.status) ? info.status : null)))
    || null;
  return getInjuryAbbreviation(status) === 'O';
}

export function collectOutPlayerIds(playerIds, injuriesMap, playersData, playerIdMap) {
  const out = new Set();
  for (const raw of playerIds || []) {
    if (raw == null || String(raw) === '0') continue;
    if (playerIsRuledOut(raw, injuriesMap, playersData, playerIdMap)) {
      out.add(String(raw));
    }
  }
  return out;
}

function labelForPlayer(playerGameLabels, playerId) {
  if (!playerGameLabels || playerId == null) return null;
  return playerGameLabels[playerId] || playerGameLabels[String(playerId)] || null;
}

/**
 * Points already on the board. Midweek sim invents an actual from the
 * clock so Scores / HProj have something to lock besides 0.
 * Week-1-done only flips game labels to Final — it must not copy the
 * projection onto the score, or the proj column looks like a duplicate.
 */
export function displayActualPts(player, label, proj) {
  const simulated = simulatedLockedPts(label, proj);
  if (simulated != null) return simulated;
  const pts = player && typeof player.pts === 'number' ? player.pts : Number(player && player.pts);
  return Number.isFinite(pts) ? pts : 0;
}

export function simulatedLockedPts(label, proj) {
  if (!SIMULATE_MIDWEEK || !label || !label.simulated) return null;
  if (typeof proj !== 'number' || !Number.isFinite(proj)) {
    return null;
  }
  if (label && label.completed) return round1(proj);
  if (label && label.live) {
    const frac = clamp01(label.timeRemainingFrac);
    const played = Number.isFinite(Number(label.timeRemainingFrac)) ? 1 - frac : 0.48;
    return round1(proj * played);
  }
  return null;
}

export function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

export function labelForOutlook(playerGameLabels, playerId) {
  return labelForPlayer(playerGameLabels, playerId);
}
