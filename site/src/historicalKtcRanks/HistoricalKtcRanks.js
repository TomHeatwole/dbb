import React, { useCallback, useEffect, useMemo, useState } from 'react';
import LoadingState from '../LoadingState';
import PositionBadge from '../PositionBadge';
import {
  buildRankBoard,
  countGaps,
  defaultDateForYear,
  getDatesForYear,
  getValueNamesForDate,
  loadHistoricalKtcRanksData,
  POSITIONS,
  summarizeCoverage,
} from './historicalKtcRanksLoader';

const VIEW_MODES = [
  { id: 'date', label: 'By date' },
  { id: 'year', label: 'By year' },
];

function formatSlotLabel(row) {
  return row.slotLabel || (row.position && row.positionalRank != null ? `${row.position}${row.positionalRank}` : '—');
}

function RankTable({ title, rows, showValueCoverage }) {
  const gaps = countGaps(rows);

  return (
    <div className="hkr-board">
      <div className="hkr-board-head">
        <h3 className="hkr-board-title">{title}</h3>
        {gaps > 0 && <span className="hkr-board-meta">{gaps} rank slot gap{gaps === 1 ? '' : 's'}</span>}
      </div>
      <div className="hkr-table-wrap">
        <table className="hkr-table">
          <thead>
            <tr>
              <th className="hkr-th hkr-th-slot">Slot</th>
              <th className="hkr-th">Player</th>
              <th className="hkr-th hkr-th-num">Overall</th>
              {showValueCoverage && <th className="hkr-th hkr-th-flag">Values</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = row.kind === 'gap'
                ? `gap-${row.position}-${row.slot}`
                : `${row.name}-${row.slot}`;

              if (row.kind === 'gap') {
                return (
                  <tr key={key} className="hkr-row hkr-row--gap">
                    <td className="hkr-td hkr-td-slot">{formatSlotLabel(row)}</td>
                    <td className="hkr-td hkr-td-gap" colSpan={showValueCoverage ? 3 : 2}>
                      Missing player at this rank slot
                    </td>
                  </tr>
                );
              }

              return (
                <tr
                  key={key}
                  className={[
                    'hkr-row',
                    showValueCoverage && row.inValues === false ? 'hkr-row--missing-value' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <td className="hkr-td hkr-td-slot">{formatSlotLabel(row)}</td>
                  <td className="hkr-td hkr-td-name">
                    <span className="hkr-name">{row.name}</span>
                    <PositionBadge position={row.position} />
                  </td>
                  <td className="hkr-td hkr-td-num">{row.overallRank ?? '—'}</td>
                  {showValueCoverage && (
                    <td className="hkr-td hkr-td-flag">
                      {row.inValues ? '✓' : '—'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoricalKtcRanks() {
  const [data, setData] = useState(null);
  const [valueNames, setValueNames] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [viewMode, setViewMode] = useState('year');
  const [year, setYear] = useState(null);
  const [date, setDate] = useState(null);
  const [position, setPosition] = useState('TE');
  const [showValueCoverage, setShowValueCoverage] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const loaded = await loadHistoricalKtcRanksData();
        if (cancelled) return;
        setData(loaded);
        const latestYear = loaded.years[loaded.years.length - 1];
        setYear(latestYear);
        setDate(loaded.dates[loaded.dates.length - 1]);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load rank history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const yearDates = useMemo(() => {
    if (!data || year == null) return [];
    return getDatesForYear(data.dates, year);
  }, [data, year]);

  useEffect(() => {
    if (!data || year == null || viewMode !== 'year') return;
    const fallback = defaultDateForYear(data.dates, year);
    if (fallback) setDate(fallback);
  }, [data, year, viewMode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!date) return;
      try {
        const names = await getValueNamesForDate(date);
        if (!cancelled) setValueNames(names);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load value coverage');
      }
    })();
    return () => { cancelled = true; };
  }, [date]);

  const rowsForDate = useMemo(() => {
    if (!data || !date) return [];
    return data.byDate.get(date) || [];
  }, [data, date]);

  const board = useMemo(() => {
    if (!rowsForDate.length) return null;
    const valueSet = showValueCoverage ? valueNames : null;
    return buildRankBoard(rowsForDate, position, valueSet);
  }, [rowsForDate, position, valueNames, showValueCoverage]);

  const coverage = useMemo(() => {
    if (!showValueCoverage || !rowsForDate.length) return null;
    return summarizeCoverage(rowsForDate, valueNames);
  }, [rowsForDate, valueNames, showValueCoverage]);

  const handleYearChange = useCallback((nextYear) => {
    setYear(Number(nextYear));
  }, []);

  if (loading) {
    return <LoadingState label="Loading historical KTC rank data…" className="hkr-loading" />;
  }

  if (error) {
    return <div className="hkr-error">{error}</div>;
  }

  if (!data) {
    return <div className="hkr-error">No rank history loaded.</div>;
  }

  return (
    <div className="hkr-root">
      <p className="hkr-intro">
        Positional rank history scraped from KTC profile pages for every player on the dynasty board
        ({data.playerCount} players, {data.recordCount.toLocaleString()} daily rows).
        TE slots use SF TE+ ranks; QB/RB/WR use regular Superflex ranks.
        Gap rows appear when a rank slot has no player (e.g. TE4 missing while TE5 exists).
      </p>

      <div className="hkr-controls">
        <label className="hkr-field">
          <span className="hkr-label">View</span>
          <select
            className="hkr-select"
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value)}
          >
            {VIEW_MODES.map((mode) => (
              <option key={mode.id} value={mode.id}>{mode.label}</option>
            ))}
          </select>
        </label>

        {viewMode === 'year' && (
          <label className="hkr-field">
            <span className="hkr-label">Year</span>
            <select
              className="hkr-select"
              value={year ?? ''}
              onChange={(e) => handleYearChange(e.target.value)}
            >
              {data.years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
        )}

        <label className="hkr-field">
          <span className="hkr-label">Date</span>
          <select
            className="hkr-select hkr-select--date"
            value={date ?? ''}
            onChange={(e) => setDate(e.target.value)}
          >
            {(viewMode === 'year' ? yearDates : data.dates).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>

        <label className="hkr-field">
          <span className="hkr-label">Position</span>
          <select
            className="hkr-select"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
          >
            <option value="ALL">All positions</option>
            {POSITIONS.map((pos) => (
              <option key={pos} value={pos}>{pos}</option>
            ))}
          </select>
        </label>

        <label className="hkr-check">
          <input
            type="checkbox"
            checked={showValueCoverage}
            onChange={(e) => setShowValueCoverage(e.target.checked)}
          />
          Compare to merged value history
        </label>
      </div>

      {coverage && (
        <div className="hkr-stats">
          <div className="hkr-stat">
            <span className="hkr-stat-label">Rank rows</span>
            <span className="hkr-stat-value">{coverage.rankCount}</span>
          </div>
          <div className="hkr-stat">
            <span className="hkr-stat-label">Value rows</span>
            <span className="hkr-stat-value">{coverage.valueCount}</span>
          </div>
          <div className="hkr-stat">
            <span className="hkr-stat-label">In both</span>
            <span className="hkr-stat-value">{coverage.inBoth}</span>
          </div>
          <div className="hkr-stat hkr-stat--warn">
            <span className="hkr-stat-label">Rank only</span>
            <span className="hkr-stat-value">{coverage.ranksOnly}</span>
          </div>
          <div className="hkr-stat hkr-stat--warn">
            <span className="hkr-stat-label">Value only</span>
            <span className="hkr-stat-value">{coverage.valuesOnly}</span>
          </div>
        </div>
      )}

      {!board && (
        <div className="hkr-empty">No rank rows for {date}.</div>
      )}

      {board?.mode === 'all' && board.boards.map((section) => (
        <RankTable
          key={section.position}
          title={section.position}
          rows={section.rows}
          showValueCoverage={showValueCoverage}
        />
      ))}

      {board?.mode !== 'all' && board && (
        <RankTable
          title={`${position} ranks — ${date}`}
          rows={board}
          showValueCoverage={showValueCoverage}
        />
      )}
    </div>
  );
}

export default HistoricalKtcRanks;
