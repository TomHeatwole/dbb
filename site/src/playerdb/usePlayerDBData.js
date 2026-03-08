/**
 * usePlayerDBData
 *
 * Loads and merges all player data sources into a single unified record per player.
 *
 * Sources (all fetched in parallel):
 *   - ktc_values.csv            → dynasty values + pos ranks, position, NFL team
 *   - fantasycalc.csv           → FC value, rank, pos rank, 30-day trend, age, sleeperId
 *   - stats_player_reg_YYYY.csv → fantasy points, games played, headshot URL
 *                                 (tries CURRENT_YEAR first, falls back to CURRENT_YEAR-1
 *                                  so off-season still loads last season's stats)
 *   - ffb.csv                   → FFB ranking (pos ranks computed from data)
 *   - player_ids.txt            → reliable sleeperId → espnId mapping for headshots
 *   - Sleeper API               → fantasy team ownership (via fetchTeamData)
 *   - players.txt               → sleeperId ↔ name mapping, ESPN ID supplement
 *
 * Join strategy:
 *   1. KTC + FC form the base player universe (skill positions QB/RB/WR/TE only)
 *   2. Stats joined by normalised display name
 *   3. Ownership joined by sleeperId (FC provides it directly; fallback: name map)
 *   4. Only players with at least one of: KTC value, fantasy points, or FC value are returned
 *
 * To add a new data source: parse it, build a normName or sleeperId map,
 * then merge additional fields inside `buildPlayer`.
 */

import { useState, useEffect } from 'react';
import { fetchKtcData } from '../lookups/KtcLookup';
import { fetchTeamData, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { normalisePlayerName, findBestPlayerMatch } from '../utils/playerNameMatcher';
import { CURRENT_YEAR } from '../utils/DateHelper';

const SKILL_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseIntOrNull(val) {
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

function parseFloatOrNull(val) {
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

/**
 * Fetch stats CSV. Tries CURRENT_YEAR first, falls back to CURRENT_YEAR-1.
 * This handles the off-season window where CURRENT_YEAR is the next season
 * (e.g. 2026) but only the previous season's file (2025) exists.
 *
 * Validates the response is actually CSV, not an HTML 404 page — some SPA
 * hosts return index.html with a 200 status for missing static paths, which
 * would cause silent parse failures if we only checked res.ok.
 */
async function fetchStatsText(year) {
  async function tryFetch(y) {
    const res = await fetch(`/data/stats_player_reg_${y}.csv`).catch(() => null);
    if (!res?.ok) return null;
    // Reject HTML responses (SPA fallback pages served as 200)
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('html')) return null;
    const text = await res.text();
    // Confirm the file is actually our stats CSV by checking the header line
    if (!text.trimStart().startsWith('player_id,')) return null;
    return text;
  }
  return (await tryFetch(year)) ?? (await tryFetch(Number(year) - 1));
}

/**
 * Load player_ids.txt and return a sleeperId → espnId map.
 * This is more complete than using player.espn_id from the Sleeper API directly.
 */
async function fetchSleeperToEspnMap() {
  const res = await fetch('/data/player_ids.txt').catch(() => null);
  if (!res?.ok) return {};
  const text = await res.text();
  const lines = text.trim().split('\n');
  const header = lines[0].split(',');
  const sleeperIdx = header.indexOf('sleeper_id');
  const espnIdx    = header.indexOf('espn_id');
  if (sleeperIdx < 0 || espnIdx < 0) return {};
  const map = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const sid  = cols[sleeperIdx]?.trim();
    const eid  = cols[espnIdx]?.trim();
    if (sid && eid) map[sid] = eid;
  }
  return map;
}

export function usePlayerDBData() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rosterInfo, setRosterInfo] = useState({ rosters: null, users: null });

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        const [
          ktcResult,
          fcResponse,
          statsText,
          ffbResponse,
          teamData,
          sleeperPlayers,
          sleeperToEspnMap,
        ] = await Promise.all([
          fetchKtcData().catch(() => null),
          fetch('/data/fantasycalc.csv').catch(() => null),
          fetchStatsText(CURRENT_YEAR),
          fetch('/data/ffb.csv').catch(() => null),
          fetchTeamData(CURRENT_YEAR).catch(() => null),
          fetch('/data/players.txt').then(r => r.ok ? r.json() : {}).catch(() => ({})),
          fetchSleeperToEspnMap(),
        ]);

        if (cancelled) return;

        const [fcText, ffbText] = await Promise.all([
          fcResponse?.ok ? fcResponse.text() : Promise.resolve(null),
          ffbResponse?.ok ? ffbResponse.text() : Promise.resolve(null),
        ]);

        if (cancelled) return;

        // ── Roster ownership map: sleeperId → { fantasyTeamName, fantasyTeamId } ──
        const rosterMap = {};
        if (teamData && Array.isArray(teamData.rosters)) {
          const teamInfoMap = buildRosterIdToTeamInfoMap(
            teamData.rosters,
            teamData.users || []
          );
          for (const roster of teamData.rosters) {
            const ridKey = Number(roster.roster_id);
            const info = teamInfoMap[ridKey];
            if (!info) continue;
            for (const sleeperId of (roster.players || [])) {
              rosterMap[String(sleeperId)] = {
                fantasyTeamName: info.teamName,
                fantasyTeamId: String(ridKey),
              };
            }
          }
        }

        // ── Sleeper name → sleeperId + espnId maps ──
        // Merge player.espn_id from Sleeper data with the more complete player_ids.txt
        const sleeperNameMap    = {};  // normName → sleeperId
        const sleeperIdToEspnId = {};  // sleeperId → espnId (starts from player_ids.txt)
        // Seed with the reliable player_ids.txt map
        Object.assign(sleeperIdToEspnId, sleeperToEspnMap);
        // Supplement with inline Sleeper espn_id (and build name map)
        for (const [sleeperId, player] of Object.entries(sleeperPlayers || {})) {
          if (!player.full_name || !SKILL_POSITIONS.has(player.position)) continue;
          const norm = normalisePlayerName(player.full_name);
          sleeperNameMap[norm] = sleeperId;
          // Only use Sleeper's espn_id if player_ids.txt didn't already supply one
          if (!sleeperIdToEspnId[sleeperId] && player.espn_id) {
            sleeperIdToEspnId[sleeperId] = String(player.espn_id);
          }
        }

        // ── Parse FantasyCalc CSV (semicolon-delimited, quoted fields) ──
        // Format: name;team;position;age;fantasycalcId;sleeperId;mflId;value;overallRank;positionRank;trend30day
        const fcBySleeperID = {};
        const fcByNormName  = {};
        if (fcText) {
          const lines = fcText.trim().split('\n');
          const hdr = lines[0].split(';').map(s => s.replace(/^"|"$/g, '').trim());
          const fi = {
            name:      hdr.indexOf('name'),
            team:      hdr.indexOf('team'),
            pos:       hdr.indexOf('position'),
            age:       hdr.indexOf('age'),
            sleeperId: hdr.indexOf('sleeperId'),
            value:     hdr.indexOf('value'),
            rank:      hdr.indexOf('overallRank'),
            posRank:   hdr.indexOf('positionRank'),
            trend:     hdr.indexOf('trend30day'),
          };
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(';').map(s => s.replace(/^"|"$/g, '').trim());
            const pos = cols[fi.pos] || '';
            if (!SKILL_POSITIONS.has(pos)) continue;
            const name = cols[fi.name] || '';
            if (!name) continue;
            const rawTrend = parseIntOrNull(cols[fi.trend]);
            const entry = {
              name,
              position:  pos,
              nflTeam:   cols[fi.team] || '',
              age:       parseFloatOrNull(cols[fi.age]),
              sleeperId: cols[fi.sleeperId] || null,
              fcValue:   parseIntOrNull(cols[fi.value]),
              fcRank:    parseIntOrNull(cols[fi.rank]),
              fcPosRank: parseIntOrNull(cols[fi.posRank]),
              fcTrend30: rawTrend,
            };
            if (entry.sleeperId) fcBySleeperID[entry.sleeperId] = entry;
            fcByNormName[normalisePlayerName(name)] = entry;
          }
        }

        // ── Parse stats CSV (join by normalised display name) ──
        const statsByNormName = {};
        if (statsText) {
          const lines = statsText.trim().split('\n');
          const headers = parseCSVLine(lines[0]);
          const si = {
            name:     headers.indexOf('player_display_name'),
            pos:      headers.indexOf('position'),
            games:    headers.indexOf('games'),
            ppr:      headers.indexOf('fantasy_points_ppr'),
            headshot: headers.indexOf('headshot_url'),
          };
          for (let i = 1; i < lines.length; i++) {
            const cols = parseCSVLine(lines[i]);
            const pos = cols[si.pos]?.trim() || '';
            if (!SKILL_POSITIONS.has(pos)) continue;
            const displayName = cols[si.name]?.trim() || '';
            if (!displayName) continue;
            const games = parseInt(cols[si.games], 10) || 0;
            const pts   = parseFloat(cols[si.ppr]) || 0;
            if (games === 0 && pts === 0) continue;
            const norm = normalisePlayerName(displayName);
            statsByNormName[norm] = {
              gamesPlayed: games,
              fantasyPoints: pts,
              fantasyPointsPerGame: games > 0
                ? Math.round((pts / games) * 100) / 100
                : 0,
              headshotUrl: cols[si.headshot]?.trim() || null,
            };
          }
        }

        // ── Parse FFB CSV: rank,name,sleeper_id ──
        // Also compute positional ranks by grouping within each position.
        const ffbBySleeperID = {};
        const ffbByNormName  = {};
        const ffbPosRankBySleeperId = {};
        const ffbPosRankByNormName  = {};
        if (ffbText) {
          const lines = ffbText.trim().split('\n');
          // First pass: collect entries with their names so we can match to positions
          const ffbEntries = [];
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',');
            const rank = parseInt(cols[0], 10) || null;
            const name = cols[1]?.trim() || '';
            const sid  = cols[2]?.trim() || '';
            if (!rank || !name) continue;
            const norm = normalisePlayerName(name);
            if (sid)  ffbBySleeperID[sid]  = rank;
            if (norm) ffbByNormName[norm]   = rank;
            ffbEntries.push({ rank, norm, sid });
          }

          // Second pass: derive position for each FFB player via FC or KTC data,
          // then compute positional ranks within each group.
          const byPos = {};
          for (const entry of ffbEntries) {
            const fcEntry  = fcByNormName[entry.norm];
            const ktcEntry = ktcResult?.map?.get(entry.norm);
            const pos = fcEntry?.position || ktcEntry?.position || null;
            if (!pos || !SKILL_POSITIONS.has(pos)) continue;
            if (!byPos[pos]) byPos[pos] = [];
            byPos[pos].push({ ...entry, pos });
          }
          // Sort each group by overall rank and assign positional ranks
          for (const posEntries of Object.values(byPos)) {
            posEntries.sort((a, b) => a.rank - b.rank);
            posEntries.forEach((e, idx) => {
              const posRank = idx + 1;
              if (e.sid)  ffbPosRankBySleeperId[e.sid]  = posRank;
              if (e.norm) ffbPosRankByNormName[e.norm]   = posRank;
            });
          }
        }

        // ── Candidate arrays for fallback name matching ──
        const ktcCandidates = ktcResult?.map ? Array.from(ktcResult.map.values()) : [];
        const fcCandidates  = Object.values(fcByNormName);

        // ── Helper: build a unified player record ──
        function buildPlayer(normName, displayName, position, nflTeam) {
          const ktcEntry = ktcResult?.map?.get(normName) || null;

          // FC lookup: direct normName first, then last-name fallback with
          // position+team hints to handle nickname mismatches (e.g. "Chig" vs "Chigoziem")
          let fcEntry = fcByNormName[normName] || null;
          if (!fcEntry) {
            const pos  = position || ktcEntry?.position;
            const team = nflTeam  || ktcEntry?.nflTeam;
            const { candidate } = findBestPlayerMatch(
              displayName,
              fcCandidates,
              { position: pos, team },
              { name: 'name', position: 'position', team: 'nflTeam' },
            );
            fcEntry = candidate || null;
          }
          // When fcEntry was found via nickname fallback (e.g. "Chig" matched to
          // a KTC entry under "Chigoziem"), its own normName differs from the
          // primary normName. Use it as a secondary key so stats, sleeper name
          // map, and FFB name lookups — which are keyed by the FC/stats name —
          // are also resolved correctly.
          const fcNorm = fcEntry ? normalisePlayerName(fcEntry.name) : null;
          const altNorm = (fcNorm && fcNorm !== normName) ? fcNorm : null;

          // Prefer FC's sleeperId (exact match), then Sleeper name map
          const sleeperId = fcEntry?.sleeperId
            || sleeperNameMap[normName]
            || (altNorm ? sleeperNameMap[altNorm] : null)
            || null;
          const statsEntry = statsByNormName[normName]
            || (altNorm ? statsByNormName[altNorm] : null)
            || null;
          const ownership  = sleeperId ? rosterMap[sleeperId] : null;

          // FFB overall + pos rank
          const ffbRank = (sleeperId && ffbBySleeperID[sleeperId])
            ? ffbBySleeperID[sleeperId]
            : (ffbByNormName[normName] || (altNorm ? ffbByNormName[altNorm] : null) || null);
          const ffbPosRank = (sleeperId && ffbPosRankBySleeperId[sleeperId])
            ? ffbPosRankBySleeperId[sleeperId]
            : (ffbPosRankByNormName[normName] || (altNorm ? ffbPosRankByNormName[altNorm] : null) || null);

          // Headshot: prefer NFL CDN from stats CSV, then ESPN CDN via espnId
          const espnId = sleeperId ? sleeperIdToEspnId[sleeperId] : null;
          const headshotUrl = statsEntry?.headshotUrl
            || (espnId
              ? `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${espnId}.png`
              : null);

          const sleeperPlayer = sleeperId ? (sleeperPlayers[sleeperId] || null) : null;

          return {
            sleeperId,
            name:      displayName,
            normName,
            position:  position  || ktcEntry?.position  || fcEntry?.position  || '',
            nflTeam:   nflTeam   || ktcEntry?.nflTeam   || fcEntry?.nflTeam   || '',
            age:       fcEntry?.age ?? null,
            yearsExp:  sleeperPlayer?.years_exp ?? null,
            headshotUrl,
            // Ownership
            fantasyTeamName: ownership?.fantasyTeamName || null,
            fantasyTeamId:   ownership?.fantasyTeamId   || null,
            isFreeAgent:     !ownership,
            // 2025 stats
            gamesPlayed:          statsEntry?.gamesPlayed          || 0,
            fantasyPoints:        statsEntry?.fantasyPoints        || 0,
            fantasyPointsPerGame: statsEntry?.fantasyPointsPerGame || 0,
            // KTC (both formats; page enriches to active ktcValue/ktcRank/ktcPosRank)
            ktcValue_sf:    ktcEntry?.ktcValue_sf    || null,
            ktcValue_tep:   ktcEntry?.ktcValue_tep   || null,
            ktcRank_sf:     ktcEntry?.overallRank_sf  || null,
            ktcRank_tep:    ktcEntry?.overallRank_tep || null,
            ktcPosRank_sf:  ktcEntry?.posRank_sf      || null,
            ktcPosRank_tep: ktcEntry?.posRank_tep     || null,
            // FantasyCalc
            fcValue:   fcEntry?.fcValue   || null,
            fcRank:    fcEntry?.fcRank    || null,
            fcPosRank: fcEntry?.fcPosRank || null,
            fcTrend30: fcEntry?.fcTrend30 ?? null,
            // FFB
            ffbRank,
            ffbPosRank,
          };
        }

        // ── Merge passes ──
        const seen    = new Set();
        const unified = [];

        // Pass 1: KTC players (most authoritative dynasty source)
        if (ktcResult?.map) {
          for (const [normName, ktcEntry] of ktcResult.map) {
            if (!SKILL_POSITIONS.has(ktcEntry.position)) continue;
            seen.add(normName);
            unified.push(
              buildPlayer(normName, ktcEntry.name, ktcEntry.position, ktcEntry.nflTeam)
            );
          }
        }

        // Pass 2: FC players not already covered by KTC
        for (const [normName, fcEntry] of Object.entries(fcByNormName)) {
          if (seen.has(normName) || !SKILL_POSITIONS.has(fcEntry.position)) continue;
          // Skip if this FC player was already merged into a KTC entry via fallback
          // (e.g. "Chig Okonkwo" in FC was already pulled into "Chigoziem Okonkwo" from KTC)
          const { candidate: ktcMatch } = findBestPlayerMatch(
            fcEntry.name,
            ktcCandidates,
            { position: fcEntry.position, team: fcEntry.nflTeam },
            { name: 'name', position: 'position', team: 'nflTeam' },
          );
          if (ktcMatch) continue;
          seen.add(normName);
          unified.push(
            buildPlayer(normName, fcEntry.name, fcEntry.position, fcEntry.nflTeam)
          );
        }

        // Deduplicate by sleeperId: if the KTC and FC passes both resolved the
        // same person (via different display-name variants), they'll share a
        // sleeperId and produce a duplicate row. Keep the first occurrence
        // (KTC pass), which is the more authoritative source.
        const seenById = new Set();
        const result = unified.filter(p => {
          if (p.sleeperId) {
            if (seenById.has(p.sleeperId)) return false;
            seenById.add(p.sleeperId);
          }
          return (
            (p.ktcValue_tep && p.ktcValue_tep > 0) ||
            p.fantasyPoints > 0 ||
            (p.fcValue && p.fcValue > 0)
          );
        });

        if (!cancelled) {
          setPlayers(result);
          setRosterInfo({
            rosters: teamData?.rosters || null,
            users:   teamData?.users   || null,
          });
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load player data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => { cancelled = true; };
  }, []);

  return { players, loading, error, rosterInfo };
}
