import { CURRENT_YEAR, getCurrentNFLWeek } from '../utils/DateHelper';

/**
 * Active /scores weeks get the Highest Scores vs Highest Projections toggle.
 * Future weeks always rank by projections; past weeks always by actual scores.
 */
export function resolveScoresLineupMode({
  season,
  week,
  isWeekCompleteByGames = false,
  lineupMode = 'scores',
}) {
  const isCurrentSeason = String(season) === String(CURRENT_YEAR);
  const currentWeek = getCurrentNFLWeek();
  const w = Number(week);

  const isActiveWeek =
    isCurrentSeason && w === currentWeek && !isWeekCompleteByGames;

  let effectiveMode;
  if (isCurrentSeason && w > currentWeek) {
    effectiveMode = 'projections';
  } else if (
    !isCurrentSeason
    || w < currentWeek
    || (w === currentWeek && isWeekCompleteByGames)
  ) {
    effectiveMode = 'scores';
  } else {
    effectiveMode = lineupMode === 'projections' ? 'projections' : 'scores';
  }

  return {
    effectiveMode,
    showLineupModeToggle: isActiveWeek,
    isActiveWeek,
  };
}
