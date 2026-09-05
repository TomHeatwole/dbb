/**
 * Compact per-game drives snapshot: best drive result vs the model line.
 */

import { shortTeamName } from '../sop/gameSnapshot';
import { evaluateDriveGame, formatAmericanOdds } from './driveModel';

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
  const q = periodLabel(live?.period);
  const clock = live?.clock && live.clock !== '0:00' ? live.clock : null;
  return [q, clock].filter(Boolean).join(' ') || 'LIVE';
}

const DRIVE_UPCOMING_MS = 6 * 60 * 60 * 1000;

export function isActiveDriveMonitorGame(game, now = Date.now()) {
  if (game?.inPlay) return true;
  if (!game?.nextDrive) return false;
  const kick = Date.parse(game?.openDate ?? '');
  if (!Number.isFinite(kick)) return false;
  return kick <= now + DRIVE_UPCOMING_MS;
}

export function pickHeadlineDrivePlay(model) {
  const candidates = (model?.rows ?? []).filter((row) => (
    Number.isFinite(row.american) && Number.isFinite(row.edgePoints)
  ));
  if (!candidates.length) return null;
  return candidates.reduce((best, cur) => (
    cur.edgePoints > best.edgePoints ? cur : best
  ));
}

function playLabel(row) {
  if (!row) return '—';
  if (row.key === 'td') return 'TD';
  if (row.key === 'fg') return 'FG';
  return row.label ?? '—';
}

export function buildDrivesGameSnapshot(game) {
  const model = evaluateDriveGame(game);
  const play = pickHeadlineDrivePlay(model);
  const book = game?.nextDrive?.source === 'dk' ? 'dk' : 'fd';

  return {
    eventId: game?.eventId,
    name: shortDriveGameName(game),
    fullName: game?.name ?? shortDriveGameName(game),
    score: game?.scoreDisplay ?? '0-0',
    clock: drivesClockLabel(game),
    inPlay: Boolean(game?.inPlay),
    market: playLabel(play),
    oddsBook: play ? book : null,
    oddsAmerican: play?.american ?? null,
    lineLabel: play && Number.isFinite(play.fairAmerican)
      ? `model ${formatAmericanOdds(play.fairAmerican)}`
      : '—',
    edgePoints: play?.edgePoints ?? null,
    profitable: Boolean(play?.profitable),
  };
}

export function buildDrivesMonitorRows(games, now = Date.now()) {
  return (games ?? [])
    .filter((game) => isActiveDriveMonitorGame(game, now))
    .map((game) => buildDrivesGameSnapshot(game));
}
