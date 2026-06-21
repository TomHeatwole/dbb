import React, { useEffect, useMemo, useState } from 'react';
import LoadingState from '../LoadingState';
import { POSITIONS } from './computePosValueCompare';
import { computeQbGroundedMultipliers } from './posValueCompareMetrics';
import {
  ANALYSIS_YEARS,
  DEFAULT_DATASET_ID,
  loadPosValueCompareData,
  POS_VALUE_COMPARE_DATASETS,
  TOP_KTC_RANK,
} from './posValueCompareLoader';

function fmtSigned(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

function fmtPctSigned(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function pctClass(value) {
  if (value == null || !Number.isFinite(value)) return '';
  if (value > 0) return 'pvc-pos';
  if (value < 0) return 'pvc-neg';
  return '';
}

function fmtValue(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString();
}

function fmtMultiplier(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(3);
}

function QbGroundedMultipliers({ comparisons, valueColumnLabel }) {
  const grounded = useMemo(
    () => computeQbGroundedMultipliers(comparisons),
    [comparisons],
  );

  const rows = POSITIONS.map((pos) => grounded.byPosition[pos]).filter(Boolean);

  return (
    <div className="pvc-section">
      <h3 className="pvc-section-title">QB-grounded value multipliers</h3>
      <p className="pvc-section-desc">
        Hold QB at 1.0× and scale other positions so matched-pair HVORP aligns with QB scoring.
        Each multiplier is the |Δ|-weighted average of (pos HVORP ÷ QB HVORP) in QB vs pos pairs.
        Apply to {valueColumnLabel} values: e.g. RB 5000 × multiplier → QB-equivalent value.
      </p>
      <div className="pvc-table-wrap">
        <table className="pvc-table">
          <thead>
            <tr>
              <th>Position</th>
              <th className="pvc-th-num">Multiplier</th>
              <th className="pvc-th-num">Avg QB HVORP</th>
              <th className="pvc-th-num">Avg pos HVORP</th>
              <th className="pvc-th-num">Avg Δ (QB − pos)</th>
              <th className="pvc-th-num"># Pairs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.position}>
                <td className="pvc-td-label">{row.position}</td>
                <td className="pvc-td-num pvc-mult">{fmtMultiplier(row.multiplier)}</td>
                <td className="pvc-td-num">
                  {row.position === 'QB' ? '—' : row.avgHvorpQb?.toFixed(1) ?? '—'}
                </td>
                <td className="pvc-td-num">
                  {row.position === 'QB' ? '—' : row.avgHvorpPos?.toFixed(1) ?? '—'}
                </td>
                <td className={`pvc-td-num ${pctClass(row.avgDelta)}`}>
                  {row.position === 'QB' ? '—' : fmtSigned(row.avgDelta)}
                </td>
                <td className="pvc-td-num">
                  {row.pairCount > 0 ? row.pairCount.toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PairSummaryTable({ byPair, title, valueColumnLabel }) {
  const rows = useMemo(() => {
    const list = [];
    for (let i = 0; i < POSITIONS.length; i += 1) {
      for (let j = i + 1; j < POSITIONS.length; j += 1) {
        const key = `${POSITIONS[i]}_vs_${POSITIONS[j]}`;
        const group = byPair[key];
        if (group) list.push(group);
      }
    }
    return list;
  }, [byPair]);

  return (
    <div className="pvc-section">
      {title && <h3 className="pvc-section-title">{title}</h3>}
      <div className="pvc-table-wrap">
        <table className="pvc-table">
          <thead>
            <tr>
              <th>Comparison</th>
              <th className="pvc-th-num">Avg Δ HVORP</th>
              <th className="pvc-th-num">Avg Δ %</th>
              <th className="pvc-th-num"># Pairs</th>
              <th className="pvc-th-note">Interpretation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((group) => (
              <tr key={group.label}>
                <td className="pvc-td-label">{group.label}</td>
                <td className={`pvc-td-num ${pctClass(group.avgDelta)}`}>
                  {fmtSigned(group.avgDelta)}
                </td>
                <td className={`pvc-td-num ${pctClass(group.avgPctDelta)}`}>
                  {fmtPctSigned(group.avgPctDelta)}
                </td>
                <td className="pvc-td-num">{group.count.toLocaleString()}</td>
                <td className="pvc-td-note">
                  {group.avgDelta == null
                    ? 'No matched pairs'
                    : `${group.posA} averaged ${fmtSigned(group.avgDelta)} HVORP (${fmtPctSigned(group.avgPctDelta)} vs ${group.posB}) at similar ${valueColumnLabel}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ComparisonDetails({ comparisons, pairFilter, valueColumnLabel }) {
  const filtered = useMemo(() => {
    const list = pairFilter
      ? comparisons.filter((c) => c.pairKey === pairFilter)
      : comparisons;
    return [...list].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [comparisons, pairFilter]);

  if (filtered.length === 0) {
    return <p className="pvc-empty">No comparisons for this filter.</p>;
  }

  return (
    <div className="pvc-table-wrap pvc-table-wrap--scroll">
      <table className="pvc-table pvc-table--detail">
        <thead>
          <tr>
            <th>Season</th>
            <th>Pair</th>
            <th>{filtered[0]?.posA || 'A'}</th>
            <th>{valueColumnLabel}</th>
            <th>HVORP</th>
            <th>{filtered[0]?.posB || 'B'}</th>
            <th>{valueColumnLabel}</th>
            <th>HVORP</th>
            <th className="pvc-th-num">Δ</th>
            <th className="pvc-th-num">Δ %</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row, idx) => (
            <tr key={`${row.season}-${row.playerA}-${row.playerB}-${idx}`}>
              <td>{row.season ?? '—'}</td>
              <td className="pvc-td-muted">{row.pairKey.replace('_', ' ')}</td>
              <td>{row.playerA}</td>
              <td className="pvc-td-num">{fmtValue(row.valueA)}</td>
              <td className="pvc-td-num">{row.hvorpA.toFixed(1)}</td>
              <td>{row.playerB}</td>
              <td className="pvc-td-num">{fmtValue(row.valueB)}</td>
              <td className="pvc-td-num">{row.hvorpB.toFixed(1)}</td>
              <td className={`pvc-td-num ${pctClass(row.delta)}`}>
                {fmtSigned(row.delta)}
              </td>
              <td className={`pvc-td-num ${pctClass(row.pctDelta)}`}>
                {fmtPctSigned(row.pctDelta)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PosValueCompare() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [valueDataset, setValueDataset] = useState(DEFAULT_DATASET_ID);
  const [selectedSeason, setSelectedSeason] = useState('all');
  const [pairFilter, setPairFilter] = useState('');

  const datasetConfig = POS_VALUE_COMPARE_DATASETS[valueDataset] || POS_VALUE_COMPARE_DATASETS.final_ktc;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await loadPosValueCompareData(valueDataset);
        if (!cancelled) {
          setResults(data);
          setGeneratedAt(data.generatedAt);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load positional value comparison');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [valueDataset]);

  const activeView = useMemo(() => {
    if (!results) return null;
    if (selectedSeason === 'all') {
      return {
        byPair: results.aggregate.byPair,
        comparisons: results.aggregate.comparisons,
        avgDeltaOverall: results.aggregate.avgDeltaOverall,
        avgPctDeltaOverall: results.aggregate.avgPctDeltaOverall,
        totalComparisons: results.aggregate.totalComparisons,
        playersEvaluated: results.seasonResults.reduce((s, r) => s + r.playersEvaluated, 0),
        label: `${ANALYSIS_YEARS[0]}–${ANALYSIS_YEARS[ANALYSIS_YEARS.length - 1]} combined`,
      };
    }
    const seasonResult = results.seasonResults.find((r) => String(r.season) === selectedSeason);
    if (!seasonResult) return null;
    return {
      byPair: seasonResult.byPair,
      comparisons: seasonResult.comparisons.map((c) => ({ ...c, season: seasonResult.season })),
      avgDeltaOverall: seasonResult.avgDeltaOverall,
      avgPctDeltaOverall: seasonResult.avgPctDeltaOverall,
      totalComparisons: seasonResult.totalComparisons,
      playersEvaluated: seasonResult.playersEvaluated,
      label: `${seasonResult.season} (${datasetConfig.label})`,
    };
  }, [results, selectedSeason, datasetConfig.label]);

  const pairOptions = useMemo(() => {
    if (!activeView) return [];
    return Object.values(activeView.byPair)
      .filter((g) => g.count > 0)
      .map((g) => ({ key: `${g.posA}_vs_${g.posB}`, label: g.label }));
  }, [activeView]);

  if (loading) {
    return <LoadingState label="Loading positional value comparison…" className="pvc-loading" />;
  }

  if (error) {
    return <div className="pvc-error">{error}</div>;
  }

  if (!activeView) {
    return <div className="pvc-error">No results available.</div>;
  }

  return (
    <div className="pvc-root">
      <p className="pvc-intro">
        Top {TOP_KTC_RANK} by {datasetConfig.label.toLowerCase()} per year, matched across positions
        (±200 value, min 2% of avg). HVORP on an empty roster. Positive Δ means the first
        position scored more at the same dynasty price. Per-pair Δ % uses symmetric HVORP;
        summary Δ % weights each pair by |Δ HVORP| so elite mismatches count more than depth pairs.
        {generatedAt && (
          <span className="pvc-meta"> Baseline computed {generatedAt.slice(0, 10)}.</span>
        )}
      </p>

      <div className="pvc-controls">
        <label className="pvc-field">
          <span className="pvc-label">Value basis</span>
          <select
            className="pvc-select"
            value={valueDataset}
            onChange={(e) => {
              setValueDataset(e.target.value);
              setSelectedSeason('all');
              setPairFilter('');
            }}
          >
            {Object.values(POS_VALUE_COMPARE_DATASETS).map((ds) => (
              <option key={ds.id} value={ds.id}>{ds.label}</option>
            ))}
          </select>
        </label>

        <label className="pvc-field">
          <span className="pvc-label">Season</span>
          <select
            className="pvc-select"
            value={selectedSeason}
            onChange={(e) => {
              setSelectedSeason(e.target.value);
              setPairFilter('');
            }}
          >
            <option value="all">All seasons ({ANALYSIS_YEARS.join(', ')})</option>
            {ANALYSIS_YEARS.map((year) => (
              <option key={year} value={String(year)}>{year}</option>
            ))}
          </select>
        </label>

        <label className="pvc-field">
          <span className="pvc-label">Position pair</span>
          <select
            className="pvc-select"
            value={pairFilter}
            onChange={(e) => setPairFilter(e.target.value)}
          >
            <option value="">All pairs</option>
            {pairOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="pvc-stats-row">
        <div className="pvc-stat">
          <span className="pvc-stat-label">View</span>
          <span className="pvc-stat-value">{activeView.label}</span>
        </div>
        <div className="pvc-stat">
          <span className="pvc-stat-label">Players scored</span>
          <span className="pvc-stat-value">{activeView.playersEvaluated.toLocaleString()}</span>
        </div>
        <div className="pvc-stat">
          <span className="pvc-stat-label">Value-matched pairs</span>
          <span className="pvc-stat-value">{activeView.totalComparisons.toLocaleString()}</span>
        </div>
        <div className="pvc-stat">
          <span className="pvc-stat-label">Overall avg Δ HVORP</span>
          <span className="pvc-stat-value">{fmtSigned(activeView.avgDeltaOverall)}</span>
        </div>
        <div className="pvc-stat">
          <span className="pvc-stat-label">Overall avg Δ %</span>
          <span className="pvc-stat-value">{fmtPctSigned(activeView.avgPctDeltaOverall)}</span>
        </div>
      </div>

      <PairSummaryTable
        byPair={activeView.byPair}
        title="Summary by position pair"
        valueColumnLabel={datasetConfig.valueColumnLabel}
      />

      <QbGroundedMultipliers
        comparisons={activeView.comparisons}
        valueColumnLabel={datasetConfig.valueColumnLabel}
      />

      <div className="pvc-section">
        <h3 className="pvc-section-title">
          Individual comparisons
          {pairFilter && ` — ${pairFilter.replace('_vs_', ' vs ')}`}
        </h3>
        <ComparisonDetails
          comparisons={activeView.comparisons}
          pairFilter={pairFilter || null}
          valueColumnLabel={datasetConfig.valueColumnLabel}
        />
      </div>
    </div>
  );
}

export default PosValueCompare;
