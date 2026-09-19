/**
 * Compact per-game drives snapshot: best drive result vs the model line.
 */

import { shortTeamName } from '../sop/gameSnapshot';
import { driveCardRole, evaluateDriveGame, formatAmericanOdds, formatDriveOrdinal, isHalftimeLive, listDriveSides, resolveOffenseTeam } from './driveModel';

function shortDriveTeam(name) {
  const raw = String(name ?? '')
    .replace(/\s+University$/i, '')
    .replace(/\s+\((OH|OHIO|FL|FLA)\)$/i, ' $1')
    .trim();
  if (!raw) return '';
  if (raw.length <= 16) return raw;
  const parts = raw.split(/\s+/);
  if (parts.length >= 3 && /state/i.test(parts[parts.length - 1])) {
    return `${parts.slice(0, -1).map((p) => p[0]).join('')} St`;
  }
  return shortTeamName(raw);
}

export function shortDriveGameName(game) {
  const home = shortDriveTeam(game?.teams?.home);
  const away = shortDriveTeam(game?.teams?.away);
  if (home && away) return `${away} @ ${home}`;
  const raw = String(game?.name ?? '').trim();
  if (!raw) return '—';
  return raw
    .split(/\s+@\s+|\s+v(?:s\.?)?\s+/i)
    .map((part) => shortDriveTeam(part))
    .join(' @ ');
}

function periodLabel(period) {
  if (!Number.isFinite(period) || period <= 0) return null;
  if (period <= 4) return `Q${period}`;
  return `OT${period - 4}`;
}

function drivesClockLabel(game) {
  const live = game?.live;
  if (!game?.inPlay) return null;
  if (isHalftimeLive(live)) return 'HT';
  const q = periodLabel(live?.period);
  const clock = live?.clock && live.clock !== '0:00' ? live.clock : null;
  return [q, clock].filter(Boolean).join(' ') || 'LIVE';
}

function hasDriveMonitorMarket(game) {
  return Boolean(game?.nextDrive || game?.driveMarkets?.length);
}

function isLocalCalendarDay(ms, nowMs) {
  const a = new Date(ms);
  const b = new Date(nowMs);
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export function isActiveDriveMonitorGame(game, now = Date.now(), { todayOnly = true } = {}) {
  if (game?.inPlay) return true;
  if (!hasDriveMonitorMarket(game)) return false;
  const kick = Date.parse(game?.openDate ?? '');
  if (!Number.isFinite(kick)) return false;
  if (!todayOnly) return true;
  return isLocalCalendarDay(kick, now);
}

export function pickHeadlineDrivePlay(model) {
  const candidates = (model?.rows ?? []).filter((row) => (
    Number.isFinite(row.american)
    && Number.isFinite(row.edgePoints)
    && !row.lineFiltered
  ));
  if (!candidates.length) return null;
  return candidates.reduce((best, cur) => (
    cur.edgePoints > best.edgePoints ? cur : best
  ));
}

function collectDriveViews(game, { granular = false, nextDriveOnly = false } = {}) {
  const markets = listDriveSides(game, { granular });
  const views = markets.length
    ? markets.map((market) => ({ market, model: evaluateDriveGame(game, { market }) }))
    : [{ market: game?.nextDrive ?? null, model: evaluateDriveGame(game) }];
  if (!nextDriveOnly) return views;
  return views.filter((view) => driveCardRole(game, view.model?.pred) !== 'current');
}

export function maxDriveEdgePoints(game, opts = {}) {
  let best = null;
  for (const view of collectDriveViews(game, opts)) {
    const play = pickHeadlineDrivePlay(view.model);
    if (play && Number.isFinite(play.edgePoints) && (best == null || play.edgePoints > best)) {
      best = play.edgePoints;
    }
  }
  return best;
}

export function compareDriveSnapshotRows(a, b) {
  const ae = Number.isFinite(a?.edgePoints) ? a.edgePoints : -Infinity;
  const be = Number.isFinite(b?.edgePoints) ? b.edgePoints : -Infinity;
  if (be !== ae) return be - ae;
  return String(a?.name ?? '').localeCompare(String(b?.name ?? ''));
}

function playLabel(row) {
  if (!row) return '—';
  return row.label ?? '—';
}

export function buildDrivesGameSnapshot(game, { granular = false, nextDriveOnly = false } = {}) {
  const views = collectDriveViews(game, { granular, nextDriveOnly });

  let play = null;
  let market = views[0]?.market ?? null;
  let headline = views[0] ?? null;
  for (const view of views) {
    const candidate = pickHeadlineDrivePlay(view.model);
    if (candidate && (!play || candidate.edgePoints > play.edgePoints)) {
      play = candidate;
      market = view.market;
      headline = view;
    }
  }
  const book = market?.source === 'dk' ? 'dk' : 'fd';
  const team = shortDriveTeam(resolveOffenseTeam(game, market).name);
  const result = playLabel(play);
  const role = driveCardRole(game, headline?.model?.pred);
  const roleWord = role === 'current' ? 'current' : role === 'first' ? '1st' : 'next';
  const ord = formatDriveOrdinal(headline?.model?.driveNumber);
  const marketLabel = team && result !== '—'
    ? `${team} ${result}`
    : (team
      ? [team, role === 'first' ? null : ord, roleWord].filter(Boolean).join(' ')
      : result);

  return {
    eventId: game?.eventId,
    name: shortDriveGameName(game),
    fullName: game?.name ?? shortDriveGameName(game),
    score: game?.scoreDisplay ?? '0-0',
    clock: drivesClockLabel(game),
    inPlay: Boolean(game?.inPlay),
    market: marketLabel,
    oddsBook: play ? book : null,
    oddsAmerican: play?.american ?? null,
    lineLabel: play && Number.isFinite(play.fairAmerican)
      ? `model ${formatAmericanOdds(play.fairAmerican)}`
      : '—',
    role,
    edgePoints: play?.edgePoints ?? null,
    profitable: Boolean(play?.profitable),
    styleWarning: play?.styleWarning ?? null,
  };
}

export function buildDrivesMonitorRows(games, now = Date.now(), opts = {}) {
  const { nextDriveOnly = false, todayOnly = true } = opts;
  return (games ?? [])
    .filter((game) => isActiveDriveMonitorGame(game, now, { todayOnly }))
    .map((game) => buildDrivesGameSnapshot(game, opts))
    .filter((row) => !nextDriveOnly || Number.isFinite(row.oddsAmerican))
    .sort(compareDriveSnapshotRows);
}
