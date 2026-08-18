import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchTeamData, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { calculateDraftOrder } from '../utils/DraftOrderHelper';
import { CURRENT_YEAR, getCompletedWeeksCount } from '../utils/DateHelper';
import { PREVIOUS_YEARS } from '../utils/global_constants';

const PLAYOFF_END_WEEK = 17;
const ALL_YEARS = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)].sort(
  (a, b) => Number(b) - Number(a)
);

function getAvatarUrl(user) {
  if (!user) return null;
  return user.user_avatar_url || user.avatar_url || user.team_avatar_url || null;
}

function LeagueHistoryCard() {
  const [loading, setLoading] = useState(true);
  const [seasons, setSeasons] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [players, idMap] = await Promise.all([
          fetchPlayersData(),
          fetchPlayerIdMap(),
        ]);

        const results = await Promise.all(
          ALL_YEARS.map(async (year) => {
            try {
              const completedWeeks = getCompletedWeeksCount(year);
              if (!Number.isFinite(completedWeeks) || completedWeeks < PLAYOFF_END_WEEK) {
                return null;
              }
              const [weeksData, teamData] = await Promise.all([
                fetchScoresData(year),
                fetchTeamData(year),
              ]);
              if (!weeksData || !teamData?.rosters || !teamData?.users) return null;

              const rosterMap = buildRosterIdToTeamInfoMap(teamData.rosters, teamData.users);
              const placeToRosterId = calculateDraftOrder(year, weeksData, teamData, players, idMap);

              const top4 = [];
              for (let place = 1; place <= 4; place += 1) {
                const rid = placeToRosterId[place];
                if (rid == null) continue;
                const info = rosterMap[rid] || rosterMap[String(rid)] || null;
                const ownerName = info?.ownerName || null;
                const displayName = ownerName && !ownerName.startsWith('Owner ') ? ownerName : (info?.teamName || `Team ${rid}`);
                top4.push({
                  place,
                  rosterId: Number(rid),
                  avatarUrl: getAvatarUrl(info?.user),
                  name: displayName,
                });
              }

              return { year: String(year), top4 };
            } catch (_) {
              return null;
            }
          })
        );

        if (!cancelled) {
          setSeasons(results.filter(Boolean));
        }
      } catch (_) {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const PLACE_LABELS = ['🏆', '2nd', '3rd', '4th'];

  return (
    <HomeCard>
      <div className="home-card-inner">
        <h2 className="home-card-title">📜 League History</h2>
        <div className="home-card-body">
          {loading && <LoadingState label="Loading…" ariaLabel="Loading history" />}

          {!loading && seasons.length === 0 && (
            <div className="previous-year-recap-status">No completed seasons yet.</div>
          )}

          {!loading && seasons.length > 0 && (
            <div className="lh-card-seasons">
              {seasons.map((season) => (
                <div key={season.year} className="lh-card-season">
                  <div className="lh-card-year">{season.year}</div>
                  <div className="lh-card-top4">
                    {season.top4.map((team) => (
                      <div key={team.rosterId} className="lh-card-team" title={`${PLACE_LABELS[team.place - 1]} ${team.name}`}>
                        <div className="lh-card-place">{PLACE_LABELS[team.place - 1]}</div>
                        {team.avatarUrl ? (
                          <img className="lh-card-avatar" src={team.avatarUrl} alt="" />
                        ) : (
                          <div className="lh-card-avatar lh-card-avatar--placeholder" />
                        )}
                        <div className="lh-card-name">{team.name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="active-playoffs-link-row">
          <Link className="active-playoffs-link" to="/league-history">
            View Full History →
          </Link>
        </div>
      </div>
    </HomeCard>
  );
}

export default LeagueHistoryCard;
