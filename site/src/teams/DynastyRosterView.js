/**
 * DynastyRosterView
 *
 * Shows all league teams ordered by total dynasty value (players + picks).
 * Format selector: SF | SF TE+
 *
 * Selecting a team reveals:
 *  – Players sorted by KTC value descending, with overall rank and positional
 *    rank (e.g. #5 · RB2)
 *  – Draft picks below players, formatted as "2026 1.02" when draft order is
 *    known, with tier-based KTC values (early / mid / late)
 *
 * Self-contained: owns all data loading.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { fetchTeamData, fetchTradedPicks, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from '../lookups/PlayerLookup';
import PositionBadge from '../PositionBadge';
import {
  fetchKtcData,
  getKtcEntryByName,
  getPickKtcValue,
  formatKtcValue,
} from '../lookups/KtcLookup';
import { fetchFantasyCalcData, getFantasyCalcEntry, formatFcValue } from '../lookups/FantasyCalcLookup';
import { fetchFfbData, getFfbEntry, formatFfbRank } from '../lookups/FfbLookup';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { CURRENT_YEAR, getCompletedWeeksCount } from '../utils/DateHelper';
import { calculateDraftOrder, convertPlacementToPickNumbers } from '../utils/DraftOrderHelper';
import PlayerWeeklyScores from '../players/PlayerWeeklyScores';
import LoadingState from '../LoadingState';

// Draft pick KTC values are approximate — enable when real data is available
const PICKS_ENABLED = false;

const RANKED_POSITIONS  = ['QB', 'RB', 'WR', 'TE'];

// Value source options: KTC SF, KTC SF TE+, FantasyCalc, FFB
const VALUE_SOURCES = ['ktc_sf', 'ktc_sf_tep', 'fantasycalc', 'ffb'];
const VALUE_SOURCE_LABELS = {
  ktc_sf:       'KTC SF',
  ktc_sf_tep:   'KTC SF TE+',
  fantasycalc:  'FantasyCalc',
  ffb:          'FFB',
};
const VALUE_SOURCE_COL_HEADER = {
  ktc_sf:       'KTC',
  ktc_sf_tep:   'KTC',
  fantasycalc:  'FC',
  ffb:          'FFB Rank',
};
const VALUE_SOURCE_TOTAL_LABEL = {
  ktc_sf:       'Total KTC',
  ktc_sf_tep:   'Total KTC',
  fantasycalc:  'Total FC',
  ffb:          'FFB Score',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function toOrdinal(n) {
  if (!Number.isFinite(n)) return '';
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/**
 * Build per-team pick lists from the Sleeper traded-picks API response.
 * Covers the next 3 drafts (or the current draft + 2 more during preseason).
 */
function buildPicksByRoster(teamData, allTradedPicks) {
  const completedWeeks = getCompletedWeeksCount(CURRENT_YEAR);
  const isPreSeason    = completedWeeks === 0;
  const currentYearNum = Number(CURRENT_YEAR);
  const yearOffset     = isPreSeason ? 0 : 1;
  const minSeason      = currentYearNum + yearOffset;
  const maxSeason      = currentYearNum + yearOffset + 2;

  const futurePicks = (allTradedPicks || []).filter((p) => {
    const s = p.season != null ? Number(p.season) : currentYearNum;
    return Number.isFinite(s) && s >= minSeason && s <= maxSeason;
  });

  const result = {};

  for (const roster of (teamData.rosters || [])) {
    const rosterId = Number(roster.roster_id);

    const tradedAway = new Set();
    for (const p of futurePicks) {
      if (Number(p.roster_id) === rosterId && Number(p.owner_id) !== rosterId) {
        tradedAway.add(`${p.season}-${p.round}`);
      }
    }

    const picks = [];
    for (let yr = minSeason; yr <= maxSeason; yr++) {
      for (let round = 1; round <= 4; round++) {
        if (!tradedAway.has(`${yr}-${round}`)) {
          picks.push({ season: String(yr), round, roster_id: rosterId, isOwn: true });
        }
      }
    }
    for (const p of futurePicks) {
      if (Number(p.owner_id) === rosterId && Number(p.roster_id) !== rosterId) {
        picks.push({ ...p, isOwn: false });
      }
    }
    picks.sort((a, b) => {
      const sy = Number(a.season) - Number(b.season);
      if (sy !== 0) return sy;
      return Number(a.round) - Number(b.round);
    });
    result[rosterId] = picks;
  }

  return result;
}

/**
 * Format a pick for display.
 * Uses "2026 1.02 (via Team Name)" format when draft order is known for the
 * next draft; falls back to "2026 1st" otherwise.
 */
function formatPickLabel(pick, draftOrderMap, nextDraftYear, rosterInfoMap) {
  const season        = pick.season || '';
  const round         = Number(pick.round);
  const origRosterId  = pick.roster_id != null ? String(pick.roster_id) : null;

  let label;
  if (String(season) === String(nextDraftYear) && origRosterId && draftOrderMap[origRosterId]) {
    const pickNum = draftOrderMap[origRosterId];
    label = `${season} ${round}.${String(pickNum).padStart(2, '0')}`;
  } else {
    label = `${season} ${toOrdinal(round)}`;
  }

  if (!pick.isOwn) {
    const origInfo = origRosterId ? rosterInfoMap[Number(origRosterId)] : null;
    const via = origInfo?.teamName || (origRosterId ? `Team ${origRosterId}` : '');
    if (via) label += ` (via ${via})`;
  }

  return label;
}

// ── Component ─────────────────────────────────────────────────────────────────

function DynastyRosterView() {
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [teams, setTeams]                 = useState([]);
  const [rosters, setRosters]             = useState({});
  const [rawRosters, setRawRosters]       = useState(null);
  const [rawUsers, setRawUsers]           = useState(null);
  const [picksByRoster, setPicksByRoster] = useState({});
  const [rosterInfoMap, setRosterInfoMap] = useState({});
  const [draftOrderMap, setDraftOrderMap] = useState({});   // rosterId → pick# (1-10)
  const [nextDraftYear, setNextDraftYear] = useState(null);
  const [playersData, setPlayersData]     = useState(null);
  const [playerIdMap, setPlayerIdMap]     = useState(null);
  const [ktcMap, setKtcMap]               = useState(null);
  const [ktcAsOf, setKtcAsOf]             = useState(null);
  const [fcData, setFcData]               = useState(null); // { bySleeperId, byName }
  const [ffbData, setFfbData]             = useState(null); // { bySleeperId, byName }
  const [selectedId, setSelectedId]       = useState(null);
  const [valueSource, setValueSource]     = useState('ktc_sf_tep');
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  // ── Data loading ────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const completedWeeks = getCompletedWeeksCount(CURRENT_YEAR);
        const isPreSeason    = completedWeeks === 0;
        const prevYearStr    = String(Number(CURRENT_YEAR) - 1);
        // nextDraftYear: during preseason it's CURRENT_YEAR; after draft it's CURRENT_YEAR+1
        const nextDraft      = isPreSeason ? String(CURRENT_YEAR) : String(Number(CURRENT_YEAR) + 1);

        const [teamData, weeksData, idMap, ktcResult, fcResult, ffbResult, allTradedPicks, prevWeeksData] =
          await Promise.all([
            fetchTeamData(CURRENT_YEAR),
            fetchScoresData(CURRENT_YEAR),
            fetchPlayerIdMap(),
            fetchKtcData(),
            fetchFantasyCalcData().catch(() => null),
            fetchFfbData().catch(() => null),
            PICKS_ENABLED ? fetchTradedPicks(CURRENT_YEAR).catch(() => []) : Promise.resolve([]),
            PICKS_ENABLED && isPreSeason
              ? fetchScoresData(prevYearStr).catch(() => null)
              : Promise.resolve(null),
          ]);

        if (!teamData || !Array.isArray(teamData.rosters)) throw new Error('No team data');
        if (cancelled) return;

        const players = await fetchPlayersData(teamData.rosters);
        if (cancelled) return;

        // Draft order: maps rosterId → pick slot (1-10) for the upcoming draft
        let orderMap = {};
        if (PICKS_ENABLED) {
          try {
            const scoresForOrder = isPreSeason ? prevWeeksData : weeksData;
            const scoresYear     = isPreSeason ? prevYearStr   : String(CURRENT_YEAR);
            if (scoresForOrder && Array.isArray(scoresForOrder)) {
              const placeToRid = calculateDraftOrder(scoresYear, scoresForOrder, teamData, null, null);
              orderMap = convertPlacementToPickNumbers(placeToRid);
            }
          } catch (_) { /* keep orderMap empty */ }
        }

        const infoMap  = buildRosterIdToTeamInfoMap(teamData.rosters, teamData.users);
        const picksMap = PICKS_ENABLED ? buildPicksByRoster(teamData, allTradedPicks) : {};
        const ktcM      = ktcResult.map;

        // Roster map
        const rosterMap = {};
        for (const roster of teamData.rosters) {
          const rid = Number(roster.roster_id);
          rosterMap[rid] = Array.isArray(roster.players) ? roster.players : [];
        }

        // Build team list with totals per format (we compute totals reactively via useMemo,
        // but we store enough here to do initial sort with the default format)
        const teamList = (teamData.rosters || []).map((roster) => {
          const rid = Number(roster.roster_id);
          if (!Number.isFinite(rid)) return null;
          const user = (teamData.users || []).find(
            (u) => String(u.user_id) === String(roster.owner_id)
          );
          let teamName = `Team ${rid}`;
          if (user?.metadata?.team_name) teamName = user.metadata.team_name;
          else if (user?.display_name)   teamName = `Team ${user.display_name}`;
          const avatarUrl =
            (user && (user.team_avatar_url || user.user_avatar_url || user.avatar_url)) || null;
          return { rosterId: rid, teamName, avatarUrl };
        }).filter(Boolean);

        setTeams(teamList);
        setRosters(rosterMap);
        setRawRosters(teamData.rosters);
        setRawUsers(teamData.users);
        setPicksByRoster(picksMap);
        setRosterInfoMap(infoMap);
        setDraftOrderMap(orderMap);
        setNextDraftYear(nextDraft);
        setPlayersData(players);
        setPlayerIdMap(idMap);
        setKtcMap(ktcM);
        setKtcAsOf(ktcResult.asOf);
        setFcData(fcResult || null);
        setFfbData(ffbResult || null);
      } catch (e) {
        if (!cancelled) setError('Failed to load dynasty roster data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // ── Helper: get a numeric "sort value" for a player given the current source ──

  const getPlayerSortValue = React.useCallback((pid, info) => {
    const name  = info?.full_name || info?.name || '';
    const hints = { position: info?.position, team: info?.team || info?.team_abbr, age: info?.age };

    if (valueSource === 'ktc_sf' || valueSource === 'ktc_sf_tep') {
      if (!ktcMap) return 0;
      const ktcFmt = valueSource === 'ktc_sf_tep' ? 'sf_tep' : 'sf';
      const entry  = getKtcEntryByName(name, ktcMap, ktcFmt, hints);
      return entry?.ktcValue ?? 0;
    }
    if (valueSource === 'fantasycalc') {
      if (!fcData) return 0;
      const entry = getFantasyCalcEntry(pid, name, fcData.bySleeperId, fcData.byName, hints);
      return entry?.value ?? 0;
    }
    if (valueSource === 'ffb') {
      if (!ffbData) return 0;
      const entry = getFfbEntry(pid, name, ffbData.bySleeperId, ffbData.byName);
      // Synthetic score: higher = better (top-ranked player scores ~389)
      return entry ? Math.max(0, 390 - entry.rank) : 0;
    }
    return 0;
  }, [valueSource, ktcMap, fcData, ffbData]);

  // ── Per-team value totals (recomputes when source changes) ───────────────────

  const teamKtcTotals = useMemo(() => {
    if (!playersData || !playerIdMap) return {};
    const totals = {};
    for (const team of teams) {
      let total = 0;
      for (const pid of (rosters[team.rosterId] || [])) {
        const info = getPlayerInfo(pid, playersData, playerIdMap);
        if (!info) continue;
        total += getPlayerSortValue(pid, info);
      }
      // Picks only apply to KTC sources
      if (PICKS_ENABLED && (valueSource === 'ktc_sf' || valueSource === 'ktc_sf_tep')) {
        for (const pick of (picksByRoster[team.rosterId] || [])) {
          const origRid = pick.roster_id != null ? String(pick.roster_id) : null;
          const pickNum = origRid ? draftOrderMap[origRid] : null;
          total += getPickKtcValue(pick.season, pick.round, CURRENT_YEAR, pickNum ?? null);
        }
      }
      totals[team.rosterId] = total;
    }
    return totals;
  }, [playersData, playerIdMap, teams, rosters, picksByRoster, draftOrderMap, getPlayerSortValue, valueSource]);

  // Teams sorted by total KTC descending
  const sortedTeams = useMemo(() => {
    return teams.slice().sort((a, b) => {
      const ta = teamKtcTotals[a.rosterId] ?? 0;
      const tb = teamKtcTotals[b.rosterId] ?? 0;
      return tb !== ta ? tb - ta : Number(a.rosterId) - Number(b.rosterId);
    });
  }, [teams, teamKtcTotals]);

  // ── Selected team detail ─────────────────────────────────────────────────────

  const selectedPlayers = useMemo(() => {
    if (!selectedId || !playersData || !playerIdMap) return [];

    const ktcFmt = valueSource === 'ktc_sf_tep' ? 'sf_tep' : 'sf';

    return (rosters[selectedId] || []).map((pid) => {
      const info  = getPlayerInfo(pid, playersData, playerIdMap);
      const name  = info?.full_name || info?.name || pid;
      const hints = { position: info?.position, team: info?.team || info?.team_abbr, age: info?.age };

      // KTC
      const ktcEntry = ktcMap
        ? getKtcEntryByName(name, ktcMap, ktcFmt, hints)
        : null;

      // FantasyCalc
      const fcEntry = fcData
        ? getFantasyCalcEntry(pid, name, fcData.bySleeperId, fcData.byName, hints)
        : null;

      // FFB
      const ffbEntry = ffbData
        ? getFfbEntry(pid, name, ffbData.bySleeperId, ffbData.byName)
        : null;

      // Active source fields for display
      let displayValue, overallRank, posRank, sortValue;
      if (valueSource === 'ktc_sf' || valueSource === 'ktc_sf_tep') {
        displayValue = formatKtcValue(ktcEntry?.ktcValue);
        overallRank  = ktcEntry?.overallRank ?? null;
        posRank      = ktcEntry?.posRank     ?? null;
        sortValue    = ktcEntry?.ktcValue    ?? 0;
      } else if (valueSource === 'fantasycalc') {
        displayValue = formatFcValue(fcEntry?.value);
        overallRank  = fcEntry?.overallRank ?? null;
        posRank      = fcEntry?.posRank     ?? null;
        sortValue    = fcEntry?.value       ?? 0;
      } else {
        // ffb
        displayValue = formatFfbRank(ffbEntry?.rank);
        overallRank  = null; // rank IS the display value
        posRank      = null;
        sortValue    = ffbEntry ? Math.max(0, 390 - ffbEntry.rank) : 0;
      }

      return {
        pid,
        name,
        position:     info?.position || '',
        nflTeam:      info?.team || info?.team_abbr || '',
        espnPhotoUrl: info?.espn_photo_url || null,
        displayValue,
        overallRank,
        posRank,
        sortValue,
        hasValue: sortValue > 0,
      };
    }).sort((a, b) => b.sortValue - a.sortValue);
  }, [selectedId, playersData, playerIdMap, ktcMap, fcData, ffbData, rosters, valueSource]);

  const selectedPicks = useMemo(() => {
    if (!selectedId) return [];
    return (picksByRoster[selectedId] || []).map((pick) => {
      const origRid = pick.roster_id != null ? String(pick.roster_id) : null;
      const pickNum = origRid ? draftOrderMap[origRid] : null;
      return {
        ...pick,
        pickNum,
        ktcValue: getPickKtcValue(pick.season, pick.round, CURRENT_YEAR, pickNum ?? null),
        label:    formatPickLabel(pick, draftOrderMap, nextDraftYear, rosterInfoMap),
      };
    });
  }, [selectedId, picksByRoster, draftOrderMap, nextDraftYear, rosterInfoMap]);

  const selectedTeam  = useMemo(() => sortedTeams.find((t) => t.rosterId === selectedId) || null, [sortedTeams, selectedId]);
  const selectedTotal = selectedId != null ? (teamKtcTotals[selectedId] ?? 0) : 0;

  // ── Player modal ────────────────────────────────────────────────────────────

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') setSelectedPlayer(null);
    }
    if (selectedPlayer) {
      document.addEventListener('keydown', onKeyDown);
    }
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedPlayer]);

  useEffect(() => {
    if (selectedPlayer) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => document.body.classList.remove('modal-open');
  }, [selectedPlayer]);

  const playerModal = selectedPlayer ? (
    <div className="player-modal-overlay" onClick={() => setSelectedPlayer(null)}>
      <div
        className="player-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <PlayerWeeklyScores
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
          rosters={rawRosters}
          users={rawUsers}
        />
      </div>
    </div>
  ) : null;

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) return <LoadingState label="Loading dynasty values…" />;
  if (error)   return <div className="dynasty-error">{error}</div>;

  return (
    <div className="dynasty-root">

      {/* ── Header + value source selector ── */}
      <div className="dynasty-section-header">
        <div className="dynasty-header-row">
          <div>
            <span className="dynasty-section-title">Dynasty Roster Values</span>
            <span className="dynasty-section-sub">sorted by total value</span>
          </div>
          <div className="dynasty-format-toggle">
            {VALUE_SOURCES.map((src) => (
              <button
                key={src}
                type="button"
                className={'dynasty-format-btn' + (valueSource === src ? ' dynasty-format-btn--active' : '')}
                onClick={() => setValueSource(src)}
              >
                {VALUE_SOURCE_LABELS[src]}
              </button>
            ))}
          </div>
        </div>
        {(valueSource === 'ktc_sf' || valueSource === 'ktc_sf_tep') && ktcAsOf && (
          <span className="dynasty-as-of">as of {ktcAsOf}</span>
        )}
      </div>

      {/* ── Team selector ── */}
      <div className="h2h-web-instruction">Select a team to view its roster values</div>
      <div className="h2h-web-list-anim-shell">
        <div className="h2h-web-list dynasty-team-list">
          {sortedTeams.map((team, idx) => {
            const isSelected = team.rosterId === selectedId;
            const total      = teamKtcTotals[team.rosterId];
            return (
              <button
                key={team.rosterId}
                type="button"
                className={
                  'h2h-web-card dynasty-team-card' +
                  (isSelected ? ' h2h-web-card--selected-primary' : '')
                }
                onClick={() => setSelectedId(isSelected ? null : team.rosterId)}
              >
                <span className="dynasty-card-rank">#{idx + 1}</span>
                {team.avatarUrl && (
                  <img
                    className="standings-avatar h2h-web-avatar"
                    src={team.avatarUrl}
                    alt={`${team.teamName} avatar`}
                  />
                )}
                <span className="yoffs-bracket-name h2h-web-name dynasty-card-name">
                  {team.teamName}
                </span>
                {total != null && total > 0 && (
                  <span className="dynasty-card-total">{total.toLocaleString()}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Roster panel ── */}
      {selectedTeam && (
        <div className="dynasty-roster-panel">
          <div className="dynasty-roster-header">
            {selectedTeam.avatarUrl && (
              <img
                className="standings-avatar dynasty-roster-avatar"
                src={selectedTeam.avatarUrl}
                alt={selectedTeam.teamName}
              />
            )}
            <span className="dynasty-roster-team-name">{selectedTeam.teamName}</span>
            <span className="dynasty-roster-total-label">{VALUE_SOURCE_TOTAL_LABEL[valueSource]}</span>
            <span className="dynasty-roster-total-value">{selectedTotal.toLocaleString()}</span>
          </div>

          <table className="dynasty-table">
            <thead>
              <tr>
                <th className="dynasty-th dynasty-th-player">Player</th>
                <th className="dynasty-th dynasty-th-ranks">Rank</th>
                <th className="dynasty-th dynasty-th-team">NFL</th>
                <th className="dynasty-th dynasty-th-ktc">{VALUE_SOURCE_COL_HEADER[valueSource]}</th>
              </tr>
            </thead>
            <tbody>
              {/* ── Players ── */}
              {selectedPlayers.map(({ pid, name, position, nflTeam, espnPhotoUrl, displayValue, overallRank, posRank, hasValue }) => {
                const pRankLabel = RANKED_POSITIONS.includes(position) && posRank
                  ? `${position}${posRank}`
                  : null;
                const playerInfo = playersData ? getPlayerInfo(pid, playersData, playerIdMap) : null;
                return (
                  <tr
                    key={pid}
                    className="dynasty-player-row player-clickable"
                    onClick={() => playerInfo && setSelectedPlayer(playerInfo)}
                  >
                    <td className="dynasty-td dynasty-td-player">
                      <img
                        src={getPlayerLogoUrl(espnPhotoUrl)}
                        alt={name}
                        className="dynasty-player-avatar"
                      />
                      <div className="dynasty-player-info">
                        <span className="dynasty-player-name">{name}</span>
                        {position && <PositionBadge position={position} />}
                      </div>
                    </td>
                    <td className="dynasty-td dynasty-td-ranks">
                      {(overallRank != null || pRankLabel) ? (
                        <div className="dynasty-rank-stack">
                          {overallRank != null && (
                            <span className="dynasty-rank-overall">#{overallRank}</span>
                          )}
                          {pRankLabel && (
                            <span className="dynasty-rank-pos">{pRankLabel}</span>
                          )}
                        </div>
                      ) : null}
                    </td>
                    <td className="dynasty-td dynasty-td-team">{nflTeam}</td>
                    <td className="dynasty-td dynasty-td-ktc">
                      <span className={hasValue ? 'dynasty-ktc-value' : 'dynasty-ktc-none'}>
                        {displayValue}
                      </span>
                    </td>
                  </tr>
                );
              })}

              {/* ── Picks divider ── */}
              {PICKS_ENABLED && (valueSource === 'ktc_sf' || valueSource === 'ktc_sf_tep') && selectedPicks.length > 0 && (
                <tr className="dynasty-picks-divider-row">
                  <td colSpan={4} className="dynasty-picks-divider-cell">Draft Picks</td>
                </tr>
              )}

              {/* ── Picks ── */}
              {PICKS_ENABLED && (valueSource === 'ktc_sf' || valueSource === 'ktc_sf_tep') && selectedPicks.map((pick, i) => (
                <tr key={`pick-${i}`} className="dynasty-player-row dynasty-pick-row">
                  <td className="dynasty-td dynasty-td-player">
                    <div className="dynasty-pick-icon">
                      <span className="dynasty-pick-icon-inner">{pick.round}</span>
                    </div>
                    <div className="dynasty-player-info">
                      <span className="dynasty-player-name dynasty-pick-label">{pick.label}</span>
                    </div>
                  </td>
                  <td className="dynasty-td dynasty-td-ranks">
                    {pick.pickNum != null && (
                      <span className="dynasty-rank-overall dynasty-rank-approx">
                        #{pick.pickNum}
                      </span>
                    )}
                  </td>
                  <td className="dynasty-td dynasty-td-team" />
                  <td className="dynasty-td dynasty-td-ktc">
                    <span className={pick.ktcValue > 0 ? 'dynasty-ktc-value dynasty-ktc-approx' : 'dynasty-ktc-none'}>
                      {formatKtcValue(pick.ktcValue)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {playerModal && createPortal(playerModal, document.body)}
    </div>
  );
}

export default DynastyRosterView;
