import React, { useMemo, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getStandings, getWeekScoreBreakdown, getPlayerSeasonTotalsMap } from './ScoresParser';
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
  const isCurrentSeason = !urlYear || String(urlYear) === String(CURRENT_YEAR);
  const rosterIdToTeamInfo = useMemo(() => {
    return buildRosterIdToTeamInfoMap(rosters, users);
  }, [rosters, users]);

  // Load traded picks for this team in the summary (Overview) tab and log them for now
  useEffect(() => {
    let cancelled = false;
    if (!isCurrentSeason) {
      setTradedPicks([]);
      return () => {
        cancelled = true;
      };
    }
    const seasonForPicks = urlYear ? String(urlYear) : String(CURRENT_YEAR);
    (async () => {
      try {
        const allPicks = await fetchTradedPicks(seasonForPicks);
        if (cancelled || !Array.isArray(allPicks)) {
          return;
        }
        const currentYearNum = Number(CURRENT_YEAR);
        const minSeason = currentYearNum + 1;
        const maxSeason = currentYearNum + 3;

        // Determine which of this team's own natural picks (by season/round) have been traded away.
        // We treat a pick as traded away if its original roster_id is this team but the current owner_id is different.
        const tradedAwaySelfKeys = new Set();
        for (const p of allPicks) {
          if (!p) {
            continue;
          }
          const seasonNum = p.season != null ? Number(p.season) : Number(seasonForPicks);
          const roundNum = p.round != null ? Number(p.round) : null;
          if (!Number.isFinite(seasonNum) || !Number.isFinite(roundNum)) {
            continue;
          }
          if (seasonNum < minSeason || seasonNum > maxSeason) {
            continue;
          }
          const rosterIdNum = p.roster_id != null ? Number(p.roster_id) : null;
          const ownerIdNum = p.owner_id != null ? Number(p.owner_id) : null;
          if (rosterIdNum === Number(rosterId) && ownerIdNum !== Number(rosterId)) {
            tradedAwaySelfKeys.add(`${seasonNum}-${roundNum}`);
          }
        }

        // Base (assumed) picks: 1st–4th for each future year current+1 .. current+3,
        // minus any that were traded away (as detected above).
        const basePicks = [];
        if (Number.isFinite(minSeason) && Number.isFinite(maxSeason)) {
          for (let yr = minSeason; yr <= maxSeason; yr += 1) {
            for (let round = 1; round <= 4; round += 1) {
              const key = `${yr}-${round}`;
              if (tradedAwaySelfKeys.has(key)) {
                continue;
              }
              basePicks.push({
                season: String(yr),
                round,
                owner_id: Number(rosterId),
              });
            }
          }
        }

        // Traded picks that this roster currently owns within the same future window
        const ownedTraded = allPicks
          .filter((p) => {
            if (!p || p.owner_id == null) {
              return false;
            }
            const seasonNum = p.season != null ? Number(p.season) : Number(seasonForPicks);
            if (!Number.isFinite(seasonNum)) {
              return false;
            }
            if (seasonNum < minSeason || seasonNum > maxSeason) {
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

        // Combine base and traded picks, then sort by year, round, and then team name
        const combined = [...basePicks, ...ownedTraded].sort((a, b) => {
          const aSeason = Number(a.season);
          const bSeason = Number(b.season);
          if (aSeason !== bSeason) {
            return aSeason - bSeason;
          }
          const aRound = Number(a.round || 0);
          const bRound = Number(b.round || 0);
          if (aRound !== bRound) {
            return aRound - bRound;
          }
          const aIsBase = !a.team_name;
          const bIsBase = !b.team_name;
          if (aIsBase !== bIsBase) {
            // Base picks first, then traded
            return aIsBase ? -1 : 1;
          }
          const aName = a.team_name || '';
          const bName = b.team_name || '';
          return aName.localeCompare(bName);
        });
        if (!cancelled) {
          setTradedPicks(combined);
          // Temporary debug output until we render this in a column
          // eslint-disable-next-line no-console
          console.log('Picks (summary) for roster', rosterId, 'season window', `${minSeason}-${maxSeason}`, combined);
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
  }, [urlYear, rosterId, rosterIdToTeamInfo, isCurrentSeason]);
  const playerSeasonTotalsMap = useMemo(() => {
    return getPlayerSeasonTotalsMap(weeksParsedData);
  }, [weeksParsedData]);
  const myStanding = useMemo(() => {
    if (loading || !weeksParsedData) { return null; }
    const baseStandings = getStandings(weeksParsedData) || [];
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
          const computed = StartSitSort(raw, playersData, playerIdMap, null, null, playerSeasonTotalsMap);
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
  }, [loading, weeksParsedData, rosterId, playersData, playerIdMap, urlYear, playerSeasonTotalsMap]);

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
          {isCurrentSeason ? (
            <FullRoster playerList={playerList} positions={['QB', 'WR', 'RB', 'TE', 'Picks']} picks={tradedPicks} />
          ) : (
            <FullRoster playerList={playerList} positions={['QB', 'WR', 'RB', 'TE']} />
          )}
        </>
      ) : (
        <div>No data for this team.</div>
      )}
    </div>
  );
}

export default TeamSummary; 