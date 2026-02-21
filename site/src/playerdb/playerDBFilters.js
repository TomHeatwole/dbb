/**
 * playerDBFilters.js
 *
 * Filter definitions for the Ultimate Player DB.
 *
 * Each filter:
 *   key          – unique identifier; matches a key in filterState
 *   type         – 'search' | 'select' | 'toggle'
 *   label        – display label (null for the search bar)
 *   defaultValue – initial value
 *   options      – array of string options OR a function (allPlayers) => string[]
 *                  (only for type: 'select')
 *   filterFn     – (player, value) => boolean
 *
 * To add a new filter: append one object to PLAYER_DB_FILTERS.
 * The controls component and page loop over this array automatically.
 */

export const PLAYER_DB_FILTERS = [
  {
    key: 'nameSearch',
    type: 'search',
    label: null,
    defaultValue: '',
    filterFn: (player, value) => {
      if (!value) return true;
      return player.name.toLowerCase().includes(value.toLowerCase());
    },
  },
  {
    key: 'position',
    type: 'select',
    label: 'Position',
    defaultValue: 'ALL',
    options: () => ['ALL', 'QB', 'RB', 'WR', 'TE'],
    filterFn: (player, value) => value === 'ALL' || player.position === value,
  },
  {
    key: 'nflTeam',
    type: 'select',
    label: 'NFL Team',
    defaultValue: 'ALL',
    options: (players) => {
      const teams = [...new Set(players.map(p => p.nflTeam).filter(Boolean))].sort();
      return ['ALL', ...teams];
    },
    filterFn: (player, value) => value === 'ALL' || player.nflTeam === value,
  },
  {
    key: 'fantasyTeam',
    type: 'select',
    label: 'Fantasy Team',
    defaultValue: 'ALL',
    options: (players) => {
      const teams = [
        ...new Set(players.map(p => p.fantasyTeamName).filter(Boolean)),
      ].sort();
      return ['ALL', 'Free Agents', ...teams];
    },
    filterFn: (player, value) => {
      if (value === 'ALL') return true;
      if (value === 'Free Agents') return player.isFreeAgent;
      return player.fantasyTeamName === value;
    },
  },
  {
    key: 'includeNflFreeAgents',
    type: 'toggle',
    label: 'Include NFL Free Agents',
    defaultValue: true,
    filterFn: (player, value) => value || !!player.nflTeam,
  },
];

export function getDefaultFilterState() {
  return Object.fromEntries(PLAYER_DB_FILTERS.map(f => [f.key, f.defaultValue]));
}
