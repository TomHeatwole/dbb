/**
 * ESPN summary drives → team start counts for FanDuel-style drive numbers.
 *
 * Counts a team's offensive series. Does not count:
 *   - End of Half / End of Game clock stubs
 *   - Kickoff-only rows (0 offensive plays, no series result), including
 *     the post-PAT "current" drive ESPN opens before the return team snaps
 *
 * Louisville @ Ole Miss (401856661), Q3 after Miss TD: ESPN lists 8 LOU
 * rows including a 0:06 kickoff + "End of 2nd quarter" tagged LOU. That
 * is not a Louisville drive. Next LOU series is the 8th.
 */

const CLOCK_STUB = /end of (half|game)/i;
const SERIES_RESULT = /touchdown|field goal|punt|fumble|interception|downs|safety|missed|blocked/i;

export function espnDriveResultName(drive) {
  return String(drive?.result?.displayName || drive?.displayResult || '').trim();
}

export function isClockStubDrive(drive) {
  return CLOCK_STUB.test(espnDriveResultName(drive));
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

export function isInProgressDrive(drive) {
  if (!drive || isClockStubDrive(drive) || isKickoffOnlyDrive(drive)) return false;
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
  const add = (drive) => {
    if (!drive || typeof drive !== 'object') return;
    const id = drive.id != null ? String(drive.id) : null;
    if (id) {
      if (seen.has(id)) return;
      seen.add(id);
    }
    if (!isCountableTeamDrive(drive)) return;
    const side = sideOf(drive);
    if (side === 'home' || side === 'away') started[side] += 1;
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
    currentSide: liveCurrent,
    currentResult,
    finishedSide,
  };
}
