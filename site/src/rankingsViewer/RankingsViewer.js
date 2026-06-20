import React, { useCallback, useEffect, useMemo, useState } from 'react';
import LoadingState from '../LoadingState';
import PositionBadge from '../PositionBadge';
import {
  buildSourceOptions,
  defaultDirForSortKey,
  defaultSortForSource,
  findSourceOption,
  DEFAULT_SOURCE_ID,
  sourceHasValue,
  SORT_KEYS,
  getYearLabel,
  getValueColumnLabel,
} from './rankingsSources';
import {
  formatKtcValue,
  getKtcHistoricalDateList,
  getYearsForSource,
  loadRankings,
  sourceUsesDate,
  sourceUsesYear,
} from './rankingsViewerLoader';

const SOURCE_GROUPS = buildSourceOptions();
const POSITION_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE'];

function compareRows(a, b, sortKey, sortDir) {
  const mul = sortDir === 'asc' ? 1 : -1;

  if (sortKey === 'name') {
    return mul * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  }

  const av = a[sortKey];
  const bv = b[sortKey];

  if (av == null && bv == null) {
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  }
  if (av == null) return 1;
  if (bv == null) return -1;

  if (typeof av === 'number' && typeof bv === 'number') {
    const diff = mul * (av - bv);
    return diff !== 0 ? diff : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  }

  return mul * String(av).localeCompare(String(bv));
}

function SortArrow({ direction }) {
  return (
    <span className="rv-sort-arrow" aria-hidden="true">
      {direction === 'asc' ? '▲' : '▼'}
    </span>
  );
}

function SortableHeader({ label, sortKey, activeKey, activeDir, onSort, className = '' }) {
  const isActive = activeKey === sortKey;
  return (
    <th
      className={`rv-th rv-th--sortable ${isActive ? 'rv-th--active' : ''} ${className}`.trim()}
      aria-sort={isActive ? (activeDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="rv-sort-btn"
        onClick={() => onSort(sortKey)}
      >
        {label}
        {isActive && <SortArrow direction={activeDir} />}
      </button>
    </th>
  );
}

function formatValue(row) {
  if (row.value == null || row.value === '') return '—';
  if (typeof row.value === 'number' && row.value > 100) {
    return formatKtcValue(row.value);
  }
  if (typeof row.value === 'number') {
    return Number.isInteger(row.value) ? row.value.toString() : row.value.toFixed(1);
  }
  return String(row.value);
}

function RankingsViewer() {
  const [sourceId, setSourceId] = useState(DEFAULT_SOURCE_ID);
  const [year, setYear] = useState('2026');
  const [date, setDate] = useState('');
  const [availableDates, setAvailableDates] = useState([]);
  const [positionFilter, setPositionFilter] = useState('ALL');
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('rank');
  const [sortDir, setSortDir] = useState('asc');

  const sourceOption = useMemo(
    () => findSourceOption(sourceId, SOURCE_GROUPS),
    [sourceId],
  );

  const yearOptions = useMemo(
    () => (sourceOption ? getYearsForSource(sourceOption) : []),
    [sourceOption],
  );

  useEffect(() => {
    const defaults = defaultSortForSource(sourceOption);
    setSortKey(defaults.key);
    setSortDir(defaults.dir);
  }, [sourceId, sourceOption]);

  useEffect(() => {
    if (!sourceOption || !sourceUsesYear(sourceOption)) return;
    const years = getYearsForSource(sourceOption);
    if (years.length && !years.includes(Number(year))) {
      setYear(String(years[years.length - 1]));
    }
  }, [sourceOption, year]);

  useEffect(() => {
    if (!sourceOption || !sourceUsesDate(sourceOption)) {
      setAvailableDates([]);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        const dates = sourceOption.variant
          ? await getKtcHistoricalDateList(sourceOption.variant)
          : [];
        if (cancelled) return;
        setAvailableDates(dates);
        setDate((prev) => {
          if (prev && dates.includes(prev)) return prev;
          return dates[dates.length - 1] || '';
        });
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load KTC dates');
      }
    })();

    return () => { cancelled = true; };
  }, [sourceOption]);

  const loadData = useCallback(async () => {
    if (!sourceOption) return;
    if (sourceUsesDate(sourceOption) && !date) return;

    setLoading(true);
    setError(null);

    try {
      const result = await loadRankings(sourceOption, { year, date });
      setRows(result.rows);
      setMeta(result.meta);
    } catch (err) {
      setRows([]);
      setMeta(null);
      setError(err.message || 'Failed to load rankings');
    } finally {
      setLoading(false);
    }
  }, [sourceOption, year, date]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredRows = useMemo(() => {
    if (positionFilter === 'ALL') return rows;
    return rows.filter((row) => row.position === positionFilter);
  }, [rows, positionFilter]);

  const sortedRows = useMemo(
    () => [...filteredRows].sort((a, b) => compareRows(a, b, sortKey, sortDir)),
    [filteredRows, sortKey, sortDir],
  );

  const hasValue = sourceHasValue(sourceOption);

  const handleSort = useCallback((key) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'));
        return prevKey;
      }
      setSortDir(defaultDirForSortKey(key, sourceOption));
      return key;
    });
  }, [sourceOption]);

  const subtitle = useMemo(() => {
    if (!meta) return '';
    const parts = [meta.sourceLabel];
    if (meta.year) parts.push(`${meta.year} class`);
    if (meta.snapshotLabel) parts.push(meta.snapshotLabel);
    else if (meta.date) parts.push(meta.date);
    if (meta.usedCurrentFallback) {
      parts.push('historical May 20 unavailable for this class');
    }
    if (meta.asOf) parts.push(`as of ${meta.asOf}`);
    if (meta.stitched) parts.push('stitched TE+');
    if (meta.teFallbackCount > 0) {
      parts.push(`${meta.teFallbackCount} TEs w/ non-TEP fallback`);
    }
    if (meta.rowCount != null) parts.push(`${meta.rowCount.toLocaleString()} players`);
    return parts.join(' · ');
  }, [meta]);

  return (
    <div className="rv-root">
      <div className="rv-controls">
        <label className="rv-field">
          <span className="rv-label">Source</span>
          <select
            className="rv-select"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            {SOURCE_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        {sourceUsesYear(sourceOption) && (
          <label className="rv-field">
            <span className="rv-label">{getYearLabel(sourceOption)}</span>
            <select
              className="rv-select rv-select--narrow"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
        )}

        {sourceUsesDate(sourceOption) && (
          <label className="rv-field">
            <span className="rv-label">Date</span>
            <input
              type="date"
              className="rv-input"
              value={date}
              min={availableDates[0] || undefined}
              max={availableDates[availableDates.length - 1] || undefined}
              onChange={(e) => setDate(e.target.value)}
              list="rv-ktc-dates"
            />
            <datalist id="rv-ktc-dates">
              {availableDates.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
        )}

        <label className="rv-field">
          <span className="rv-label">Position</span>
          <select
            className="rv-select rv-select--narrow"
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
          >
            {POSITION_FILTERS.map((pos) => (
              <option key={pos} value={pos}>{pos === 'ALL' ? 'All' : pos}</option>
            ))}
          </select>
        </label>
      </div>

      {subtitle && !error && (
        <p className="rv-meta">{subtitle}</p>
      )}

      {error && (
        <div className="rv-error">{error}</div>
      )}

      {loading ? (
        <LoadingState
          label={
            sourceOption?.kind === 'ktc_rookie' || sourceUsesDate(sourceOption)
              ? 'Loading KTC historical data…'
              : 'Loading rankings…'
          }
          className="rv-loading"
        />
      ) : (
        <div className="rv-table-wrap">
          <table className="rv-table">
            <thead>
              <tr>
                <SortableHeader
                  label={SORT_KEYS.rank}
                  sortKey="rank"
                  activeKey={sortKey}
                  activeDir={sortDir}
                  onSort={handleSort}
                  className="rv-th-rank"
                />
                <SortableHeader
                  label={SORT_KEYS.name}
                  sortKey="name"
                  activeKey={sortKey}
                  activeDir={sortDir}
                  onSort={handleSort}
                />
                <th className="rv-th rv-th-pos">Pos</th>
                <th className="rv-th rv-th-team">Team</th>
                <SortableHeader
                  label={SORT_KEYS.posRank}
                  sortKey="posRank"
                  activeKey={sortKey}
                  activeDir={sortDir}
                  onSort={handleSort}
                  className="rv-th-pos-rank"
                />
                {hasValue ? (
                  <SortableHeader
                    label={getValueColumnLabel(sourceOption)}
                    sortKey="value"
                    activeKey={sortKey}
                    activeDir={sortDir}
                    onSort={handleSort}
                    className="rv-th-value"
                  />
                ) : (
                  <th className="rv-th rv-th-value">{SORT_KEYS.value}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="rv-empty">No players match the current filters.</td>
                </tr>
              ) : (
                sortedRows.map((row, idx) => (
                  <tr key={`${row.rank}-${row.name}-${idx}`} className="rv-row">
                    <td className="rv-td rv-td-rank">{idx + 1}</td>
                    <td className="rv-td rv-td-name">{row.name}</td>
                    <td className="rv-td rv-td-pos">
                      {row.position ? <PositionBadge position={row.position} /> : '—'}
                    </td>
                    <td className="rv-td rv-td-team">{row.team || '—'}</td>
                    <td className="rv-td rv-td-pos-rank">
                      {row.posRank != null ? `${row.position || ''}${row.posRank}` : '—'}
                    </td>
                    <td className="rv-td rv-td-value">{formatValue(row)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default RankingsViewer;
