/**
 * ESPN summary drives → team start counts for FanDuel-style drive numbers.
 *
 * Counts a team's offensive series. Does not count:
 *   - End of Half / End of Game clock stubs with no offensive plays
 *   - Kickoff-only rows (0 offensive plays, no series result), including
 *     the post-PAT "current" drive ESPN opens before the return team snaps
 *
 * A series that actually ran (rushes/passes) and then expired at the half
 * DOES count. SMU @ FSU (401858212): SMU's 0:31 1H drive ended "End of Half"
 * with 4 offensive plays — that is Drive 6; FanDuel's 2H market is Drive 7.
 *
 * Louisville @ Ole Miss (401856661) 0:06 kickoff + "End of 2nd quarter"
 * tagged LOU is still not a drive.
 */

const CLOCK_STUB = /end of (half|game)/i;
const SERIES_RESULT = /touchdown|field goal|punt|fumble|interception|downs|safety|missed|blocked/i;

export function espnDriveResultName(drive) {
  if (typeof drive?.result === 'string' && drive.result.trim()) return drive.result.trim();
  return String(drive?.result?.displayName || drive?.displayResult || '').trim();
}

const ST_TD = /interception|fumble return|punt return|kickoff return|kick return|blocked punt|blocked field goal/i;

/**
 * FanDuel settlement bucket for a completed ESPN series.
 * Matches scripts/scrape_espn_ncaaf_drives.py classify_bucket.
 */
export function classifyEspnDriveBucket(drive) {
  if (!drive || isInProgressDrive(drive) || !isCountableTeamDrive(drive)) return null;
  const display = espnDriveResultName(drive).toLowerCase();
  if (!display) return 'other';
  if (/field goal|missed fg/.test(display)) return 'fg';
  if (display === 'punt' || display === 'blocked punt') return 'punt';
  if (/touchdown|\btd\b/.test(display)) return ST_TD.test(display) ? 'other' : 'td';
  if (/^punt\b/.test(display)) return 'punt';
  return 'other';
}

export function isClockStubDrive(drive) {
  if (!CLOCK_STUB.test(espnDriveResultName(drive))) return false;
  const off = Number(drive?.offensivePlays);
  // Real series that ran out the clock (SMU 1H: 4 offensive plays).
  if (Number.isFinite(off) && off > 0) return false;
  return true;
}

/** Made TD / FG / PAT — that series is over; kickoff goes the other way. */
export function isMadeScoreLabel(label) {
  const n = String(label ?? '');
  if (!n) return false;
  if (/missed|no good|blocked/i.test(n) && /fg|field goal/i.test(n)) return false;
  if (/extra point|two point|\bpat\b|\bxp\b/i.test(n)) return true;
  return /touchdown|\btd\b/i.test(n) || /field goal/i.test(n);
}

function playTypeName(play) {
  return String(play?.type?.text || '');
}

/** Kickoff / PAT / clock — not an offensive series, even if ESPN tags a team. */
export function isKickoffOnlyDrive(drive) {
  const off = Number(drive?.offensivePlays);
  if (Number.isFinite(off) && off > 0) return false;
  if (SERIES_RESULT.test(espnDriveResultName(drive)) && !isClockStubDrive(drive)) return false;
  const plays = Array.isArray(drive?.plays) ? drive.plays : [];
  if (!plays.length) return false;
  return plays.every((play) => (
    /kickoff|extra point|two-point|timeout|end period|end of|coin toss/i.test(playTypeName(play))
  ));
}

/**
 * ESPN sometimes stamps INT/fumble/TD on the current drive after a penalty
 * wiped the play ("NO PLAY"). The series is still live.
 */
export function isNegatedDriveResult(drive) {
  const plays = Array.isArray(drive?.plays) ? drive.plays : [];
  const last = plays.length ? plays[plays.length - 1] : null;
  const text = String(last?.text || last?.shortText || '');
  if (!text || !/\bno play\b/i.test(text)) return false;
  const result = espnDriveResultName(drive);
  return Boolean(result) && !/in progress/i.test(result);
}

export function isInProgressDrive(drive) {
  if (!drive || isClockStubDrive(drive) || isKickoffOnlyDrive(drive)) return false;
  if (isNegatedDriveResult(drive)) return true;
  const result = espnDriveResultName(drive);
  return !result || /in progress/i.test(result);
}

/** Real offensive series, or an in-progress one that has not been result-tagged yet. */
export function isCountableTeamDrive(drive) {
  if (!drive || isClockStubDrive(drive) || isKickoffOnlyDrive(drive)) return false;
  if (isInProgressDrive(drive)) return true;
  const off = Number(drive.offensivePlays);
  if (Number.isFinite(off) && off > 0) return true;
  return SERIES_RESULT.test(espnDriveResultName(drive));
}

export function parseEspnDriveBlob(blob, sideOf) {
  if (!blob || typeof blob !== 'object' || typeof sideOf !== 'function') return null;
  const previous = Array.isArray(blob.previous) ? blob.previous : [];
  const current = blob.current && typeof blob.current === 'object' ? blob.current : null;
  const seen = new Set();
  const started = { home: 0, away: 0 };
  const soFar = { td: 0, fg: 0, punt: 0, other: 0 };
  let openingReceiveSide = null;
  const add = (drive) => {
    if (!drive || typeof drive !== 'object') return;
    const id = drive.id != null ? String(drive.id) : null;
    if (id) {
      if (seen.has(id)) return;
      seen.add(id);
    }
    if (!isCountableTeamDrive(drive)) return;
    const side = sideOf(drive);
    if (side === 'home' || side === 'away') {
      if (!openingReceiveSide) openingReceiveSide = side;
      started[side] += 1;
    }
    const bucket = classifyEspnDriveBucket(drive);
    if (bucket) soFar[bucket] += 1;
  };
  for (const drive of previous) add(drive);
  if (current) add(current);
  const currentSide = current && isInProgressDrive(current) ? sideOf(current) : null;
  const liveCurrent = currentSide === 'home' || currentSide === 'away' ? currentSide : null;
  const currentResult = current ? espnDriveResultName(current) || null : null;
  const finished = current && !isInProgressDrive(current) && !isKickoffOnlyDrive(current)
    ? sideOf(current)
    : null;
  const finishedSide = finished === 'home' || finished === 'away' ? finished : null;
  if (!started.home && !started.away && !liveCurrent) return null;
  return {
    homeStarted: started.home,
    awayStarted: started.away,
    startedTotal: started.home + started.away,
    soFar,
    currentSide: liveCurrent,
    currentResult,
    finishedSide,
    openingReceiveSide,
  };
}

function normSpotText(s) {
  return String(s ?? '').replace(/^\s*at\s+/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** ESPN play start/end hash → live snap fields. */
export function spotFromEspnHash(hash) {
  if (!hash || typeof hash !== 'object') return null;
  const possessionText = String(hash.possessionText || hash.text || '').trim() || null;
  const ytg = Number(hash.yardsToEndzone);
  const yl = Number(hash.yardLine);
  const down = Number(hash.down);
  const distance = Number(hash.distance);
  const downDistance = hash.shortDownDistanceText || hash.downDistanceText || null;
  const hasYtg = Number.isFinite(ytg) && ytg >= 1 && ytg <= 99;
  if (!possessionText && !hasYtg && !downDistance && !(Number.isFinite(down) && down > 0)) {
    return null;
  }
  return {
    possessionText,
    yardsToEndzone: hasYtg ? ytg : null,
    yardLine: Number.isFinite(yl) ? yl : null,
    down: Number.isFinite(down) && down > 0 ? down : null,
    distance: Number.isFinite(distance) ? distance : null,
    downDistance: downDistance || null,
  };
}

/** Prefer the play's end (next snap) over its start. */
export function liveSpotFromPlay(play) {
  if (!play || typeof play !== 'object') return null;
  const end = spotFromEspnHash(play.end);
  const start = spotFromEspnHash(play.start);
  if (end && (end.possessionText || end.yardsToEndzone != null || end.down != null)) return end;
  return start;
}

/** Latest snap on the in-progress series — not drive.start (opening hash). */
export function liveSpotFromCurrentDrive(drive) {
  const plays = Array.isArray(drive?.plays) ? drive.plays : [];
  for (let i = plays.length - 1; i >= 0; i -= 1) {
    const spot = liveSpotFromPlay(plays[i]);
    if (spot) return spot;
  }
  return null;
}

export function currentDrivePlayMoved(drive, playSpot) {
  const startText = normSpotText(drive?.start?.text || drive?.start?.possessionText);
  const playText = normSpotText(playSpot?.possessionText);
  if (startText && playText && playText !== startText) return true;
  const startYtg = Number(drive?.start?.yardsToEndzone);
  const playYtg = Number(playSpot?.yardsToEndzone);
  return Number.isFinite(startYtg) && Number.isFinite(playYtg) && startYtg !== playYtg;
}

/**
 * Use the current-drive play spot when the header is empty, still showing
 * drive.start, or the series has already moved off that opening hash.
 * Keep a header that is ahead of an un-updated play list.
 */
export function shouldApplyCurrentDriveSpot(headerPossessionText, drive, playSpot) {
  if (!playSpot) return false;
  if (!headerPossessionText) return true;
  const startText = normSpotText(drive?.start?.text || drive?.start?.possessionText);
  const headerText = normSpotText(headerPossessionText);
  if (startText && headerText === startText) return true;
  return currentDrivePlayMoved(drive, playSpot);
}
