import React, { useRef, useState, useEffect } from 'react';
import { KTC_FORMAT_LABELS } from '../lookups/KtcLookup';
import { PLAYER_DB_FILTERS } from './playerDBFilters';
import { PLAYER_DB_COLUMNS } from './playerDBColumns';

const KTC_FORMATS = ['sf', 'sf_tep'];
const LIMIT_OPTIONS = [25, 50, 100, 250, 500];

// Group columns for the toggle panel
const COLUMN_GROUPS = [
  {
    label: 'Identity',
    keys: ['name', 'position', 'nflTeam', 'age'],
  },
  {
    label: 'KTC',
    keys: ['ktcValue', 'ktcRank', 'ktcPosRank'],
  },
  {
    label: '2025 Stats',
    keys: ['fantasyPoints', 'fantasyPointsPerGame', 'gamesPlayed'],
  },
  {
    label: 'FantasyCalc',
    keys: ['fcValue', 'fcRank', 'fcPosRank', 'fcTrend30'],
  },
  {
    label: 'FFB',
    keys: ['ffbRank', 'ffbPosRank'],
  },
  {
    label: 'Hwang Adjusted KTC',
    keys: [
      'hwangMarketValue',
      'hwangMarketRank',
      'hwangMarketPosRank',
      'hwangTrueValue',
      'hwangTrueRank',
      'hwangTruePosRank',
    ],
  },
  {
    label: 'Redraft Adjusted',
    keys: [
      'competitorAdjustedValue',
      'competitorAdjustedRank',
      'rebuilderAdjustedValue',
      'rebuilderAdjustedRank',
    ],
  },
  {
    label: 'Ownership',
    keys: ['fantasyTeamName'],
  },
];

function ColumnTogglePanel({ columnVisibility, onColumnVisibilityChange, onReset, onClose }) {
  return (
    <div className="pdb-col-panel">
      <div className="pdb-col-panel-header">
        <span className="pdb-col-panel-title">Columns</span>
        <div className="pdb-col-panel-actions">
          <button className="pdb-col-panel-reset" onClick={onReset}>
            Reset
          </button>
          <button className="pdb-col-panel-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </div>
      <div className="pdb-col-panel-body">
        {COLUMN_GROUPS.map(group => {
          const colsInGroup = PLAYER_DB_COLUMNS.filter(c => group.keys.includes(c.key));
          if (!colsInGroup.length) return null;
          return (
            <div key={group.label} className="pdb-col-group">
              <div className="pdb-col-group-label">{group.label}</div>
              {colsInGroup.map(col => (
                <label key={col.key} className="pdb-col-toggle-row">
                  <input
                    type="checkbox"
                    className="pdb-toggle-checkbox"
                    checked={columnVisibility[col.key] !== false}
                    onChange={e => onColumnVisibilityChange(col.key, e.target.checked)}
                    // Prevent hiding the name column (always required)
                    disabled={col.key === 'name'}
                  />
                  <span className={col.key === 'name' ? 'pdb-col-toggle-locked' : ''}>
                    {col.label}
                  </span>
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * PlayerDBControls
 *
 * Props:
 *   allPlayers              – full (unfiltered) player list; used for dynamic options
 *   filterState             – current filter values
 *   onFilterChange          – (key, value) => void
 *   ktcFormat               – 'sf' | 'sf_tep'
 *   onKtcFormatChange       – (format) => void
 *   limit / onLimitChange
 *   resultCount / totalCount
 *   columnVisibility        – { [colKey]: boolean }
 *   onColumnVisibilityChange – (key, visible) => void
 *   onResetColumnVisibility – () => void
 */
function PlayerDBControls({
  allPlayers,
  filterState,
  onFilterChange,
  ktcFormat,
  onKtcFormatChange,
  limit,
  onLimitChange,
  resultCount,
  totalCount,
  columnVisibility,
  onColumnVisibilityChange,
  onResetColumnVisibility,
}) {
  const searchRef     = useRef(null);
  const colBtnRef     = useRef(null);
  const colPanelRef   = useRef(null);
  const [colPanelOpen, setColPanelOpen] = useState(false);

  // Close column panel on outside click
  useEffect(() => {
    if (!colPanelOpen) return;
    function handleClick(e) {
      if (
        colPanelRef.current && !colPanelRef.current.contains(e.target) &&
        colBtnRef.current  && !colBtnRef.current.contains(e.target)
      ) {
        setColPanelOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [colPanelOpen]);

  function resolveOptions(filterDef) {
    if (!filterDef.options) return [];
    return typeof filterDef.options === 'function'
      ? filterDef.options(allPlayers)
      : filterDef.options();
  }

  const searchFilter  = PLAYER_DB_FILTERS.find(f => f.type === 'search');
  const selectFilters = PLAYER_DB_FILTERS.filter(f => f.type === 'select');
  const toggleFilters = PLAYER_DB_FILTERS.filter(f => f.type === 'toggle');

  // Count how many non-default columns are hidden or extra columns are shown
  const hiddenCount = PLAYER_DB_COLUMNS.filter(
    c => c.key !== 'name' && columnVisibility[c.key] === false
  ).length;
  const shownExtraCount = PLAYER_DB_COLUMNS.filter(
    c => c.defaultVisible === false && columnVisibility[c.key] === true
  ).length;
  const colBadge = shownExtraCount > 0 ? `+${shownExtraCount}` : hiddenCount > 0 ? `-${hiddenCount}` : null;

  return (
    <div className="pdb-controls">
      {/* ── Search bar ── */}
      <div className="pdb-search-wrap">
        <span className="pdb-search-icon">🔍</span>
        <input
          ref={searchRef}
          type="text"
          className="pdb-search-input"
          placeholder="Search players by name…"
          value={filterState[searchFilter.key]}
          onChange={e => onFilterChange(searchFilter.key, e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {filterState[searchFilter.key] && (
          <button
            className="pdb-search-clear"
            onClick={() => {
              onFilterChange(searchFilter.key, '');
              searchRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {/* ── Filter + column row ── */}
      <div className="pdb-filter-row">
        {/* KTC format toggle */}
        <div className="control-group">
          <label>Format:</label>
          <div className="dynasty-format-toggle">
            {KTC_FORMATS.map(f => (
              <button
                key={f}
                type="button"
                className={
                  'dynasty-format-btn' +
                  (ktcFormat === f ? ' dynasty-format-btn--active' : '')
                }
                onClick={() => onKtcFormatChange(f)}
              >
                {KTC_FORMAT_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        {/* Select filters */}
        {selectFilters.map(filterDef => (
          <div key={filterDef.key} className="control-group">
            <label>{filterDef.label}:</label>
            <select
              className="control-select"
              value={filterState[filterDef.key]}
              onChange={e => onFilterChange(filterDef.key, e.target.value)}
            >
              {resolveOptions(filterDef).map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        ))}

        {/* Toggle filters */}
        {toggleFilters.map(filterDef => (
          <div key={filterDef.key} className="control-group">
            <label className="pdb-toggle-label">
              <input
                type="checkbox"
                className="pdb-toggle-checkbox"
                checked={filterState[filterDef.key]}
                onChange={e => onFilterChange(filterDef.key, e.target.checked)}
              />
              {filterDef.label}
            </label>
          </div>
        ))}

        {/* Limit selector */}
        <div className="control-group">
          <label>Show:</label>
          <select
            className="control-select"
            value={limit}
            onChange={e => onLimitChange(Number(e.target.value))}
          >
            {LIMIT_OPTIONS.map(n => (
              <option key={n} value={n}>Top {n}</option>
            ))}
            <option value={9999}>All</option>
          </select>
        </div>

        {/* Column visibility button */}
        <div className="pdb-col-btn-wrap" style={{ marginLeft: 'auto' }}>
          <button
            ref={colBtnRef}
            className={'pdb-col-btn' + (colPanelOpen ? ' pdb-col-btn--active' : '')}
            onClick={() => setColPanelOpen(p => !p)}
            aria-label="Toggle column visibility"
          >
            Columns
            {colBadge && (
              <span className="pdb-col-badge">{colBadge}</span>
            )}
          </button>

          {colPanelOpen && (
            <div ref={colPanelRef} className="pdb-col-panel-anchor">
              <ColumnTogglePanel
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={onColumnVisibilityChange}
                onReset={onResetColumnVisibility}
                onClose={() => setColPanelOpen(false)}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Result count ── */}
      <div className="pdb-result-count">
        Showing <strong>{resultCount}</strong>
        {totalCount !== resultCount && (
          <> of <strong>{totalCount}</strong></>
        )}{' '}
        players
      </div>
    </div>
  );
}

export default PlayerDBControls;
