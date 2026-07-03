import React, { useEffect, useMemo, useState } from 'react';
import SimulatorHistogramChart from './SimulatorHistogramChart';
import {
  buildScoreHistogramChartData,
  buildSlotRankChartData,
  computeScoreHistogramStats,
  computeSlotRankAverage,
  computeSlotScoreAverage,
} from './simulatorHistograms';

const RANGE_OPTIONS = [
  { key: 'reg', label: 'Reg Season' },
  { key: 'full', label: 'Full Season' },
  { key: 'playoff', label: 'Playoffs' },
];

function fmtPts(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function rankClass(rank, totalTeams = 10) {
  if (!rank || !totalTeams) return 'scenario-pos-impact-neutral';
  const pct = rank / totalTeams;
  if (pct <= 0.3) return 'scenario-pos-impact-rank--top';
  if (pct >= 0.7) return 'scenario-pos-impact-rank--bot';
  return 'scenario-pos-impact-rank--mid';
}

function SlotHistogramStats({ scoreStats, avgScore, avgRank, totalTeams }) {
  return (
    <div className="simulator-slot-hist-stats">
      <div className="simulator-slot-hist-stat">
        <span className="simulator-slot-hist-stat-label">Avg score</span>
        <span className="simulator-slot-hist-stat-val">{fmtPts(avgScore)}</span>
      </div>
      <div className="simulator-slot-hist-stat">
        <span className="simulator-slot-hist-stat-label">Avg rank</span>
        <span className={`simulator-slot-hist-stat-val ${rankClass(avgRank, totalTeams)}`}>
          {avgRank != null ? `${avgRank.toFixed(1)}/${totalTeams}` : '—'}
        </span>
      </div>
      {scoreStats && (
        <>
          <div className="simulator-slot-hist-stat">
            <span className="simulator-slot-hist-stat-label">Median</span>
            <span className="simulator-slot-hist-stat-val">{fmtPts(scoreStats.median)}</span>
          </div>
          <div className="simulator-slot-hist-stat">
            <span className="simulator-slot-hist-stat-label">Std dev</span>
            <span className="simulator-slot-hist-stat-val">{fmtPts(scoreStats.stdDev)}</span>
          </div>
        </>
      )}
    </div>
  );
}

function SlotExpandedCharts({ slotData, iterations, totalTeams }) {
  const scoreChartData = useMemo(
    () => buildScoreHistogramChartData(slotData?.score, iterations),
    [slotData, iterations],
  );
  const rankChartData = useMemo(
    () => buildSlotRankChartData(slotData?.rank, iterations),
    [slotData, iterations],
  );
  const scoreStats = useMemo(
    () => computeScoreHistogramStats(slotData?.score),
    [slotData],
  );
  const avgScore = computeSlotScoreAverage(slotData?.score);
  const avgRank = computeSlotRankAverage(slotData?.rank);

  return (
    <div className="simulator-slot-expanded">
      <div className="simulator-slot-expanded-col">
        <div className="simulator-slot-expanded-title">Score distribution</div>
        <SimulatorHistogramChart
          data={scoreChartData}
          height={160}
          barColor="#7c9cff"
          activeBarColor="#a0b8ff"
          valueLabel="runs"
          emptyLabel="No scores recorded"
          variant="continuous"
        />
      </div>
      <div className="simulator-slot-expanded-col">
        <div className="simulator-slot-expanded-title">League rank distribution</div>
        <SimulatorHistogramChart
          data={rankChartData}
          height={160}
          barColor="#6b9e78"
          activeBarColor="#8fd4a0"
          highlightPredicate={(row) => row.isPlayoff}
          valueLabel="runs"
          emptyLabel="No rank data"
        />
      </div>
      <SlotHistogramStats
        scoreStats={scoreStats}
        avgScore={avgScore}
        avgRank={avgRank}
        totalTeams={totalTeams}
      />
    </div>
  );
}

/**
 * Per-lineup-slot averages and expandable score/rank distributions.
 */
function SimulatorPositionSlotPanel({ teamSlotHistograms, rosterId, iterations, totalTeams = 10 }) {
  const [expandedPos, setExpandedPos] = useState(null);
  const [weekRange, setWeekRange] = useState('reg');

  const teamData = useMemo(
    () => teamSlotHistograms?.[rosterId] || teamSlotHistograms?.[String(rosterId)] || null,
    [teamSlotHistograms, rosterId],
  );

  const rangeKey = weekRange === 'full' ? 'total' : weekRange;

  const rows = useMemo(() => {
    if (!teamData?.slots?.length) return [];
    return teamData.slots.map((slot) => {
      const rangeData = slot[rangeKey] || slot.reg;
      const avgScore = computeSlotScoreAverage(rangeData?.score);
      const avgRank = computeSlotRankAverage(rangeData?.rank);
      return {
        pos: slot.pos,
        idx: slot.idx,
        rangeData,
        avgScore,
        avgRank,
      };
    });
  }, [teamData, rangeKey]);

  useEffect(() => { setExpandedPos(null); }, [rosterId]);
  useEffect(() => { setExpandedPos(null); }, [weekRange]);

  if (!rows.length) return null;

  return (
    <div className="simulator-team-detail-section simulator-team-detail-section--slots">
      <div className="simulator-team-detail-section-title">Lineup position breakdown</div>
      <div className="simulator-team-detail-subtitle">
        Average score and league rank at each starter slot across {iterations.toLocaleString()} simulations
        {' · '}click a position to expand distributions
      </div>

      <div className="scenario-pos-impact">
        <div className="scenario-pos-impact-range-toggle">
          {RANGE_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`scenario-pos-impact-range-btn${weekRange === key ? ' scenario-pos-impact-range-btn--active' : ''}`}
              onClick={() => setWeekRange(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <table className="scenario-pos-impact-tbl simulator-slot-tbl">
          <thead>
            <tr>
              <th className="scenario-pos-impact-th scenario-pos-impact-th--pos">Pos</th>
              <th
                className="scenario-pos-impact-th scenario-pos-impact-th--num"
                title="Average starter points at this slot"
              >
                Avg Score
              </th>
              <th
                className="scenario-pos-impact-th scenario-pos-impact-th--num"
                title="Average league rank at this slot (among all teams)"
              >
                Avg Rank
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ pos, rangeData, avgScore, avgRank }) => {
              const isExpanded = expandedPos === pos;
              return (
                <React.Fragment key={pos}>
                  <tr
                    className={`scenario-pos-impact-row scenario-pos-impact-row--clickable${isExpanded ? ' scenario-pos-impact-row--expanded' : ''}`}
                    onClick={() => setExpandedPos(isExpanded ? null : pos)}
                  >
                    <td className="scenario-pos-impact-pos">
                      <span className={`scenario-pos-impact-chevron${isExpanded ? ' scenario-pos-impact-chevron--open' : ''}`}>
                        ▶
                      </span>
                      {pos}
                    </td>
                    <td className="scenario-pos-impact-num">{fmtPts(avgScore)}</td>
                    <td className={`scenario-pos-impact-num scenario-pos-impact-num--rank ${rankClass(avgRank, totalTeams)}`}>
                      {avgRank != null ? `${avgRank.toFixed(1)}/${totalTeams}` : '—'}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="scenario-pos-impact-chart-row">
                      <td colSpan={3} className="scenario-pos-impact-chart-cell">
                        <SlotExpandedCharts
                          slotData={rangeData}
                          iterations={iterations}
                          totalTeams={totalTeams}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default SimulatorPositionSlotPanel;
