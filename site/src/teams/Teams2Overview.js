import React, { useMemo, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { CURRENT_YEAR, isPostSeasonPreDraft, getCompletedWeeksCount } from '../utils/DateHelper';
import { LEAGUE_ID, PREVIOUS_YEARS } from '../utils/global_constants';
import { fetchTradedPicks, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { calculateDraftOrder, convertPlacementToPickNumbers } from '../utils/DraftOrderHelper';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import PlayerWeeklyScores from '../players/PlayerWeeklyScores';
import LoadingState from '../LoadingState';

function Teams2Overview({ weeksParsedData, loading, playersData, playerIdMap, playerList, rosters, users }) {
  const { id } = useParams();
  const rosterId = Number(id);
  const [searchParams] = useSearchParams();
  const urlYear = searchParams.get('year');
  const [tradedPicks, setTradedPicks] = useState([]);
  const [draftOrder, setDraftOrder] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const isCurrentSeason = !urlYear || String(urlYear) === String(CURRENT_YEAR);
  const completedWeeks = getCompletedWeeksCount(urlYear || CURRENT_YEAR);
  const isPreSeason = isCurrentSeason && completedWeeks === 0;

  const rosterIdToTeamInfo = useMemo(() => {
    return buildRosterIdToTeamInfoMap(rosters, users);
  }, [rosters, users]);

  // Load traded picks (same logic as TeamSummary)
  useEffect(() => {
    let cancelled = false;
    if (!isCurrentSeason) {
      setTradedPicks([]);
      return () => { cancelled = true; };
    }
    const seasonForPicks = urlYear ? String(urlYear) : String(CURRENT_YEAR);
    (async () => {
      try {
        const allPicks = await fetchTradedPicks(seasonForPicks);
        if (cancelled || !Array.isArray(allPicks)) return;
        const currentYearNum = Number(CURRENT_YEAR);
        const yearOffset = isPreSeason ? 0 : 1;
        const minSeason = currentYearNum + yearOffset;
        const maxSeason = currentYearNum + yearOffset + 2;

        const tradedAwaySelfKeys = new Set();
        for (const p of allPicks) {
          if (!p) continue;
          const seasonNum = p.season != null ? Number(p.season) : Number(seasonForPicks);
          const roundNum = p.round != null ? Number(p.round) : null;
          if (!Number.isFinite(seasonNum) || !Number.isFinite(roundNum)) continue;
          if (seasonNum < minSeason || seasonNum > maxSeason) continue;
          if (Number(p.roster_id) === rosterId && Number(p.owner_id) !== rosterId) {
            tradedAwaySelfKeys.add(`${seasonNum}-${roundNum}`);
          }
        }

        const basePicks = [];
        for (let yr = minSeason; yr <= maxSeason; yr++) {
          for (let round = 1; round <= 4; round++) {
            if (tradedAwaySelfKeys.has(`${yr}-${round}`)) continue;
            basePicks.push({
              season: String(yr),
              round,
              owner_id: Number(rosterId),
              roster_id: Number(rosterId),
            });
          }
        }

        const ownedTraded = allPicks
          .filter((p) => {
            if (!p || p.owner_id == null) return false;
            const seasonNum = p.season != null ? Number(p.season) : Number(seasonForPicks);
            if (!Number.isFinite(seasonNum) || seasonNum < minSeason || seasonNum > maxSeason) return false;
            return Number(p.owner_id) === Number(rosterId);
          })
          .map((p) => {
            const prevId = p.previous_owner_id != null ? Number(p.previous_owner_id) : null;
            const info = prevId != null ? rosterIdToTeamInfo[prevId] : null;
            return {
              ...p,
              team_name: info?.teamName || (prevId != null ? `Team ${prevId}` : null),
            };
          });

        const combined = [...basePicks, ...ownedTraded].sort((a, b) => {
          const aSeason = Number(a.season);
          const bSeason = Number(b.season);
          if (aSeason !== bSeason) return aSeason - bSeason;
          const aRound = Number(a.round || 0);
          const bRound = Number(b.round || 0);
          if (aRound !== bRound) return aRound - bRound;
          const aIsBase = !a.team_name;
          const bIsBase = !b.team_name;
          if (aIsBase !== bIsBase) return aIsBase ? -1 : 1;
          return (a.team_name || '').localeCompare(b.team_name || '');
        });
        if (!cancelled) setTradedPicks(combined);
      } catch (_) {
        if (!cancelled) setTradedPicks([]);
      }
    })();
    return () => { cancelled = true; };
  }, [urlYear, rosterId, rosterIdToTeamInfo, isCurrentSeason, isPreSeason]);

  // Load draft order
  useEffect(() => {
    let cancelled = false;
    if (!isCurrentSeason || (!isPostSeasonPreDraft(CURRENT_YEAR) && !isPreSeason)) {
      setDraftOrder(null);
      return () => { cancelled = true; };
    }
    const prevYearNums = Object.keys(PREVIOUS_YEARS).map(Number).filter(n => Number.isFinite(n));
    const scoresSeasonForOrder = isPreSeason && prevYearNums.length > 0
      ? String(Math.max(...prevYearNums))
      : CURRENT_YEAR;

    (async () => {
      try {
        const [weeksData, teamDataRaw] = await Promise.all([
          fetchScoresData(scoresSeasonForOrder),
          (async () => {
            const rosterRes = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`);
            if (!rosterRes.ok) throw new Error('Failed to fetch rosters');
            return { rosters: await rosterRes.json() };
          })(),
        ]);
        if (cancelled) return;
        const placeToRosterId = calculateDraftOrder(scoresSeasonForOrder, weeksData, teamDataRaw, null, null);
        const rosterIdToPickNum = convertPlacementToPickNumbers(placeToRosterId);
        if (!cancelled) setDraftOrder(rosterIdToPickNum);
      } catch (_) {
        if (!cancelled) setDraftOrder(null);
      }
    })();
    return () => { cancelled = true; };
  }, [isCurrentSeason, isPreSeason]);

  // Group players by position for the card grid
  const positionGroups = useMemo(() => {
    const groups = { QB: [], RB: [], WR: [], TE: [] };
    for (const p of playerList) {
      if (groups[p.position]) {
        groups[p.position].push(p);
      }
    }
    for (const pos of Object.keys(groups)) {
      groups[pos].sort((a, b) => (a.search_rank || 9999999) - (b.search_rank || 9999999));
    }
    return groups;
  }, [playerList]);

  // Player modal
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') setSelectedPlayer(null);
    }
    if (selectedPlayer) document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedPlayer]);

  useEffect(() => {
    if (selectedPlayer) document.body.classList.add('modal-open');
    else document.body.classList.remove('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, [selectedPlayer]);

  if (loading) {
    return <LoadingState label="Loading overview..." />;
  }

  const positions = isCurrentSeason ? ['QB', 'RB', 'WR', 'TE'] : ['QB', 'RB', 'WR', 'TE'];
  const showPicks = isCurrentSeason && tradedPicks.length > 0;

  const modal = selectedPlayer ? (
    <div className="player-modal-overlay" onClick={() => setSelectedPlayer(null)}>
      <div className="player-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <PlayerWeeklyScores
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
          rosters={rosters}
          users={users}
        />
      </div>
    </div>
  ) : null;

  return (
    <div className="teams2-overview">
      {/* Roster as card grid */}
      <div className="teams2-roster">
        {positions.map(pos => (
          <div key={pos} className="teams2-roster-group">
            <div className="teams2-roster-group-header">
              <span className={`teams2-pos-badge teams2-pos-${pos.toLowerCase()}`}>{pos}</span>
              <span className="teams2-roster-group-count">{positionGroups[pos]?.length || 0}</span>
            </div>
            <div className="teams2-roster-players">
              {(positionGroups[pos] || []).map((p, i) => (
                <div
                  key={i}
                  className="teams2-player-card"
                  onClick={() => setSelectedPlayer(p)}
                >
                  <img
                    src={getPlayerLogoUrl(p.espn_photo_url)}
                    alt=""
                    className="teams2-player-card-img"
                  />
                  <div className="teams2-player-card-info">
                    <span className="teams2-player-card-name">{p.name}</span>
                    {p.team && (
                      <span className="teams2-player-card-team">{p.team || p.team_abbr || ''}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Draft picks */}
      {showPicks && (
        <div className="teams2-picks-section">
          <h3 className="teams2-picks-title">Draft Capital</h3>
          <div className="teams2-picks-grid">
            {tradedPicks.map((pick, i) => {
              const season = pick.season || '';
              const round = pick.round;
              const via = pick.team_name;
              let label = `${season} Round ${round}`;
              if (draftOrder && pick.roster_id != null) {
                const pickNum = draftOrder[String(pick.roster_id)];
                if (Number.isFinite(pickNum)) {
                  label = `${season} ${round}.${String(pickNum).padStart(2, '0')}`;
                }
              }
              return (
                <div key={i} className="teams2-pick-chip">
                  <span className="teams2-pick-round">R{round}</span>
                  <span className="teams2-pick-label">{label}</span>
                  {via && <span className="teams2-pick-via">via {via}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {modal && createPortal(modal, document.body)}
    </div>
  );
}

export default Teams2Overview;
