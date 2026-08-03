#!/usr/bin/env node
/**
 * build_archetype_rosters.js
 *
 * Builds the archetype roster set for the HVORP / True Hwang Value project.
 *
 * Selection rules:
 *   - 2024: top 6 finishers (wins, then fpts)
 *   - 2025: top finishers (wins, then fpts) excluding tankers — the season had
 *           only 6 competitive teams (11+ wins); the other four (PUPpy Bowl,
 *           The Boomers, Eat It While She Sleeper, Sell for Sellers) tanked
 *           and would taint the archetype data
 *   - 2026: top 7 by simulation — everyone except an explicit exclusion list,
 *           ordered by total roster KTC (SF TE+) value
 *
 * Every rostered player is recorded with:
 *   - current KTC SF TE+ value / overall rank / positional rank (ktc_values.csv)
 *   - current competitor-adjusted value / ranks (ktc_redraft_value_index.csv)
 *
 * Output:
 *   site/public/data/archetype_rosters.csv
 *   site/public/data/archetype_rosters_meta.json
 *
 * Usage (from project root):
 *   node site/src/data_parse/build_archetype_rosters.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalisePlayerName, findBestPlayerMatch } from '../utils/playerNameMatcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const DATA_DIR = path.join(PROJECT_ROOT, 'site/public/data');
const SETTINGS_PATH = path.join(PROJECT_ROOT, 'settings/settings.json');

const OUT_CSV = path.join(DATA_DIR, 'archetype_rosters.csv');
const OUT_META = path.join(DATA_DIR, 'archetype_rosters_meta.json');

// Selection config
const TOP_N_BY_SEASON = { 2024: 6, 2025: 7 };
// Tankers excluded from past-season standings selection (no legitimate 7th
// competitor existed in 2025 — top 7 by record would pull in a 5-13 tanker).
const STANDINGS_EXCLUDED_TEAMS = {
  2025: ['PUPpy Bowl', 'The Boomers', 'Eat It While She Sleeper', 'Sell for Sellers'],
};
const SIM_SEASON = 2026;
const SIM_EXCLUDED_TEAMS = ['Sell for Sellers', 'The Boomers', 'PUPpy Bowl'];

// ── CSV helpers ───────────────────────────────────────────────────────────────

function parseCsv(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',');
    const row = {};
    headers.forEach((h, idx) => { row[h] = (cols[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

function csvEscape(val) {
  if (val == null) return '';
  const s = String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ── Sleeper fetches ───────────────────────────────────────────────────────────

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed (${res.status}): ${url}`);
  return res.json();
}

function fpts(settings) {
  return (settings?.fpts ?? 0) + (settings?.fpts_decimal ?? 0) / 100;
}

function resolveTeamName(roster, usersById, overrides) {
  const override = overrides?.[String(roster.roster_id)];
  if (override?.name) return { teamName: override.name.trim(), owner: override.owner || '' };
  const user = usersById[roster.owner_id];
  const teamName = (user?.metadata?.team_name || '').trim() || user?.display_name || `Roster ${roster.roster_id}`;
  return { teamName, owner: user?.display_name || '' };
}

// ── Value boards ──────────────────────────────────────────────────────────────

function buildKtcBoard(rows) {
  // SF TE+ values; recompute positional ranks by tep value
  const entries = rows
    .map((r) => ({
      name: r.name,
      position: r.position,
      team: r.team,
      ktcValue: parseInt(r.ktc_value_tep_2qb, 10),
      overallRank: parseInt(r.rank_tep_2qb, 10) || null,
      asOf: r.as_of,
    }))
    .filter((r) => r.name && Number.isFinite(r.ktcValue));

  const byPos = {};
  for (const e of entries) {
    (byPos[e.position] = byPos[e.position] || []).push(e);
  }
  for (const pos of Object.keys(byPos)) {
    byPos[pos].sort((a, b) => b.ktcValue - a.ktcValue);
    byPos[pos].forEach((e, idx) => { e.posRank = idx + 1; });
  }

  const map = new Map();
  for (const e of entries) map.set(normalisePlayerName(e.name), e);
  return { entries, map, asOf: entries[0]?.asOf || null };
}

function buildCompAdjBoard(rows) {
  const entries = rows
    .map((r) => ({
      name: r.name,
      position: r.position,
      team: r.team,
      compAdjValue: parseInt(r.competitor_adjusted_value, 10),
    }))
    .filter((r) => r.name && Number.isFinite(r.compAdjValue));

  const sorted = [...entries].sort((a, b) => b.compAdjValue - a.compAdjValue);
  sorted.forEach((e, idx) => { e.overallRank = idx + 1; });

  const byPos = {};
  for (const e of entries) {
    (byPos[e.position] = byPos[e.position] || []).push(e);
  }
  for (const pos of Object.keys(byPos)) {
    byPos[pos].sort((a, b) => b.compAdjValue - a.compAdjValue);
    byPos[pos].forEach((e, idx) => { e.posRank = idx + 1; });
  }

  const map = new Map();
  for (const e of entries) map.set(normalisePlayerName(e.name), e);
  return { entries, map };
}

function lookupOnBoard(board, playerName, hints) {
  const direct = board.map.get(normalisePlayerName(playerName));
  if (direct) return direct;
  const { candidate } = findBestPlayerMatch(playerName, board.entries, hints);
  return candidate || null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const settings = JSON.parse(await fs.readFile(SETTINGS_PATH, 'utf8'));
  const leagueIds = {
    ...Object.fromEntries(
      Object.entries(settings.PREVIOUS_YEARS || {}).map(([y, id]) => [Number(y), id]),
    ),
    [SIM_SEASON]: settings.LEAGUE_ID,
  };
  const rosterOverrides = settings.PREVIOUS_ROSTER_OVERRIDES || {};

  console.log('Loading players.txt / KTC boards…');
  const [playersRaw, ktcRaw, compAdjRaw] = await Promise.all([
    fs.readFile(path.join(DATA_DIR, 'players.txt'), 'utf8'),
    fs.readFile(path.join(DATA_DIR, 'ktc_values.csv'), 'utf8'),
    fs.readFile(path.join(DATA_DIR, 'ktc_redraft_value_index.csv'), 'utf8'),
  ]);
  const sleeperPlayers = JSON.parse(playersRaw);
  const ktcBoard = buildKtcBoard(parseCsv(ktcRaw));
  const compAdjBoard = buildCompAdjBoard(parseCsv(compAdjRaw));

  const outRows = [];
  const unmatched = [];
  const archetypes = [];

  for (const season of Object.keys(leagueIds).map(Number).sort()) {
    const leagueId = leagueIds[season];
    console.log(`Fetching Sleeper league ${leagueId} (${season})…`);
    const [rosters, users] = await Promise.all([
      fetchJson(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
      fetchJson(`https://api.sleeper.app/v1/league/${leagueId}/users`),
    ]);
    const usersById = Object.fromEntries(users.map((u) => [u.user_id, u]));
    const overrides = rosterOverrides[String(season)];

    const teams = rosters.map((roster) => {
      const { teamName, owner } = resolveTeamName(roster, usersById, overrides);
      return {
        roster,
        teamName,
        owner,
        wins: roster.settings?.wins ?? 0,
        losses: roster.settings?.losses ?? 0,
        fpts: fpts(roster.settings),
      };
    });

    let selected;
    let rankBasis;
    if (season === SIM_SEASON) {
      rankBasis = 'sim_roster_value';
      const excluded = new Set(SIM_EXCLUDED_TEAMS.map((n) => n.toLowerCase()));
      selected = teams.filter((t) => !excluded.has(t.teamName.toLowerCase()));
      if (selected.length !== teams.length - SIM_EXCLUDED_TEAMS.length) {
        const names = teams.map((t) => t.teamName).join(', ');
        throw new Error(`2026 exclusion list didn't match exactly. Team names: ${names}`);
      }
      // Order by total roster KTC value (computed below, so pre-compute here)
      for (const t of selected) {
        t.totalKtc = t.roster.players.reduce((sum, pid) => {
          const p = sleeperPlayers[pid];
          if (!p) return sum;
          const entry = lookupOnBoard(ktcBoard, p.full_name || '', {
            position: p.position || p.fantasy_positions?.[0],
            team: p.team,
          });
          return sum + (entry?.ktcValue || 0);
        }, 0);
      }
      selected.sort((a, b) => b.totalKtc - a.totalKtc);
    } else {
      rankBasis = 'standings';
      const topN = TOP_N_BY_SEASON[season];
      const excluded = new Set(
        (STANDINGS_EXCLUDED_TEAMS[season] || []).map((n) => n.toLowerCase()),
      );
      selected = [...teams]
        .filter((t) => !excluded.has(t.teamName.toLowerCase()))
        .sort((a, b) => (b.wins - a.wins) || (b.fpts - a.fpts))
        .slice(0, topN);
    }

    selected.forEach((team, idx) => {
      const finishRank = idx + 1;
      const archetypeId = `${season}_${finishRank}`;
      archetypes.push({
        archetypeId,
        season,
        finishRank,
        rankBasis,
        teamName: team.teamName,
        owner: team.owner,
        record: `${team.wins}-${team.losses}`,
        fpts: team.fpts,
      });

      const playerRows = team.roster.players.map((pid) => {
        const p = sleeperPlayers[pid];
        const playerName = p?.full_name || `Unknown ${pid}`;
        const sleeperPos = p?.position || p?.fantasy_positions?.[0] || '';
        const hints = { position: sleeperPos, team: p?.team };
        const ktc = lookupOnBoard(ktcBoard, playerName, hints);
        const compAdj = lookupOnBoard(compAdjBoard, playerName, hints);
        if (!ktc) unmatched.push(`${season} ${team.teamName}: ${playerName} (${sleeperPos})`);
        return {
          archetype_id: archetypeId,
          season,
          finish_rank: finishRank,
          rank_basis: rankBasis,
          team_name: team.teamName,
          owner: team.owner,
          roster_id: team.roster.roster_id,
          wins: team.wins,
          losses: team.losses,
          fpts: team.fpts.toFixed(2),
          sleeper_id: pid,
          player_name: playerName,
          sleeper_position: sleeperPos,
          nfl_team: p?.team || '',
          ktc_name: ktc?.name || '',
          position: ktc?.position || sleeperPos,
          ktc_value: ktc?.ktcValue ?? '',
          ktc_overall_rank: ktc?.overallRank ?? '',
          ktc_pos_rank: ktc?.posRank ?? '',
          comp_adj_value: compAdj?.compAdjValue ?? '',
          comp_adj_overall_rank: compAdj?.overallRank ?? '',
          comp_adj_pos_rank: compAdj?.posRank ?? '',
        };
      });

      // Within an archetype: order by current KTC value desc, unmatched last
      playerRows.sort((a, b) => (Number(b.ktc_value) || 0) - (Number(a.ktc_value) || 0));
      outRows.push(...playerRows);
    });
  }

  const headers = Object.keys(outRows[0]);
  const csv = [
    headers.join(','),
    ...outRows.map((r) => headers.map((h) => csvEscape(r[h])).join(',')),
  ].join('\n');
  await fs.writeFile(OUT_CSV, `${csv}\n`);

  const meta = {
    generatedAt: new Date().toISOString(),
    ktcAsOf: ktcBoard.asOf,
    selection: {
      2024: 'top 6 by standings (wins, then fpts)',
      2025: `top by standings (wins, then fpts), excluding tankers: ${(STANDINGS_EXCLUDED_TEAMS[2025] || []).join(', ')}`,
      [SIM_SEASON]: `all teams except ${SIM_EXCLUDED_TEAMS.join(', ')}, ordered by total roster KTC SF TE+ value`,
    },
    archetypes,
    unmatchedPlayers: unmatched,
  };
  await fs.writeFile(OUT_META, `${JSON.stringify(meta, null, 2)}\n`);

  console.log(`\nWrote ${outRows.length} player rows across ${archetypes.length} archetypes → ${path.relative(PROJECT_ROOT, OUT_CSV)}`);
  for (const a of archetypes) {
    console.log(`  ${a.archetypeId}  ${a.teamName} (${a.record}, ${a.fpts.toFixed(0)} pts)`);
  }
  if (unmatched.length) {
    console.log(`\n${unmatched.length} players with no current KTC value:`);
    unmatched.forEach((u) => console.log(`  - ${u}`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
