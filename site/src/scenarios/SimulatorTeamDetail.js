import React, { useMemo, useEffect, useRef } from 'react';
import { buildFutureScenario2EvalUrl } from './scenarioEncoding';
import { percentileColor } from './luckMetrics';
import SimulatorHistogramChart from './SimulatorHistogramChart';
import SimulatorPositionSlotPanel from './SimulatorPositionSlotPanel';
import {
  buildTeamFinishChartData,
  buildScoreHistogramChartData,
  computeScoreHistogramStats,
} from './simulatorHistograms';
import { useMyCurrentRosterId, isMyRoster } from '../hooks/useAuthUser';

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
      playoffRolls: sim.playoffRolls,
      totalScore: tr.totalScore,
      luckPercentile: tr.luckPercentile ?? null,
    });
  }

  for (const bucket of buckets) {
    bucket.runs.sort((a, b) => b.totalScore - a.totalScore);
  }

  return buckets;
}

function fmtPts(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function ScoreHistogramStats({ stats }) {
  if (!stats) return null;

  return (
    <div className="simulator-score-hist-stats">
      <div className="simulator-score-hist-stat">
        <span className="simulator-score-hist-stat-label">Median</span>
        <span className="simulator-score-hist-stat-val">{fmtPts(stats.median)}</span>
      </div>
      <div className="simulator-score-hist-stat">
        <span className="simulator-score-hist-stat-label">P75</span>
        <span className="simulator-score-hist-stat-val">{fmtPts(stats.p75)}</span>
      </div>
      <div className="simulator-score-hist-stat">
        <span className="simulator-score-hist-stat-label">P25</span>
        <span className="simulator-score-hist-stat-val">{fmtPts(stats.p25)}</span>
      </div>
      <div className="simulator-score-hist-stat">
        <span className="simulator-score-hist-stat-label">Std dev</span>
        <span className="simulator-score-hist-stat-val">{fmtPts(stats.stdDev)}</span>
      </div>
    </div>
  );
}

function ScoreHistogramSection({ title, subtitle, data, hist, barColor, activeBarColor }) {
  const stats = useMemo(() => computeScoreHistogramStats(hist), [hist]);

  return (
    <div className="simulator-team-detail-section simulator-team-detail-section--score-hist">
      <div className="simulator-team-detail-section-title">{title}</div>
      <div className="simulator-team-detail-subtitle">{subtitle}</div>
      <SimulatorHistogramChart
        data={data}
        height={180}
        barColor={barColor}
        activeBarColor={activeBarColor}
        valueLabel="runs"
        emptyLabel="No scores recorded"
        variant="continuous"
      />
      <ScoreHistogramStats stats={stats} />
    </div>
  );
}

function SimOutcomeLink({ run, originalRosters, scenarioRosters, seasonYear }) {
  if (!run?.rolls) return null;

  const href = buildFutureScenario2EvalUrl(
    originalRosters,
    scenarioRosters,
    run.rolls,
    seasonYear,
    run.playoffRolls,
  );
  const luckLabel = run.luckPercentile != null
    ? `P${Math.round(run.luckPercentile)}`
    : '—';
  const placeBit = run.place ? `${ordinal(run.place)} · ` : '';

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="simulator-sim-link-row"
      title={`Sim #${run.simIndex} · ${placeBit}${run.totalScore.toFixed(1)} pts · ${luckLabel} luck · open in Future Scenarios v2`}
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
}

function SeasonExtremeCard({ label, tone, run, originalRosters, scenarioRosters, seasonYear }) {
  const href = run?.rolls
    ? buildFutureScenario2EvalUrl(
      originalRosters,
      scenarioRosters,
      run.rolls,
      seasonYear,
      run.playoffRolls,
    )
    : null;
  const luckLabel = run?.luckPercentile != null
    ? `P${Math.round(run.luckPercentile)} luck`
    : null;
  const className = `simulator-extreme-card simulator-extreme-card--${tone}${href ? ' simulator-extreme-card--link' : ''}`;

  const inner = (
    <>
      <div className="simulator-extreme-card-label">{label}</div>
      {run ? (
        <>
          <div className="simulator-extreme-card-meta">
            {run.place ? `${ordinal(run.place)} · ` : ''}
            {fmtPts(run.totalScore)} pts
            {luckLabel ? ` · ${luckLabel}` : ''}
          </div>
          {href
            ? <div className="simulator-extreme-card-cta">Open this season →</div>
            : <span className="simulator-finish-col-empty">No outcome link</span>}
        </>
      ) : (
        <span className="simulator-finish-col-empty">—</span>
      )}
    </>
  );

  if (!href) {
    return <div className={className}>{inner}</div>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={`${label} · sim #${run.simIndex} · open in Future Scenarios v2`}
      onClick={(e) => e.stopPropagation()}
    >
      {inner}
    </a>
  );
}

function SimulatorTeamDetail({
  rosterId,
  teamsForGrid,
  teamFinishBuckets,
  teamScoreHistograms,
  teamSlotHistograms,
  teamSeasonExtremes,
  originalRosters,
  scenarioRosters,
  seasonYear,
  iterations,
  simSamplesAvailable,
}) {
  const team = (teamsForGrid || []).find((t) => t.rosterId === rosterId) || {};
  const myRosterId = useMyCurrentRosterId();
  const mine = isMyRoster(rosterId, myRosterId);
  const detailRef = useRef(null);

  useEffect(() => {
    detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [rosterId]);

  const buckets = useMemo(
    () => teamFinishBuckets?.[rosterId] || teamFinishBuckets?.[String(rosterId)] || null,
    [teamFinishBuckets, rosterId],
  );

  const scoreHist = useMemo(
    () => teamScoreHistograms?.[rosterId] || teamScoreHistograms?.[String(rosterId)] || null,
    [teamScoreHistograms, rosterId],
  );

  const seasonExtremes = useMemo(
    () => teamSeasonExtremes?.[rosterId] || teamSeasonExtremes?.[String(rosterId)] || null,
    [teamSeasonExtremes, rosterId],
  );

  const finishChartData = useMemo(
    () => buildTeamFinishChartData(buckets, iterations),
    [buckets, iterations],
  );

  const regChartData = useMemo(
    () => buildScoreHistogramChartData(scoreHist?.reg, iterations),
    [scoreHist, iterations],
  );

  const playoffChartData = useMemo(
    () => buildScoreHistogramChartData(scoreHist?.playoff, iterations),
    [scoreHist, iterations],
  );

  const totalChartData = useMemo(
    () => buildScoreHistogramChartData(scoreHist?.total, iterations),
    [scoreHist, iterations],
  );

  if (!buckets || buckets.every((b) => b.count === 0)) return null;

  const showOutcomeLinks = simSamplesAvailable;
  const totalTeams = (teamsForGrid || []).length || 10;

  return (
    <div className="simulator-team-detail" ref={detailRef}>
      <div className="simulator-team-detail-header">
        <span className="simulator-team-detail-label">Viewing:</span>
        {team.avatarUrl
          ? <img className={`simulator-team-detail-avatar${mine ? ' me-avatar' : ''}`} src={team.avatarUrl} alt="" />
          : <span className={`simulator-team-detail-avatar simulator-team-detail-avatar--placeholder${mine ? ' me-avatar' : ''}`} />
        }
        <span className="simulator-team-detail-name">{team.teamName || `Team ${rosterId}`}</span>
      </div>

      {(seasonExtremes?.bestByPlace || seasonExtremes?.worstByPlace
        || seasonExtremes?.bestByScore || seasonExtremes?.worstByScore) && (
        <div className="simulator-team-detail-section simulator-team-detail-section--extremes">
          <div className="simulator-team-detail-section-title">Best and worst seasons</div>
          <div className="simulator-team-detail-subtitle">
            Best and worst finish, plus highest- and lowest-scoring runs, across {iterations.toLocaleString()} simulations
            {' '}· click to open the full outcome set
          </div>
          <div className="simulator-extreme-groups">
            <div className="simulator-extreme-group">
              <div className="simulator-extreme-group-title">By league finish</div>
              <div className="simulator-extreme-grid">
                <SeasonExtremeCard
                  label="Best finish"
                  tone="best"
                  run={seasonExtremes.bestByPlace}
                  originalRosters={originalRosters}
                  scenarioRosters={scenarioRosters}
                  seasonYear={seasonYear}
                />
                <SeasonExtremeCard
                  label="Worst finish"
                  tone="worst"
                  run={seasonExtremes.worstByPlace}
                  originalRosters={originalRosters}
                  scenarioRosters={scenarioRosters}
                  seasonYear={seasonYear}
                />
              </div>
            </div>
            <div className="simulator-extreme-group">
              <div className="simulator-extreme-group-title">By total score</div>
              <div className="simulator-extreme-grid">
                <SeasonExtremeCard
                  label="Highest score"
                  tone="best"
                  run={seasonExtremes.bestByScore}
                  originalRosters={originalRosters}
                  scenarioRosters={scenarioRosters}
                  seasonYear={seasonYear}
                />
                <SeasonExtremeCard
                  label="Lowest score"
                  tone="worst"
                  run={seasonExtremes.worstByScore}
                  originalRosters={originalRosters}
                  scenarioRosters={scenarioRosters}
                  seasonYear={seasonYear}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="simulator-team-detail-section simulator-team-detail-section--histogram">
        <div className="simulator-team-detail-section-title">League finish distribution</div>
        <div className="simulator-team-detail-subtitle">
          Final standing across {iterations.toLocaleString()} simulations
        </div>
        <SimulatorHistogramChart
          data={finishChartData}
          height={200}
          barColor="#7c9cff"
          activeBarColor="#ffd56b"
          highlightPredicate={(row) => row.isPlayoff}
          valueLabel="runs"
        />
      </div>

      <div className="simulator-team-detail-section simulator-team-detail-section--scores">
        <div className="simulator-team-detail-section-title">Starter points distributions</div>
        <div className="simulator-team-detail-subtitle">
          Optimal lineup totals across {iterations.toLocaleString()} simulations
        </div>

        <div className="simulator-score-hist-grid">
          <ScoreHistogramSection
            title="Total score"
            subtitle="Full season (weeks 1–17)"
            data={totalChartData}
            hist={scoreHist?.total}
            barColor="#7c9cff"
            activeBarColor="#a0b8ff"
          />
          <ScoreHistogramSection
            title="14-week score"
            subtitle="Regular season (weeks 1–14)"
            data={regChartData}
            hist={scoreHist?.reg}
            barColor="#6b9e78"
            activeBarColor="#8fd4a0"
          />
          <ScoreHistogramSection
            title="Playoff score"
            subtitle="Weeks 15–17"
            data={playoffChartData}
            hist={scoreHist?.playoff}
            barColor="#c49a6c"
            activeBarColor="#e0b88a"
          />
        </div>
      </div>

      <SimulatorPositionSlotPanel
        teamSlotHistograms={teamSlotHistograms}
        rosterId={rosterId}
        iterations={iterations}
        totalTeams={totalTeams}
        teamsForGrid={teamsForGrid}
      />

      {showOutcomeLinks && (
        <div className="simulator-team-detail-section simulator-team-detail-section--outcomes">
          <div className="simulator-team-detail-section-title">Specific simulations</div>
          <div className="simulator-team-detail-subtitle">
            Open an outcome set in Future Scenarios v2
            {buckets.some((b) => b.count > b.runs.length) && (
              <span className="simulator-team-detail-note">
                {' '}· top 50 scores per finish shown
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
                    bucket.runs.map((run) => (
                      <SimOutcomeLink
                        key={run.simIndex}
                        run={run}
                        originalRosters={originalRosters}
                        scenarioRosters={scenarioRosters}
                        seasonYear={seasonYear}
                      />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default SimulatorTeamDetail;
