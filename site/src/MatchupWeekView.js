import React from 'react';

/**
 * MatchupWeekView
 *
 * Renders the per-position grid for a single playoff week, including starters
 * and bench for both teams side by side.
 *
 * Props:
 * - positions: array of position labels (e.g. STARTER_POSITION_NAMES)
 * - starters1: array of starter slots for team 1 (left side)
 * - starters2: array of starter slots for team 2 (right side)
 * - bench1: array of bench slots for team 1
 * - bench2: array of bench slots for team 2
 * - renderPlayerSide: function(slot, align) => JSX to render a player cell
 * - expanded: boolean – whether to show full grid or collapsed summary row
 * - onToggleExpanded: function() – toggles expanded state
 * - week: number – week number label for collapsed row
 * - leftTotalText / rightTotalText: string – totals for each team in collapsed row
 */
function MatchupWeekView({
  positions,
  starters1,
  starters2,
  bench1,
  bench2,
  renderPlayerSide,
  expanded = true,
  onToggleExpanded = null,
  week = null,
  leftTotalText = '',
  rightTotalText = '',
}) {
  const safePositions = Array.isArray(positions) ? positions : [];
  const rowCount =
    safePositions.length ||
    Math.max(starters1.length || 0, starters2.length || 0);
  const benchRowCount = Math.max(bench1.length || 0, bench2.length || 0);
  const arrowSymbol = expanded ? '▾' : '▸';

  if (!expanded) {
    return (
      <div className="yoffs-matchup-table yoffs-matchup-table--collapsed">
        <div className="yoffs-matchup-row yoffs-matchup-row--summary">
          <div className="yoffs-matchup-cell yoffs-matchup-cell--left">
            <div className="yoffs-matchup-summary">
              <span className="yoffs-matchup-summary-score">
                {leftTotalText}
              </span>
            </div>
          </div>
          <div className="yoffs-matchup-pos-col">
            {onToggleExpanded ? (
              <button
                type="button"
                className="yoffs-matchup-week-pill"
                onClick={onToggleExpanded}
              >
                <span className="yoffs-matchup-week-label">
                  {week != null ? `Week ${week}` : 'Week'}
                </span>
                <span className="yoffs-matchup-week-arrow">{arrowSymbol}</span>
              </button>
            ) : (
              <span className="yoffs-matchup-week-pill">
                <span className="yoffs-matchup-week-label">
                  {week != null ? `Week ${week}` : 'Week'}
                </span>
              </span>
            )}
          </div>
          <div className="yoffs-matchup-cell yoffs-matchup-cell--right">
            <div className="yoffs-matchup-summary yoffs-matchup-summary--right">
              <span className="yoffs-matchup-summary-score">
                {rightTotalText}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="yoffs-matchup-table">
      {onToggleExpanded && (
        <div className="yoffs-matchup-row yoffs-matchup-row--summary">
          <div className="yoffs-matchup-cell yoffs-matchup-cell--left">
            <div className="yoffs-matchup-summary">
              <span className="yoffs-matchup-summary-score">
                {leftTotalText}
              </span>
            </div>
          </div>
          <div className="yoffs-matchup-pos-col">
            <button
              type="button"
              className="yoffs-matchup-week-pill"
              onClick={onToggleExpanded}
            >
              <span className="yoffs-matchup-week-label">
                {week != null ? `Week ${week}` : 'Week'}
              </span>
              <span className="yoffs-matchup-week-arrow">{arrowSymbol}</span>
            </button>
          </div>
          <div className="yoffs-matchup-cell yoffs-matchup-cell--right">
            <div className="yoffs-matchup-summary yoffs-matchup-summary--right">
              <span className="yoffs-matchup-summary-score">
                {rightTotalText}
              </span>
            </div>
          </div>
        </div>
      )}
      {Array.from({ length: rowCount }).map((_, idx) => {
        const posLabel = safePositions[idx] || `S${idx + 1}`;
        const leftSlot = starters1[idx];
        const rightSlot = starters2[idx];
        return (
          <div key={posLabel + idx} className="yoffs-matchup-row">
            <div className="yoffs-matchup-cell yoffs-matchup-cell--left">
              {renderPlayerSide(leftSlot, 'left')}
            </div>
            <div className="yoffs-matchup-pos-col">
              <span className="yoffs-matchup-pos-pill">{posLabel}</span>
            </div>
            <div className="yoffs-matchup-cell yoffs-matchup-cell--right">
              {renderPlayerSide(rightSlot, 'right')}
            </div>
          </div>
        );
      })}
      {benchRowCount > 0 && (
        <>
          <div className="yoffs-matchup-divider-row">
            <div className="yoffs-matchup-divider" />
          </div>
          {Array.from({ length: benchRowCount }).map((_, idx) => {
            const leftBench = bench1[idx];
            const rightBench = bench2[idx];
            return (
              <div
                key={`bench-${idx}`}
                className="yoffs-matchup-row yoffs-matchup-row--bench"
              >
                <div className="yoffs-matchup-cell yoffs-matchup-cell--left">
                  {renderPlayerSide(leftBench, 'left')}
                </div>
                <div className="yoffs-matchup-pos-col">
                  <span className="yoffs-matchup-pos-pill yoffs-matchup-pos-pill--bench">
                    BN
                  </span>
                </div>
                <div className="yoffs-matchup-cell yoffs-matchup-cell--right">
                  {renderPlayerSide(rightBench, 'right')}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

export default MatchupWeekView;


