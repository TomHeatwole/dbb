#!/usr/bin/env node
/**
 * Derive Hwang pick values from trades.
 *
 * Players are scored with trade-date SF TE+ KTC × pass-2 position multipliers,
 * then KTC-style Value Adjustment. Picks are treated as having zero KTC.
 * Revealed equality implies: playerGap = value(picks received by the
 * player-light side). OLS / clean residuals recover round values.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { evaluateKtcStyleTrade } from '../site/src/tradeCalculator/ktcValueAdjustment.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'site/public/data');
const OUT_JSON = join(ROOT, 'example_data/hwang_implied_pick_values.json');
const SLEEPER = 'https://api.sleeper.app/v1';
const CURRENT_LEAGUE_ID = '1326575946462920704';
const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);
const MAX_SLACK_DAYS = 3;

/** Pass-2 mixed-position KTC-weighted ratios vs Hwang equality. */
const POS_MULT = { QB: 0.99, RB: 1.04, WR: 1.0, TE: 1.06 };
const DRAFT_IDS = {
  2025: '1194868087212167169',
  2026: '1326575946467123200',
};

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function nyDate(ms) {
  return new Date(ms).toLocaleString('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
}

function mean(xs) {
  return xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : null;
}
function median(xs) {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function round1(n) {
  return n == null || !Number.isFinite(n) ? null : Math.round(n);
}

function userTeamName(user, fallback) {
  if (!user) return fallback;
  const meta = user.metadata || {};
  return String(meta.team_name || user.display_name || fallback).trim();
}

async function teamMap(leagueId) {
  const [users, rosters] = await Promise.all([
    getJson(`${SLEEPER}/league/${leagueId}/users`),
    getJson(`${SLEEPER}/league/${leagueId}/rosters`),
  ]);
  const byId = Object.fromEntries(users.map((u) => [u.user_id, u]));
  const assigned = new Set(rosters.map((r) => String(r.owner_id || '')).filter(Boolean));
  const leftover = users.filter((u) => !assigned.has(String(u.user_id)));
  let leftoverI = 0;
  const out = {};
  for (const r of rosters) {
    const rid = Number(r.roster_id);
    const user = r.owner_id ? byId[String(r.owner_id)] : null;
    if (user) out[rid] = userTeamName(user, `Roster ${rid}`);
    else if (leftoverI < leftover.length) {
      out[rid] = userTeamName(leftover[leftoverI], `Vacant roster ${rid}`);
      leftoverI += 1;
    } else out[rid] = `Vacant roster ${rid}`;
  }
  return out;
}

function playerMeta(players, pid) {
  const p = players[String(pid)] || {};
  const name = `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.full_name || `Player ${pid}`;
  const pos = String(p.position || (p.fantasy_positions || [])[0] || '?').toUpperCase();
  return { id: String(pid), name, pos };
}

function loadKtcHistory() {
  const text = readFileSync(join(DATA, 'sf_ktc_values_historical.csv'), 'utf8');
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(',');
  const iDate = header.indexOf('date');
  const iVal = header.indexOf('ktc_value');
  const iSid = header.indexOf('sleeper_id');
  const byId = new Map();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(',');
    const d = (cols[iDate] || '').trim();
    const sid = (cols[iSid] || '').trim();
    if (!d || !sid) continue;
    const v = Number(cols[iVal]);
    if (!Number.isFinite(v)) continue;
    let arr = byId.get(sid);
    if (!arr) {
      arr = [];
      byId.set(sid, arr);
    }
    arr.push([d, v]);
  }
  for (const [sid, arr] of byId) {
    arr.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const collapsed = [];
    for (const row of arr) {
      if (collapsed.length && collapsed[collapsed.length - 1][0] === row[0]) {
        collapsed[collapsed.length - 1] = row;
      } else collapsed.push(row);
    }
    byId.set(sid, collapsed);
  }
  return byId;
}

function lookupKtc(series, tradeDate) {
  if (!series?.length) return null;
  let lo = 0;
  let hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] <= tradeDate) lo = mid + 1;
    else hi = mid;
  }
  const i = lo - 1;
  if (i >= 0) {
    const [d, v] = series[i];
    if (daysBetween(tradeDate, d) <= MAX_SLACK_DAYS) return { value: v, asOf: d };
  }
  if (i + 1 < series.length) {
    const [d, v] = series[i + 1];
    if (daysBetween(d, tradeDate) <= MAX_SLACK_DAYS) return { value: v, asOf: d };
  }
  return null;
}

function loadLiveKtc() {
  const text = readFileSync(join(DATA, 'ktc_values.csv'), 'utf8');
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(',');
  const iName = header.indexOf('name');
  const iVal = header.indexOf('ktc_value_tep_2qb');
  const iAsOf = header.indexOf('as_of');
  const byName = new Map();
  let asOf = null;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cols = lines[i].split(',');
    const name = (cols[iName] || '').trim().toLowerCase();
    const v = Number(cols[iVal]);
    if (!name || !Number.isFinite(v)) continue;
    byName.set(name, v);
    asOf = cols[iAsOf] || asOf;
  }
  return { byName, asOf };
}

function adjPlayerValue(ktc, pos) {
  if (!(ktc > 0)) return 0;
  return ktc * (POS_MULT[pos] ?? 1);
}

function tierFromSlot(slot) {
  const n = Number(slot);
  if (!Number.isFinite(n) || n < 1) return null;
  if (n <= 3) return 'Early';
  if (n <= 7) return 'Mid';
  return 'Late';
}

function invertSlotMap(slotToRoster) {
  const out = {};
  for (const [slot, rid] of Object.entries(slotToRoster || {})) {
    out[String(rid)] = Number(slot);
  }
  return out;
}

/** Gaussian elimination for k x k. Returns null if singular. */
function solve(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    }
    if (Math.abs(M[piv][i]) < 1e-9) return null;
    [M[i], M[piv]] = [M[piv], M[i]];
    const div = M[i][i];
    for (let c = i; c <= n; c++) M[i][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i];
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  return M.map((row) => row[n]);
}

function ols(rows, keys) {
  const n = rows.length;
  const k = keys.length;
  if (!n || !k) return { keys, beta: {}, n: 0 };
  const XtX = Array.from({ length: k }, () => Array(k).fill(0));
  const Xty = Array(k).fill(0);
  let sse0 = 0;
  for (const row of rows) {
    sse0 += row.y * row.y;
    for (let i = 0; i < k; i++) {
      Xty[i] += row.x[keys[i]] * row.y;
      for (let j = 0; j < k; j++) XtX[i][j] += row.x[keys[i]] * row.x[keys[j]];
    }
  }
  const betaArr = solve(XtX, Xty);
  if (!betaArr) return { keys, beta: {}, n, singular: true };
  const beta = {};
  keys.forEach((key, i) => { beta[key] = betaArr[i]; });
  let sse = 0;
  for (const row of rows) {
    let yhat = 0;
    for (const key of keys) yhat += (beta[key] || 0) * row.x[key];
    sse += (row.y - yhat) ** 2;
  }
  const df = Math.max(1, n - k);
  const sigma2 = sse / df;
  const se = {};
  const XtXinv = [];
  for (let j = 0; j < k; j++) {
    const e = Array(k).fill(0);
    e[j] = 1;
    const col = solve(XtX, e);
    XtXinv.push(col);
  }
  keys.forEach((key, i) => {
    se[key] = XtXinv[i] ? Math.sqrt(Math.max(0, sigma2 * XtXinv[i][i])) : null;
  });
  return {
    keys,
    beta,
    se,
    n,
    r2: sse0 > 0 ? 1 - sse / sse0 : null,
    rmse: Math.sqrt(sse / n),
  };
}

function bootstrapOls(rows, keys, reps = 400) {
  const dist = Object.fromEntries(keys.map((k) => [k, []]));
  for (let r = 0; r < reps; r++) {
    const sample = [];
    for (let i = 0; i < rows.length; i++) {
      sample.push(rows[Math.floor(Math.random() * rows.length)]);
    }
    const fit = ols(sample, keys);
    if (fit.singular || !Object.keys(fit.beta).length) continue;
    for (const key of keys) dist[key].push(fit.beta[key]);
  }
  const ci = {};
  for (const key of keys) {
    const a = dist[key].sort((x, y) => x - y);
    if (!a.length) {
      ci[key] = null;
      continue;
    }
    ci[key] = {
      p05: a[Math.floor(a.length * 0.05)],
      p50: a[Math.floor(a.length * 0.5)],
      p95: a[Math.min(a.length - 1, Math.floor(a.length * 0.95))],
      n: a.length,
    };
  }
  return ci;
}

function isotonicRounds(beta) {
  const r = [1, 2, 3, 4].map((i) => beta[`r${i}`] ?? 0);
  // Pool adjacent violations (PAV), enforce decreasing & non-negative.
  const w = [1, 1, 1, 1];
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < 3; i++) {
      if (r[i] < r[i + 1]) {
        const merged = (r[i] * w[i] + r[i + 1] * w[i + 1]) / (w[i] + w[i + 1]);
        r[i] = r[i + 1] = merged;
        w[i] = w[i + 1] = w[i] + w[i + 1];
      }
    }
  }
  for (let i = 0; i < 4; i++) r[i] = Math.max(0, r[i]);
  return { r1: r[0], r2: r[1], r3: r[2], r4: r[3] };
}

async function walkLeagues(startId) {
  const leagues = [];
  const seen = new Set();
  let id = startId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const league = await getJson(`${SLEEPER}/league/${id}`);
    leagues.push(league);
    id = league.previous_league_id || null;
  }
  return leagues;
}

async function main() {
  const players = JSON.parse(readFileSync(join(DATA, 'players.txt'), 'utf8'));
  const ktcById = loadKtcHistory();
  const liveKtc = loadLiveKtc();
  const slotBySeason = {};
  for (const [year, draftId] of Object.entries(DRAFT_IDS)) {
    const draft = await getJson(`${SLEEPER}/draft/${draftId}`);
    slotBySeason[year] = invertSlotMap(draft.slot_to_roster_id);
  }

  const leagues = await walkLeagues(CURRENT_LEAGUE_ID);
  const funnel = {};
  const bump = (k) => { funnel[k] = (funnel[k] || 0) + 1; };
  const rows = [];

  for (const league of leagues) {
    const leagueYear = String(league.season);
    const names = await teamMap(league.league_id);
    const txns = await getJson(`${SLEEPER}/league/${league.league_id}/transactions/1`);
    const trades = (Array.isArray(txns) ? txns : []).filter(
      (t) => t?.type === 'trade' && t?.status === 'complete',
    );

    for (const trade of trades) {
      bump('completed');
      const rosterIds = [...new Set((trade.roster_ids || []).map(Number))];
      if (rosterIds.length !== 2) {
        bump('not_two_team');
        continue;
      }
      const picks = trade.draft_picks || [];
      if (!picks.length) {
        bump('no_picks');
        continue;
      }
      bump('with_picks');

      const faabAmt = (trade.waiver_budget || [])
        .filter((w) => w && w.amount)
        .reduce((s, w) => s + Number(w.amount || 0), 0);
      const date = nyDate(trade.created);
      const sides = rosterIds.sort((a, b) => a - b).map((rid) => ({
        rosterId: rid,
        team: names[rid] || `Roster ${rid}`,
        players: [],
        picks: [],
      }));
      const byRid = Object.fromEntries(sides.map((s) => [s.rosterId, s]));

      for (const [pid, rid] of Object.entries(trade.adds || {})) {
        const side = byRid[Number(rid)];
        if (!side) continue;
        const meta = playerMeta(players, pid);
        const hit = lookupKtc(ktcById.get(meta.id), date);
        let ktc = hit?.value ?? null;
        let ktcSource = hit ? 'historical' : null;
        if (ktc == null) {
          const live = liveKtc.byName.get(meta.name.toLowerCase());
          if (live != null) {
            ktc = live;
            ktcSource = 'live_fallback';
          }
        }
        side.players.push({
          ...meta,
          ktc,
          ktcSource,
          adj: ktc != null ? adjPlayerValue(ktc, meta.pos) : null,
        });
      }
      for (const pick of picks) {
        const to = byRid[Number(pick.owner_id)];
        if (!to) continue;
        const season = String(pick.season);
        const round = Number(pick.round);
        const orig = pick.roster_id != null ? Number(pick.roster_id) : null;
        const startup = leagueYear === '2024' && season === '2024';
        const currentYear = !startup && season === leagueYear && round >= 1 && round <= 4;
        const future = !startup && Number(season) > Number(leagueYear) && round >= 1 && round <= 4;
        const slot = currentYear ? (slotBySeason[season] || {})[String(orig)] : null;
        const tier = currentYear ? tierFromSlot(slot) : null;
        to.picks.push({
          season,
          round,
          orig,
          slot: slot ?? null,
          tier,
          currentYear,
          future,
          startup,
          label: currentYear && slot
            ? `${season} ${round}.${String(slot).padStart(2, '0')} (${tier})`
            : startup
              ? `${season} startup R${round}`
              : `${season} ${round === 1 ? '1st' : round === 2 ? '2nd' : round === 3 ? '3rd' : `${round}th`}`,
        });
      }

      const missing = sides.flatMap((s) => s.players.filter((p) => p.adj == null));
      const usedLive = sides.some((s) => s.players.some((p) => p.ktcSource === 'live_fallback'));
      if (missing.length) {
        bump('missing_player_ktc');
        continue;
      }
      if (faabAmt > 1) {
        bump('has_faab');
        continue;
      }
      const hasStartup = sides.some((s) => s.picks.some((p) => p.startup));
      const hasWeirdRound = sides.some((s) => s.picks.some((p) => p.round > 4 && !p.startup));
      if (hasWeirdRound) {
        bump('round_gt_4');
        continue;
      }

      const valuesA = sides[0].players.map((p) => p.adj).filter((v) => v > 0);
      const valuesB = sides[1].players.map((p) => p.adj).filter((v) => v > 0);
      const va = evaluateKtcStyleTrade(valuesA, valuesB);
      const adjA = va.adjustedTotalA;
      const adjB = va.adjustedTotalB;
      // A's picks must cover B's player surplus: y = adjB - adjA = val(picksA) - val(picksB)
      const y = adjB - adjA;

      const net = {
        r1: 0, r2: 0, r3: 0, r4: 0,
        r1_early: 0, r1_mid: 0, r1_late: 0, r1_future: 0,
        r2_curr: 0, r2_future: 0,
        r3_curr: 0, r3_future: 0,
        r4_curr: 0, r4_future: 0,
      };
      const addPick = (p, sign) => {
        if (p.startup) return;
        if (p.round < 1 || p.round > 4) return;
        net[`r${p.round}`] += sign;
        if (p.round === 1) {
          if (p.currentYear && p.tier === 'Early') net.r1_early += sign;
          else if (p.currentYear && p.tier === 'Mid') net.r1_mid += sign;
          else if (p.currentYear && p.tier === 'Late') net.r1_late += sign;
          else net.r1_future += sign;
        } else if (p.round === 2) {
          if (p.currentYear) net.r2_curr += sign;
          else net.r2_future += sign;
        } else if (p.round === 3) {
          if (p.currentYear) net.r3_curr += sign;
          else net.r3_future += sign;
        } else if (p.round === 4) {
          if (p.currentYear) net.r4_curr += sign;
          else net.r4_future += sign;
        }
      };
      for (const p of sides[0].picks) addPick(p, 1);
      for (const p of sides[1].picks) addPick(p, -1);

      const nPicksA = sides[0].picks.filter((p) => !p.startup).length;
      const nPicksB = sides[1].picks.filter((p) => !p.startup).length;
      if (nPicksA + nPicksB === 0) {
        bump('startup_only');
        continue;
      }
      const roundsPresent = [...new Set(
        [...sides[0].picks, ...sides[1].picks]
          .filter((p) => !p.startup && p.round >= 1 && p.round <= 4)
          .map((p) => p.round),
      )];
      const nonzeroRounds = [1, 2, 3, 4].filter((r) => net[`r${r}`] !== 0);
      rows.push({
        season: leagueYear,
        date,
        transactionId: String(trade.transaction_id),
        a: {
          team: sides[0].team,
          players: sides[0].players.map((p) => `${p.name} (${p.pos} ${round1(p.adj)})`),
          picks: sides[0].picks.map((p) => p.label),
          adj: adjA,
          playerObjs: sides[0].players.map((p) => ({
            name: p.name, pos: p.pos, adj: round1(p.adj),
          })),
          pickObjs: sides[0].picks.filter((p) => !p.startup).map((p) => ({
            label: p.label, round: p.round, season: p.season,
            currentYear: p.currentYear, tier: p.tier, slot: p.slot,
          })),
        },
        b: {
          team: sides[1].team,
          players: sides[1].players.map((p) => `${p.name} (${p.pos} ${round1(p.adj)})`),
          picks: sides[1].picks.map((p) => p.label),
          adj: adjB,
          playerObjs: sides[1].players.map((p) => ({
            name: p.name, pos: p.pos, adj: round1(p.adj),
          })),
          pickObjs: sides[1].picks.filter((p) => !p.startup).map((p) => ({
            label: p.label, round: p.round, season: p.season,
            currentYear: p.currentYear, tier: p.tier, slot: p.slot,
          })),
        },
        y,
        x: net,
        vaApplied: va.appliesAdjustment,
        usedLiveFallback: usedLive,
        nPlayers: sides[0].players.length + sides[1].players.length,
        nPicks: nPicksA + nPicksB,
        nonzeroRounds,
        roundsPresent,
        singleRound: roundsPresent.length === 1 && nonzeroRounds.length === 1,
        pickOnlyVsPlayers:
          (nPicksA > 0 && sides[0].players.length === 0 && nPicksB === 0 && sides[1].players.length > 0)
          || (nPicksB > 0 && sides[1].players.length === 0 && nPicksA === 0 && sides[0].players.length > 0),
        hasStartup,
      });
      bump('modeled');
    }
  }

  const modeled = rows.filter((r) => !r.hasStartup);
  const ROUND_KEYS = ['r1', 'r2', 'r3', 'r4'];
  const SPLIT_KEYS = [
    'r1_early', 'r1_mid', 'r1_late', 'r1_future',
    'r2_curr', 'r2_future', 'r3_curr', 'r3_future', 'r4_curr', 'r4_future',
  ];
  const histOnly = modeled.filter((r) => !r.usedLiveFallback);
  const olsHist = ols(histOnly, ROUND_KEYS);
  const isoHist = isotonicRounds(olsHist.beta || {});

  function usedKeys(sample, keys) {
    return keys.filter((k) => sample.some((r) => r.x[k] !== 0));
  }

  const olsRounds = ols(modeled, ROUND_KEYS);
  const olsRoundsCi = bootstrapOls(modeled, ROUND_KEYS);
  const iso = isotonicRounds(olsRounds.beta);
  const splitKeys = usedKeys(modeled, SPLIT_KEYS);
  const olsSplit = ols(modeled, splitKeys);
  const olsSplitCi = bootstrapOls(modeled, splitKeys);

  const cleanByRound = { 1: [], 2: [], 3: [], 4: [] };
  const pickOnlyByRound = { 1: [], 2: [], 3: [], 4: [] };
  const currFirstByTier = { Early: [], Mid: [], Late: [] };
  for (const r of modeled) {
    if (r.singleRound) {
      const rnd = r.nonzeroRounds[0];
      const net = r.x[`r${rnd}`];
      if (net !== 0) {
        const implied = r.y / net;
        cleanByRound[rnd].push(implied);
        if (r.pickOnlyVsPlayers) pickOnlyByRound[rnd].push(implied);
      }
    }
    const netEarly = r.x.r1_early;
    const netMid = r.x.r1_mid;
    const netLate = r.x.r1_late;
    const other1st = r.x.r1_future;
    const otherRounds = r.x.r2 + r.x.r3 + r.x.r4;
    if (otherRounds === 0 && other1st === 0) {
      if (netEarly !== 0 && netMid === 0 && netLate === 0) {
        currFirstByTier.Early.push(r.y / netEarly);
      }
      if (netMid !== 0 && netEarly === 0 && netLate === 0) {
        currFirstByTier.Mid.push(r.y / netMid);
      }
      if (netLate !== 0 && netEarly === 0 && netMid === 0) {
        currFirstByTier.Late.push(r.y / netLate);
      }
    }
  }

  function summarize(arr) {
    if (!arr.length) return { n: 0 };
    return {
      n: arr.length,
      mean: mean(arr),
      median: median(arr),
      min: Math.min(...arr),
      max: Math.max(...arr),
    };
  }

  const senderEvents = [];
  for (const t of modeled) {
    const make = (sender, receiver, picksSent, picksRecv, playersIn, playersOut, adjIn, adjOut) => {
      if (!picksSent.length) return;
      const implied = adjIn - adjOut;
      const roundsSent = [...new Set(picksSent.map((p) => p.round))].sort((a, b) => a - b);
      senderEvents.push({
        date: t.date,
        transactionId: t.transactionId,
        sender: sender.team,
        receiver: receiver.team,
        picksSent: picksSent.map((p) => p.label),
        picksSentObjs: picksSent,
        picksReceived: picksRecv.map((p) => p.label),
        playersIn: playersIn.map((p) => `${p.name} (${p.pos} ${p.adj})`),
        playersOut: playersOut.map((p) => `${p.name} (${p.pos} ${p.adj})`),
        playersInNames: playersIn.map((p) => p.name),
        playersOutNames: playersOut.map((p) => p.name),
        playerInObjs: playersIn,
        playerOutObjs: playersOut,
        adjIn,
        adjOut,
        implied,
        oneWay: picksRecv.length === 0,
        singleRound: picksRecv.length === 0 && roundsSent.length === 1,
        round: roundsSent.length === 1 ? roundsSent[0] : null,
        nPicksSent: picksSent.length,
        usedLiveFallback: t.usedLiveFallback,
      });
    };
    make(t.a, t.b, t.b.pickObjs || [], t.a.pickObjs || [], t.a.playerObjs || [], t.b.playerObjs || [], t.a.adj, t.b.adj);
    make(t.b, t.a, t.a.pickObjs || [], t.b.pickObjs || [], t.b.playerObjs || [], t.a.playerObjs || [], t.b.adj, t.a.adj);
  }
  senderEvents.sort((a, b) => {
    if ((a.round || 99) !== (b.round || 99)) return (a.round || 99) - (b.round || 99);
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.implied - b.implied;
  });
  const oneWaySingle = senderEvents.filter((e) => e.singleRound);
  const senderByRound = { 1: [], 2: [], 3: [], 4: [] };
  for (const e of oneWaySingle) {
    senderByRound[e.round].push(e.implied / e.nPicksSent);
  }
  const oneWayEvents = senderEvents.filter((e) => e.oneWay);
  const senderByManager = {};
  for (const e of oneWayEvents) {
    if (!senderByManager[e.sender]) {
      senderByManager[e.sender] = { sender: e.sender, n: 0, byRound: { 1: [], 2: [], 3: [], 4: [] }, mixed: 0 };
    }
    const row = senderByManager[e.sender];
    row.n += 1;
    if (e.round) row.byRound[e.round].push(Math.round(e.implied / e.nPicksSent));
    else row.mixed += 1;
  }
  const senderByManagerRows = Object.values(senderByManager)
    .map((row) => ({
      ...row,
      r1: summarize(row.byRound[1]),
      r2: summarize(row.byRound[2]),
      r3: summarize(row.byRound[3]),
      r4: summarize(row.byRound[4]),
    }))
    .sort((a, b) => b.n - a.n);

  const coverage = {};
  for (const key of [...ROUND_KEYS, ...SPLIT_KEYS]) {
    coverage[key] = modeled.reduce((s, r) => s + Math.abs(r.x[key]), 0);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    posMult: POS_MULT,
    funnel,
    nModeled: modeled.length,
    nHistOnly: histOnly.length,
    nLiveFallback: modeled.filter((r) => r.usedLiveFallback).length,
    nStartupExcluded: rows.length - modeled.length,
    coverage,
    methods: {
      olsRounds: {
        ...olsRounds,
        beta: Object.fromEntries(ROUND_KEYS.map((k) => [k, olsRounds.beta[k] ?? null])),
        se: olsRounds.se,
        ci: olsRoundsCi,
      },
      isotonicRounds: iso,
      olsHistOnly: {
        n: histOnly.length,
        beta: olsHist.beta,
        r2: olsHist.r2,
        isotonic: isoHist,
      },
      olsSplit: {
        ...olsSplit,
        ci: olsSplitCi,
      },
      cleanSingleRound: {
        r1: summarize(cleanByRound[1]),
        r2: summarize(cleanByRound[2]),
        r3: summarize(cleanByRound[3]),
        r4: summarize(cleanByRound[4]),
      },
      pickOnlyVsPlayers: {
        r1: summarize(pickOnlyByRound[1]),
        r2: summarize(pickOnlyByRound[2]),
        r3: summarize(pickOnlyByRound[3]),
        r4: summarize(pickOnlyByRound[4]),
      },
      currentYearFirstByTier: {
        Early: summarize(currFirstByTier.Early),
        Mid: summarize(currFirstByTier.Mid),
        Late: summarize(currFirstByTier.Late),
      },
      senderOneWaySingleRound: {
        r1: summarize(senderByRound[1]),
        r2: summarize(senderByRound[2]),
        r3: summarize(senderByRound[3]),
        r4: summarize(senderByRound[4]),
      },
    },
    senderEvents,
    senderByManager: senderByManagerRows,
    trades: modeled.sort((a, b) => (a.date < b.date ? -1 : 1)),
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2));

  const fmt = (n) => (n == null || !Number.isFinite(n) ? '—' : String(Math.round(n)));
  console.log('FUNNEL', funnel);
  console.log('modeled', modeled.length, 'hist-only', histOnly.length, 'live-fallback', modeled.length - histOnly.length);
  console.log('coverage', coverage);
  console.log('\nOLS rounds', olsRounds.beta, 'r2', olsRounds.r2, 'rmse', olsRounds.rmse);
  console.log('isotonic', iso);
  console.log('OLS split', olsSplit.beta);
  console.log('\nClean single-round medians');
  for (const r of [1, 2, 3, 4]) {
    const s = payload.methods.cleanSingleRound[`r${r}`];
    console.log(`  R${r} n=${s.n} median=${fmt(s.median)} mean=${fmt(s.mean)}`);
  }
  console.log('\nPick-only vs players');
  for (const r of [1, 2, 3, 4]) {
    const s = payload.methods.pickOnlyVsPlayers[`r${r}`];
    console.log(`  R${r} n=${s.n} median=${fmt(s.median)}`);
  }
  console.log('\nCurrent-year 1sts by tier (clean)');
  for (const t of ['Early', 'Mid', 'Late']) {
    const s = payload.methods.currentYearFirstByTier[t];
    console.log(`  ${t} n=${s.n} median=${fmt(s.median)} mean=${fmt(s.mean)}`);
  }
  console.log('\nSender one-way single-round (implied per pick)');
  for (const r of [1, 2, 3, 4]) {
    const s = payload.methods.senderOneWaySingleRound[`r${r}`];
    console.log(`  R${r} n=${s.n} median=${fmt(s.median)} mean=${fmt(s.mean)}`);
  }
  console.log('\n=== SENDER EVENTS (one-way) ===');
  for (const e of senderEvents.filter((x) => x.oneWay)) {
    console.log(
      `${e.date} R${e.round || '?'} ${e.sender} sends [${e.picksSent.join(', ')}]  gets [${e.playersIn.join(', ') || '—'}]  gives [${e.playersOut.join(', ') || '—'}]  implied ${fmt(e.implied)}`,
    );
  }
  console.log('wrote', OUT_JSON);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
