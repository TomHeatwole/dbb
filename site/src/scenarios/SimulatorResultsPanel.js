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

/**
 * Monte Carlo simulator results — win rate and aggregate standings stats.
 */
function SimulatorResultsPanel({ results, teamsForGrid, iterations }) {
  const teamInfoById = {};
  for (const t of (teamsForGrid || [])) teamInfoById[t.rosterId] = t;

  if (!results || results.length === 0) return null;

  return (
    <div className="simulator-results">
      <div className="simulator-results-header">
        <span className="simulator-results-title">Simulation Results</span>
        <span className="simulator-results-subtitle">
          {iterations.toLocaleString()} runs · sorted by win %, avg total score tiebreaker
        </span>
      </div>

      <div className="simulator-results-scroll">
        <table className="simulator-results-tbl">
          <thead>
            <tr>
              <th className="simulator-results-th simulator-results-th--rank">#</th>
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
              return (
                <tr
                  key={row.rosterId}
                  className={`simulator-results-tr${idx === 0 ? ' simulator-results-tr--leader' : ''}`}
                >
                  <td className="simulator-results-td simulator-results-td--rank">{idx + 1}.</td>
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
                    {fmtPct(row.winPct)}
                    <span className="simulator-results-sub">{row.wins}/{iterations}</span>
                  </td>
                  <td className="simulator-results-td simulator-results-td--num">
                    {fmtPct(row.playoffPct)}
                  </td>
                  <td className="simulator-results-td simulator-results-td--num">
                    {fmtPct(row.top3Pct)}
                  </td>
                  <td className="simulator-results-td simulator-results-td--num">
                    {fmtFinish(row.avgFinish)}
                  </td>
                  <td className="simulator-results-td simulator-results-td--num">
                    {fmtFinish(row.avgRegSeasonRank)}
                  </td>
                  <td className="simulator-results-td simulator-results-td--num">
                    {fmtPts(row.avgRegSeason)}
                  </td>
                  <td className="simulator-results-td simulator-results-td--num">
                    {fmtPts(row.avgPlayoff)}
                  </td>
                  <td className="simulator-results-td simulator-results-td--num simulator-results-td--total">
                    {fmtPts(row.avgTotalScore)}
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
