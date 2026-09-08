/**
 * Map Neon fd_drive_odds rows onto the drive-book market shape, and merge
 * them with DraftKings 1st-drive quotes so the UI can show dual books.
 */

const BUCKETS = [
  ['td', 'td_american', 'Offensive Touchdown'],
  ['fg', 'fg_american', 'Field Goal Attempt'],
  ['punt', 'punt_american', 'Punt'],
  ['other', 'other_american', 'Other'],
];

function signedAmerican(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) >= 100000) return null;
  return n;
}

export function fdDriveMarketFromRow(row) {
  if (!row) return null;
  const outcomes = {};
  for (const [key, col, runnerName] of BUCKETS) {
    const american = signedAmerican(row[col]);
    if (american == null) continue;
    outcomes[key] = { american, runnerName, status: 'ACTIVE' };
  }
  if (!Object.keys(outcomes).length) return null;

  const driveN = Number(row.drive_n);
  const offenseName = row.offense_name || null;
  const marketName = row.market_name
    || (Number.isFinite(driveN) && driveN === 1 && offenseName
      ? `1st ${offenseName} Drive Result`
      : (Number.isFinite(driveN) ? `Drive ${driveN} - Result` : 'Drive Result'));

  return {
    marketName,
    marketStatus: row.market_status || 'OPEN',
    outcomes,
    source: 'fd',
    offenseSide: row.offense_side === 'away' || row.offense_side === 'home'
      ? row.offense_side
      : null,
    offenseName,
    driveN: Number.isFinite(driveN) && driveN >= 1 ? driveN : null,
    fetchedAt: row.fetched_at ? new Date(row.fetched_at).toISOString() : null,
  };
}

export function matchingFdDriveRows(game, rows, namesMatch) {
  const list = Array.isArray(rows) ? rows : [];
  const eventId = game?.eventId != null ? String(game.eventId) : '';
  const byId = eventId
    ? list.filter((row) => row?.event_id && String(row.event_id) === eventId)
    : [];
  if (byId.length) return byId;
  return list.filter((row) => (
    typeof namesMatch === 'function'
    && namesMatch(game?.teams?.home, row?.home_team)
    && namesMatch(game?.teams?.away, row?.away_team)
  ));
}

export function fdDriveRowsForGame(game, rows, namesMatch) {
  return matchingFdDriveRows(game, rows, namesMatch).map(fdDriveMarketFromRow).filter(Boolean);
}

function mergeDualMarket(fd, dk) {
  const outcomes = {};
  for (const key of ['td', 'fg', 'punt', 'other']) {
    const f = fd?.outcomes?.[key];
    const d = dk?.outcomes?.[key];
    if (!f && !d) continue;
    const fdAmerican = signedAmerican(f?.american);
    const dkAmerican = signedAmerican(d?.american);
    outcomes[key] = {
      american: fdAmerican ?? dkAmerican,
      runnerName: f?.runnerName || d?.runnerName || null,
      legs: Array.isArray(f?.legs) ? f.legs : (Array.isArray(d?.legs) ? d.legs : null),
      fd: fdAmerican != null ? { american: fdAmerican } : undefined,
      dk: dkAmerican != null ? { american: dkAmerican } : undefined,
    };
  }
  return {
    ...fd,
    source: 'fd',
    marketName: fd?.marketName || dk?.marketName,
    offenseSide: fd?.offenseSide || dk?.offenseSide || null,
    offenseName: fd?.offenseName || dk?.offenseName || null,
    outcomes,
  };
}

function sameDriveSide(a, b) {
  if (a?.offenseSide && b?.offenseSide) return a.offenseSide === b.offenseSide;
  if (a?.offenseName && b?.offenseName) {
    return String(a.offenseName).toLowerCase() === String(b.offenseName).toLowerCase();
  }
  return false;
}

/** Prefer FanDuel rows; fold DK 1st-drive onto the matching side. */
export function mergeFdAndDkMarkets(fdMarkets, dkMarkets) {
  const fd = (fdMarkets || []).filter(Boolean);
  const dk = (dkMarkets || []).filter(Boolean);
  if (!fd.length) return dk;
  if (!dk.length) return fd;

  const used = new Set();
  const out = fd.map((market) => {
    const idx = dk.findIndex((row, i) => !used.has(i) && sameDriveSide(market, row));
    if (idx < 0) return market;
    used.add(idx);
    return mergeDualMarket(market, dk[idx]);
  });
  dk.forEach((row, i) => {
    if (!used.has(i)) out.push(row);
  });
  return out;
}
