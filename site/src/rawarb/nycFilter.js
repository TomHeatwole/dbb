import { parseMarketKey } from './marketNormalize.js';

const HOCKEY_SPORTS = new Set(['nhl', 'hockey']);

export function isHockeySport(sport) {
  return HOCKEY_SPORTS.has(sport);
}

function isExtraInnings(row) {
  if (/extra innings?/i.test(String(row?.label ?? ''))) return true;
  const { period, kind, stat } = parseMarketKey(row?.key ?? '');
  return kind === 'yesno' && stat === 'overtime' && period === 'fg';
}

function isMlbAltLine(row) {
  if (!row || (row.kind !== 'total' && row.kind !== 'spread')) return false;
  if (/^alt (?:o\/u|spread)/i.test(String(row.label ?? ''))) return true;
  const { period, kind } = parseMarketKey(row.key);
  return Boolean(row.main && period === 'fg' && (kind === 'total' || kind === 'spread'));
}

/** Markets NY books typically omit — hide when "Filter out NYC" is on. */
export function isNycBlockedExtra(row, game) {
  if (!row || !game) return false;
  if (isHockeySport(game.sport)) return true;
  if (game.sport !== 'mlb') return false;
  if (isExtraInnings(row)) return true;
  return isMlbAltLine(row);
}

export function nycVisibleExtras(game, filterNyc = false) {
  const extras = game?.extras ?? [];
  if (!filterNyc) return extras;
  return extras.filter((row) => !isNycBlockedExtra(row, game));
}
