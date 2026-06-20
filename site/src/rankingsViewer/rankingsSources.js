/**
 * Rankings / value source definitions for the sandbox Rankings Viewer.
 * ADP year lists reflect files present under /data/adp/.
 */

export const ADP_TYPES = {
  overall: {
    label: 'ADP — Overall',
    years: [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
  },
  half: {
    label: 'ADP — Half PPR',
    years: [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
  },
  ppr: {
    label: 'ADP — PPR',
    years: [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
  },
  bestball: {
    label: 'ADP — Best Ball',
    years: [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
  },
};

export const KTC_CURRENT_FORMATS = {
  '1qb': {
    label: 'KTC — 1QB (current)',
    valueKey: 'ktc_value_1qb',
    rankKey: 'rank_1qb',
  },
  sf: {
    label: 'KTC — Superflex (current)',
    valueKey: 'ktc_value_2qb',
    rankKey: 'rank_2qb',
  },
  tep_1qb: {
    label: 'KTC — TE+ 1QB (current)',
    valueKey: 'ktc_value_tep_1qb',
    rankKey: 'rank_tep_1qb',
  },
  tep_sf: {
    label: 'KTC — TE+ Superflex (current)',
    valueKey: 'ktc_value_tep_2qb',
    rankKey: 'rank_tep_2qb',
  },
};

export const KTC_HISTORICAL_VARIANTS = {
  sf_non_tep: {
    label: 'KTC Historical — Superflex (no TEP)',
    file: '/data/sf_non_tep_ktc_values_historical.csv',
    datesKey: 'sf_non_tep',
  },
  sf_tep: {
    label: 'KTC Historical — Superflex TE+',
    file: '/data/sf_tep_ktc_values_historical.csv',
    datesKey: 'sf_tep',
  },
};

/** Draft classes with May 20 snapshots in SF historical data (2020-04-01 onward). */
export const KTC_ROOKIE_CLASS_YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];

export const KTC_ROOKIE_VALUES = {
  sf: {
    label: 'KTC Rookie Values — Superflex',
    variant: 'sf_non_tep',
    snapshotMonth: 5,
    snapshotDay: 20,
  },
};

export const FP_ECR_SOURCES = {
  qb: { label: 'FantasyPros ECR — QB', path: '/data/fantasypros_qb.csv', position: 'QB' },
  rb: { label: 'FantasyPros ECR — RB', path: '/data/fantasypros_rb_std.csv', position: 'RB' },
  wr: { label: 'FantasyPros ECR — WR', path: '/data/fantasypros_wr_std.csv', position: 'WR' },
  te: { label: 'FantasyPros ECR — TE', path: '/data/fantasypros_te_half.csv', position: 'TE' },
  all: { label: 'FantasyPros ECR — All Positions', paths: null, position: null },
};

/** Flat list for the source `<select>` with optgroups applied in the UI. */
export function buildSourceOptions() {
  const groups = [];

  groups.push({
    label: 'ADP (FantasyPros)',
    options: Object.entries(ADP_TYPES).map(([adpType, cfg]) => ({
      id: `adp:${adpType}`,
      label: cfg.label,
      kind: 'adp',
      adpType,
      defaultYear: cfg.years[cfg.years.length - 1],
    })),
  });

  groups.push({
    label: 'KTC (current)',
    options: Object.entries(KTC_CURRENT_FORMATS).map(([format, cfg]) => ({
      id: `ktc:${format}`,
      label: cfg.label,
      kind: 'ktc_current',
      format,
    })),
  });

  groups.push({
    label: 'KTC (historical)',
    options: [
      ...Object.entries(KTC_HISTORICAL_VARIANTS).map(([variant, cfg]) => ({
        id: `ktc_hist:${variant}`,
        label: cfg.label,
        kind: 'ktc_historical',
        variant,
      })),
      ...Object.entries(KTC_ROOKIE_VALUES).map(([key, cfg]) => ({
        id: `ktc_rookie:${key}`,
        label: cfg.label,
        kind: 'ktc_rookie',
        rookieKey: key,
      })),
    ],
  });

  groups.push({
    label: 'Other',
    options: [
      { id: 'fantasycalc', label: 'FantasyCalc Dynasty', kind: 'fantasycalc' },
      { id: 'ffb', label: 'FFB Dynasty Rankings', kind: 'ffb' },
      ...Object.entries(FP_ECR_SOURCES).map(([key, cfg]) => ({
        id: `fp:${key}`,
        label: cfg.label,
        kind: 'fp',
        fpKey: key,
      })),
    ],
  });

  return groups;
}

export function findSourceOption(sourceId, groups = buildSourceOptions()) {
  for (const group of groups) {
    const hit = group.options.find((o) => o.id === sourceId);
    if (hit) return hit;
  }
  return null;
}

export const DEFAULT_SOURCE_ID = 'adp:overall';

/** Sources with a meaningful numeric value column (KTC, FantasyCalc, ADP avg). */
export function sourceHasValue(sourceOption) {
  if (!sourceOption) return false;
  return ['ktc_current', 'ktc_historical', 'ktc_rookie', 'fantasycalc', 'adp'].includes(sourceOption.kind);
}

/** Default table sort when a source is selected or data reloads. */
export function defaultSortForSource(sourceOption) {
  if (!sourceOption) return { key: 'rank', dir: 'asc' };
  if (
    sourceOption.kind === 'ktc_current'
    || sourceOption.kind === 'ktc_historical'
    || sourceOption.kind === 'ktc_rookie'
  ) {
    return { key: 'value', dir: 'desc' };
  }
  if (sourceOption.kind === 'fantasycalc') {
    return { key: 'value', dir: 'desc' };
  }
  if (sourceOption.kind === 'adp') {
    return { key: 'value', dir: 'asc' };
  }
  return { key: 'rank', dir: 'asc' };
}

export const SORT_KEYS = {
  rank: '#',
  name: 'Player',
  posRank: 'Pos #',
  value: 'Value',
};

export function defaultDirForSortKey(key, sourceOption = null) {
  if (key === 'value') {
    return sourceOption?.kind === 'adp' ? 'asc' : 'desc';
  }
  return 'asc';
}

export function getYearLabel(sourceOption) {
  if (sourceOption?.kind === 'ktc_rookie') return 'Draft class';
  return 'Year';
}

export function getValueColumnLabel(sourceOption) {
  if (sourceOption?.kind === 'ktc_rookie') return 'Rookie Value';
  if (sourceOption?.kind === 'adp') return 'Avg ADP';
  return SORT_KEYS.value;
}
