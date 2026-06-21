import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import LoadingState from '../LoadingState';
import PositionBadge from '../PositionBadge';
import PlayerWeeklyScores from '../players/PlayerWeeklyScores';
import { getPlayerInfo, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { fetchTeamData } from '../lookups/TeamLookup';
import { CURRENT_YEAR } from '../utils/DateHelper';
import RedraftAdjustmentPanel from '../redraftValueIndex/RedraftAdjustmentPanel';
import { RedraftAdjTooltip } from '../redraftValueIndex/redraftValueTooltip';
import {
  buildSourceOptions,
  defaultDirForSortKey,
  defaultSortForSource,
  findSourceOption,
  DEFAULT_SOURCE_ID,
  REDRAFT_VALUE_INDEX_SOURCE_ID,
  REDRAFT_VALUE_INDEX_YEARS,
  REDRAFT_VALUE_INDEX_CURRENT_YEAR,
  resolveRedraftValueIndexSource,
  getRedraftLookupBlend,
  sourceHasValue,
  SORT_KEYS,
  getYearLabel,
  getValueColumnLabel,
  sourceIsRedraftAdjusted,
  sourceIsHwangAdjusted,
  redraftUsesHwangAdp,
} from './rankingsSources';
import { HwangAdpTooltip } from './hwangAdpTooltip';
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

function formatKtcNumber(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return formatKtcValue(value);
}

function formatPosRankSlot(position, rank) {
  if (!position || rank == null) return '—';
  return `${position}${rank}`;
}

function formatPosAdpRank(position, rank) {
  if (!position || rank == null) return '—';
  return `${position}${rank}`;
}

function formatAdjustedAdpRank(row) {
  const { position, adpEffRank, adpPosRank } = row;
  if (!position) return '—';
  if (adpEffRank != null) return `${position}${adpEffRank.toFixed(2)}`;
  if (adpPosRank != null) return `${position}${adpPosRank}`;
  return '—';
}

function formatOvrAdp(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(1);
}

function formatRedraftIndex(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}×`;
}

function formatAdpDelta(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) < 0.05) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}`;
}

function indexClassName(value) {
  if (value == null || !Number.isFinite(value)) return '';
  if (value > 1.005) return 'rv-td-index rv-td-index--up';
  if (value < 0.995) return 'rv-td-index rv-td-index--down';
  return 'rv-td-index rv-td-index--flat';
}

function resolveSleeperId(row, playersData) {
  if (row.sleeperId) return row.sleeperId;
  if (!playersData || !row.name) return null;

  const nameLower = row.name.toLowerCase();
  const exact = Object.keys(playersData).find((id) => {
    const p = playersData[id];
    return (p.full_name || '').toLowerCase() === nameLower;
  });
  if (exact) return exact;

  if (row.position) {
    return Object.keys(playersData).find((id) => {
      const p = playersData[id];
      if ((p.full_name || '').toLowerCase() !== nameLower) return false;
      const pos = p.position || (p.fantasy_positions && p.fantasy_positions[0]) || '';
      return pos === row.position;
    }) || null;
  }

  return null;
}

function RankingsViewer({ fixedSourceId = null }) {
  const isRedraftValueIndexMode = fixedSourceId === REDRAFT_VALUE_INDEX_SOURCE_ID;
  const [sourceId, setSourceId] = useState(fixedSourceId || DEFAULT_SOURCE_ID);
  const [year, setYear] = useState(String(REDRAFT_VALUE_INDEX_CURRENT_YEAR));
  const [date, setDate] = useState('');
  const [availableDates, setAvailableDates] = useState([]);
  const [positionFilter, setPositionFilter] = useState('ALL');
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('rank');
  const [sortDir, setSortDir] = useState('asc');
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [selectedRedraftRow, setSelectedRedraftRow] = useState(null);
  const [rankLookup, setRankLookup] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [rosters, setRosters] = useState(null);
  const [users, setUsers] = useState(null);

  const sourceOption = useMemo(() => {
    if (isRedraftValueIndexMode) {
      return resolveRedraftValueIndexSource(year);
    }
    if (fixedSourceId) {
      return findSourceOption(fixedSourceId, SOURCE_GROUPS);
    }
    return findSourceOption(sourceId, SOURCE_GROUPS);
  }, [isRedraftValueIndexMode, fixedSourceId, sourceId, year]);

  const redraftLookupBlend = useMemo(
    () => (isRedraftValueIndexMode ? getRedraftLookupBlend(year) : getRedraftLookupBlend(REDRAFT_VALUE_INDEX_CURRENT_YEAR)),
    [isRedraftValueIndexMode, year],
  );

  const yearOptions = useMemo(() => {
    if (isRedraftValueIndexMode) return REDRAFT_VALUE_INDEX_YEARS;
    return sourceOption ? getYearsForSource(sourceOption) : [];
  }, [isRedraftValueIndexMode, sourceOption]);

  useEffect(() => {
    if (!fixedSourceId && !sourceOption) return;
    if (!fixedSourceId || isRedraftValueIndexMode) {
      const defaults = defaultSortForSource(sourceOption);
      setSortKey(defaults.key);
      setSortDir(defaults.dir);
      return;
    }
    const defaults = defaultSortForSource(sourceOption);
    setSortKey(defaults.key);
    setSortDir(defaults.dir);
  }, [sourceId, sourceOption, fixedSourceId, isRedraftValueIndexMode]);

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
      if (sourceIsRedraftAdjusted(sourceOption)) {
        setRankLookup(result.meta?.rankLookup ?? null);
      } else {
        setRankLookup(null);
        setSelectedRedraftRow(null);
      }
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

  useEffect(() => {
    setSelectedRedraftRow(null);
  }, [year, sourceOption?.kind]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/data/players.txt').then((res) => (res.ok ? res.json() : null)),
      fetchPlayerIdMap(),
      fetchTeamData(CURRENT_YEAR),
    ])
      .then(([players, idMap, teamData]) => {
        if (cancelled) return;
        setPlayersData(players);
        setPlayerIdMap(idMap);
        setRosters(teamData?.rosters ?? null);
        setUsers(teamData?.users ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setPlayersData(null);
          setPlayerIdMap(null);
          setRosters(null);
          setUsers(null);
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        if (selectedRedraftRow) setSelectedRedraftRow(null);
        else setSelectedPlayer(null);
      }
    }
    if (selectedPlayer || selectedRedraftRow) {
      document.addEventListener('keydown', onKeyDown);
    }
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedPlayer, selectedRedraftRow]);

  useEffect(() => {
    if (selectedPlayer) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => document.body.classList.remove('modal-open');
  }, [selectedPlayer]);

  const handlePlayerClick = useCallback((row) => {
    if (sourceIsRedraftAdjusted(sourceOption)) {
      setSelectedRedraftRow((prev) => (
        prev?.name === row.name && prev?.position === row.position ? null : row
      ));
      return;
    }

    if (!playersData) return;

    const sleeperId = resolveSleeperId(row, playersData);
    if (sleeperId) {
      const info = getPlayerInfo(sleeperId, playersData, playerIdMap);
      if (info) {
        setSelectedPlayer(info);
        return;
      }
    }

    setSelectedPlayer({
      player_id: sleeperId || undefined,
      full_name: row.name,
      name: row.name,
      position: row.position,
      team: row.team,
    });
  }, [playersData, playerIdMap, sourceOption]);

  const handleCloseModal = useCallback(() => setSelectedPlayer(null), []);

  const filteredRows = useMemo(() => {
    if (positionFilter === 'ALL') return rows;
    return rows.filter((row) => row.position === positionFilter);
  }, [rows, positionFilter]);

  const sortedRows = useMemo(
    () => [...filteredRows].sort((a, b) => compareRows(a, b, sortKey, sortDir)),
    [filteredRows, sortKey, sortDir],
  );

  const hasValue = sourceHasValue(sourceOption);
  const isRedraftAdjusted = sourceIsRedraftAdjusted(sourceOption);
  const isHwangAdjusted = sourceIsHwangAdjusted(sourceOption);
  const redraftHwangAdp = isRedraftAdjusted && redraftUsesHwangAdp(meta?.adpSource);
  const colCount = isRedraftAdjusted ? (redraftHwangAdp ? 15 : 14) : (isHwangAdjusted ? 8 : 6);

  const handleSort = useCallback((key) => {
    if (sortKey === key) {
      setSortDir((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(defaultDirForSortKey(key, sourceOption));
  }, [sortKey, sourceOption]);

  const playerModal = !isRedraftAdjusted && selectedPlayer ? (
    <div className="player-modal-overlay" onClick={handleCloseModal}>
      <div
        className="player-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <PlayerWeeklyScores
          player={selectedPlayer}
          onClose={handleCloseModal}
          rosters={rosters}
          users={users}
        />
      </div>
    </div>
  ) : null;

  const subtitle = useMemo(() => {
    if (!meta) return '';
    const parts = [isRedraftValueIndexMode ? 'Redraft Value Index' : meta.sourceLabel];
    if (meta.year && sourceOption?.kind === 'ktc_rookie') parts.push(`${meta.year} class`);
    else if (meta.year && !meta.snapshotLabel) parts.push(String(meta.year));
    if (meta.snapshotLabel) parts.push(meta.snapshotLabel);
    else if (meta.date) parts.push(meta.date);
    if (meta.usedCurrentFallback) {
      parts.push('historical May 20 unavailable for this class');
    }
    if (meta.asOf) parts.push(`as of ${meta.asOf}`);
    if (meta.adpSource) parts.push(`via ${meta.adpSource.replace(/_/g, ' ')}`);
    if (meta.scoringSource) parts.push(`shift from ${meta.scoringSource.replace(/_/g, ' ')}`);
    if (meta.premiumRetention != null) {
      parts.push(`λ=${meta.premiumRetention}`);
    }
    if (meta.stitched) parts.push('stitched TE+');
    if (meta.adjustmentSummary) parts.push(meta.adjustmentSummary);
    if (meta.teFallbackCount > 0) {
      parts.push(`${meta.teFallbackCount} TEs w/ non-TEP fallback`);
    }
    if (meta.rowCount != null) parts.push(`${meta.rowCount.toLocaleString()} players`);
    return parts.join(' · ');
  }, [meta, sourceOption, isRedraftValueIndexMode]);

  return (
    <div className={`rv-root${isRedraftAdjusted ? ' rv-root--redraft' : ''}`}>
      <div className="rv-controls">
        {!fixedSourceId && (
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
        )}

        {(!fixedSourceId && sourceUsesYear(sourceOption)) || isRedraftValueIndexMode ? (
          <label className="rv-field">
            <span className="rv-label">{isRedraftValueIndexMode ? 'Season' : getYearLabel(sourceOption)}</span>
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
        ) : null}

        {!fixedSourceId && sourceUsesDate(sourceOption) && (
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
            sourceOption?.kind === 'ktc_rookie'
              || sourceOption?.kind === 'final_ktc_values'
              || sourceOption?.kind === 'final_ktc_redraft_adjusted'
              || sourceUsesDate(sourceOption)
              ? 'Loading KTC historical data…'
              : 'Loading rankings…'
          }
          className="rv-loading"
        />
      ) : (
        <>
          {isRedraftAdjusted && (
            <p className="rv-hint">
              Click a row for rank lookup math. Hwang ADP = half→standard RB/WR correction on best ball.
            </p>
          )}
          <div className={isRedraftAdjusted && selectedRedraftRow ? 'rv-redraft-layout' : undefined}>
            <div className="rv-table-wrap">
              <table className={`rv-table${isRedraftAdjusted ? ' rv-table--redraft' : ''}`}>
            {isRedraftAdjusted && (
              <colgroup>
                <col className="rv-col-rank" />
                <col className="rv-col-name" />
                <col className="rv-col-pos" />
                <col className="rv-col-team" />
                <col className="rv-col-num" span={redraftHwangAdp ? 11 : 10} />
              </colgroup>
            )}
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
                  className="rv-th-name"
                />
                <th className="rv-th rv-th-pos">Pos</th>
                <th className="rv-th rv-th-team">Team</th>
                {!isRedraftAdjusted && !isHwangAdjusted && (
                  <SortableHeader
                    label={SORT_KEYS.posRank}
                    sortKey="posRank"
                    activeKey={sortKey}
                    activeDir={sortDir}
                    onSort={handleSort}
                    className="rv-th-pos-rank"
                  />
                )}
                {isHwangAdjusted && (
                  <>
                    <SortableHeader
                      label="Pos ADP"
                      sortKey="posRank"
                      activeKey={sortKey}
                      activeDir={sortDir}
                      onSort={handleSort}
                      className="rv-th-pos-rank"
                    />
                    <SortableHeader
                      label="Best Ball ADP"
                      sortKey="bbAvgAdp"
                      activeKey={sortKey}
                      activeDir={sortDir}
                      onSort={handleSort}
                      className="rv-th-ovr-adp"
                    />
                    <SortableHeader
                      label="Δ ADP"
                      sortKey="adpDelta"
                      activeKey={sortKey}
                      activeDir={sortDir}
                      onSort={handleSort}
                      className="rv-th-adp-delta"
                    />
                  </>
                )}
                {isRedraftAdjusted && (
                  <>
                    <SortableHeader
                      label="Adj Rank"
                      sortKey="posRank"
                      activeKey={sortKey}
                      activeDir={sortDir}
                      onSort={handleSort}
                      className="rv-th-pos-rank"
                    />
                    <SortableHeader
                      label="KTC Rank"
                      sortKey="ktcPosRank"
                      activeKey={sortKey}
                      activeDir={sortDir}
                      onSort={handleSort}
                      className="rv-th-ktc-rank"
                    />
                    <SortableHeader
                      label="Pos ADP"
                      sortKey="adpPosRank"
                      activeKey={sortKey}
                      activeDir={sortDir}
                      onSort={handleSort}
                      className="rv-th-pos-adp"
                    />
                    <SortableHeader
                      label="Eff ADP"
                      sortKey="adpEffRank"
                      activeKey={sortKey}
                      activeDir={sortDir}
                      onSort={handleSort}
                      className="rv-th-adj-adp"
                    />
                    {redraftHwangAdp && (
                      <SortableHeader
                        label="BB ADP"
                        sortKey="bbAvgAdp"
                        activeKey={sortKey}
                        activeDir={sortDir}
                        onSort={handleSort}
                        className="rv-th-bb-adp"
                      />
                    )}
                    <SortableHeader
                      label={redraftHwangAdp ? 'Hwang ADP' : 'OVR ADP'}
                      sortKey="adpAvg"
                      activeKey={sortKey}
                      activeDir={sortDir}
                      onSort={handleSort}
                      className="rv-th-ovr-adp"
                    />
                    <SortableHeader
                      label="Dynasty"
                      sortKey="ktcValue"
                      activeKey={sortKey}
                      activeDir={sortDir}
                      onSort={handleSort}
                      className="rv-th-dynasty"
                    />
                  </>
                )}
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
                {isRedraftAdjusted && (
                  <>
                    <SortableHeader
                      label="Redraft Idx"
                      sortKey="redraftValueIndex"
                      activeKey={sortKey}
                      activeDir={sortDir}
                      onSort={handleSort}
                      className="rv-th-index"
                    />
                    <SortableHeader
                      label="Rebuild Val"
                      sortKey="rebuilderAdjustedValue"
                      activeKey={sortKey}
                      activeDir={sortDir}
                      onSort={handleSort}
                      className="rv-th-rebuilder"
                    />
                    <SortableHeader
                      label="Rebuild Idx"
                      sortKey="rebuildValueIndex"
                      activeKey={sortKey}
                      activeDir={sortDir}
                      onSort={handleSort}
                      className="rv-th-rebuild-index"
                    />
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="rv-empty">No players match the current filters.</td>
                </tr>
              ) : (
                sortedRows.map((row, idx) => {
                  const isSelected = isRedraftAdjusted
                    && selectedRedraftRow?.name === row.name
                    && selectedRedraftRow?.position === row.position;
                  return (
                  <tr
                    key={`${row.rank}-${row.name}-${idx}`}
                    className={`rv-row player-clickable${isSelected ? ' rv-row--selected' : ''}`}
                    onClick={() => handlePlayerClick(row)}
                    role={isRedraftAdjusted ? 'button' : undefined}
                    tabIndex={isRedraftAdjusted ? 0 : undefined}
                    onKeyDown={isRedraftAdjusted ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handlePlayerClick(row);
                      }
                    } : undefined}
                  >
                    <td className="rv-td rv-td-rank">
                      {isRedraftAdjusted ? (row.rank ?? '—') : (idx + 1)}
                    </td>
                    <td className="rv-td rv-td-name" title={row.name}>{row.name}</td>
                    <td className="rv-td rv-td-pos">
                      {row.position ? <PositionBadge position={row.position} /> : '—'}
                    </td>
                    <td className="rv-td rv-td-team">{row.team || '—'}</td>
                    {!isRedraftAdjusted && !isHwangAdjusted && (
                      <td className="rv-td rv-td-pos-rank">
                        {row.posRank != null ? `${row.position || ''}${row.posRank}` : '—'}
                      </td>
                    )}
                    {isHwangAdjusted && (
                      <>
                        <td className="rv-td rv-td-pos-rank">
                          {formatPosAdpRank(row.position, row.posRank)}
                        </td>
                        <td className="rv-td rv-td-ovr-adp">{formatOvrAdp(row.bbAvgAdp)}</td>
                        <td className="rv-td rv-td-adp-delta">
                          <HwangAdpTooltip row={row}>
                            {formatAdpDelta(row.adpDelta)}
                          </HwangAdpTooltip>
                        </td>
                      </>
                    )}
                    {isRedraftAdjusted && (
                      <>
                        <td className="rv-td rv-td-pos-rank">
                          {formatPosRankSlot(row.position, row.posRank)}
                        </td>
                        <td className="rv-td rv-td-ktc-rank">
                          {formatPosRankSlot(row.position, row.ktcPosRank)}
                        </td>
                        <td className="rv-td rv-td-pos-adp">
                          {formatPosRankSlot(row.position, row.adpPosRank)}
                        </td>
                        <td className="rv-td rv-td-adj-adp">{formatAdjustedAdpRank(row)}</td>
                        {redraftHwangAdp && (
                          <td className="rv-td rv-td-bb-adp">{formatOvrAdp(row.bbAvgAdp)}</td>
                        )}
                        <td className="rv-td rv-td-ovr-adp">{formatOvrAdp(row.adpAvg)}</td>
                        <td className="rv-td rv-td-dynasty">{formatKtcNumber(row.ktcValue)}</td>
                      </>
                    )}
                    <td className="rv-td rv-td-value">
                      {isRedraftAdjusted ? (
                        <RedraftAdjTooltip kind="comp" entry={row} usesHwangAdp={redraftHwangAdp}>
                          {formatKtcNumber(row.value)}
                        </RedraftAdjTooltip>
                      ) : isHwangAdjusted ? (
                        <HwangAdpTooltip row={row}>
                          {formatValue(row)}
                        </HwangAdpTooltip>
                      ) : (
                        formatValue(row)
                      )}
                    </td>
                    {isRedraftAdjusted && (
                      <>
                        <td className={`rv-td ${indexClassName(row.redraftValueIndex)}`}>
                          <RedraftAdjTooltip kind="comp" entry={row} usesHwangAdp={redraftHwangAdp}>
                            {formatRedraftIndex(row.redraftValueIndex)}
                          </RedraftAdjTooltip>
                        </td>
                        <td className="rv-td rv-td-rebuilder">
                          <RedraftAdjTooltip kind="rebuild" entry={row} usesHwangAdp={redraftHwangAdp}>
                            {formatKtcNumber(row.rebuilderAdjustedValue)}
                          </RedraftAdjTooltip>
                        </td>
                        <td className={`rv-td ${indexClassName(row.rebuildValueIndex)}`}>
                          <RedraftAdjTooltip kind="rebuild" entry={row} usesHwangAdp={redraftHwangAdp}>
                            {formatRedraftIndex(row.rebuildValueIndex)}
                          </RedraftAdjTooltip>
                        </td>
                      </>
                    )}
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
            </div>
            {isRedraftAdjusted && selectedRedraftRow && (
              <RedraftAdjustmentPanel
                row={selectedRedraftRow}
                lookupMap={rankLookup}
                usesHwangAdp={redraftHwangAdp}
                lookupBlend={redraftLookupBlend}
              />
            )}
          </div>
        </>
      )}
      {playerModal && createPortal(playerModal, document.body)}
    </div>
  );
}

export default RankingsViewer;
