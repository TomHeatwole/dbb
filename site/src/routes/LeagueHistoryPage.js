import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import PageMeta from '../PageMeta';
import LoadingState from '../LoadingState';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchTeamData, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { getStandings } from '../scores/ScoresParser';
import { calculateDraftOrder } from '../utils/DraftOrderHelper';
import { CURRENT_YEAR, getCompletedWeeksCount } from '../utils/DateHelper';
import { PREVIOUS_YEARS } from '../utils/global_constants';
import { useMyCurrentRosterId, isMyRoster } from '../hooks/useAuthUser';

const OG_TITLE = 'League History';
const OG_DESCRIPTION = 'Champions, runners-up, Top PF, and all-time career records.';
const PLAYOFF_END_WEEK = 17;

const ALL_YEARS = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)].sort(
  (a, b) => Number(b) - Number(a)
);

// Roster 2 changed hands between 2024 (mehrj14) and 2025 (aidsonballs).
// We merge them into one career entry keyed by roster slot, not owner_id.
const MERGED_ROSTER_IDS = new Set([2]);
const MERGED_ROSTER_NOTES = {
  2: { full: 'owned by mehrj14 during 2024 championship run', short: 'prev. mehrj14' },
};

function getTeamLabel(teamInfo, rosterId) {
  const ownerName = teamInfo?.ownerName || null;
  const teamName = teamInfo?.teamName || `Team ${rosterId}`;
  const displayName = ownerName && ownerName !== `Owner ${rosterId}` ? ownerName : teamName;
  const avatarUrl =
    teamInfo && teamInfo.user
      ? teamInfo.user.user_avatar_url ||
        teamInfo.user.avatar_url ||
        teamInfo.user.team_avatar_url ||
        null
      : null;
  const ownerId =
    teamInfo && teamInfo.roster && teamInfo.roster.owner_id != null
      ? String(teamInfo.roster.owner_id)
      : null;
  return { name: displayName, teamName, avatarUrl, ownerId, ownerName };
}

function playoffFormatForYear(year) {
  return String(year) === '2024' ? 'cumulative' : 'bracket';
}

function formatAvgFinish(avg) {
  if (avg == null || !Number.isFinite(avg)) return '—';
  const rounded = Math.round(avg * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function ordinal(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  const mod100 = num % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${num}th`;
  switch (num % 10) {
    case 1:
      return `${num}st`;
    case 2:
      return `${num}nd`;
    case 3:
      return `${num}rd`;
    default:
      return `${num}th`;
  }
}

async function loadSeasonHistory(year, players, idMap) {
  const completedWeeks = getCompletedWeeksCount(year);
  if (!Number.isFinite(completedWeeks) || completedWeeks < PLAYOFF_END_WEEK) {
    return null;
  }

  const [weeksData, teamData] = await Promise.all([
    fetchScoresData(year),
    fetchTeamData(year),
  ]);

  if (!weeksData || !Array.isArray(weeksData)) {
    throw new Error(`No scores data for ${year}`);
  }
  if (!teamData || !Array.isArray(teamData.rosters) || !Array.isArray(teamData.users)) {
    throw new Error(`No team data for ${year}`);
  }

  const rosterMap = buildRosterIdToTeamInfoMap(teamData.rosters, teamData.users);
  const placeToRosterId = calculateDraftOrder(year, weeksData, teamData, players, idMap);

  const championId = placeToRosterId[1] != null ? Number(placeToRosterId[1]) : null;
  const runnerUpId = placeToRosterId[2] != null ? Number(placeToRosterId[2]) : null;
  if (championId == null || runnerUpId == null) {
    return null;
  }

  // Absolute Top PF over weeks 1–17 (true season points leader).
  const standingsAll17 = getStandings((weeksData || []).slice(0, 17).filter(Boolean)) || [];
  const pfOrdered = standingsAll17
    .slice()
    .sort((a, b) => (b.points_scored || 0) - (a.points_scored || 0));
  const topPfId =
    pfOrdered.length && pfOrdered[0].roster_id != null
      ? Number(pfOrdered[0].roster_id)
      : null;

  // Display Top PF like the home card: prefer a team not already champ/runner-up.
  const top2Ids = new Set([championId, runnerUpId].map(String));
  let displayTopPfId = null;
  for (const row of pfOrdered) {
    if (!row || row.roster_id == null) continue;
    if (!top2Ids.has(String(row.roster_id))) {
      displayTopPfId = Number(row.roster_id);
      break;
    }
  }
  if (displayTopPfId == null && topPfId != null) {
    displayTopPfId = topPfId;
  }

  function toResultRow(key, label, rosterId) {
    if (rosterId == null) return null;
    const info = rosterMap[rosterId] || rosterMap[String(rosterId)] || null;
    const { name, avatarUrl, ownerId, ownerName } = getTeamLabel(info, rosterId);
    return { key, label, rosterId, teamName: name, avatarUrl, ownerId, ownerName };
  }

  const highlightRows = [
    toResultRow('winner', '🏆 Winner', championId),
    toResultRow('runner_up', '🥈 Runner-up', runnerUpId),
    toResultRow('top_pf', '📈 Top PF', displayTopPfId),
  ].filter(Boolean);

  const placements = [];
  for (let place = 1; place <= 10; place += 1) {
    const rosterId = placeToRosterId[place];
    if (rosterId == null) continue;
    const rid = Number(rosterId);
    const info = rosterMap[rid] || rosterMap[String(rid)] || null;
    const { name, avatarUrl, ownerId, ownerName } = getTeamLabel(info, rid);
    placements.push({
      place,
      rosterId: rid,
      teamName: name,
      avatarUrl,
      ownerId,
      ownerName,
      isChampion: place === 1,
      madePlayoffs: place <= 4,
      isTopPf: topPfId != null && Number(topPfId) === rid,
    });
  }

  return {
    year: String(year),
    highlightRows,
    placements,
  };
}

function LeagueHistoryPage() {
  const myRosterId = useMyCurrentRosterId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [yearResults, setYearResults] = useState([]);
  const [ownerToCurrentRosterId, setOwnerToCurrentRosterId] = useState({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [players, idMap, currentTeamData] = await Promise.all([
          fetchPlayersData(),
          fetchPlayerIdMap(),
          fetchTeamData(CURRENT_YEAR).catch(() => null),
        ]);

        const ownerMap = {};
        if (currentTeamData?.rosters) {
          for (const roster of currentTeamData.rosters) {
            if (roster?.owner_id != null && roster.roster_id != null) {
              ownerMap[String(roster.owner_id)] = Number(roster.roster_id);
            }
          }
        }

        const seasons = await Promise.all(
          ALL_YEARS.map(async (year) => {
            try {
              return await loadSeasonHistory(year, players, idMap);
            } catch (_) {
              return null;
            }
          })
        );

        if (cancelled) return;

        setOwnerToCurrentRosterId(ownerMap);
        setYearResults(seasons.filter(Boolean));
      } catch (_) {
        if (!cancelled) setError('Unable to load league history right now.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const careerRows = useMemo(() => {
    const byKey = {};

    for (const season of yearResults) {
      for (const p of season.placements) {
        // Merge roster-slot transfers (e.g. roster 2 changed owners between seasons).
        const key = MERGED_ROSTER_IDS.has(p.rosterId)
          ? `roster:${p.rosterId}`
          : p.ownerId || `roster:${p.rosterId}`;
        if (!byKey[key]) {
          byKey[key] = {
            ownerId: p.ownerId,
            teamName: p.teamName,
            avatarUrl: p.avatarUrl,
            championships: 0,
            playoffAppearances: 0,
            topPfWins: 0,
            finishSum: 0,
            seasonsPlayed: 0,
            bestFinish: null,
            latestYear: null,
            mergedRosterId: MERGED_ROSTER_IDS.has(p.rosterId) ? p.rosterId : null,
            ownerNames: new Set(),
          };
        }
        const row = byKey[key];
        if (p.ownerName) {
          row.ownerNames.add(p.ownerName);
        }
        if (row.latestYear == null || Number(season.year) > Number(row.latestYear)) {
          row.latestYear = season.year;
          row.teamName = p.teamName;
          row.avatarUrl = p.avatarUrl;
          row.ownerId = p.ownerId;
        }
        row.seasonsPlayed += 1;
        row.finishSum += p.place;
        if (row.bestFinish == null || p.place < row.bestFinish) {
          row.bestFinish = p.place;
        }
        if (p.isChampion) row.championships += 1;
        if (p.madePlayoffs) row.playoffAppearances += 1;
        if (p.isTopPf) row.topPfWins += 1;
      }
    }

    return Object.values(byKey)
      .map((row) => ({
        ...row,
        ownerNames: Array.from(row.ownerNames),
        avgFinish: row.seasonsPlayed > 0 ? row.finishSum / row.seasonsPlayed : null,
        currentRosterId:
          row.ownerId && ownerToCurrentRosterId[row.ownerId] != null
            ? ownerToCurrentRosterId[row.ownerId]
            : row.mergedRosterId != null
              ? row.mergedRosterId
              : null,
        mergedNote:
          row.mergedRosterId != null && MERGED_ROSTER_NOTES[row.mergedRosterId]
            ? MERGED_ROSTER_NOTES[row.mergedRosterId]
            : null,  
      }))
      .sort((a, b) => {
        if (b.championships !== a.championships) return b.championships - a.championships;
        if ((a.avgFinish || 99) !== (b.avgFinish || 99)) {
          return (a.avgFinish || 99) - (b.avgFinish || 99);
        }
        if (b.playoffAppearances !== a.playoffAppearances) {
          return b.playoffAppearances - a.playoffAppearances;
        }
        if (b.topPfWins !== a.topPfWins) return b.topPfWins - a.topPfWins;
        return String(a.teamName).localeCompare(String(b.teamName));
      });
  }, [yearResults, ownerToCurrentRosterId]);

  function renderTeamCell(teamName, avatarUrl, rosterIdForLink, rosterIdForMe, mergedNote) {
    const me = isMyRoster(rosterIdForMe, myRosterId);
    const className = `league-history-team-link${me ? ' recap-team--me league-history-me' : ''}`;
    const inner = (
      <>
        {avatarUrl ? (
          <img className="league-history-avatar" src={avatarUrl} alt="" />
        ) : (
          <div className="league-history-avatar league-history-avatar--placeholder" />
        )}
        {mergedNote ? (
          <span className="league-history-team-name-wrap">
            <span className="league-history-team-name">
              {teamName}
              <span className="league-history-asterisk league-history-asterisk--desktop"> * {mergedNote.full}</span>
              {me ? <span className="me-chip">YOU</span> : null}
            </span>
            <span className="league-history-asterisk league-history-asterisk--mobile">* {mergedNote.short}</span>
          </span>
        ) : (
          <span className="league-history-team-name">
            {teamName}
            {me ? <span className="me-chip">YOU</span> : null}
          </span>
        )}
      </>
    );

    if (rosterIdForLink != null) {
      return (
        <Link to={`/team/${rosterIdForLink}`} className={className}>
          {inner}
        </Link>
      );
    }

    return <div className={className}>{inner}</div>;
  }

  function renderHighlightRow(row) {
    const currentRid =
      row.ownerId && ownerToCurrentRosterId[row.ownerId] != null
        ? ownerToCurrentRosterId[row.ownerId]
        : null;
    const me = isMyRoster(currentRid, myRosterId);
    const teamInner = (
      <>
        {row.avatarUrl ? (
          <img
            className="previous-year-recap-avatar"
            src={row.avatarUrl}
            alt={`${row.teamName} avatar`}
          />
        ) : (
          <div className="previous-year-recap-avatar previous-year-recap-avatar--placeholder" />
        )}
        <div className="previous-year-recap-name">
          {row.teamName}
          {me ? <span className="me-chip">YOU</span> : null}
        </div>
      </>
    );

    return (
      <div key={row.key} className="league-history-result-row">
        <div className="previous-year-recap-rank">{row.label}</div>
        {currentRid != null ? (
          <Link
            to={`/team/${currentRid}`}
            className={`previous-year-recap-team${me ? ' recap-team--me' : ''}`}
          >
            {teamInner}
          </Link>
        ) : (
          <div className={`previous-year-recap-team${me ? ' recap-team--me' : ''}`}>{teamInner}</div>
        )}
      </div>
    );
  }

  return (
    <>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
      <InfoPageWrapper title="League History">
        {loading && <LoadingState label="Loading league history…" />}

        {!loading && error && <div className="league-history-error">{error}</div>}

        {!loading && !error && yearResults.length === 0 && (
          <div className="league-history-empty">No completed seasons yet.</div>
        )}

        {!loading && !error && yearResults.length > 0 && (
          <div className="league-history-root">
            <section className="league-history-highlights" aria-label="Past season results">
              <h2 className="league-history-section-title">Past Champions</h2>
              <div className="league-history-year-grid">
                {yearResults.map((season) => {
                  const format = playoffFormatForYear(season.year);
                  return (
                    <div key={season.year} className="league-history-year-card">
                      <div className="league-history-year-card-header">
                        <h3 className="league-history-year-heading">🏁 {season.year} Results</h3>
                        <Link
                          className="league-history-yoffs-link"
                          to={`/yoffs?year=${season.year}&format=${format}&tab=Bracket`}
                        >
                          View Playoffs →
                        </Link>
                      </div>
                      <div className="previous-year-recap-list">
                        {season.highlightRows.map((row) => renderHighlightRow(row))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="league-history-career" aria-label="Career records">
              <h2 className="league-history-section-title">Career Records</h2>
              <div className="league-history-table-wrap">
                <table className="league-history-table">
                  <thead>
                    <tr>
                      <th scope="col">Owner</th>
                      <th scope="col" title="Championships">
                        🏆
                      </th>
                      <th scope="col" title="Playoff appearances">
                        Playoffs
                      </th>
                      <th scope="col" title="Top PF wins">
                        Top PF
                      </th>
                      <th scope="col" title="Average finish">
                        Avg
                      </th>
                      <th scope="col" title="Best finish">
                        Best
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {careerRows.map((row) => (
                      <tr key={row.ownerId || row.teamName}>
                        <td>
                          {renderTeamCell(
                            row.teamName,
                            row.avatarUrl,
                            row.currentRosterId,
                            row.currentRosterId,
                            row.mergedNote
                          )}
                        </td>
                        <td className={row.championships > 0 ? 'league-history-stat--hot' : ''}>
                          {row.championships}
                        </td>
                        <td>{row.playoffAppearances}</td>
                        <td className={row.topPfWins > 0 ? 'league-history-stat--hot' : ''}>
                          {row.topPfWins}
                        </td>
                        <td>{formatAvgFinish(row.avgFinish)}</td>
                        <td>{ordinal(row.bestFinish)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </InfoPageWrapper>
    </>
  );
}

export default LeagueHistoryPage;
