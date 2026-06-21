/** Precomputed positional value compare baselines (top 300, empty roster). */
export const POS_VALUE_COMPARE_DATASETS = {
  final_ktc: {
    id: 'final_ktc',
    label: 'Final KTC',
    basename: 'final_ktc_top300_empty_roster_pos_value_compare',
    datasetId: 'final_ktc_top300_empty_roster',
    valueSource: 'final_ktc_values.csv (preseason SF TE+, top 300 by KTC value)',
    valueColumnLabel: 'KTC',
    hvorpAdjustmentKey: 'final_ktc',
  },
  comp_adj: {
    id: 'comp_adj',
    label: 'Competitor Adjusted Value',
    basename: 'final_ktc_comp_adj_top300_empty_roster_pos_value_compare',
    datasetId: 'final_ktc_comp_adj_top300_empty_roster',
    valueSource: 'final_ktc_redraft_value_index.csv (competitor_adjusted_value, top 300)',
    valueColumnLabel: 'Comp Adj',
    hvorpAdjustmentKey: 'comp_adj_final_ktc',
  },
};

export const DEFAULT_DATASET_ID = 'final_ktc';

export function getPosValueCompareDataset(datasetId = DEFAULT_DATASET_ID) {
  const cfg = POS_VALUE_COMPARE_DATASETS[datasetId];
  if (!cfg) throw new Error(`Unknown pos value compare dataset: ${datasetId}`);
  return cfg;
}

export const DATASET_IDS = Object.keys(POS_VALUE_COMPARE_DATASETS);
