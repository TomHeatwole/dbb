import React from 'react';

function fmtPct(pct) {
  return `${pct.toFixed(1)}%`;
}

function fmtPts(pts) {
  return Number(pts).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function fmtFinish(place) {
  return place.toFixed(2);
}

function fmtPctDelta(delta) {
  const sign = delta > 0 ? '+' : '';
  return `(${sign}${delta.toFixed(1)}%)`;
}

function fmtFinishDelta(delta) {
  const sign = delta > 0 ? '+' : '';
  return `(${sign}${delta.toFixed(2)})`;
}

function fmtPtsDelta(delta) {
  const sign = delta > 0 ? '+' : '';
  return `(${sign}${delta.toFixed(1)})`;
}

function MetricDelta({ delta, format, threshold = 0.05 }) {
  if (delta == null || Math.abs(delta) < threshold) return null;
  const isPos = delta > 0;
  return (
    <span
      className={
        `scenario-standings-cell-delta simulator-results-cell-delta ${
          isPos ? 'scenario-standings-cell-delta--pos' : 'scenario-standings-cell-delta--neg'
        }`
      }
    >
      {format(delta)}
    </span>
  );
}

function RankMovement({ delta }) {
  if (delta == null || delta === 0) {
    return <span className="simulator-results-movement" aria-hidden="true" />;
  }
  const isUp = delta > 0;
  return (
    <span
      className={
        `simulator-results-movement scenario-standings-movement ${
          isUp ? 'scenario-standings-movement--up' : 'scenario-standings-movement--down'
        }`
      }
    >
      {isUp ? `↑${delta}` : `↓${Math.abs(delta)}`}
    </span>
  );
}

/**
 * Monte Carlo simulator results — win rate and aggregate standings stats.
 */
function SimulatorResultsPanel({
  results, resultDeltas, teamsForGrid, iterations, selectedRosterId, onSelectTeam,
}) {
  const teamInfoById = {};
  for (const t of (teamsForGrid || [])) teamInfoById[t.rosterId] = t;

  const deltaByRosterId = {};
  for (const d of (resultDeltas || [])) deltaByRosterId[d.rosterId] = d;

  const hasDeltas = (resultDeltas || []).some((d) => (
    d.resultsRankDelta
    || Math.abs(d.winPctDelta || 0) >= 0.05
    || Math.abs(d.playoffPctDelta || 0) >= 0.05
    || Math.abs(d.top3PctDelta || 0) >= 0.05
    || Math.abs(d.avgFinishDelta || 0) >= 0.005
    || Math.abs(d.avgRegSeasonRankDelta || 0) >= 0.005
    || Math.abs(d.avgRegSeasonDelta || 0) >= 0.05
    || Math.abs(d.avgPlayoffDelta || 0) >= 0.05
    || Math.abs(d.avgTotalScoreDelta || 0) >= 0.05
  ));

  if (!results || results.length === 0) return null;

  return (
    <div className="simulator-results">
      <div className="simulator-results-header">
        <span className="simulator-results-title">Simulation Results</span>
        <span className="simulator-results-subtitle">
          {iterations.toLocaleString()} runs · click a team for finish breakdown · sorted by win %
          {hasDeltas ? ' · deltas vs original rosters' : ''}
        </span>
      </div>

      <div className="simulator-results-scroll">
        <table className="simulator-results-tbl">
          <thead>
            <tr>
              <th className="simulator-results-th simulator-results-th--rank">#</th>
              {hasDeltas && (
                <th
                  className="simulator-results-th simulator-results-th--move"
                  title="Change in win-rate rank vs original rosters"
                />
              )}
              <th className="simulator-results-th simulator-results-th--team">Team</th>
              <th className="simulator-results-th simulator-results-th--num" title="Championship rate">Win %</th>
              <th className="simulator-results-th simulator-results-th--num" title="Top-4 seed rate">Playoff %</th>
              <th className="simulator-results-th simulator-results-th--num" title="Finish 1st–3rd rate">Top 3 %</th>
              <th className="simulator-results-th simulator-results-th--num" title="Average final standing (1–10)">Avg Finish</th>
              <th className="simulator-results-th simulator-results-th--num" title="Average regular-season seed by points">Avg Reg Seed</th>
              <th className="simulator-results-th simulator-results-th--num" title="Average regular-season starter points">Avg 14 Wk</th>
              <th className="simulator-results-th simulator-results-th--num" title="Average playoff starter points">Avg Playoff</th>
              <th className="simulator-results-th simulator-results-th--num" title="Average total starter points">Avg Total</th>
            </tr>
          </thead>
          <tbody>
            {results.map((row, idx) => {
              const team = teamInfoById[row.rosterId] || {};
              const delta = deltaByRosterId[row.rosterId] || {};
              return (
                <tr
                  key={row.rosterId}
                  className={
                    'simulator-results-tr simulator-results-tr--clickable' +
                    (idx === 0 ? ' simulator-results-tr--leader' : '') +
                    (selectedRosterId === row.rosterId ? ' simulator-results-tr--selected' : '')
                  }
                  onClick={() => onSelectTeam && onSelectTeam(
                    selectedRosterId === row.rosterId ? null : row.rosterId,
                  )}
                >
                  <td className="simulator-results-td simulator-results-td--rank">{idx + 1}.</td>
                  {hasDeltas && (
                    <td className="simulator-results-td simulator-results-td--move">
                      <RankMovement delta={delta.resultsRankDelta} />
                    </td>
                  )}
                  <td className="simulator-results-td simulator-results-td--team">
                    <span className="simulator-results-team-inner">
                      {team.avatarUrl
                        ? <img className="simulator-results-avatar" src={team.avatarUrl} alt="" />
                        : <span className="simulator-results-avatar simulator-results-avatar--placeholder" />
                      }
                      <span className="simulator-results-name" title={team.teamName || ''}>
                        {idx === 0 && <span className="simulator-results-trophy">🏆</span>}
                        {team.teamName || `Team ${row.rosterId}`}
                      </span>
                    </span>
                  </td>
                  <td className="simulator-results-td simulator-results-td--num simulator-results-td--win">
                    <span className="simulator-results-metric">
                      <span>{fmtPct(row.winPct)}</span>
                      <MetricDelta delta={delta.winPctDelta} format={fmtPctDelta} />
                    </span>
                    <span className="simulator-results-sub">{row.wins}/{iterations}</span>
                  </td>
                  <td className="simulator-results-td simulator-results-td--num">
                    <span className="simulator-results-metric">
                      <span>{fmtPct(row.playoffPct)}</span>
                      <MetricDelta delta={delta.playoffPctDelta} format={fmtPctDelta} />
                    </span>
                  </td>
                  <td className="simulator-results-td simulator-results-td--num">
                    <span className="simulator-results-metric">
                      <span>{fmtPct(row.top3Pct)}</span>
                      <MetricDelta delta={delta.top3PctDelta} format={fmtPctDelta} />
                    </span>
                  </td>
                  <td className="simulator-results-td simulator-results-td--num">
                    <span className="simulator-results-metric">
                      <span>{fmtFinish(row.avgFinish)}</span>
                      <MetricDelta
                        delta={delta.avgFinishDelta}
                        format={fmtFinishDelta}
                        threshold={0.005}
                      />
                    </span>
                  </td>
                  <td className="simulator-results-td simulator-results-td--num">
                    <span className="simulator-results-metric">
                      <span>{fmtFinish(row.avgRegSeasonRank)}</span>
                      <MetricDelta
                        delta={delta.avgRegSeasonRankDelta}
                        format={fmtFinishDelta}
                        threshold={0.005}
                      />
                    </span>
                  </td>
                  <td className="simulator-results-td simulator-results-td--num">
                    <span className="simulator-results-metric">
                      <span>{fmtPts(row.avgRegSeason)}</span>
                      <MetricDelta delta={delta.avgRegSeasonDelta} format={fmtPtsDelta} />
                    </span>
                  </td>
                  <td className="simulator-results-td simulator-results-td--num">
                    <span className="simulator-results-metric">
                      <span>{fmtPts(row.avgPlayoff)}</span>
                      <MetricDelta delta={delta.avgPlayoffDelta} format={fmtPtsDelta} />
                    </span>
                  </td>
                  <td className="simulator-results-td simulator-results-td--num simulator-results-td--total">
                    <span className="simulator-results-metric">
                      <span>{fmtPts(row.avgTotalScore)}</span>
                      <MetricDelta delta={delta.avgTotalScoreDelta} format={fmtPtsDelta} />
                    </span>
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

export default SimulatorResultsPanel;
