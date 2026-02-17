import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useMemo } from 'react';
import { trackPageLoad } from '../utils/UsageTracker';
import { useSearchParams, useParams } from 'react-router-dom';
import { getWeekScoreBreakdown, getPlayerSeasonTotalsMap } from './ScoresParser';
import { StartSitSort } from '../players/StartSitDecider';
import { getPlayerInfo, fetchPlayersData } from '../lookups/PlayerLookup';
import { getDefaultDisplayWeek, CURRENT_YEAR, getCurrentNFLWeek } from '../utils/DateHelper';
import WeekSelector from './WeekSelector';
import { fetchInjuriesForWeek } from '../lookups/InjuryLookup';
import { fetchNflScoreboard } from '../lookups/GamesLookup';
import { mapPlayersToGames, getEventLabelForTeam, getGameDisplayForTeam, isScoreboardWeekComplete } from './GamesParser';
import TeamScoresTables from './TeamScoresTables';
import useIsMobile from '../hooks/useIsMobile';
import { createLiveScoresPoller } from '../utils/livePolling';

// Lazy import to avoid circular deps at module init
async function readPlayersSnapshotFromDb(season, week) {
  try {
    const mod = await import('../utils/database');
    if (mod && typeof mod.readPlayersSnapshot === 'function') {
      return await mod.readPlayersSnapshot(season, week);
    }
  } catch (_) {}
  return null;
}

function formatKickoffShort(iso) {
  if (!iso) {
    return '';
  }
  try {
    const d = new Date(iso);
    const dow = d.toLocaleDateString(undefined, { weekday: 'short' });
    const tm = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${dow} ${tm}`;
  } catch (_) {
    return '';
  }
}

const NUM_WEEKS = 17;

const TeamScores = forwardRef(function TeamScores({ weeksParsedData, playersData, playerIdMap, updateQueryParams }, ref) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlWeek = parseInt(searchParams.get('week'), 10);
  const initialWeek = !isNaN(urlWeek) && urlWeek >= 1 && urlWeek <= NUM_WEEKS ? urlWeek : getDefaultDisplayWeek(searchParams.get('year'));
  const [week, setWeek] = useState(initialWeek);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const { id } = useParams();
  const rosterId = Number(id);
  const isMobile = useIsMobile();

  const season = searchParams.get('year') ? String(searchParams.get('year')) : String(CURRENT_YEAR);
  const currentWeek = getCurrentNFLWeek(CURRENT_YEAR);
  const showCurrentInjury = String(season) === String(CURRENT_YEAR) && week >= currentWeek;
  const [injuriesMap, setInjuriesMap] = useState({});
  const [playerGameLabels, setPlayerGameLabels] = useState({});
  const [isWeekCompleteByGames, setIsWeekCompleteByGames] = useState(false);
  const [playersTeamMap, setPlayersTeamMap] = useState({});
  const [liveWeeksParsedData, setLiveWeeksParsedData] = useState(null);

  // Use live data if available, otherwise use prop data
  const effectiveWeeksParsedData = liveWeeksParsedData || weeksParsedData;

  // Close dropdown on outside click
  useEffect(() => {
    trackPageLoad();
    if (!dropdownOpen) return;
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  // Close dropdown on week change (arrow, dropdown, or query param)
  useEffect(() => {
    setDropdownOpen(false);
  }, [week]);

  // Update query param when week changes
  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('week', week);
    newParams.set('tab', 'Scores');
    setSearchParams(newParams, { replace: true });
    // eslint-disable-next-line
  }, [week]);

  // Update week if query param changes (browser nav)
  useEffect(() => {
    if (!isNaN(urlWeek) && urlWeek >= 1 && urlWeek <= NUM_WEEKS && week !== urlWeek)  {
      setWeek(urlWeek);
    }
    // eslint-disable-next-line
  }, [urlWeek]);

  useImperativeHandle(ref, () => ({
    resetWeek: (season) => {
      const week = getDefaultDisplayWeek(season);
      setWeek(week);
      if (updateQueryParams) {
        updateQueryParams({ week, tab: 'Scores', year: season === CURRENT_YEAR ? null : season });
      } else {
        const newParams = new URLSearchParams(searchParams);
        newParams.set('week', week);
        if (season === CURRENT_YEAR) { newParams.delete('year'); } else { newParams.set('year', season); }
        setSearchParams(newParams, { replace: true });
      }
    }
  }));

  const handleSelect = w => setWeek(w);

  // When viewing a previous week in the current season, prefer that week's player snapshot
  const seasonIsCurrent = String(season) === String(CURRENT_YEAR);
  const currentWk = getCurrentNFLWeek(CURRENT_YEAR);
  const preferHistoricalPlayers = seasonIsCurrent && Number(week) < currentWk;
  const [playersDataForWeek, setPlayersDataForWeek] = useState(playersData);
  useEffect(() => {
    let cancelled = false;
    if (preferHistoricalPlayers) {
      (async () => {
        try {
          const hist = await fetchPlayersData(null, { week });
          if (!cancelled && hist) { setPlayersDataForWeek(hist); }
        } catch (_) {}
      })();
    } else {
      setPlayersDataForWeek(playersData);
    }
    return () => { cancelled = true; };
  }, [preferHistoricalPlayers, week, playersData]);

  // Load injuries map for season/week (DB for previous weeks; file fallback)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const isCurrentSeason = String(season) === String(CURRENT_YEAR);
        const currentWeekNum = getCurrentNFLWeek();
        const isPreviousWeek = isCurrentSeason ? (Number(week) < currentWeekNum) : true;
        if (isPreviousWeek) {
          try {
            const snap = await readPlayersSnapshotFromDb(season, week);
            const data = snap && snap.snapshot && snap.snapshot.data ? snap.snapshot.data : null;
            if (data && !cancelled) {
              const byPlayerId = {};
              for (const [pid, p] of Object.entries(data)) {
                const status = (p && (p.injury_status || p.injury_notes || (p.status && /out|pup|questionable|doubtful|suspended|ir|injured reserve|na/i.test(p.status) ? p.status : null))) || null;
                if (status) { byPlayerId[String(pid)] = String(status); }
              }
              setInjuriesMap(byPlayerId);
              return;
            }
          } catch (_) {}
        }
        const m = await fetchInjuriesForWeek(season, week);
        if (!cancelled) {
          let combined = { ...(m || {}) };
          try {
            if (playerIdMap && typeof playerIdMap === 'object') {
              for (const [pid, mapping] of Object.entries(playerIdMap)) {
                const espnId = mapping && (mapping.espn_id || (mapping.metadata && mapping.metadata.espn_id));
                if (espnId && combined[String(espnId)] && !combined[String(pid)]) {
                  combined[String(pid)] = combined[String(espnId)];
                }
              }
            }
          } catch (_) {}
          setInjuriesMap(combined);
        }
      } catch (_) {
        if (!cancelled) { setInjuriesMap({}); }
      }
    })();
    return () => { cancelled = true; };
  }, [season, week, playerIdMap]);

  // Load per-player team mapping from weekly players snapshot (current season only)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const isCurrentSeason = String(season) === String(CURRENT_YEAR);
        if (!isCurrentSeason || !week || Number(week) < 1) {
          if (!cancelled) {
            setPlayersTeamMap({});
          }
          return;
        }
        const snap = await readPlayersSnapshotFromDb(String(season), Number(week));
        const data = snap && snap.snapshot && snap.snapshot.data ? snap.snapshot.data : null;
        if (cancelled) {
          return;
        }
        if (!data) {
          setPlayersTeamMap({});
          return;
        }
        const next = {};
        for (const [pid, pinfo] of Object.entries(data)) {
          const abbr = pinfo && (pinfo.team || pinfo.team_abbr || pinfo.team_abbreviation);
          if (abbr) {
            next[String(pid)] = String(abbr);
          }
        }
        setPlayersTeamMap(next);
      } catch (_) {
        if (!cancelled) {
          setPlayersTeamMap({});
        }
      }
    })();
    return () => { cancelled = true; };
  }, [season, week]);

  // Compute player->game labels for the selected week
  useEffect(() => {
    if (!playersDataForWeek || !playerIdMap || !effectiveWeeksParsedData) {
      setPlayerGameLabels({});
      setIsWeekCompleteByGames(false);
      return;
    }

    const playerIdSet = new Set();
    // Collect player IDs from the raw week data for this roster
    const weekArr = Array.isArray(effectiveWeeksParsedData) ? effectiveWeeksParsedData[week - 1] : null;
    if (Array.isArray(weekArr)) {
      const entry = weekArr.find(e => e && Number(e.roster_id) === Number(rosterId));
      if (entry && Array.isArray(entry.players)) {
        entry.players.forEach(pid => {
          if (pid && String(pid) !== '0') {
            playerIdSet.add(pid);
          }
        });
      }
    }

    const playerIds = Array.from(playerIdSet);
    if (playerIds.length === 0) {
      setPlayerGameLabels({});
      setIsWeekCompleteByGames(false);
      return;
    }

    const seasonYear = Number(season);
    let cancelled = false;
    fetchNflScoreboard(seasonYear, week)
      .then(async (json) => {
        if (cancelled) {
          return;
        }
        try {
          setIsWeekCompleteByGames(isScoreboardWeekComplete(json));
        } catch (_) {
          setIsWeekCompleteByGames(false);
        }
        const mapping = await mapPlayersToGames(
          playerIds,
          playersDataForWeek,
          playerIdMap,
          json,
          String(season) === String(CURRENT_YEAR) ? playersTeamMap : null
        );
        const labels = {};
        for (const pid of playerIds) {
          const item = mapping[pid];
          const ev = item && item.event;
          const teamForWeek = item && item.team;
          const d = ev ? getGameDisplayForTeam(ev, teamForWeek) : { text: 'BYE', live: false, completed: false, eventId: null };

          // TeamScores wants a more compact pre-game label so the "matchup" column can be narrow.
          let text = d.text;
          if (ev && !d.live && !d.completed) {
            const perspective = getEventLabelForTeam(ev, teamForWeek) || '';
            const kickoff = formatKickoffShort(ev.date || (ev.competitions && ev.competitions[0] && ev.competitions[0].date));
            text = `${kickoff} ${perspective}`.trim();
          }

          labels[pid] = { ...d, text, team: teamForWeek || null };
        }
        if (!cancelled) {
          setPlayerGameLabels(labels);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerGameLabels({});
          setIsWeekCompleteByGames(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [season, week, rosterId, playersDataForWeek, playerIdMap, effectiveWeeksParsedData, playersTeamMap]);

  // Live polling: when viewing current week of current season, auto-refresh scores
  useEffect(() => {
    const isCurrentSeason = String(season) === String(CURRENT_YEAR);
    const currentWeekNum = getCurrentNFLWeek();
    if (!isCurrentSeason || Number(week) !== Number(currentWeekNum)) {
      return;
    }

    let cancelled = false;

    const poller = createLiveScoresPoller({
      season,
      week,
      forceOnStartAndFocus: true,
      onData: ({ newWeeks }) => {
        if (cancelled || !Array.isArray(newWeeks)) {
          return;
        }
        setLiveWeeksParsedData(newWeeks);
      },
    });

    poller.start();

    return () => {
      cancelled = true;
      poller.stop();
    };
  }, [season, week]);

  const playerSeasonTotalsMap = useMemo(() => {
    return getPlayerSeasonTotalsMap(weeksParsedData);
  }, [weeksParsedData]);

  // Get week breakdown for this roster
  const rawWeekBreakdown = effectiveWeeksParsedData ? getWeekScoreBreakdown(effectiveWeeksParsedData, week)[rosterId] : null;
  const weekBreakdown = rawWeekBreakdown ? StartSitSort(rawWeekBreakdown, playersDataForWeek, playerIdMap, playerGameLabels, injuriesMap, playerSeasonTotalsMap) : null;

  // Debug: dump players missing ESPN mapping for this team/week
  useEffect(() => {
    try {
      if (!weekBreakdown || !playerIdMap) { return; }
      const rows = [...(weekBreakdown.starters || []), ...(weekBreakdown.bench || [])];
      const missing = [];
      for (const p of rows) {
        const pid = String(p && p.id);
        if (!pid || pid === '0') { continue; }
        const mapping = playerIdMap[pid];
        const espnId = mapping && (mapping.espn_id || (mapping.metadata && mapping.metadata.espn_id));
        if (!espnId) {
          const info = getPlayerInfo(pid, playersDataForWeek, playerIdMap);
          const name = info && info.name ? info.name : pid;
          missing.push({ id: pid, name });
        }
      }
      // removed debug log
    } catch (_) {}
  }, [season, week, rosterId, weekBreakdown, playerIdMap, playersDataForWeek]);

  // Calculate activity counts for current week
  const isActiveWeek =
    String(season) === String(CURRENT_YEAR) &&
    Number(week) === Number(getCurrentNFLWeek()) &&
    !isWeekCompleteByGames;
  let activeCount = 0;
  let yetToPlayCount = 0;

  if (isActiveWeek && weekBreakdown && playerGameLabels) {
    const rosterPlayerIds = [...(weekBreakdown.starters || []), ...(weekBreakdown.bench || [])]
      .map(p => p && p.id)
      .filter(pid => pid && pid !== '0');
    
    for (const pid of rosterPlayerIds) {
      const label = playerGameLabels[pid];
      if (!label) {
        continue;
      }
      const isLive = !!label.live;
      const isCompleted = !!label.completed;
      const isBye = label && label.text === 'BYE';
      if (isLive) {
        activeCount++;
      } else if (!isCompleted && !isBye) {
        yetToPlayCount++;
      }
    }
  }

  return (
    <div className="team-scores-container team-scores-container--team-page">
      <WeekSelector week={week} onChange={handleSelect} />
      
      {isActiveWeek && (
        <div className="team-scores-activity-banner">
          <span className="standings-activity-item">
            {isMobile ? `YTP ${yetToPlayCount}` : `Yet to Play: ${yetToPlayCount}`}
          </span>
          <span className="standings-activity-item">
            {isMobile ? `Live ${activeCount}` : `In-Play: ${activeCount}`}
          </span>
        </div>
      )}

      {weekBreakdown ? (
        <TeamScoresTables
          weekBreakdown={weekBreakdown}
          totalsPlacement="top"
          playersData={playersDataForWeek}
          playerIdMap={playerIdMap}
          playerGameLabels={playerGameLabels}
          isActiveWeek={isActiveWeek}
          injuriesMap={injuriesMap}
          showCurrentInjury={showCurrentInjury}
          playerHighlightMap={{}}
          playersTeamMap={playersTeamMap}
        />
      ) : (
        <div>No data for this week/team.</div>
      )}
    </div>
  );
});

export default TeamScores; 