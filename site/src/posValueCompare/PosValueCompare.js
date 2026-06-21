import React, { useEffect, useMemo, useState } from 'react';
import LoadingState from '../LoadingState';
import { POSITIONS } from './computePosValueCompare';
import { ANALYSIS_YEARS, runMultiSeasonPosValueCompare } from './posValueCompareLoader';

function fmtSigned(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

function fmtValue(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString();
}

function PairSummaryTable({ byPair, title }) {
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
              <th className="pvc-th-num"># Pairs</th>
              <th className="pvc-th-note">Interpretation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((group) => (
              <tr key={group.label}>
                <td className="pvc-td-label">{group.label}</td>
                <td className={`pvc-td-num ${group.avgDelta > 0 ? 'pvc-pos' : group.avgDelta < 0 ? 'pvc-neg' : ''}`}>
                  {fmtSigned(group.avgDelta)}
                </td>
                <td className="pvc-td-num">{group.count.toLocaleString()}</td>
                <td className="pvc-td-note">
                  {group.avgDelta == null
                    ? 'No matched pairs'
                    : `${group.posA} averaged ${fmtSigned(group.avgDelta)} HVORP vs ${group.posB} at similar KTC`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ComparisonDetails({ comparisons, pairFilter }) {
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
            <th>KTC</th>
            <th>HVORP</th>
            <th>{filtered[0]?.posB || 'B'}</th>
            <th>KTC</th>
            <th>HVORP</th>
            <th className="pvc-th-num">Δ</th>
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
              <td className={`pvc-td-num ${row.delta > 0 ? 'pvc-pos' : row.delta < 0 ? 'pvc-neg' : ''}`}>
                {fmtSigned(row.delta)}
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
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  const [selectedSeason, setSelectedSeason] = useState('all');
  const [pairFilter, setPairFilter] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await runMultiSeasonPosValueCompare(ANALYSIS_YEARS, (p) => {
          if (!cancelled) setProgress(p);
        });
        if (!cancelled) setResults(data);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to run positional value comparison');
      } finally {
        if (!cancelled) {
          setLoading(false);
          setProgress(null);
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const activeView = useMemo(() => {
    if (!results) return null;
    if (selectedSeason === 'all') {
      return {
        byPair: results.aggregate.byPair,
        comparisons: results.aggregate.comparisons,
        avgDeltaOverall: results.aggregate.avgDeltaOverall,
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
      totalComparisons: seasonResult.totalComparisons,
      playersEvaluated: seasonResult.playersEvaluated,
      label: `${seasonResult.season} preseason KTC`,
    };
  }, [results, selectedSeason]);

  const pairOptions = useMemo(() => {
    if (!activeView) return [];
    return Object.values(activeView.byPair)
      .filter((g) => g.count > 0)
      .map((g) => ({ key: `${g.posA}_vs_${g.posB}`, label: g.label }));
  }, [activeView]);

  if (loading) {
    const label = progress?.year
      ? `Loading ${progress.year} scoring data (${progress.index + 1}/${progress.total})…`
      : 'Running positional value comparison…';
    return <LoadingState label={label} className="pvc-loading" />;
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
        Preseason KTC SF TE+ values matched across positions (±200 KTC, min 2% of avg value).
        HVORP is optimal lineup contribution on an empty roster — positive Δ means the first
        position scored more roster value at the same dynasty price.
      </p>

      <div className="pvc-controls">
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
      </div>

      <PairSummaryTable byPair={activeView.byPair} title="Summary by position pair" />

      <div className="pvc-section">
        <h3 className="pvc-section-title">
          Individual comparisons
          {pairFilter && ` — ${pairFilter.replace('_vs_', ' vs ')}`}
        </h3>
        <ComparisonDetails
          comparisons={activeView.comparisons}
          pairFilter={pairFilter || null}
        />
      </div>
    </div>
  );
}

export default PosValueCompare;
