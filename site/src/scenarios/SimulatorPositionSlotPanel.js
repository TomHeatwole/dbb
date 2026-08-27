import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import SimulatorHistogramChart from './SimulatorHistogramChart';
import {
  buildScoreHistogramChartData,
  buildSlotRankChartData,
  computeScoreHistogramStats,
  computeSlotObjectiveRankings,
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

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function rankClass(rank, totalTeams = 10) {
  if (!rank || !totalTeams) return 'scenario-pos-impact-neutral';
  const pct = rank / totalTeams;
  if (pct <= 0.3) return 'scenario-pos-impact-rank--top';
  if (pct >= 0.7) return 'scenario-pos-impact-rank--bot';
  return 'scenario-pos-impact-rank--mid';
}

function RankTooltipContent({ rankings, currentRid, teamsForGrid }) {
  return (
    <table className="pos-rank-tooltip-tbl">
      <tbody>
        {rankings.map((item, i) => {
          const t = (teamsForGrid || []).find((x) => String(x.rosterId) === String(item.rid));
          const isCurrent = String(item.rid) === String(currentRid);
          return (
            <tr key={item.rid} className={`pos-rank-tooltip-row${isCurrent ? ' pos-rank-tooltip-row--current' : ''}`}>
              <td className="pos-rank-tooltip-rank">#{i + 1}</td>
              <td className="pos-rank-tooltip-name">{t?.teamName || `Team ${item.rid}`}</td>
              <td className="pos-rank-tooltip-pts">{fmtPts(item.total)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SlotHistogramStats({ scoreStats, avgScore, avgRank, objRank, totalTeams }) {
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
      <div className="simulator-slot-hist-stat">
        <span className="simulator-slot-hist-stat-label">Obj rank</span>
        <span className={`simulator-slot-hist-stat-val ${rankClass(objRank, totalTeams)}`}>
          {objRank > 0 ? ordinal(objRank) : '—'}
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

function SlotExpandedCharts({ slotData, iterations, totalTeams, objRank }) {
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
        objRank={objRank}
        totalTeams={totalTeams}
      />
    </div>
  );
}

/**
 * Per-lineup-slot averages and expandable score/rank distributions.
 */
function SimulatorPositionSlotPanel({
  teamSlotHistograms,
  rosterId,
  iterations,
  totalTeams = 10,
  teamsForGrid,
}) {
  const [expandedPos, setExpandedPos] = useState(null);
  const [weekRange, setWeekRange] = useState('reg');
  const [rankTip, setRankTip] = useState(null);

  const teamData = useMemo(
    () => teamSlotHistograms?.[rosterId] || teamSlotHistograms?.[String(rosterId)] || null,
    [teamSlotHistograms, rosterId],
  );

  const rangeKey = weekRange === 'full' ? 'total' : weekRange;

  const objectiveBySlot = useMemo(
    () => computeSlotObjectiveRankings(teamSlotHistograms, rangeKey),
    [teamSlotHistograms, rangeKey],
  );

  const rows = useMemo(() => {
    if (!teamData?.slots?.length) return [];
    return teamData.slots.map((slot) => {
      const rangeData = slot[rangeKey] || slot.reg;
      const avgScore = computeSlotScoreAverage(rangeData?.score);
      const avgRank = computeSlotRankAverage(rangeData?.rank);
      const rankings = objectiveBySlot[slot.idx] || [];
      const objRankIdx = rankings.findIndex((t) => String(t.rid) === String(rosterId));
      return {
        pos: slot.pos,
        idx: slot.idx,
        rangeData,
        avgScore,
        avgRank,
        objRank: objRankIdx >= 0 ? objRankIdx + 1 : 0,
        rankings,
      };
    });
  }, [teamData, rangeKey, objectiveBySlot, rosterId]);

  const showRankTip = useCallback((e, rankings) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setRankTip({ x: rect.left + rect.width / 2, y: rect.top - 6, rankings });
  }, []);
  const hideRankTip = useCallback(() => setRankTip(null), []);

  useEffect(() => { setExpandedPos(null); }, [rosterId]);
  useEffect(() => { setExpandedPos(null); }, [weekRange]);
  useEffect(() => { setRankTip(null); }, [rosterId, weekRange]);

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
                title="Average league rank at this slot across simulations (among all teams)"
              >
                Avg Rank
              </th>
              <th
                className="scenario-pos-impact-th scenario-pos-impact-th--num"
                title="Rank of this team's average score vs other teams at this slot (hover for stack rank)"
              >
                Obj Rank
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ pos, rangeData, avgScore, avgRank, objRank, rankings }) => {
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
                    <td
                      className={`scenario-pos-impact-num scenario-pos-impact-num--rank scenario-pos-impact-num--obj-rank ${rankClass(objRank, totalTeams)}`}
                      onMouseEnter={(e) => rankings?.length && showRankTip(e, rankings)}
                      onMouseLeave={hideRankTip}
                    >
                      {objRank > 0 ? ordinal(objRank) : '—'}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="scenario-pos-impact-chart-row">
                      <td colSpan={4} className="scenario-pos-impact-chart-cell">
                        <SlotExpandedCharts
                          slotData={rangeData}
                          iterations={iterations}
                          totalTeams={totalTeams}
                          objRank={objRank}
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
      {rankTip && createPortal(
        <div
          className="pos-rank-tooltip"
          style={{ position: 'fixed', left: rankTip.x, top: rankTip.y, transform: 'translate(-50%, -100%)', zIndex: 9999, pointerEvents: 'none' }}
        >
          <RankTooltipContent rankings={rankTip.rankings} currentRid={rosterId} teamsForGrid={teamsForGrid} />
        </div>,
        document.body,
      )}
    </div>
  );
}

export default SimulatorPositionSlotPanel;
