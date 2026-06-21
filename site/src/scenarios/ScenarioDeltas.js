import React, { useMemo } from 'react';
import { getPlayerInfo } from '../lookups/PlayerLookup';
import { isValidPlayerId } from './scenarioUtils';

/**
 * Live "Your Scenario" summary panel.
 * Shows every add/drop the user has made relative to the original rosters,
 * grouped by team.
 */
function ScenarioDeltas({ originalRosters, scenarioRosters, teamsForGrid, playersData, playerIdMap, onRevert, readOnly }) {
  const deltas = useMemo(() => {
    return teamsForGrid
      .map((team) => {
        const rid = team.rosterId;
        const origSet = new Set(originalRosters[rid] || []);
        const curr = scenarioRosters[rid] || [];
        const currSet = new Set(curr);

        const added = curr.filter((p) => isValidPlayerId(p) && !origSet.has(p));
        const removed = [...(originalRosters[rid] || [])]
          .filter((p) => isValidPlayerId(p) && !currSet.has(p));

        if (added.length === 0 && removed.length === 0) return null;

        const resolve = (pid) => {
          const info = getPlayerInfo(pid, playersData, playerIdMap);
          return info?.name || `Player ${pid}`;
        };

        return {
          team,
          added: added.map((pid) => ({ pid, name: resolve(pid) })),
          removed: removed.map((pid) => ({ pid, name: resolve(pid) })),
        };
      })
      .filter(Boolean);
  }, [originalRosters, scenarioRosters, teamsForGrid, playersData, playerIdMap]);

  return (
    <div className="scenario-deltas-root">
      <div className="scenario-deltas-heading">Your Scenario</div>

      {deltas.length === 0 ? (
        <div className="scenario-deltas-empty">No changes yet.</div>
      ) : (
        <div className="scenario-deltas-list">
          {deltas.map(({ team, added, removed }) => (
            <div key={team.rosterId} className="scenario-deltas-team">
              <div className="scenario-deltas-team-name">{team.teamName}</div>
              <div className="scenario-deltas-changes">
                {added.map(({ pid, name }) => (
                  <div key={`add-${pid}`} className="scenario-deltas-row scenario-deltas-row--add">
                    <span className="scenario-deltas-sign">+</span>
                    <span className="scenario-deltas-player-name">{name}</span>
                    {!readOnly && (
                      <button
                        type="button"
                        className="scenario-deltas-revert-btn"
                        title="Revert"
                        onClick={() => onRevert && onRevert(team.rosterId, pid, 'add')}
                      >↩</button>
                    )}
                  </div>
                ))}
                {removed.map(({ pid, name }) => (
                  <div key={`rem-${pid}`} className="scenario-deltas-row scenario-deltas-row--remove">
                    <span className="scenario-deltas-sign">−</span>
                    <span className="scenario-deltas-player-name">{name}</span>
                    {!readOnly && (
                      <button
                        type="button"
                        className="scenario-deltas-revert-btn"
                        title="Revert"
                        onClick={() => onRevert && onRevert(team.rosterId, pid, 'remove')}
                      >↩</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ScenarioDeltas;
