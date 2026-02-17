import React, { useMemo, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getStandings, getWeekScoreBreakdown, getPlayerSeasonTotalsMap } from '../scores/ScoresParser';
import { CURRENT_YEAR, getCurrentNFLWeek, isPostSeasonPreDraft, getCompletedWeeksCount } from '../utils/DateHelper';
import { LEAGUE_ID } from '../utils/global_constants';
import { StartSitSort } from '../players/StartSitDecider';
import FullRoster from './FullRoster';
import { fetchTradedPicks, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { calculateDraftOrder, convertPlacementToPickNumbers } from '../utils/DraftOrderHelper';
import LoadingState from '../LoadingState';

function TeamSummary({ weeksParsedData, loading, playersData, playerIdMap, playerList, rosters, users }) {
  const { id } = useParams();
  const rosterId = Number(id);
  const [searchParams] = useSearchParams();
  const urlYear = searchParams.get('year');
  const [tradedPicks, setTradedPicks] = useState([]);
  const [draftOrder, setDraftOrder] = useState(null); // Map of rosterId -> pick number (1-10)
  const isCurrentSeason = !urlYear || String(urlYear) === String(CURRENT_YEAR);
  const completedWeeks = getCompletedWeeksCount(urlYear || CURRENT_YEAR);
  const isPreSeason = isCurrentSeason && completedWeeks === 0;
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
                roster_id: Number(rosterId), // Add roster_id so we can look up draft position
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
        }
      } catch (_) {
        if (!cancelled) {
          setTradedPicks([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [urlYear, rosterId, rosterIdToTeamInfo, isCurrentSeason]);

  // Load draft order if we're in post-season, pre-draft state
  useEffect(() => {
    let cancelled = false;
    
    // Only fetch draft order for current season in post-season state
    if (!isCurrentSeason || !isPostSeasonPreDraft(CURRENT_YEAR)) {
      setDraftOrder(null);
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        // Fetch all data needed to calculate draft order
        const [weeksData, teamDataRaw] = await Promise.all([
          fetchScoresData(CURRENT_YEAR),
          (async () => {
            const rosterRes = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`);
            if (!rosterRes.ok) throw new Error('Failed to fetch rosters for draft order');
            const rosters = await rosterRes.json();
            return { rosters };
          })(),
        ]);

        if (cancelled) {
          return;
        }

        // For draft order calculation, we need players data, but we can pass null
        // and it will fall back to API points (acceptable for draft order)
        const placeToRosterId = calculateDraftOrder(CURRENT_YEAR, weeksData, teamDataRaw, null, null);
        const rosterIdToPickNum = convertPlacementToPickNumbers(placeToRosterId);
        
        if (!cancelled) {
          setDraftOrder(rosterIdToPickNum);
        }
      } catch (_) {
        if (!cancelled) {
          setDraftOrder(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isCurrentSeason]);

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
  }, [loading, weeksParsedData, rosterId, playersData, playerIdMap, playerSeasonTotalsMap, isCurrentSeason]);

  if (loading) {
    return (
      <LoadingState label="Loading summary…" />
    );
  }

  return (
    <div className="team-summary-root">
      {/* Only show standings if we have matchup data AND we're not in pre-season */}
      {myStanding && !isPreSeason ? (
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
        </>
      ) : isPreSeason ? (
        <div className="team-summary-preseason">
          Season hasn't started yet
        </div>
      ) : null}
      
      {/* Always render roster if we have player data */}
      {isCurrentSeason ? (
        <FullRoster 
          playerList={playerList} 
          positions={['QB', 'WR', 'RB', 'TE', 'Picks']} 
          picks={tradedPicks}
          draftOrder={draftOrder}
          nextDraftYear={String(Number(CURRENT_YEAR) + 1)}
          rosters={rosters}
          users={users}
        />
      ) : (
        <FullRoster 
          playerList={playerList} 
          positions={['QB', 'WR', 'RB', 'TE']}
          rosters={rosters}
          users={users}
        />
      )}
    </div>
  );
}

export default TeamSummary; 