import React, { useMemo } from 'react';
import { buildFutureScenario2EvalUrl } from './scenarioEncoding';
import { percentileColor } from './luckMetrics';

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Group sim runs by final league finish (1–10) for one team.
 */
export function buildTeamFinishBuckets(simRuns, rosterId) {
  const rosterKey = rosterId != null ? String(rosterId) : rosterId;
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    place: i + 1,
    count: 0,
    runs: [],
  }));

  for (const sim of simRuns || []) {
    const tr = sim.teamResults?.[rosterId] || sim.teamResults?.[rosterKey];
    if (!tr || tr.place < 1 || tr.place > 10) continue;
    const bucket = buckets[tr.place - 1];
    bucket.count += 1;
    bucket.runs.push({
      simIndex: sim.simIndex,
      rolls: sim.rolls,
      totalScore: tr.totalScore,
      luckPercentile: tr.luckPercentile ?? null,
    });
  }

  for (const bucket of buckets) {
    bucket.runs.sort((a, b) => b.totalScore - a.totalScore);
  }

  return buckets;
}

function SimulatorTeamDetail({
  rosterId,
  teamsForGrid,
  teamFinishBuckets,
  originalRosters,
  scenarioRosters,
  seasonYear,
  iterations,
}) {
  const team = (teamsForGrid || []).find((t) => t.rosterId === rosterId) || {};

  const buckets = useMemo(
    () => teamFinishBuckets?.[rosterId] || teamFinishBuckets?.[String(rosterId)] || null,
    [teamFinishBuckets, rosterId],
  );

  if (!buckets || buckets.every((b) => b.count === 0)) return null;

  return (
    <div className="simulator-team-detail">
      <div className="simulator-team-detail-header">
        <span className="simulator-team-detail-label">Viewing:</span>
        {team.avatarUrl
          ? <img className="simulator-team-detail-avatar" src={team.avatarUrl} alt="" />
          : <span className="simulator-team-detail-avatar simulator-team-detail-avatar--placeholder" />
        }
        <span className="simulator-team-detail-name">{team.teamName || `Team ${rosterId}`}</span>
      </div>

      <div className="simulator-team-detail-subtitle">
        Finish distribution across {iterations.toLocaleString()} simulations · click a row to open that outcome set in Future Scenarios v2
        {buckets.some((b) => b.count > b.runs.length) && (
          <span className="simulator-team-detail-note">
            {' '}(links show top 50 scores per finish)
          </span>
        )}
      </div>

      <div className="simulator-finish-grid">
        {buckets.map((bucket) => (
          <div
            key={bucket.place}
            className={
              'simulator-finish-col' +
              (bucket.place <= 4 ? ' simulator-finish-col--playoff' : '')
            }
          >
            <div className="simulator-finish-col-header">{ordinal(bucket.place)}</div>
            <div className="simulator-finish-col-count">
              {bucket.count}
              <span className="simulator-finish-col-count-denom">/{iterations}</span>
            </div>
            <div className="simulator-finish-col-links">
              {bucket.runs.length === 0 ? (
                <span className="simulator-finish-col-empty">—</span>
              ) : (
                bucket.runs.map((run) => {
                  const href = buildFutureScenario2EvalUrl(
                    originalRosters,
                    scenarioRosters,
                    run.rolls,
                    seasonYear,
                  );
                  const luckLabel = run.luckPercentile != null
                    ? `P${Math.round(run.luckPercentile)}`
                    : '—';
                  return (
                    <a
                      key={run.simIndex}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="simulator-sim-link-row"
                      title={`Sim #${run.simIndex} · ${run.totalScore.toFixed(1)} pts · ${luckLabel} luck · open in Future Scenarios v2`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="simulator-sim-link-id">#{run.simIndex}</span>
                      <span className="simulator-sim-link-score">
                        {run.totalScore.toFixed(1)}
                      </span>
                      <span
                        className="simulator-sim-link-luck"
                        style={run.luckPercentile != null ? {
                          '--roll-color': percentileColor(run.luckPercentile),
                        } : undefined}
                      >
                        {luckLabel}
                      </span>
                    </a>
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SimulatorTeamDetail;
