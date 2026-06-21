/**
 * Rankings / value source definitions for the sandbox Rankings Viewer.
 * ADP year lists reflect files present under /data/adp/.
 */

import { HWANG_VALUE_ADJUSTMENTS } from '../lookups/HwangValueAdjustmentLookup';
import { HVORP_VALUE_ADJUSTMENTS } from '../lookups/HvorpValueAdjustmentLookup';

export { HWANG_VALUE_ADJUSTMENTS };

/** Dynasty startup ADP from Dynasty Data Lab (Sleeper draft sample). */
export const DDL_STARTUP_ADP_YEARS = [2021, 2022, 2023, 2024, 2025];

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
    file: '/data/sf_ktc_values_historical.csv',
    datesKey: 'sf_tep',
  },
};

/** Draft classes with May 20 snapshots in SF historical data (2020-04-01 onward). */
export const KTC_ROOKIE_CLASS_YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];

/** Preseason SF TE+ KTC snapshot years (week-1 eve dates in final_ktc_values.csv). */
export const FINAL_KTC_YEARS = [2020, 2021, 2022, 2023, 2024, 2025];

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
    label: 'ADP (Dynasty Data Lab)',
    options: [{
      id: 'ddl_startup_adp',
      label: 'ADP — Dynasty Startup',
      kind: 'ddl_startup_adp',
      defaultYear: DDL_STARTUP_ADP_YEARS[DDL_STARTUP_ADP_YEARS.length - 1],
    }],
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
      {
        id: 'final_ktc_values',
        label: 'Final KTC Values — SF TE+',
        kind: 'final_ktc_values',
      },
    ],
  });

  groups.push({
    label: 'HVORP Values',
    options: [
      {
        id: HVORP_VALUE_ADJUSTMENTS.final_ktc.id,
        label: HVORP_VALUE_ADJUSTMENTS.final_ktc.label,
        kind: 'hvorp_values_empty_roster_final_ktc',
        adjustmentKey: 'final_ktc',
      },
      {
        id: HVORP_VALUE_ADJUSTMENTS.comp_adj_final_ktc.id,
        label: HVORP_VALUE_ADJUSTMENTS.comp_adj_final_ktc.label,
        kind: 'hvorp_values_empty_roster_competitor_adjusted_final_ktc',
        adjustmentKey: 'comp_adj_final_ktc',
      },
    ],
  });

  groups.push({
    label: 'Hwang',
    options: [
      {
        id: 'hwang_market_value_adjusted_ktc',
        label: HWANG_VALUE_ADJUSTMENTS.market.label,
        kind: 'hwang_market_value_adjusted_ktc',
        adjustmentKey: 'market',
      },
      {
        id: 'hwang_true_value_adjusted_ktc',
        label: HWANG_VALUE_ADJUSTMENTS.true.label,
        kind: 'hwang_true_value_adjusted_ktc',
        adjustmentKey: 'true',
      },
      {
        id: 'hwang_adjusted_adp',
        label: 'Hwang Adjusted Positional ADP',
        kind: 'hwang_adjusted_adp',
      },
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

export const REDRAFT_VALUE_INDEX_SOURCE = {
  id: 'ktc_redraft_adjusted',
  label: 'KTC — Competitor Adjusted Value',
  kind: 'ktc_redraft_adjusted',
};

export const REDRAFT_VALUE_INDEX_SOURCE_ID = REDRAFT_VALUE_INDEX_SOURCE.id;

/** Current live index year; prior seasons use final_ktc_redraft_value_index.csv. */
export const REDRAFT_VALUE_INDEX_CURRENT_YEAR = 2026;
export const REDRAFT_VALUE_INDEX_YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];

/** Seasons with best-ball + half + standard ADP for Hwang adjustment. */
export const HWANG_ADP_YEARS = REDRAFT_VALUE_INDEX_YEARS;

export const FINAL_KTC_REDRAFT_SOURCE = {
  id: 'final_ktc_redraft_adjusted',
  label: 'Final KTC — Competitor Adjusted Value',
  kind: 'final_ktc_redraft_adjusted',
};

export function redraftValueIndexUsesHistoricalSeason(year) {
  const yearNum = Number(year);
  return yearNum >= 2020 && yearNum <= 2025;
}

export function resolveRedraftValueIndexSource(year) {
  if (redraftValueIndexUsesHistoricalSeason(year)) {
    return FINAL_KTC_REDRAFT_SOURCE;
  }
  return REDRAFT_VALUE_INDEX_SOURCE;
}

export function getRedraftLookupBlend(year) {
  if (redraftValueIndexUsesHistoricalSeason(year)) {
    return { histWeight: 0.5, seasonWeight: 0.5, seasonLabel: 'Final KTC' };
  }
  return { histWeight: 0.4, seasonWeight: 0.6, seasonLabel: 'Current KTC' };
}

/** Sources with a meaningful numeric value column (KTC, FantasyCalc, ADP avg). */
export function sourceHasValue(sourceOption) {
  if (!sourceOption) return false;
  return ['ktc_current', 'ktc_historical', 'ktc_rookie', 'final_ktc_values', 'ktc_redraft_adjusted', 'final_ktc_redraft_adjusted', 'hvorp_values_empty_roster_final_ktc', 'hvorp_values_empty_roster_competitor_adjusted_final_ktc', 'hwang_market_value_adjusted_ktc', 'hwang_true_value_adjusted_ktc', 'hwang_adjusted_adp', 'fantasycalc', 'adp', 'ddl_startup_adp'].includes(sourceOption.kind);
}

/** Default table sort when a source is selected or data reloads. */
export function defaultSortForSource(sourceOption) {
  if (!sourceOption) return { key: 'rank', dir: 'asc' };
  if (
    sourceOption.kind === 'ktc_current'
    || sourceOption.kind === 'ktc_historical'
    ||     sourceOption.kind === 'ktc_rookie'
    || sourceOption.kind === 'final_ktc_values'
    || sourceOption.kind === 'ktc_redraft_adjusted'
    || sourceOption.kind === 'final_ktc_redraft_adjusted'
    || sourceOption.kind === 'hvorp_values_empty_roster_final_ktc'
    || sourceOption.kind === 'hvorp_values_empty_roster_competitor_adjusted_final_ktc'
    || sourceOption.kind === 'hwang_market_value_adjusted_ktc'
    || sourceOption.kind === 'hwang_true_value_adjusted_ktc'
  ) {
    return { key: 'value', dir: 'desc' };
  }
  if (sourceOption.kind === 'fantasycalc') {
    return { key: 'value', dir: 'desc' };
  }
  if (sourceOption.kind === 'adp' || sourceOption.kind === 'hwang_adjusted_adp' || sourceOption.kind === 'ddl_startup_adp') {
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
  if (key === 'value' || key === 'ktcValue' || key === 'redraftValueIndex' || key === 'rebuildValueIndex' || key === 'rebuilderAdjustedValue') {
    return (sourceOption?.kind === 'adp' || sourceOption?.kind === 'hwang_adjusted_adp' || sourceOption?.kind === 'ddl_startup_adp') ? 'asc' : 'desc';
  }
  if (key === 'adpAvg' || key === 'adpEffRank' || key === 'bbAvgAdp' || key === 'adpDelta' || key === 'scoringRankShift' || key === 'ktcPosRank' || key === 'adpPosRank') {
    return 'asc';
  }
  return 'asc';
}

export function getYearLabel(sourceOption) {
  if (sourceOption?.kind === 'ktc_rookie') return 'Draft class';
  return 'Year';
}

export function getValueColumnLabel(sourceOption) {
  if (sourceOption?.kind === 'ktc_rookie') return 'Rookie Value';
  if (sourceOption?.kind === 'ktc_redraft_adjusted' || sourceOption?.kind === 'final_ktc_redraft_adjusted') return 'Comp';
  if (sourceOption?.kind === 'hwang_adjusted_adp') return 'Hwang ADP';
  if (sourceOption?.kind === 'ddl_startup_adp') return 'Startup ADP';
  if (sourceOption?.kind === 'adp') return 'Avg ADP';
  return SORT_KEYS.value;
}

export function sourceIsRedraftAdjusted(sourceOption) {
  return sourceOption?.kind === 'ktc_redraft_adjusted'
    || sourceOption?.kind === 'final_ktc_redraft_adjusted';
}

export function redraftUsesHwangAdp(adpSource) {
  return (adpSource || '').includes('hwang_adjusted');
}

export function sourceIsHwangAdjusted(sourceOption) {
  return sourceOption?.kind === 'hwang_adjusted_adp';
}
