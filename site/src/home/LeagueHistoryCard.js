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
import { useMyCurrentRosterId, isMyRoster } from '../hooks/useAuthUser';

const PLAYOFF_END_WEEK = 17;
const ALL_YEARS = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)].sort(
  (a, b) => Number(b) - Number(a)
);

function placeLabel(place) {
  if (place === 1) return 'Champion';
  if (place === 2) return '2nd';
  if (place === 3) return '3rd';
  if (place === 4) return '4th';
  return `${place}th`;
}

function teamPageHref(rosterId, year) {
  const base = `/team/${rosterId}`;
  if (!year) return base;
  return `${base}?year=${encodeURIComponent(year)}`;
}

function getOwnerAvatarUrl(user) {
  if (!user) return null;
  // user_avatar_url is already enriched (custom profile, else team / later-season logo).
  return user.user_avatar_url || user.avatar_url || user.team_avatar_url || null;
}

function getTeamAvatarUrl(user) {
  if (!user) return null;
  return user.team_avatar_url || user.user_avatar_url || user.avatar_url || null;
}

function TeamAvatar({ url, name, className }) {
  if (url) {
    return <img className={className} src={url} alt="" />;
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <div className={`${className} lh-card-avatar--placeholder`} aria-hidden="true">
      {initial}
    </div>
  );
}

function LeagueHistoryCard() {
  const myRosterId = useMyCurrentRosterId();
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
                  ownerAvatarUrl: getOwnerAvatarUrl(info?.user),
                  teamAvatarUrl: getTeamAvatarUrl(info?.user),
                  name: displayName,
                  teamName: info?.teamName || displayName,
                });
              }

              if (!top4.length) return null;
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

  return (
    <HomeCard>
      <div className="home-card-inner">
        <div className="home-card-title-row">
          <h2 className="home-card-title">📜 League History</h2>
          <Link className="active-playoffs-link" to="/league-history">
            View Full History →
          </Link>
        </div>
        <div className="home-card-body">
          {loading && <LoadingState label="Loading…" ariaLabel="Loading history" />}

          {!loading && seasons.length === 0 && (
            <div className="previous-year-recap-status">No completed seasons yet.</div>
          )}

          {!loading && seasons.length > 0 && (
            <div className="lh-card-seasons">
              {seasons.map((season) => {
                const champ = season.top4.find((team) => team.place === 1) || season.top4[0];
                const rest = season.top4.filter((team) => team.place !== champ?.place);
                const champIsMe = champ ? isMyRoster(champ.rosterId, myRosterId) : false;
                const champMainAvatar = champ
                  ? (champ.teamAvatarUrl || champ.ownerAvatarUrl)
                  : null;
                const champOwnerAvatar =
                  champ &&
                  champ.ownerAvatarUrl &&
                  champ.ownerAvatarUrl !== champMainAvatar
                    ? champ.ownerAvatarUrl
                    : null;

                return (
                  <div key={season.year} className="lh-card-season">
                    <div className="lh-card-year">{season.year}</div>
                    <div className="lh-card-row">
                      {champ ? (
                        <Link
                          to={teamPageHref(champ.rosterId, season.year)}
                          className={`lh-card-champ${champIsMe ? ' recap-team--me' : ''}`}
                          title={`${placeLabel(champ.place)} · ${champ.teamName}`}
                        >
                          <span className="lh-card-champ-trophy" aria-hidden="true">🏆</span>
                          <TeamAvatar
                            url={champMainAvatar}
                            name={champ.teamName}
                            className="lh-card-champ-avatar"
                          />
                          <div className="lh-card-champ-copy">
                            <div className="lh-card-champ-name">{champ.teamName}</div>
                            <div className="lh-card-champ-owner">
                              {champOwnerAvatar ? (
                                <TeamAvatar
                                  url={champOwnerAvatar}
                                  name={champ.name}
                                  className="lh-card-champ-owner-avatar"
                                />
                              ) : null}
                              <span className="lh-card-champ-owner-name">
                                {champ.name}
                                {champIsMe ? <span className="me-chip">YOU</span> : null}
                              </span>
                            </div>
                          </div>
                        </Link>
                      ) : null}
                    </div>

                    {rest.length > 0 && (
                      <div className="lh-card-rest" aria-label={`${season.year} final four`}>
                        {rest.map((team) => {
                          const me = isMyRoster(team.rosterId, myRosterId);
                          return (
                            <Link
                              key={team.rosterId}
                              to={teamPageHref(team.rosterId, season.year)}
                              className={`lh-card-rest-team lh-card-rest-team--p${team.place}${me ? ' recap-team--me' : ''}`}
                              title={`${placeLabel(team.place)} · ${team.name}`}
                            >
                              <TeamAvatar
                                url={team.teamAvatarUrl || team.ownerAvatarUrl}
                                name={team.name}
                                className={`lh-card-rest-avatar lh-card-rest-avatar--p${team.place}`}
                              />
                              <div className="lh-card-rest-copy">
                                <div className="lh-card-rest-place">{placeLabel(team.place)}</div>
                                <div className="lh-card-rest-name">
                                  {team.name}
                                  {me ? <span className="me-chip">YOU</span> : null}
                                </div>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </HomeCard>
  );
}

export default LeagueHistoryCard;
