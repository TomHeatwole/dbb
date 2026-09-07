/**
 * ESPN summary drives → team start counts for FanDuel-style drive numbers.
 *
 * Counts a team's offensive series. Does not count:
 *   - End of Half / End of Game clock stubs
 *   - Kickoff-only rows (0 offensive plays, no series result)
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

export function isInProgressDrive(drive) {
  if (!drive || isClockStubDrive(drive)) return false;
  const result = espnDriveResultName(drive);
  return !result || /in progress/i.test(result);
}

/** Real offensive series, or an in-progress one that has not been result-tagged yet. */
export function isCountableTeamDrive(drive) {
  if (!drive || isClockStubDrive(drive)) return false;
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
  if (!started.home && !started.away && !liveCurrent) return null;
  return {
    homeStarted: started.home,
    awayStarted: started.away,
    currentSide: liveCurrent,
  };
}
