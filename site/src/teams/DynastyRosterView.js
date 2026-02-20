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
import {
  fetchKtcData,
  getKtcEntryByName,
  getPickKtcValue,
  formatKtcValue,
  KTC_FORMAT_LABELS,
} from '../lookups/KtcLookup';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { CURRENT_YEAR, getCompletedWeeksCount } from '../utils/DateHelper';
import { calculateDraftOrder, convertPlacementToPickNumbers } from '../utils/DraftOrderHelper';
import { SANDBOX_FEATURES, isFeatureEnabled } from '../utils/featureToggles';
import PlayerWeeklyScores from '../players/PlayerWeeklyScores';
import LoadingState from '../LoadingState';

const PICKS_ENABLED = isFeatureEnabled('DYNASTY_DRAFT_PICKS', SANDBOX_FEATURES);

const RANKED_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const DISPLAY_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const KTC_FORMATS = ['sf', 'sf_tep'];

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
  const [selectedId, setSelectedId]       = useState(null);
  const [format, setFormat]               = useState('sf_tep');
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

        const [teamData, weeksData, idMap, ktcResult, allTradedPicks, prevWeeksData] =
          await Promise.all([
            fetchTeamData(CURRENT_YEAR),
            fetchScoresData(CURRENT_YEAR),
            fetchPlayerIdMap(),
            fetchKtcData(),
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
      } catch (e) {
        if (!cancelled) setError('Failed to load dynasty roster data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // ── Per-team KTC totals (recomputes when format changes) ─────────────────────

  const teamKtcTotals = useMemo(() => {
    if (!ktcMap || !playersData || !playerIdMap) return {};
    const totals = {};
    for (const team of teams) {
      let total = 0;
      // Players
      for (const pid of (rosters[team.rosterId] || [])) {
        const info  = getPlayerInfo(pid, playersData, playerIdMap);
        if (!info) continue;
        const entry = getKtcEntryByName(info.full_name || info.name, ktcMap, format, {
          position: info.position,
          team:     info.team || info.team_abbr,
          age:      info.age,
        });
        if (entry && entry.ktcValue > 0) total += entry.ktcValue;
      }
      // Picks (only when feature is enabled)
      if (PICKS_ENABLED) {
        for (const pick of (picksByRoster[team.rosterId] || [])) {
          const origRid = pick.roster_id != null ? String(pick.roster_id) : null;
          const pickNum = origRid ? draftOrderMap[origRid] : null;
          total += getPickKtcValue(pick.season, pick.round, CURRENT_YEAR, pickNum ?? null);
        }
      }
      totals[team.rosterId] = total;
    }
    return totals;
  }, [ktcMap, playersData, playerIdMap, teams, rosters, picksByRoster, draftOrderMap, format]);

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
    if (!selectedId || !playersData || !playerIdMap || !ktcMap) return [];
    return (rosters[selectedId] || []).map((pid) => {
      const info  = getPlayerInfo(pid, playersData, playerIdMap);
      const name  = info?.full_name || info?.name || pid;
      const entry = getKtcEntryByName(name, ktcMap, format, {
        position: info?.position,
        team:     info?.team || info?.team_abbr,
        age:      info?.age,
      });
      return {
        pid,
        name,
        position:    info?.position || '',
        nflTeam:     info?.team || info?.team_abbr || '',
        espnPhotoUrl: info?.espn_photo_url || null,
        ktcValue:    entry?.ktcValue    ?? 0,
        overallRank: entry?.overallRank ?? null,
        posRank:     entry?.posRank     ?? null,
      };
    }).sort((a, b) => b.ktcValue - a.ktcValue);
  }, [selectedId, playersData, playerIdMap, ktcMap, rosters, format]);

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

      {/* ── Header + format selector ── */}
      <div className="dynasty-section-header">
        <div className="dynasty-header-row">
          <div>
            <span className="dynasty-section-title">Dynasty Roster Values</span>
            <span className="dynasty-section-sub">KTC · sorted by total value</span>
          </div>
          <div className="dynasty-format-toggle">
            {KTC_FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                className={'dynasty-format-btn' + (format === f ? ' dynasty-format-btn--active' : '')}
                onClick={() => setFormat(f)}
              >
                {KTC_FORMAT_LABELS[f]}
              </button>
            ))}
          </div>
        </div>
        {ktcAsOf && <span className="dynasty-as-of">as of {ktcAsOf}</span>}
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
                {total != null && ktcMap && (
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
            <span className="dynasty-roster-total-label">Total KTC</span>
            <span className="dynasty-roster-total-value">{selectedTotal.toLocaleString()}</span>
          </div>

          <table className="dynasty-table">
            <thead>
              <tr>
                <th className="dynasty-th dynasty-th-player">Player</th>
                <th className="dynasty-th dynasty-th-ranks">Rank</th>
                <th className="dynasty-th dynasty-th-team">NFL</th>
                <th className="dynasty-th dynasty-th-ktc">KTC</th>
              </tr>
            </thead>
            <tbody>
              {/* ── Players ── */}
              {selectedPlayers.map(({ pid, name, position, nflTeam, espnPhotoUrl, ktcValue, overallRank, posRank }) => {
                const posClass   = DISPLAY_POSITIONS.includes(position)
                  ? `dynasty-pos-badge dynasty-pos-${position.toLowerCase()}`
                  : 'dynasty-pos-badge dynasty-pos-other';
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
                        {position && <span className={posClass}>{position}</span>}
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
                      <span className={ktcValue > 0 ? 'dynasty-ktc-value' : 'dynasty-ktc-none'}>
                        {formatKtcValue(ktcValue)}
                      </span>
                    </td>
                  </tr>
                );
              })}

              {/* ── Picks divider ── */}
              {PICKS_ENABLED && selectedPicks.length > 0 && (
                <tr className="dynasty-picks-divider-row">
                  <td colSpan={4} className="dynasty-picks-divider-cell">Draft Picks</td>
                </tr>
              )}

              {/* ── Picks ── */}
              {PICKS_ENABLED && selectedPicks.map((pick, i) => (
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
