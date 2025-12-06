import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useMemo } from 'react';
import { trackPageLoad } from './UsageTracker';
import { useSearchParams, useParams } from 'react-router-dom';
import { getWeekScoreBreakdown, getPlayerSeasonTotalsMap } from './ScoresParser';
import { StartSitSort } from './StartSitDecider';
import { getPlayerInfo, fetchPlayersData } from './PlayerLookup';
import { STARTER_POSITION_NAMES } from './global_constants';
import { getDefaultDisplayWeek, CURRENT_YEAR, getCurrentNFLWeek } from './DateHelper';
import WeekSelector from './WeekSelector';
import { getInjuryAbbreviation } from './InjuryLookup';
import { fetchInjuriesForWeek, maybeRemapInjuriesKeysUsingPlayerIdMap } from './InjuryLookup';

// Lazy import to avoid circular deps at module init
async function readPlayersSnapshotFromDb(season, week) {
  try {
    const mod = await import('./database');
    if (mod && typeof mod.readPlayersSnapshot === 'function') {
      return await mod.readPlayersSnapshot(season, week);
    }
  } catch (_) {}
  return null;
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

  const season = searchParams.get('year') ? String(searchParams.get('year')) : String(CURRENT_YEAR);
  const currentWeek = getCurrentNFLWeek(CURRENT_YEAR);
  const showCurrentInjury = String(season) === String(CURRENT_YEAR) && week >= currentWeek;
  const [injuriesMap, setInjuriesMap] = useState({});

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
;
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

  const playerSeasonTotalsMap = useMemo(() => {
    return getPlayerSeasonTotalsMap(weeksParsedData);
  }, [weeksParsedData]);

  // Get week breakdown for this roster
  const rawWeekBreakdown = weeksParsedData ? getWeekScoreBreakdown(weeksParsedData, week)[rosterId] : null;
  const weekBreakdown = rawWeekBreakdown ? StartSitSort(rawWeekBreakdown, playersDataForWeek, playerIdMap, null, injuriesMap, playerSeasonTotalsMap) : null;

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

  const InjuryBadge = ({ playerId, info }) => {
    let status = null;
    // Previous weeks: use injuriesMap by Sleeper player id
    if (!showCurrentInjury && injuriesMap && playerId && injuriesMap[String(playerId)]) {
      status = injuriesMap[String(playerId)];
    } else if (showCurrentInjury && info) {
      status = info.injury_status || info.injury_notes || (info.status && /out|pup|questionable|doubtful|suspended|ir|injured reserve/i.test(info.status) ? info.status : null);
    }
    const ab = status ? getInjuryAbbreviation(status) : null;
    if (!ab) { return null; }
    const isRetired = ab === 'NA';
    const label = isRetired ? 'Retired 😂' : ab;
    const cls = isRetired ? 'injury-badge injury-badge--retired' : 'injury-badge';
    return <span className={cls} title={status}>{label}</span>;
  };

  const benchRows = weekBreakdown ? [...weekBreakdown.bench].map((p) => {
    const info = getPlayerInfo(p.id, playersDataForWeek, playerIdMap);
    const status = showCurrentInjury && info ? (info.injury_status || info.injury_notes || (info.status && /out|pup|questionable|doubtful|suspended|ir|injured reserve/i.test(info.status) ? info.status : null)) : null;
    const ab = status ? getInjuryAbbreviation(status) : null;
    const isDeprioritized = ab === 'O' || ab === 'P' || ab === 'PUP' || ab === 'IR';
    return { p, info, isDeprioritized };
  }).sort((a, b) => {
    if (b.p.pts !== a.p.pts) { return b.p.pts - a.p.pts; }
    if (a.isDeprioritized !== b.isDeprioritized) {
      return a.isDeprioritized ? 1 : -1; // push OUT/PUP/IR below on ties
    }
    return 0;
  }) : [];

  return (
    <div className="team-scores-container">
      <WeekSelector week={week} onChange={handleSelect} />
      {/* Week content */}
      {weekBreakdown ? (
        <div className="team-scores-tables-flex">
          <div className="team-scores-tables-col">
            <div className="team-scores-starters-bench-title">Starters</div>
            <table className="team-scores-table team-scores-table-starters-simple">
              <tbody>
                {weekBreakdown.starters.map((p, i) => {
                  const info = getPlayerInfo(p.id, playersDataForWeek, playerIdMap);
                  const posLabel = STARTER_POSITION_NAMES[i] || `S${i + 1}`;
                  return (
                    <tr key={p.id}>
                      <td className="team-scores-pos-cell">{posLabel}</td>
                      <td className="team-scores-player-cell">
                        {info && info.espn_photo_url && (
                          <img src={info.espn_photo_url} alt={info.name} className="player-avatar player-avatar-style team-scores-player-img-margin" />
                        )}
                        <span className="player-name">
                          {info && info.name ? info.name : (p.id === '0' ? '\u00A0' : p.id)}
                          {info && info.position ? ` (${info.position})` : ''}
                          <InjuryBadge playerId={p.id} info={info} />
                        </span>
                      </td>
                      <td className="team-scores-pts-cell">{Number(p.pts || 0).toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="team-scores-total-row">
                    <div className="team-scores-total-inner">Total: {Number(weekBreakdown.starterTotal || 0).toFixed(1)}</div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="team-scores-tables-col">
            <div className="team-scores-starters-bench-title">Bench</div>
            <table className="team-scores-table team-scores-table-bench">
              <tbody>
                {benchRows.map(({ p, info }) => (
                  <tr key={p.id}>
                    <td className="team-scores-player-cell">
                      {info && info.espn_photo_url && (
                        <img src={info.espn_photo_url} alt={info.name} className="player-avatar player-avatar-style team-scores-player-img-margin" />
                      )}
                      <span className="player-name">
                        {info && info.name ? info.name : (p.id === '0' ? '\u00A0' : p.id)}
                        {info && info.position ? ` (${info.position})` : ''}
                        <InjuryBadge playerId={p.id} info={info} />
                      </span>
                    </td>
                    <td className="team-scores-pts-cell">{Number(p.pts || 0).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="team-scores-total-row">
                    <div className="team-scores-total-inner">Total: {Number(weekBreakdown.benchTotal || 0).toFixed(1)}</div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : (
        <div>No data for this week/team.</div>
      )}
    </div>
  );
});

export default TeamScores; 