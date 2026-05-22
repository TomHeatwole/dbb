import React from 'react';
import PositionBadge from '../PositionBadge';

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
 * - isCurrentWeek: boolean – whether this block corresponds to the current NFL week
 * - leftYetToPlayLabel / leftLiveLabel / rightYetToPlayLabel / rightLiveLabel:
 *   optional strings for activity summary (Yet to Play / Live) under the header
 * - labelOverride: string (optional) – custom center label (e.g. "Playoff Buffer")
 * - isBufferRow: boolean (optional) – whether this row is the playoff buffer row
 * - bufferSide: 'left' | 'right' | null – which side receives the buffer (for styling)
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
  isCurrentWeek = false,
  leftYetToPlayLabel = '',
  leftLiveLabel = '',
  rightYetToPlayLabel = '',
  rightLiveLabel = '',
  labelOverride = null,
  isBufferRow = false,
  bufferSide = null,
}) {
  const safePositions = Array.isArray(positions) ? positions : [];
  const rowCount =
    safePositions.length ||
    Math.max(starters1.length || 0, starters2.length || 0);
  const benchRowCount = Math.max(bench1.length || 0, bench2.length || 0);
  const arrowSymbol = expanded ? '▾' : '▸';
  const labelText =
    labelOverride || (week != null ? `Week ${week}` : 'Week');

  if (!expanded) {
    return (
      <div className="yoffs-matchup-table yoffs-matchup-table--collapsed">
        <div className="yoffs-matchup-row yoffs-matchup-row--summary">
          <div className="yoffs-matchup-cell yoffs-matchup-cell--left">
            <div className="yoffs-matchup-summary">
              <span
                className={
                  'yoffs-matchup-summary-score' +
                  (isBufferRow && bufferSide === 'left'
                    ? ' yoffs-matchup-summary-score--buffer-plus'
                    : '')
                }
              >
                {leftTotalText}
              </span>
            </div>
            {isCurrentWeek && (leftYetToPlayLabel || leftLiveLabel) && (
              <div className="yoffs-matchup-activity">
                {leftYetToPlayLabel && (
                  <span className="yoffs-matchup-activity-item">
                    {leftYetToPlayLabel}
                  </span>
                )}
                {leftLiveLabel && (
                  <span className="yoffs-matchup-activity-item">
                    {leftLiveLabel}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="yoffs-matchup-pos-col">
            {onToggleExpanded ? (
              <button
                type="button"
                className="yoffs-matchup-week-pill"
                onClick={onToggleExpanded}
              >
                <span className="yoffs-matchup-week-label">
                  {labelText}
                </span>
                <span className="yoffs-matchup-week-arrow">{arrowSymbol}</span>
              </button>
            ) : (
              <span className="yoffs-matchup-week-label-static">
                {labelText}
              </span>
            )}
          </div>
          <div className="yoffs-matchup-cell yoffs-matchup-cell--right">
            <div className="yoffs-matchup-summary yoffs-matchup-summary--right">
              <span
                className={
                  'yoffs-matchup-summary-score' +
                  (isBufferRow && bufferSide === 'right'
                    ? ' yoffs-matchup-summary-score--buffer-plus'
                    : '')
                }
              >
                {rightTotalText}
              </span>
            </div>
            {isCurrentWeek && (rightYetToPlayLabel || rightLiveLabel) && (
              <div className="yoffs-matchup-activity yoffs-matchup-activity--right">
                {rightYetToPlayLabel && (
                  <span className="yoffs-matchup-activity-item">
                    {rightYetToPlayLabel}
                  </span>
                )}
                {rightLiveLabel && (
                  <span className="yoffs-matchup-activity-item">
                    {rightLiveLabel}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="yoffs-matchup-table">
      <div className="yoffs-matchup-row yoffs-matchup-row--summary">
        <div className="yoffs-matchup-cell yoffs-matchup-cell--left">
          <div className="yoffs-matchup-summary">
              <span
                className={
                  'yoffs-matchup-summary-score' +
                  (isBufferRow && bufferSide === 'left'
                    ? ' yoffs-matchup-summary-score--buffer-plus'
                    : '')
                }
              >
                {leftTotalText}
              </span>
          </div>
          {isCurrentWeek && (leftYetToPlayLabel || leftLiveLabel) && (
            <div className="yoffs-matchup-activity">
              {leftYetToPlayLabel && (
                <span className="yoffs-matchup-activity-item">
                  {leftYetToPlayLabel}
                </span>
              )}
              {leftLiveLabel && (
                <span className="yoffs-matchup-activity-item">
                  {leftLiveLabel}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="yoffs-matchup-pos-col">
          {onToggleExpanded ? (
            <button
              type="button"
              className="yoffs-matchup-week-pill"
              onClick={onToggleExpanded}
            >
              <span className="yoffs-matchup-week-label">
                {labelText}
              </span>
              <span className="yoffs-matchup-week-arrow">{arrowSymbol}</span>
            </button>
          ) : (
            <span className="yoffs-matchup-week-label-static">
              {labelText}
            </span>
          )}
        </div>
        <div className="yoffs-matchup-cell yoffs-matchup-cell--right">
          <div className="yoffs-matchup-summary yoffs-matchup-summary--right">
              <span
                className={
                  'yoffs-matchup-summary-score' +
                  (isBufferRow && bufferSide === 'right'
                    ? ' yoffs-matchup-summary-score--buffer-plus'
                    : '')
                }
              >
                {rightTotalText}
              </span>
          </div>
          {isCurrentWeek && (rightYetToPlayLabel || rightLiveLabel) && (
            <div className="yoffs-matchup-activity yoffs-matchup-activity--right">
              {rightYetToPlayLabel && (
                <span className="yoffs-matchup-activity-item">
                  {rightYetToPlayLabel}
                </span>
              )}
              {rightLiveLabel && (
                <span className="yoffs-matchup-activity-item">
                  {rightLiveLabel}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
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
              <PositionBadge position={posLabel} />
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
                  <PositionBadge position="BN" />
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


