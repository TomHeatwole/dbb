import React, { useEffect, useMemo, useState } from 'react';
import LoadingState from '../LoadingState';
import PositionBadge from '../PositionBadge';
import { formatKtcValue } from '../lookups/KtcLookup';
import {
  buildAdpSlotBoard,
  buildFilledSlotBoard,
  buildKtcSlotBoard,
  buildRankIndex,
  buildSideBySideRows,
  buildStartupAdpIndex,
  countGaps,
  DATA_MODES,
  FILL_SOURCE_LABELS,
  formatDayOffset,
  formatFillMetadata,
  getFilledMetadataForSnapshot,
  getFilledRowsForSnapshot,
  getSnapshotTargetDate,
  getStartupAdpRows,
  getStartupAdpSeason,
  loadHistoricalKtcRanksData,
  MAX_FALLBACK_DAYS,
  POSITIONS,
  resolveRankRowsForSnapshot,
  SNAPSHOT_TYPES,
  summarizeCompareCoverage,
  summarizeFilledCoverage,
  summarizeSnapshotCoverage,
} from './historicalKtcRanksLoader';

const SORT_MODES = [
  { id: 'ktc', label: 'KTC Historical slot' },
  { id: 'adp', label: 'Startup ADP slot' },
];

function formatAdpOvr(adp) {
  if (adp == null || !Number.isFinite(adp)) return '—';
  return adp.toFixed(2);
}

function ValueCell({ row, targetDate }) {
  if (row.ktcValue == null) {
    return <span className="hkr-value-missing">—</span>;
  }

  const offsetLabel = formatDayOffset(row.valueDayOffset);
  const showDateHint = row.valueDate && row.valueDate !== targetDate;

  return (
    <span className="hkr-value-wrap">
      <span className="hkr-value">{formatKtcValue(row.ktcValue)}</span>
      {showDateHint && (
        <span className="hkr-value-sub" title={`Value from ${row.valueDate}`}>
          {offsetLabel || row.valueDate}
        </span>
      )}
    </span>
  );
}

function FillSourceTag({ fillSource }) {
  if (!fillSource || fillSource === 'historical') {
    return <span className="hkr-tag hkr-tag--historical">Historical</span>;
  }
  if (fillSource === 'adp') {
    return <span className="hkr-tag hkr-tag--adp-fill">ADP fill</span>;
  }
  if (fillSource === 'unknown') {
    return <span className="hkr-tag hkr-tag--unknown">Unknown</span>;
  }
  return <span className="hkr-tag">{fillSource}</span>;
}

function PlayerCell({ row, showAdpOnlyTag = true, showFillSource = false }) {
  if (row.kind === 'gap' || !row.name) {
    return <span className="hkr-value-missing">—</span>;
  }
  return (
    <>
      <span className="hkr-name">{row.name}</span>
      <PositionBadge position={row.position} />
      {showFillSource && row.fillSource && (
        <FillSourceTag fillSource={row.fillSource} />
      )}
      {showAdpOnlyTag && row.inKtcRanks === false && !showFillSource && (
        <span className="hkr-tag hkr-tag--adp-only">ADP only</span>
      )}
    </>
  );
}

function UnifiedRankTable({
  title,
  rows,
  targetDate,
  rankDayOffset,
  rankResolvedDate,
  sortMode,
  showFillMeta = false,
  resolvedDate = null,
}) {
  const gaps = countGaps(rows);

  return (
    <div className="hkr-board">
      <div className="hkr-board-head">
        <h3 className="hkr-board-title">{title}</h3>
        {gaps > 0 && sortMode === 'ktc' && !showFillMeta && (
          <span className="hkr-board-meta">
            {gaps} KTC rank slot gap{gaps === 1 ? '' : 's'}
          </span>
        )}
        {rankDayOffset !== 0 && rankResolvedDate && sortMode === 'ktc' && !showFillMeta && (
          <span className="hkr-board-meta">
            Ranks from {rankResolvedDate} ({formatDayOffset(rankDayOffset)})
          </span>
        )}
        {showFillMeta && resolvedDate && resolvedDate !== targetDate && (
          <span className="hkr-board-meta">
            Resolved date {resolvedDate}
          </span>
        )}
      </div>
      <div className="hkr-table-wrap">
        <table className="hkr-table">
          <thead>
            <tr>
              <th className="hkr-th hkr-th-slot">KTC slot</th>
              <th className="hkr-th">Player</th>
              {showFillMeta && <th className="hkr-th">Fill detail</th>}
              <th className="hkr-th hkr-th-num">KTC OVR</th>
              <th className="hkr-th hkr-th-num">KTC Value</th>
              <th className="hkr-th hkr-th-num">Startup ADP OVR</th>
              <th className="hkr-th hkr-th-slot">Startup ADP slot</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = row.kind === 'gap'
                ? `gap-${row.position}-${row.slot}`
                : `${row.name}-${row.slot}-${sortMode}`;

              if (row.kind === 'gap') {
                return (
                  <tr key={key} className="hkr-row hkr-row--gap">
                    <td className="hkr-td hkr-td-slot">
                      {row.ktcHistoricalSlotLabel || row.slotLabel}
                    </td>
                    <td className="hkr-td hkr-td-gap" colSpan={showFillMeta ? 6 : 5}>
                      {sortMode === 'ktc'
                        ? 'Missing player at this KTC rank slot'
                        : 'Missing player at this ADP rank slot'}
                    </td>
                  </tr>
                );
              }

              const rowClass = [
                'hkr-row',
                showFillMeta && row.fillSource === 'adp' ? 'hkr-row--filled-adp' : '',
                showFillMeta && row.fillSource === 'unknown' ? 'hkr-row--filled-unknown' : '',
                !showFillMeta && row.ktcValue == null && row.inKtcRanks !== false ? 'hkr-row--missing-value' : '',
                !showFillMeta && row.inKtcRanks === false ? 'hkr-row--adp-only' : '',
              ].filter(Boolean).join(' ');

              return (
                <tr key={key} className={rowClass}>
                  <td className="hkr-td hkr-td-slot">
                    {row.ktcHistoricalSlotLabel || row.slotLabel || '—'}
                  </td>
                  <td className="hkr-td hkr-td-name">
                    <PlayerCell row={row} showFillSource={showFillMeta} />
                  </td>
                  {showFillMeta && (
                    <td className="hkr-td hkr-td-fill-detail" title={formatFillMetadata(row.fillMeta)}>
                      {formatFillMetadata(row.fillMeta)}
                    </td>
                  )}
                  <td className="hkr-td hkr-td-num">{row.overallRank ?? '—'}</td>
                  <td className="hkr-td hkr-td-num">
                    <ValueCell row={row} targetDate={targetDate} />
                  </td>
                  <td className="hkr-td hkr-td-num">{formatAdpOvr(row.startupAdp)}</td>
                  <td className="hkr-td hkr-td-slot">
                    {row.startupAdpSlotLabel ?? (row.startupAdpPosRank != null ? `${row.position}${row.startupAdpPosRank}` : '—')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompareSlotPanel({ side, row, targetDate }) {
  const data = side === 'ktc' ? row.ktc : row.adp;
  const isGap = data.kind === 'gap';

  if (isGap) {
    return (
      <td className="hkr-td hkr-td-gap hkr-compare-cell" colSpan={3}>
        {side === 'ktc' ? 'Missing at KTC slot' : '—'}
      </td>
    );
  }

  const highlight = side === 'adp' && row.compareKind === 'adp_candidate'
    ? 'hkr-compare-cell--candidate'
    : side === 'adp' && row.compareKind === 'adp_only'
      ? 'hkr-compare-cell--adp-only'
      : '';

  return (
    <>
      <td className={`hkr-td hkr-td-name hkr-compare-cell ${highlight}`.trim()}>
        <PlayerCell row={data} />
      </td>
      <td className={`hkr-td hkr-td-num hkr-compare-cell ${highlight}`.trim()}>
        {side === 'ktc' ? (data.overallRank ?? '—') : formatAdpOvr(data.startupAdp)}
      </td>
      <td className={`hkr-td hkr-td-num hkr-compare-cell ${highlight}`.trim()}>
        {side === 'ktc'
          ? <ValueCell row={data} targetDate={targetDate} />
          : (data.startupAdpSlotLabel ?? '—')}
      </td>
    </>
  );
}

function SideBySideCompareTable({
  title,
  compareRows,
  targetDate,
  position,
}) {
  const candidates = compareRows.filter((r) => r.compareKind === 'adp_candidate').length;
  const adpOnly = compareRows.filter((r) => r.compareKind === 'adp_only').length;

  return (
    <div className="hkr-board">
      <div className="hkr-board-head">
        <h3 className="hkr-board-title">{title}</h3>
        {candidates > 0 && (
          <span className="hkr-board-meta">
            {candidates} KTC gap{candidates === 1 ? '' : 's'} with ADP player at same slot
          </span>
        )}
        {adpOnly > 0 && (
          <span className="hkr-board-meta">
            {adpOnly} ADP-only (not in KTC ranks)
          </span>
        )}
      </div>
      <div className="hkr-table-wrap">
        <table className="hkr-table hkr-table--compare">
          <thead>
            <tr>
              <th className="hkr-th hkr-th-slot" rowSpan={2}>Slot</th>
              <th className="hkr-th hkr-th-compare-group" colSpan={3}>KTC Historical</th>
              <th className="hkr-th hkr-th-compare-group" colSpan={3}>Startup ADP</th>
            </tr>
            <tr>
              <th className="hkr-th">Player</th>
              <th className="hkr-th hkr-th-num">OVR</th>
              <th className="hkr-th hkr-th-num">Value</th>
              <th className="hkr-th">Player</th>
              <th className="hkr-th hkr-th-num">OVR</th>
              <th className="hkr-th hkr-th-num">Slot</th>
            </tr>
          </thead>
          <tbody>
            {compareRows.map((row) => {
              const slotLabel = `${position}${row.slot}`;
              const rowClass = [
                'hkr-row',
                row.compareKind === 'adp_candidate' ? 'hkr-row--compare-candidate' : '',
                row.compareKind === 'adp_only' ? 'hkr-row--compare-adp-only' : '',
              ].filter(Boolean).join(' ');

              return (
                <tr key={slotLabel} className={rowClass}>
                  <td className="hkr-td hkr-td-slot">{slotLabel}</td>
                  <CompareSlotPanel side="ktc" row={row} targetDate={targetDate} />
                  <CompareSlotPanel side="adp" row={row} targetDate={targetDate} />
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [snapshotType, setSnapshotType] = useState('final_ktc');
  const [year, setYear] = useState(null);
  const [month, setMonth] = useState(9);
  const [position, setPosition] = useState('TE');
  const [sortMode, setSortMode] = useState('ktc');
  const [sideBySide, setSideBySide] = useState(false);
  const [dataMode, setDataMode] = useState('filled');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const loaded = await loadHistoricalKtcRanksData();
        if (cancelled) return;
        setData(loaded);
        setYear(SNAPSHOT_TYPES.final_ktc.years.at(-1));
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load rank history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const availableYears = useMemo(
    () => SNAPSHOT_TYPES[snapshotType]?.years || [],
    [snapshotType],
  );

  useEffect(() => {
    if (!availableYears.length) return;
    if (year == null || !availableYears.includes(Number(year))) {
      setYear(availableYears.at(-1));
    }
  }, [snapshotType, availableYears, year]);

  const targetDate = useMemo(() => {
    if (!data || year == null) return null;
    return getSnapshotTargetDate(
      snapshotType,
      year,
      data.finalKtcDatesByYear,
      snapshotType === 'monthly' ? month : null,
    );
  }, [data, snapshotType, year, month]);

  const filledRows = useMemo(() => {
    if (!data?.filledAvailable || !targetDate || dataMode !== 'filled') return [];
    return getFilledRowsForSnapshot(data.filledBySnapshot, targetDate, snapshotType);
  }, [data, targetDate, snapshotType, dataMode]);

  const filledMetadata = useMemo(() => {
    if (!data?.filledAvailable || !targetDate || dataMode !== 'filled') return new Map();
    return getFilledMetadataForSnapshot(data.filledMetadataBySnapshot, targetDate, snapshotType);
  }, [data, targetDate, snapshotType, dataMode]);

  const startupAdpSeason = useMemo(() => getStartupAdpSeason(year), [year]);

  const adpRows = useMemo(() => {
    if (!data || startupAdpSeason == null) return [];
    return getStartupAdpRows(data, startupAdpSeason);
  }, [data, startupAdpSeason]);

  const adpIndex = useMemo(() => buildStartupAdpIndex(adpRows), [adpRows]);

  const filledResolvedDate = filledRows[0]?.resolvedDate || null;

  const filledBoard = useMemo(() => {
    if (dataMode !== 'filled' || !filledRows.length) return null;
    return buildFilledSlotBoard(filledRows, filledMetadata, position, adpIndex);
  }, [dataMode, filledRows, filledMetadata, position, adpIndex]);

  const filledCoverage = useMemo(() => {
    if (dataMode !== 'filled' || !filledMetadata.size) return null;
    const entries = [...filledMetadata.values()].filter(
      (meta) => position === 'ALL' || meta.position === position,
    );
    return summarizeFilledCoverage(entries);
  }, [dataMode, filledMetadata, position]);

  const rankSnapshot = useMemo(() => {
    if (!data || !targetDate) return null;
    return resolveRankRowsForSnapshot(data, targetDate);
  }, [data, targetDate]);

  const rankIndex = useMemo(
    () => buildRankIndex(rankSnapshot?.rows || []),
    [rankSnapshot],
  );

  const ktcBoard = useMemo(() => {
    if (!data || !targetDate || !rankSnapshot?.rows?.length) return null;
    return buildKtcSlotBoard(
      rankSnapshot.rows,
      position,
      data.valuesByDate,
      targetDate,
      adpIndex,
    );
  }, [data, targetDate, rankSnapshot, position, adpIndex]);

  const adpBoard = useMemo(() => {
    if (!data || !targetDate || !adpRows.length) return null;
    return buildAdpSlotBoard(
      adpRows,
      position,
      rankIndex,
      data.valuesByDate,
      targetDate,
      adpIndex,
    );
  }, [data, targetDate, adpRows, position, rankIndex, adpIndex]);

  const activeBoard = useMemo(() => {
    if (sideBySide) return null;
    if (dataMode === 'filled') return filledBoard;
    if (sortMode === 'adp') return adpBoard;
    return ktcBoard;
  }, [sideBySide, dataMode, sortMode, ktcBoard, adpBoard, filledBoard]);

  const coverage = useMemo(() => {
    if (!data || !targetDate || !rankSnapshot?.rows?.length) return null;
    return summarizeSnapshotCoverage(
      rankSnapshot.rows,
      data.valuesByDate,
      targetDate,
      adpIndex,
    );
  }, [data, targetDate, rankSnapshot, adpIndex]);

  const compareCoverage = useMemo(() => {
    if (!ktcBoard || !adpBoard || ktcBoard.mode === 'all') return null;
    return summarizeCompareCoverage(ktcBoard, adpBoard);
  }, [ktcBoard, adpBoard]);

  if (loading) {
    return <LoadingState label="Loading historical KTC rank data…" className="hkr-loading" />;
  }

  if (error) {
    return <div className="hkr-error">{error}</div>;
  }

  if (!data) {
    return <div className="hkr-error">No rank history loaded.</div>;
  }

  const renderUnified = (board, posLabel) => {
    if (!board) return null;
    if (board.mode === 'all') {
      return board.boards.map((section) => renderUnified(section.rows, section.position));
    }
    return (
      <UnifiedRankTable
        key={posLabel}
        title={`${posLabel} — ${dataMode === 'filled' ? 'filled KTC board' : `sorted by ${sortMode === 'ktc' ? 'KTC Historical slot' : 'Startup ADP slot'}`}`}
        rows={board}
        targetDate={targetDate}
        rankDayOffset={rankSnapshot?.dayOffset ?? 0}
        rankResolvedDate={rankSnapshot?.resolvedDate}
        sortMode={sortMode}
        showFillMeta={dataMode === 'filled'}
        resolvedDate={filledResolvedDate}
      />
    );
  };

  const renderCompare = (ktcRows, adpRowsList, posLabel) => {
    const compareRows = buildSideBySideRows(ktcRows, adpRowsList, posLabel);
    return (
      <SideBySideCompareTable
        key={posLabel}
        title={`${posLabel} — KTC slot vs Startup ADP slot`}
        compareRows={compareRows}
        targetDate={targetDate}
        position={posLabel}
      />
    );
  };

  return (
    <div className="hkr-root">
      <p className="hkr-intro">
        Compare raw KTC rank scrapes vs the imputed filled board (historical + startup ADP + Unknown slots).
        Snapshots: monthly (10th, resolved forward in month), Final KTC preseason, and Rookie Draft (May 20).
        TE ranks use SF TE+; QB/RB/WR use regular Superflex. Startup ADP uses the Jan–Aug season window (2021+).
      </p>

      <div className="hkr-controls">
        <label className="hkr-field">
          <span className="hkr-label">Board</span>
          <select
            className="hkr-select hkr-select--wide"
            value={dataMode}
            onChange={(e) => {
              setDataMode(e.target.value);
              if (e.target.value === 'filled') setSideBySide(false);
            }}
          >
            {Object.values(DATA_MODES).map((mode) => (
              <option key={mode.id} value={mode.id}>{mode.label}</option>
            ))}
          </select>
        </label>

        <label className="hkr-field">
          <span className="hkr-label">Snapshot</span>
          <select
            className="hkr-select hkr-select--wide"
            value={snapshotType}
            onChange={(e) => setSnapshotType(e.target.value)}
          >
            {Object.values(SNAPSHOT_TYPES).map((cfg) => (
              <option key={cfg.id} value={cfg.id}>{cfg.label}</option>
            ))}
          </select>
        </label>

        <label className="hkr-field">
          <span className="hkr-label">Year</span>
          <select
            className="hkr-select"
            value={year ?? ''}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {availableYears.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>

        {snapshotType === 'monthly' && (
          <label className="hkr-field">
            <span className="hkr-label">Month</span>
            <select
              className="hkr-select"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {SNAPSHOT_TYPES.monthly.months.map((m) => (
                <option key={m} value={m}>
                  {new Date(2000, m - 1, 1).toLocaleString('en-US', { month: 'long' })}
                </option>
              ))}
            </select>
          </label>
        )}

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

        {!sideBySide && dataMode === 'raw' && (
          <label className="hkr-field">
            <span className="hkr-label">Sort by</span>
            <select
              className="hkr-select hkr-select--wide"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value)}
            >
              {SORT_MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>{mode.label}</option>
              ))}
            </select>
          </label>
        )}

        {dataMode === 'raw' && (
          <label className="hkr-check">
            <input
              type="checkbox"
              checked={sideBySide}
              onChange={(e) => setSideBySide(e.target.checked)}
            />
            Side-by-side compare
          </label>
        )}
      </div>

      {dataMode === 'filled' && !data.filledAvailable && (
        <div className="hkr-empty">
          Filled board CSV not found. Run{' '}
          <code>python3 scripts/build_sf_ktc_values_historical_filled.py</code>
        </div>
      )}

      {dataMode === 'filled' && data.filledAvailable && filledRows.length === 0 && targetDate && (
        <div className="hkr-empty">
          No filled data for {snapshotType} snapshot {targetDate}.
        </div>
      )}

      {targetDate && (
        <div className="hkr-snapshot-meta">
          <span>Target: <strong>{targetDate}</strong></span>
          {dataMode === 'filled' && filledResolvedDate && filledResolvedDate !== targetDate && (
            <span>Resolved: <strong>{filledResolvedDate}</strong></span>
          )}
          {dataMode === 'raw' && rankSnapshot?.resolvedDate && rankSnapshot.dayOffset !== 0 && (
            <span>
              Rank data: <strong>{rankSnapshot.resolvedDate}</strong>
              {' '}({formatDayOffset(rankSnapshot.dayOffset)})
            </span>
          )}
          {startupAdpSeason != null && adpRows[0] && (
            <span>
              Startup ADP: <strong>{startupAdpSeason}</strong>
              {' '}({adpRows[0].windowStart} – {adpRows[0].windowEnd})
            </span>
          )}
          {startupAdpSeason == null && (
            <span className="hkr-snapshot-warn">
              No startup ADP for {year} (DDL data from 2021)
            </span>
          )}
        </div>
      )}

      {dataMode === 'filled' && filledCoverage && (
        <div className="hkr-stats">
          <div className="hkr-stat">
            <span className="hkr-stat-label">Total slots</span>
            <span className="hkr-stat-value">{filledCoverage.total}</span>
          </div>
          <div className="hkr-stat">
            <span className="hkr-stat-label">{FILL_SOURCE_LABELS.historical}</span>
            <span className="hkr-stat-value">{filledCoverage.historical}</span>
          </div>
          <div className="hkr-stat hkr-stat--warn">
            <span className="hkr-stat-label">{FILL_SOURCE_LABELS.adp}</span>
            <span className="hkr-stat-value">{filledCoverage.adp}</span>
          </div>
          <div className="hkr-stat hkr-stat--warn">
            <span className="hkr-stat-label">{FILL_SOURCE_LABELS.unknown}</span>
            <span className="hkr-stat-value">{filledCoverage.unknown}</span>
          </div>
        </div>
      )}

      {(coverage || compareCoverage) && (
        <div className="hkr-stats">
          {coverage && (
            <>
              <div className="hkr-stat">
                <span className="hkr-stat-label">KTC rank rows</span>
                <span className="hkr-stat-value">{coverage.rankCount}</span>
              </div>
              <div className="hkr-stat">
                <span className="hkr-stat-label">With ADP</span>
                <span className="hkr-stat-value">{coverage.withAdp}</span>
              </div>
              <div className="hkr-stat">
                <span className="hkr-stat-label">With value</span>
                <span className="hkr-stat-value">{coverage.withValue}</span>
              </div>
            </>
          )}
          {compareCoverage && sideBySide && (
            <>
              <div className="hkr-stat hkr-stat--warn">
                <span className="hkr-stat-label">KTC gaps</span>
                <span className="hkr-stat-value">{compareCoverage.ktcGaps}</span>
              </div>
              <div className="hkr-stat hkr-stat--warn">
                <span className="hkr-stat-label">ADP fills gap</span>
                <span className="hkr-stat-value">{compareCoverage.gapFilledByAdp}</span>
              </div>
              <div className="hkr-stat hkr-stat--warn">
                <span className="hkr-stat-label">ADP only</span>
                <span className="hkr-stat-value">{compareCoverage.adpOnly}</span>
              </div>
            </>
          )}
        </div>
      )}

      {dataMode === 'raw' && sideBySide && ktcBoard && (
        startupAdpSeason != null && adpBoard
          ? (position === 'ALL' && ktcBoard.mode === 'all' && adpBoard.mode === 'all'
            ? POSITIONS.map((pos) => {
              const ktcSection = ktcBoard.boards.find((b) => b.position === pos);
              const adpSection = adpBoard.boards.find((b) => b.position === pos);
              if (!ktcSection || !adpSection) return null;
              return renderCompare(ktcSection.rows, adpSection.rows, pos);
            })
            : renderCompare(ktcBoard, adpBoard, position))
          : (
            <div className="hkr-empty">
              Side-by-side compare requires startup ADP (available from 2021).
            </div>
          )
      )}

      {!sideBySide && activeBoard && renderUnified(activeBoard, position === 'ALL' ? null : position)}
    </div>
  );
}

export default HistoricalKtcRanks;
