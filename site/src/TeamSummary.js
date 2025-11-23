import React, { useMemo, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getStandings, getWeekScoreBreakdown } from './ScoresParser';
import { CURRENT_YEAR, getCurrentNFLWeek } from './DateHelper';
import { StartSitSort } from './StartSitDecider';
import FullRoster from './FullRoster';
import { fetchTradedPicks, buildRosterIdToTeamInfoMap } from './TeamLookup';

function TeamSummary({ weeksParsedData, loading, playersData, playerIdMap, playerList, rosters, users }) {
  const { id } = useParams();
  const rosterId = Number(id);
  const [searchParams] = useSearchParams();
  const urlYear = searchParams.get('year');
  const [tradedPicks, setTradedPicks] = useState([]);
  const rosterIdToTeamInfo = useMemo(() => {
    return buildRosterIdToTeamInfoMap(rosters, users);
  }, [rosters, users]);

  // Load traded picks for this team in the summary (Overview) tab and log them for now
  useEffect(() => {
    let cancelled = false;
    const seasonForPicks = urlYear ? String(urlYear) : String(CURRENT_YEAR);
    (async () => {
      try {
        const allPicks = await fetchTradedPicks(seasonForPicks);
        if (cancelled || !Array.isArray(allPicks)) {
          return;
        }
        const owned = allPicks
          .filter((p) => {
            if (!p || p.owner_id == null) {
              return false;
            }
            const seasonNum = p.season != null ? Number(p.season) : Number(seasonForPicks);
            const currentYearNum = Number(CURRENT_YEAR);
            if (!Number.isFinite(seasonNum) || !Number.isFinite(currentYearNum)) {
              return false;
            }
            // Only show picks for seasons strictly after the current year
            if (seasonNum <= currentYearNum) {
              return false;
            }
            return Number(p.owner_id) === Number(rosterId);
          })
          .map((p) => {
            const prevId = p && p.previous_owner_id != null ? Number(p.previous_owner_id) : null;
            const info = prevId != null ? rosterIdToTeamInfo[prevId] : null;
            const viaTeamName = info && info.teamName ? info.teamName : (prevId != null ? `Team ${prevId}` : null);
            return {
              ...p,
              team_name: viaTeamName,
            };
          });
        if (!cancelled) {
          setTradedPicks(owned);
          // Temporary debug output until we render this in a column
          // eslint-disable-next-line no-console
          console.log('Traded picks (summary) for roster', rosterId, 'season', seasonForPicks, owned);
        }
      } catch (e) {
        if (!cancelled) {
          setTradedPicks([]);
        }
        // eslint-disable-next-line no-console
        console.error('Failed to fetch traded picks in TeamSummary', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [urlYear, rosterId]);
  const myStanding = useMemo(() => {
    if (loading || !weeksParsedData) { return null; }
    const baseStandings = getStandings(weeksParsedData) || [];
    const isCurrentSeason = !urlYear || String(urlYear) === String(CURRENT_YEAR);
    if (!isCurrentSeason || !playersData || !playerIdMap) {
      return baseStandings.find(s => s.roster_id === rosterId) || null;
    }
    try {
      const currentWeek = getCurrentNFLWeek();
      const breakdown = getWeekScoreBreakdown(weeksParsedData, currentWeek) || {};
      const totals = baseStandings.map((s) => {
        const raw = breakdown[s.roster_id];
        let live = s.points_scored || 0;
        if (raw) {
          const computed = StartSitSort(raw, playersData, playerIdMap);
          if (computed && typeof computed.starterTotal === 'number') {
            const priorWeeks = (weeksParsedData || []).slice(0, currentWeek - 1) || [];
            const priorSum = priorWeeks.reduce((sum, wk) => {
              if (!Array.isArray(wk)) { return sum; }
              const e = wk.find(x => x && Number(x.roster_id) === Number(s.roster_id));
              const pts = e && typeof e.points === 'number' ? e.points : 0;
              return sum + pts;
            }, 0);
            live = Math.round((priorSum + computed.starterTotal));
          }
        }
        return { roster_id: s.roster_id, liveTotal: live };
      }).sort((a, b) => b.liveTotal - a.liveTotal);
      let place = 1;
      let i = 0;
      while (i < totals.length) {
        const score = totals[i].liveTotal;
        let j = i + 1;
        while (j < totals.length && totals[j].liveTotal === score) { j++; }
        for (let k = i; k < j; k++) {
          if (totals[k].roster_id === rosterId) {
            return { place, numTied: (j - i), points_scored: totals[k].liveTotal };
          }
        }
        place += (j - i);
        i = j;
      }
      return baseStandings.find(s => s.roster_id === rosterId) || null;
    } catch (_) {
      return baseStandings.find(s => s.roster_id === rosterId) || null;
    }
  }, [loading, weeksParsedData, rosterId, playersData, playerIdMap, urlYear]);

  if (loading) return (
    <div className="loading-center">
      <div className="spinner" aria-label="Loading" />
      <div className="loading-text">Loading summary…</div>
      <img src="/logo.jpg" alt="Site logo" className="loading-logo" />
    </div>
  );
  if (!weeksParsedData) return <div>No summary data found.</div>;

  return (
    <div className="team-summary-root">
      {myStanding ? (
        <>
          <div className="team-summary-place">
            Place: #{myStanding.place}
            {myStanding.numTied > 1 && (
              <span className="team-summary-tie">
                ({myStanding.numTied}-way Tie)
              </span>
            )}
          </div>
          <div className="team-summary-points">
            {myStanding.points_scored} Fantasy Points
          </div>
          <FullRoster playerList={playerList} positions={['QB', 'WR', 'RB', 'TE', 'Picks']} picks={tradedPicks} />
        </>
      ) : (
        <div>No data for this team.</div>
      )}
    </div>
  );
}

export default TeamSummary; 