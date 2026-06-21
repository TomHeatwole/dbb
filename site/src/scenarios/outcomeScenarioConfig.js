import { PREVIOUS_YEARS } from '../utils/global_constants';
import { getCurrentYear } from '../utils/DateHelper';

/** Seasons available for Future Scenarios v2 and the Season Simulator. */
export const OUTCOME_SCENARIO_YEARS = [
  getCurrentYear(),
  ...Object.keys(PREVIOUS_YEARS || {}),
]
  .filter((y, idx, arr) => arr.indexOf(y) === idx)
  .sort((a, b) => Number(b) - Number(a));

export const DEFAULT_OUTCOME_SCENARIO_YEAR = getCurrentYear();

export function normalizeOutcomeScenarioYear(year) {
  const y = String(year || DEFAULT_OUTCOME_SCENARIO_YEAR);
  return OUTCOME_SCENARIO_YEARS.includes(y) ? y : DEFAULT_OUTCOME_SCENARIO_YEAR;
}
