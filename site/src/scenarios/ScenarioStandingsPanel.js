import React from 'react';

function fmtPts(pts) {
  return Number(pts).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function fmtDelta(delta) {
  const sign = delta > 0 ? '+' : '';
  return `(${sign}${fmtPts(delta)})`;
}

/**
 * ScenarioStandingsPanel
 *
 * Two score columns — "14 Wks" and "Playoffs" — each embed their own delta
 * inline, e.g. "1,500.0 (+225.0)" or "420.0 (-38.0)".
 *
 * Props:
 *   scenarioStandings  – output of buildFinalStandings() from computeScenarioEval
 *   teamDeltas         – [{ rosterId, originalPlace, regSeasonDelta, playoffDelta, isPlayoff }]
 *   teamsForGrid       – [{ rosterId, teamName, avatarUrl }]
 */
function ScenarioStandingsPanel({ scenarioStandings, teamDeltas, teamsForGrid }) {
  const teamInfoById = {};
  for (const t of (teamsForGrid || [])) teamInfoById[t.rosterId] = t;

  const deltaByRosterId = {};
  for (const d of (teamDeltas || [])) deltaByRosterId[d.rosterId] = d;

  const playoffRows    = (scenarioStandings || []).filter((r) => r.isPlayoff);
  const nonPlayoffRows = (scenarioStandings || []).filter((r) => !r.isPlayoff);

  function renderRow(row, isLastPlayoff) {
    const team  = teamInfoById[row.rosterId] || {};
    const delta = deltaByRosterId[row.rosterId] || {};

    const placeDiff      = (delta.originalPlace ?? row.place) - row.place;
    const regDelta       = delta.regSeasonDelta ?? 0;
    const ploffDelta     = delta.playoffDelta   ?? 0;

    return (
      <React.Fragment key={row.rosterId}>
        <div className={`scenario-standings-row${row.isPlayoff ? ' scenario-standings-row--playoff' : ''}${isLastPlayoff ? ' scenario-standings-row--playoff-last' : ''}`}>

          {/* Movement */}
          <span
            className={
              `scenario-standings-movement` +
              (placeDiff > 0 ? ' scenario-standings-movement--up' :
               placeDiff < 0 ? ' scenario-standings-movement--down' : '')
            }
          >
            {placeDiff > 0 ? `↑${placeDiff}` :
             placeDiff < 0 ? `↓${Math.abs(placeDiff)}` : ''}
          </span>

          {/* Place */}
          <span className="scenario-standings-place">{row.place}.</span>

          {/* Avatar */}
          {team.avatarUrl
            ? <img className="scenario-standings-avatar" src={team.avatarUrl} alt="" />
            : <span className="scenario-standings-avatar scenario-standings-avatar--placeholder" />
          }

          {/* Team name */}
          <span className="scenario-standings-name" title={team.teamName || ''}>
            {row.place === 1 && <span className="scenario-standings-trophy">🏆</span>}
            {team.teamName || `Team ${row.rosterId}`}
          </span>

          {/* 14-week total + inline delta */}
          <span className="scenario-standings-cell">
            <span className="scenario-standings-cell-pts">{fmtPts(row.regSeasonTotal)}</span>
            {regDelta !== 0 && (
              <span className={`scenario-standings-cell-delta ${regDelta > 0 ? 'scenario-standings-cell-delta--pos' : 'scenario-standings-cell-delta--neg'}`}>
                {fmtDelta(regDelta)}
              </span>
            )}
          </span>

          {/* Playoff total + inline delta (top 4 only) */}
          <span className="scenario-standings-cell scenario-standings-cell--playoff">
            {row.isPlayoff ? (
              <>
                <span className="scenario-standings-cell-pts">{fmtPts(row.playoffTotal)}</span>
                {ploffDelta !== 0 && (
                  <span className={`scenario-standings-cell-delta ${ploffDelta > 0 ? 'scenario-standings-cell-delta--pos' : 'scenario-standings-cell-delta--neg'}`}>
                    {fmtDelta(ploffDelta)}
                  </span>
                )}
              </>
            ) : (
              <span className="scenario-standings-cell-pts scenario-standings-cell-pts--empty">—</span>
            )}
          </span>

        </div>
      </React.Fragment>
    );
  }

  return (
    <div className="scenario-standings-panel">
      {/* Column headers */}
      <div className="scenario-standings-col-headers">
        <span className="scenario-standings-col-header-name" />
        <span className="scenario-standings-col-header">14 Wks</span>
        <span className="scenario-standings-col-header scenario-standings-col-header--playoff">Playoffs</span>
      </div>

      <div className="scenario-standings-rows">
        {playoffRows.map((row, i) =>
          renderRow(row, i === playoffRows.length - 1),
        )}
        {nonPlayoffRows.map((row) =>
          renderRow(row, false),
        )}
      </div>
    </div>
  );
}

export default ScenarioStandingsPanel;
