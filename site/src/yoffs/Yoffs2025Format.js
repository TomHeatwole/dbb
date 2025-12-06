import React, { useEffect, useState, useRef } from 'react';
import YoffsScoresView from './YoffsScoresView';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchTeamData } from '../lookups/TeamLookup';
import { getStandings, getWeekScoreBreakdown, getPlayerSeasonTotalsMap } from '../scores/ScoresParser';
import { StartSitSort } from '../players/StartSitDecider';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { CURRENT_YEAR, getCompletedWeeksCount } from '../utils/DateHelper';
import { Link, useSearchParams } from 'react-router-dom';
import MatchupView from '../matchups/MatchupView';

function Yoffs2025Format({
  season,
  selectedTab,
  onTabChange,
  playoffStartWeek,
  playoffEndWeek,
  showPlayoffPictureWarning,
  playoffSeedLockWeek,
  playoffsStarted
}) {
  const tabOptions = ['Bracket', 'Scores', 'Matchups'];
  const [seedTeams, setSeedTeams] = useState(null);
  const [loadingSeeds, setLoadingSeeds] = useState(true);
  const [seedError, setSeedError] = useState(null);
  const [finalsInfo, setFinalsInfo] = useState(null);
  const [selectedMatchupId, setSelectedMatchupId] = useState(1);
  const [searchParams, setSearchParams] = useSearchParams();
  const [matchupDropdownOpen, setMatchupDropdownOpen] = useState(false);
  const matchupDropdownRef = useRef(null);

  const matchupOptionsBase = [
    { id: 1, label: 'Semifinal 1' },
    { id: 2, label: 'Semifinal 2' },
    { id: 3, label: 'Championship' },
  ];

  const semiEndGlobal = Math.max(playoffStartWeek, playoffEndWeek - 1);
  const completedWeeksForSeason = getCompletedWeeksCount(season);
  const isCurrentSeasonGlobal = String(season) === String(CURRENT_YEAR);
  const semisCompletedGlobal =
    semiEndGlobal <= completedWeeksForSeason || !isCurrentSeasonGlobal;

  const [baseWeeksData, setBaseWeeksData] = useState(null);
  const [baseTeamData, setBaseTeamData] = useState(null);
  const [basePlayersData, setBasePlayersData] = useState(null);
  const [basePlayerIdMap, setBasePlayerIdMap] = useState(null);

  const matchupOptions = semisCompletedGlobal
    ? matchupOptionsBase
    : matchupOptionsBase.filter((opt) => opt.id !== 3);
  const availableMatchupIds = matchupOptions.map((opt) => opt.id);
  const minMatchupId = Math.min(...availableMatchupIds);
  const maxMatchupId = Math.max(...availableMatchupIds);

  const urlMatchupRaw = searchParams.get('matchup');
  const urlMatchupId =
    urlMatchupRaw && ['1', '2', '3'].includes(urlMatchupRaw)
      ? Number(urlMatchupRaw)
      : null;

  useEffect(() => {
    if (selectedTab !== 'Matchups') {
      return;
    }
    const defaultId = semisCompletedGlobal ? 3 : 1;
    let effectiveId = urlMatchupId || defaultId;

    // If semis are not complete, do not allow Championship (3) as the active matchup.
    if (!semisCompletedGlobal && effectiveId === 3) {
      effectiveId = 1;
    }
    if (effectiveId !== selectedMatchupId) {
      setSelectedMatchupId(effectiveId);
    }
    // If there was no matchup specified in the URL, write our default back
    if (!urlMatchupId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('matchup', String(effectiveId));
      setSearchParams(nextParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlMatchupId, semisCompletedGlobal, selectedTab]);

  useEffect(() => {
    if (!matchupDropdownOpen) {
      return;
    }
    const handleClickOutside = (e) => {
      if (matchupDropdownRef.current && !matchupDropdownRef.current.contains(e.target)) {
        setMatchupDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [matchupDropdownOpen]);

  useEffect(() => {
    setMatchupDropdownOpen(false);
  }, [selectedMatchupId]);

  const handleMatchupChange = (nextId) => {
    if (nextId === selectedMatchupId) {
      return;
    }
    if (!availableMatchupIds.includes(nextId)) {
      return;
    }
    setSelectedMatchupId(nextId);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('matchup', String(nextId));
    setSearchParams(nextParams, { replace: true });
  };

  useEffect(() => {
    let cancelled = false;

    async function loadSeeds() {
      setLoadingSeeds(true);
      setSeedError(null);
      try {
        const [weeksData, teamData, idMap] = await Promise.all([
          fetchScoresData(season),
          fetchTeamData(season),
          fetchPlayerIdMap()
        ]);
        if (cancelled) {
          return;
        }
        if (!weeksData || !Array.isArray(weeksData)) {
          throw new Error('No scores data');
        }
        if (!teamData || !Array.isArray(teamData.rosters) || !Array.isArray(teamData.users)) {
          throw new Error('No team data');
        }

        // For current-season brackets, build playersData from the actual rosters so
        // any player that appears in playoff lineups has metadata (name, avatar, etc.).
        // For past seasons, fall back to season-based lookup.
        let players = null;
        try {
          const useRosters =
            String(season) === String(CURRENT_YEAR) && Array.isArray(teamData.rosters)
              ? teamData.rosters
              : String(season);
          players = await fetchPlayersData(useRosters);
        } catch (_) {
          players = null;
        }

        const regularSliceFull = weeksData.slice(0, 14);
        const weeksRegular = regularSliceFull.filter(Boolean);
        if (!weeksRegular.length) {
          setSeedTeams([]);
          setLoadingSeeds(false);
          return;
        }

        const standingsRegular = getStandings(weeksRegular) || [];
        const top4Regular = standingsRegular
          .slice()
          .sort((a, b) => a.place - b.place)
          .slice(0, 4);
        const seedIds = top4Regular.map((r) => Number(r.roster_id));
        const seedSet = new Set(seedIds);

        // Compute cumulative semifinal totals for each playoff team (StartSit-based)
        const seasonTotalsMap = getPlayerSeasonTotalsMap(weeksData);
        const semiStart = playoffStartWeek;
        const semiEnd = Math.max(playoffStartWeek, playoffEndWeek - 1);
        const semiTotals = {};
        for (let wk = semiStart; wk <= semiEnd; wk += 1) {
          const breakdown = getWeekScoreBreakdown(weeksData, wk) || {};
          const weekEntries = Array.isArray(weeksData[wk - 1]) ? weeksData[wk - 1] : [];
          const basePointsByRoster = {};
          weekEntries.forEach((entry) => {
            if (!entry || entry.roster_id == null) {
              return;
            }
            const rid = Number(entry.roster_id);
            if (!seedSet.has(rid)) {
              return;
            }
            if (!basePointsByRoster[rid]) {
              basePointsByRoster[rid] = 0;
            }
            if (typeof entry.points === 'number' && isFinite(entry.points)) {
              basePointsByRoster[rid] += Math.round(entry.points * 10) / 10;
            }
          });

          Object.keys(breakdown).forEach((ridKey) => {
            const rid = Number(ridKey);
            if (!seedSet.has(rid)) {
              return;
            }
            let weekTotal = basePointsByRoster[rid] || 0;
            try {
              if (players && idMap) {
                const teamScore = breakdown[ridKey];
                if (teamScore) {
                  const computed = StartSitSort(teamScore, players, idMap, null, null, seasonTotalsMap);
                  if (computed && typeof computed.starterTotal === 'number') {
                    weekTotal = Math.round(computed.starterTotal * 10) / 10;
                  }
                }
              }
            } catch (_) {
              // fallback to base API points
            }
            if (typeof weekTotal === 'number' && isFinite(weekTotal)) {
              if (!semiTotals[rid]) {
                semiTotals[rid] = 0;
              }
              semiTotals[rid] += weekTotal;
            }
          });
        }

        const seeds = top4Regular
          .map((row) => {
            const rid = Number(row.roster_id);
            const roster = teamData.rosters.find(
              (r) => String(r.roster_id) === String(rid)
            );
            const user =
              roster && teamData.users
                ? teamData.users.find(
                    (u) =>
                      String(u.user_id) === String(roster.owner_id)
                  )
                : null;
            let teamName = `Team ${rid}`;
            if (user && user.metadata && user.metadata.team_name) {
              teamName = user.metadata.team_name;
            } else if (user && user.display_name) {
              teamName = `Team ${user.display_name}`;
            }
            const avatarUrl =
              (user &&
                (user.team_avatar_url ||
                  user.user_avatar_url ||
                  user.avatar_url)) ||
              null;
            return {
              rosterId: rid,
              seed: row.place,
              teamName,
              avatarUrl,
              semiTotal: semiTotals[rid] != null ? semiTotals[rid] : null
            };
          })
          .sort((a, b) => (a.seed || 999) - (b.seed || 999));

        // Determine if all semifinal weeks are completed
        const isCurrentSeason = String(season) === String(CURRENT_YEAR);
        const completedWeeks = getCompletedWeeksCount(season);
        const semisCompleted = semiEnd <= completedWeeks || !isCurrentSeason;

        let finalsLocal = null;
        if (semisCompleted && seeds.length >= 2) {
          const seed1 = seeds.find((t) => t.seed === 1) || seeds[0];
          const seed4 =
            seeds.find((t) => t.seed === 4) || seeds[seeds.length - 1];
          const seed2 = seeds.find((t) => t.seed === 2) || seeds[1];
          const seed3 =
            seeds.find((t) => t.seed === 3) ||
            seeds[Math.min(2, seeds.length - 1)];

          const total1 = semiTotals[seed1.rosterId] || 0;
          const total4 = semiTotals[seed4.rosterId] || 0;
          const total2 = semiTotals[seed2.rosterId] || 0;
          const total3 = semiTotals[seed3.rosterId] || 0;

          const topWinner =
            total1 > total4 ||
            (total1 === total4 && (seed1.seed || 999) < (seed4.seed || 999))
              ? seed1
              : seed4;
          const bottomWinner =
            total2 > total3 ||
            (total2 === total3 && (seed2.seed || 999) < (seed3.seed || 999))
              ? seed2
              : seed3;

          const topWinnerSemi = semiTotals[topWinner.rosterId] || 0;
          const bottomWinnerSemi = semiTotals[bottomWinner.rosterId] || 0;
          const highSemi = Math.max(topWinnerSemi, bottomWinnerSemi);
          const lowSemi = Math.min(topWinnerSemi, bottomWinnerSemi);
          const buffer =
            highSemi > lowSemi ? (highSemi - lowSemi) / 2 : 0;

          const finalsWeek = playoffEndWeek;
          const finalsBreakdown =
            getWeekScoreBreakdown(weeksData, finalsWeek) || {};

          const computeFinalBase = (rid) => {
            let weekTotal = 0;
            const raw = finalsBreakdown[rid];
            if (raw && players && idMap) {
              try {
                const computed = StartSitSort(raw, players, idMap, null, null, seasonTotalsMap);
                if (computed && typeof computed.starterTotal === 'number') {
                  weekTotal = Math.round(computed.starterTotal * 10) / 10;
                }
              } catch (_) {
                // If StartSitSort fails, weekTotal remains 0
              }
            }
            return weekTotal;
          };

          let topFinal = computeFinalBase(topWinner.rosterId);
          let bottomFinal = computeFinalBase(bottomWinner.rosterId);
          let bufferRecipient = null;

          if (buffer > 0) {
            if (topWinnerSemi > bottomWinnerSemi) {
              topFinal += buffer;
              bufferRecipient = {
                rosterId: topWinner.rosterId,
                teamName: topWinner.teamName,
                avatarUrl: topWinner.avatarUrl || null,
                amount: buffer,
              };
            } else if (bottomWinnerSemi > topWinnerSemi) {
              bottomFinal += buffer;
              bufferRecipient = {
                rosterId: bottomWinner.rosterId,
                teamName: bottomWinner.teamName,
                avatarUrl: bottomWinner.avatarUrl || null,
                amount: buffer,
              };
            }
          }

          topFinal = Math.round(topFinal * 10) / 10;
          bottomFinal = Math.round(bottomFinal * 10) / 10;

          finalsLocal = {
            top: {
              ...topWinner,
              finalsTotal: topFinal,
            },
            bottom: {
              ...bottomWinner,
              finalsTotal: bottomFinal,
            },
            buffer: bufferRecipient,
          };
        }

        setBaseWeeksData(weeksData);
        setBaseTeamData(teamData);
        setBasePlayersData(players);
        setBasePlayerIdMap(idMap);
        setSeedTeams(seeds);
        setFinalsInfo(finalsLocal);
        setLoadingSeeds(false);
      } catch (e) {
        if (!cancelled) {
          setSeedError('Failed to load bracket seeds');
          setSeedTeams([]);
          setLoadingSeeds(false);
        }
      }
    }

    loadSeeds();

    return () => {
      cancelled = true;
    };
  }, [season, playoffStartWeek, playoffEndWeek]);

  return (
    <>
      <div className="team-tabs-bar">
        {tabOptions.map((tab) => (
          <button
            key={tab}
            className={`team-tab${selectedTab === tab ? ' team-tab-active' : ''}`}
            onClick={() => {
              if (onTabChange) {
                onTabChange(tab);
              }
            }}
            type="button"
          >
            {tab}
          </button>
        ))}
      </div>

      {showPlayoffPictureWarning && (
        <div className="team-analytics-info yoffs-playoff-info">
          <span className="warning-icon" aria-label="Playoff picture notice">
            ⚠️
          </span>
          <span className="team-analytics-info-text">
            This is the current playoff picture. Teams and seeds are subject to change until Week {playoffSeedLockWeek} has concluded.
          </span>
        </div>
      )}

      {selectedTab === 'Bracket' && (
        <>
          {loadingSeeds && (
            <div className="loading-center">
              <div className="spinner" aria-label="Loading" />
              <div className="loading-text">Loading bracket…</div>
            </div>
          )}
          {!loadingSeeds && seedError && <div>{seedError}</div>}
          {!loadingSeeds && !seedError && (!seedTeams || seedTeams.length === 0) && (
            <div>No playoff teams found for this season.</div>
          )}
          {!loadingSeeds && !seedError && seedTeams && seedTeams.length > 0 && (
            <div className="yoffs-bracket">
              {(() => {
                const semiStart = playoffStartWeek;
                const semiEnd = Math.max(playoffStartWeek, playoffEndWeek - 1);
                const finalsWeek = playoffEndWeek;
                const semiLabel =
                  semiStart === semiEnd
                    ? `Semifinals (Week ${semiStart})`
                    : `Semifinals (Weeks ${semiStart}-${semiEnd})`;
                const finalsLabel =
                  `Championship (Week ${finalsWeek} + Semis Buffer)`;

                const seed1 = seedTeams.find((t) => t.seed === 1) || seedTeams[0];
                const seed4 =
                  seedTeams.find((t) => t.seed === 4) ||
                  seedTeams[seedTeams.length - 1];
                const seed2 = seedTeams.find((t) => t.seed === 2) || seedTeams[1];
                const seed3 =
                  seedTeams.find((t) => t.seed === 3) ||
                  seedTeams[Math.min(2, seedTeams.length - 1)];

                const formatScore = (val) =>
                  typeof val === 'number' && isFinite(val)
                    ? `${val.toFixed(1)} pts`
                    : '—';

                const isCurrentSeasonLocal = String(season) === String(CURRENT_YEAR);
                const completedWeeksLocal = getCompletedWeeksCount(season);
                const semisCompleted =
                  semiEnd <= completedWeeksLocal || !isCurrentSeasonLocal;
                const finalsCompleted =
                  finalsWeek <= completedWeeksLocal || !isCurrentSeasonLocal;

                const topSemiWinner =
                  semisCompleted &&
                  ((seed1.semiTotal || 0) > (seed4.semiTotal || 0) ||
                    ((seed1.semiTotal || 0) === (seed4.semiTotal || 0) &&
                      (seed1.seed || 999) < (seed4.seed || 999)));
                const bottomSemiWinner =
                  semisCompleted &&
                  ((seed2.semiTotal || 0) > (seed3.semiTotal || 0) ||
                    ((seed2.semiTotal || 0) === (seed3.semiTotal || 0) &&
                      (seed2.seed || 999) < (seed3.seed || 999)));

                const finalsTopWinner =
                  finalsCompleted &&
                  finalsInfo &&
                  ((finalsInfo.top.finalsTotal || 0) >
                    (finalsInfo.bottom.finalsTotal || 0) ||
                    ((finalsInfo.top.finalsTotal || 0) ===
                      (finalsInfo.bottom.finalsTotal || 0) &&
                      (finalsInfo.top.seed || 999) <
                        (finalsInfo.bottom.seed || 999)));

                return (
                  <>
                    <div className="yoffs-bracket-column yoffs-bracket-column--left">
                      <div className="yoffs-bracket-round-label">
                        {semiLabel}
                      </div>
                      <div className="yoffs-bracket-match-group">
                        <div className="yoffs-bracket-match">
                          <div
                            className={
                              'yoffs-bracket-team' +
                              (semisCompleted
                                ? topSemiWinner
                                  ? ' yoffs-bracket-team--winner'
                                  : ' yoffs-bracket-team--loser'
                                : '')
                            }
                          >
                            <span className="yoffs-bracket-seed">#{seed1.seed}</span>
                            {seed1.avatarUrl && (
                              <img
                                className="standings-avatar"
                                src={seed1.avatarUrl}
                                alt={`${seed1.teamName} avatar`}
                              />
                            )}
                            <span className="yoffs-bracket-name">{seed1.teamName}</span>
                            <span className="yoffs-bracket-score">
                              {formatScore(seed1.semiTotal)}
                            </span>
                          </div>
                          <div
                            className={
                              'yoffs-bracket-team' +
                              (semisCompleted
                                ? !topSemiWinner
                                  ? ' yoffs-bracket-team--winner'
                                  : ' yoffs-bracket-team--loser'
                                : '')
                            }
                          >
                            <span className="yoffs-bracket-seed">#{seed4.seed}</span>
                            {seed4.avatarUrl && (
                              <img
                                className="standings-avatar"
                                src={seed4.avatarUrl}
                                alt={`${seed4.teamName} avatar`}
                              />
                            )}
                            <span className="yoffs-bracket-name">{seed4.teamName}</span>
                            <span className="yoffs-bracket-score">
                              {formatScore(seed4.semiTotal)}
                            </span>
                          </div>
                        </div>
                        <div className="yoffs-bracket-match-footer">
                          <Link
                            className="yoffs-bracket-matchup-button"
                            to={`/yoffs?year=${season}&format=bracket&tab=Matchups&matchup=1`}
                          >
                            View Matchup
                          </Link>
                        </div>
                      </div>
                      <div className="yoffs-bracket-match-group">
                        <div className="yoffs-bracket-match">
                          <div
                            className={
                              'yoffs-bracket-team' +
                              (semisCompleted
                                ? bottomSemiWinner
                                  ? ' yoffs-bracket-team--winner'
                                  : ' yoffs-bracket-team--loser'
                                : '')
                            }
                          >
                            <span className="yoffs-bracket-seed">#{seed2.seed}</span>
                            {seed2.avatarUrl && (
                              <img
                                className="standings-avatar"
                                src={seed2.avatarUrl}
                                alt={`${seed2.teamName} avatar`}
                              />
                            )}
                            <span className="yoffs-bracket-name">{seed2.teamName}</span>
                            <span className="yoffs-bracket-score">
                              {formatScore(seed2.semiTotal)}
                            </span>
                          </div>
                          <div
                            className={
                              'yoffs-bracket-team' +
                              (semisCompleted
                                ? !bottomSemiWinner
                                  ? ' yoffs-bracket-team--winner'
                                  : ' yoffs-bracket-team--loser'
                                : '')
                            }
                          >
                            <span className="yoffs-bracket-seed">#{seed3.seed}</span>
                            {seed3.avatarUrl && (
                              <img
                                className="standings-avatar"
                                src={seed3.avatarUrl}
                                alt={`${seed3.teamName} avatar`}
                              />
                            )}
                            <span className="yoffs-bracket-name">{seed3.teamName}</span>
                            <span className="yoffs-bracket-score">
                              {formatScore(seed3.semiTotal)}
                            </span>
                          </div>
                        </div>
                        <div className="yoffs-bracket-match-footer">
                          <Link
                            className="yoffs-bracket-matchup-button"
                            to={`/yoffs?year=${season}&format=bracket&tab=Matchups&matchup=2`}
                          >
                            View Matchup
                          </Link>
                        </div>
                      </div>
                    </div>
                    <div className="yoffs-bracket-column yoffs-bracket-column--right">
                      <div className="yoffs-bracket-final-label">
                        {finalsLabel}
                      </div>
                      <div className="yoffs-bracket-final-spacer">
                        <div className="yoffs-bracket-final-inner">
                          {semisCompleted && finalsInfo && finalsInfo.buffer && (
                            <div className="yoffs-bracket-buffer">
                              Semis Buffer:{' '}
                              {finalsInfo.buffer.avatarUrl && (
                                <img
                                  className="yoffs-bracket-buffer-avatar"
                                  src={finalsInfo.buffer.avatarUrl}
                                  alt={`${finalsInfo.buffer.teamName} avatar`}
                                />
                              )}
                              <span className="yoffs-bracket-buffer-team">
                                {finalsInfo.buffer.teamName}
                              </span>
                              <span className="yoffs-bracket-buffer-value">
                                {` +${finalsInfo.buffer.amount.toFixed(1)}`}
                              </span>
                            </div>
                          )}
                          <div className="yoffs-bracket-match yoffs-bracket-match--final">
                            {finalsInfo ? (
                              <>
                                <div
                                  className={
                                    'yoffs-bracket-team' +
                                    (finalsCompleted
                                      ? finalsTopWinner
                                        ? ' yoffs-bracket-team--winner'
                                        : ' yoffs-bracket-team--loser'
                                      : '')
                                  }
                                >
                                  <span className="yoffs-bracket-seed">
                                    #{finalsInfo.top.seed}
                                  </span>
                                  {finalsInfo.top.avatarUrl && (
                                    <img
                                      className="standings-avatar"
                                      src={finalsInfo.top.avatarUrl}
                                      alt={`${finalsInfo.top.teamName} avatar`}
                                    />
                                  )}
                                  <span className="yoffs-bracket-name">
                                    {finalsInfo.top.teamName}
                                  </span>
                                  <span className="yoffs-bracket-score">
                                    {formatScore(finalsInfo.top.finalsTotal)}
                                  </span>
                                </div>
                                <div
                                  className={
                                    'yoffs-bracket-team' +
                                    (finalsCompleted
                                      ? !finalsTopWinner
                                        ? ' yoffs-bracket-team--winner'
                                        : ' yoffs-bracket-team--loser'
                                      : '')
                                  }
                                >
                                  <span className="yoffs-bracket-seed">
                                    #{finalsInfo.bottom.seed}
                                  </span>
                                  {finalsInfo.bottom.avatarUrl && (
                                    <img
                                      className="standings-avatar"
                                      src={finalsInfo.bottom.avatarUrl}
                                      alt={`${finalsInfo.bottom.teamName} avatar`}
                                    />
                                  )}
                                  <span className="yoffs-bracket-name">
                                    {finalsInfo.bottom.teamName}
                                  </span>
                                  <span className="yoffs-bracket-score">
                                    {formatScore(finalsInfo.bottom.finalsTotal)}
                                  </span>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="yoffs-bracket-team yoffs-bracket-team--placeholder">
                                  Winner of #1 vs #4
                                </div>
                                <div className="yoffs-bracket-team yoffs-bracket-team--placeholder">
                                  Winner of #2 vs #3
                                </div>
                              </>
                            )}
                          </div>
                          {semisCompleted && (
                            <div className="yoffs-bracket-match-footer">
                              <Link
                                className="yoffs-bracket-matchup-button"
                                to={`/yoffs?year=${season}&format=bracket&tab=Matchups&matchup=3`}
                              >
                                View Matchup
                              </Link>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </>
      )}

      {selectedTab === 'Scores' && (
        <YoffsScoresView
          season={season}
          rows={null}
          startWeek={playoffStartWeek}
          endWeek={playoffEndWeek}
        />
      )}

      {selectedTab === 'Matchups' && (
        <div className="yoffs-matchups-root team-scores-container">
          <div className="team-scores-week-bar">
            <button
              className="team-scores-arrow"
              type="button"
              onClick={() =>
                handleMatchupChange(Math.max(minMatchupId, selectedMatchupId - 1))
              }
              disabled={selectedMatchupId === minMatchupId}
              aria-label="Previous matchup"
            >
              &#8592;
            </button>
            <div
              className="team-scores-week-dropdown yoffs-matchup-dropdown"
              onClick={() => setMatchupDropdownOpen((open) => !open)}
              ref={matchupDropdownRef}
            >
              {matchupOptions.find((m) => m.id === selectedMatchupId)?.label || 'Semifinal 1'}
              <span className="team-scores-week-dropdown-arrow">
                {matchupDropdownOpen ? '▲' : '▼'}
              </span>
              {matchupDropdownOpen && (
                <div className="team-scores-week-dropdown-list">
                  {matchupOptions.map((opt) => (
                    <div
                      key={opt.id}
                      className={
                        'team-scores-week-dropdown-option' +
                        (selectedMatchupId === opt.id
                          ? ' team-scores-week-dropdown-option-active'
                          : '')
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMatchupChange(opt.id);
                        setMatchupDropdownOpen(false);
                      }}
                    >
                      {opt.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              className="team-scores-arrow"
              type="button"
              onClick={() =>
                handleMatchupChange(Math.min(maxMatchupId, selectedMatchupId + 1))
              }
              disabled={selectedMatchupId === maxMatchupId}
              aria-label="Next matchup"
            >
              &#8594;
            </button>
          </div>

          <div className="yoffs-matchup-view-container">
            {(!seedTeams || seedTeams.length < 2) && !loadingSeeds && !seedError && (
              <div>No playoff teams found for this season.</div>
            )}
            {loadingSeeds && (
              <div className="loading-center">
                <div className="spinner" aria-label="Loading matchup" />
              </div>
            )}
            {!loadingSeeds && seedError && <div>{seedError}</div>}
            {!loadingSeeds && !seedError && seedTeams && seedTeams.length >= 2 && (
              (() => {
                const seed1Team = seedTeams.find((t) => t.seed === 1) || seedTeams[0];
                const seed4Team =
                  seedTeams.find((t) => t.seed === 4) ||
                  seedTeams[seedTeams.length - 1];
                const seed2Team = seedTeams.find((t) => t.seed === 2) || seedTeams[1];
                const seed3Team =
                  seedTeams.find((t) => t.seed === 3) ||
                  seedTeams[Math.min(2, seedTeams.length - 1)];

                if (selectedMatchupId === 1) {
                  return (
                    <MatchupView
                      season={season}
                      team1Id={seed1Team.rosterId}
                      team2Id={seed4Team.rosterId}
                      week={playoffStartWeek}
                      weeks={[playoffStartWeek, playoffStartWeek + 1]}
                      expandedWeeksOverride={
                        !playoffsStarted ? [playoffStartWeek] : null
                      }
                      preloadedTeamData={baseTeamData}
                      preloadedWeeksData={baseWeeksData}
                      preloadedPlayersData={basePlayersData}
                      preloadedPlayerIdMap={basePlayerIdMap}
                      displaySeeds
                      seed1={1}
                      seed2={4}
                    />
                  );
                }
                if (selectedMatchupId === 2) {
                  return (
                    <MatchupView
                      season={season}
                      team1Id={seed2Team.rosterId}
                      team2Id={seed3Team.rosterId}
                      week={playoffStartWeek}
                      weeks={[playoffStartWeek, playoffStartWeek + 1]}
                      expandedWeeksOverride={
                        !playoffsStarted ? [playoffStartWeek] : null
                      }
                      preloadedTeamData={baseTeamData}
                      preloadedWeeksData={baseWeeksData}
                      preloadedPlayersData={basePlayersData}
                      preloadedPlayerIdMap={basePlayerIdMap}
                      displaySeeds
                      seed1={2}
                      seed2={3}
                    />
                  );
                }

                // Championship
                if (!semisCompletedGlobal || !finalsInfo) {
                  return (
                    <div className="yoffs-tab-placeholder">
                      Championship matchup will appear once the semifinals are complete.
                    </div>
                  );
                }
                return (
                  <MatchupView
                    season={season}
                    team1Id={finalsInfo.top.rosterId}
                    team2Id={finalsInfo.bottom.rosterId}
                    week={playoffEndWeek}
                    weeks={[playoffEndWeek]}
                    preloadedTeamData={baseTeamData}
                    preloadedWeeksData={baseWeeksData}
                    preloadedPlayersData={basePlayersData}
                    preloadedPlayerIdMap={basePlayerIdMap}
                    displaySeeds
                    seed1={finalsInfo.top.seed}
                    seed2={finalsInfo.bottom.seed}
                    playoffBufferAmount={
                      finalsInfo.buffer ? finalsInfo.buffer.amount : 0
                    }
                    playoffBufferSide={
                      finalsInfo.buffer
                      && finalsInfo.buffer.rosterId === finalsInfo.top.rosterId
                        ? 'left'
                        : finalsInfo.buffer
                        && finalsInfo.buffer.rosterId === finalsInfo.bottom.rosterId
                        ? 'right'
                        : null
                    }
                  />
                );
              })()
            )}
          </div>
    </div>
      )}
    </>
  );
}

export default Yoffs2025Format;


