/**
 * playerDBColumns.js
 *
 * Column definitions for the Ultimate Player DB table.
 *
 * Each column:
 *   key            – matches a field on the enriched player record
 *   label          – header text
 *   sortable       – whether clicking the header sorts by this column
 *   sortFn         – comparator (a, b); null if not sortable
 *   align          – 'left' | 'center' | 'right'
 *   mobileVisible  – false = always hidden on small screens
 *   defaultVisible – false = hidden by default in the column toggle panel
 *   width          – fixed width hint
 *   minWidth       – min-width hint
 *
 * To add a new column: append one object here.
 * Rendering of special cell types is handled in PlayerDBTable.js.
 */

export const PLAYER_DB_COLUMNS = [
  // ── Identity ────────────────────────────────────────────────────────────────
  {
    key: 'name',
    label: 'Player',
    sortable: true,
    sortFn: (a, b) => a.name.localeCompare(b.name),
    align: 'left',
    mobileVisible: true,
    defaultVisible: true,
    minWidth: '180px',
  },
  {
    key: 'position',
    label: 'Pos',
    sortable: true,
    sortFn: (a, b) => a.position.localeCompare(b.position),
    align: 'center',
    mobileVisible: false,
    defaultVisible: true,
    width: '60px',
  },
  {
    key: 'nflTeam',
    label: 'NFL Team',
    sortable: true,
    sortFn: (a, b) => (a.nflTeam || '').localeCompare(b.nflTeam || ''),
    align: 'center',
    mobileVisible: false,
    defaultVisible: true,
    width: '80px',
  },
  {
    key: 'age',
    label: 'Age',
    sortable: true,
    sortFn: (a, b) => (a.age ?? 99) - (b.age ?? 99),
    align: 'center',
    mobileVisible: false,
    defaultVisible: true,
    width: '60px',
  },

  // ── KTC ─────────────────────────────────────────────────────────────────────
  {
    key: 'ktcValue',
    label: 'KTC Val',
    sortable: true,
    sortFn: (a, b) => (b.ktcValue ?? -1) - (a.ktcValue ?? -1),
    align: 'right',
    mobileVisible: true,
    defaultVisible: true,
    width: '90px',
  },
  {
    key: 'ktcRank',
    label: 'KTC Rk',
    sortable: true,
    sortFn: (a, b) => (a.ktcRank ?? 9999) - (b.ktcRank ?? 9999),
    align: 'center',
    mobileVisible: false,
    defaultVisible: true,
    width: '80px',
  },
  {
    key: 'ktcPosRank',
    label: 'KTC Pos Rk',
    sortable: true,
    sortFn: (a, b) => (a.ktcPosRank ?? 9999) - (b.ktcPosRank ?? 9999),
    align: 'center',
    mobileVisible: false,
    defaultVisible: false,
    width: '100px',
  },

  // ── 2025 Stats ──────────────────────────────────────────────────────────────
  {
    key: 'fantasyPoints',
    label: '2025 Pts',
    sortable: true,
    sortFn: (a, b) => (b.fantasyPoints ?? 0) - (a.fantasyPoints ?? 0),
    align: 'right',
    mobileVisible: true,
    defaultVisible: true,
    width: '90px',
  },
  {
    key: 'fantasyPointsPerGame',
    label: 'PPG',
    sortable: true,
    sortFn: (a, b) => (b.fantasyPointsPerGame ?? 0) - (a.fantasyPointsPerGame ?? 0),
    align: 'right',
    mobileVisible: false,
    defaultVisible: true,
    width: '70px',
  },
  {
    key: 'gamesPlayed',
    label: 'GP',
    sortable: true,
    sortFn: (a, b) => (b.gamesPlayed ?? 0) - (a.gamesPlayed ?? 0),
    align: 'center',
    mobileVisible: false,
    defaultVisible: false,
    width: '55px',
  },

  // ── FantasyCalc ──────────────────────────────────────────────────────────────
  {
    key: 'fcValue',
    label: 'FC Val',
    sortable: true,
    sortFn: (a, b) => (b.fcValue ?? -1) - (a.fcValue ?? -1),
    align: 'right',
    mobileVisible: false,
    defaultVisible: true,
    width: '80px',
  },
  {
    key: 'fcRank',
    label: 'FC Rk',
    sortable: true,
    sortFn: (a, b) => (a.fcRank ?? 9999) - (b.fcRank ?? 9999),
    align: 'center',
    mobileVisible: false,
    defaultVisible: false,
    width: '75px',
  },
  {
    key: 'fcPosRank',
    label: 'FC Pos Rk',
    sortable: true,
    sortFn: (a, b) => (a.fcPosRank ?? 9999) - (b.fcPosRank ?? 9999),
    align: 'center',
    mobileVisible: false,
    defaultVisible: false,
    width: '95px',
  },
  {
    key: 'fcTrend30',
    label: 'FC Trend',
    sortable: true,
    sortFn: (a, b) => (b.fcTrend30 ?? 0) - (a.fcTrend30 ?? 0),
    align: 'center',
    mobileVisible: false,
    defaultVisible: true,
    width: '90px',
  },

  // ── FFB ─────────────────────────────────────────────────────────────────────
  {
    key: 'ffbRank',
    label: 'FFB Rk',
    sortable: true,
    sortFn: (a, b) => (a.ffbRank ?? 9999) - (b.ffbRank ?? 9999),
    align: 'center',
    mobileVisible: false,
    defaultVisible: true,
    width: '75px',
  },
  {
    key: 'ffbPosRank',
    label: 'FFB Pos Rk',
    sortable: true,
    sortFn: (a, b) => (a.ffbPosRank ?? 9999) - (b.ffbPosRank ?? 9999),
    align: 'center',
    mobileVisible: false,
    defaultVisible: false,
    width: '100px',
  },

  // ── Fantasy Ownership ────────────────────────────────────────────────────────
  {
    key: 'fantasyTeamName',
    label: 'Fantasy Team',
    sortable: true,
    sortFn: (a, b) =>
      (a.fantasyTeamName || '~').localeCompare(b.fantasyTeamName || '~'),
    align: 'left',
    mobileVisible: false,
    defaultVisible: true,
    minWidth: '120px',
  },
];

export const DEFAULT_SORT_KEY = 'ktcValue';
export const DEFAULT_SORT_DIR = 'desc';

/** Returns initial column visibility state based on defaultVisible flags. */
export function getDefaultColumnVisibility() {
  return Object.fromEntries(
    PLAYER_DB_COLUMNS.map(col => [col.key, col.defaultVisible !== false])
  );
}
