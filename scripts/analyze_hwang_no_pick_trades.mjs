#!/usr/bin/env node
/**
 * Hwang player-only trades (no picks) scored with the site trade calculator:
 * historical SF TE+ KTC on the trade date + KTC-style Value Adjustment.
 *
 * Revealed preference: Hwang treated the two sides as equal.
 * If KTC+VA still says one side won, that side's positions are overvalued
 * on KTC relative to this league (and the other side undervalued).
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { evaluateKtcStyleTrade } from '../site/src/tradeCalculator/ktcValueAdjustment.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'site/public/data');
const OUT_JSON = join(ROOT, 'example_data/hwang_no_pick_ktc.json');
const SLEEPER = 'https://api.sleeper.app/v1';
const CURRENT_LEAGUE_ID = '1326575946462920704';
const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);
const MAX_SLACK_DAYS = 3;

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

function nyTime(ms) {
  const d = new Date(ms);
  const date = nyDate(ms);
  const time = d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${date} ${time} ET`;
}

function daysBetween(a, b) {
  const ms = Date.parse(a) - Date.parse(b);
  return Math.round(ms / 86400000);
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

function loadPlayers() {
  return JSON.parse(readFileSync(join(DATA, 'players.txt'), 'utf8'));
}

function loadKtcHistory() {
  const text = readFileSync(join(DATA, 'sf_ktc_values_historical.csv'), 'utf8');
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(',');
  const iDate = header.indexOf('date');
  const iVal = header.indexOf('ktc_value');
  const iSid = header.indexOf('sleeper_id');
  const byId = new Map();
  const dates = new Set();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(',');
    const d = (cols[iDate] || '').trim();
    const sid = (cols[iSid] || '').trim();
    if (!d || !sid) continue;
    const v = Number(cols[iVal]);
    if (!Number.isFinite(v)) continue;
    dates.add(d);
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
  return { byId, min: [...dates].sort()[0], max: [...dates].sort().at(-1) };
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
    const gap = daysBetween(tradeDate, d);
    if (gap <= MAX_SLACK_DAYS) return { value: v, asOf: d, slack: gap };
  }
  if (i + 1 < series.length) {
    const [d, v] = series[i + 1];
    const gap = daysBetween(d, tradeDate);
    if (gap <= MAX_SLACK_DAYS) return { value: v, asOf: d, slack: gap };
  }
  return null;
}

function shapeLabel(nA, nB) {
  const [x, y] = nA <= nB ? [nA, nB] : [nB, nA];
  return `${x}-for-${y}`;
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

function classify(trade) {
  const picks = trade.draft_picks || [];
  const faab = (trade.waiver_budget || []).filter((w) => w && w.amount);
  const adds = trade.adds || {};
  const rosters = [...new Set((trade.roster_ids || []).map(Number))];
  if (rosters.length !== 2) return 'not_two_team';
  if (picks.length) return 'has_picks';
  const received = new Map();
  for (const rid of rosters) received.set(rid, []);
  for (const [pid, rid] of Object.entries(adds)) {
    const k = Number(rid);
    if (!received.has(k)) received.set(k, []);
    received.get(k).push(String(pid));
  }
  const counts = rosters.map((r) => received.get(r).length);
  if (counts.some((c) => c === 0)) return faab.length ? 'faab_or_empty_side' : 'empty_side';
  return faab.length ? 'players_plus_faab' : 'players_only';
}

async function main() {
  const players = loadPlayers();
  const ktc = loadKtcHistory();
  const leagues = await walkLeagues(CURRENT_LEAGUE_ID);
  const funnel = {};
  const bump = (k) => { funnel[k] = (funnel[k] || 0) + 1; };
  const tradesOut = [];

  for (const league of leagues) {
    const names = await teamMap(league.league_id);
    const txns = await getJson(`${SLEEPER}/league/${league.league_id}/transactions/1`);
    const trades = (Array.isArray(txns) ? txns : []).filter(
      (t) => t?.type === 'trade' && t?.status === 'complete',
    );
    for (const trade of trades) {
      bump('completed');
      const kind = classify(trade);
      bump(kind);
      if (kind !== 'players_only' && kind !== 'players_plus_faab') continue;

      const rosters = [...new Set(trade.roster_ids.map(Number))].sort((a, b) => a - b);
      const faab = (trade.waiver_budget || []).filter((w) => w && w.amount);
      const sides = rosters.map((rid) => ({
        rosterId: rid,
        team: names[rid] || `Roster ${rid}`,
        players: [],
      }));
      const sideByRid = Object.fromEntries(sides.map((s) => [s.rosterId, s]));
      for (const [pid, rid] of Object.entries(trade.adds || {})) {
        const side = sideByRid[Number(rid)];
        if (!side) continue;
        const meta = playerMeta(players, pid);
        const hit = lookupKtc(ktc.byId.get(meta.id), nyDate(trade.created));
        side.players.push({
          ...meta,
          ktc: hit?.value ?? null,
          ktcAsOf: hit?.asOf ?? null,
          ktcSlack: hit?.slack ?? null,
        });
      }

      const missing = sides.flatMap((s) => s.players.filter((p) => p.ktc == null));
      const a = sides[0];
      const b = sides[1];
      const valuesA = a.players.map((p) => p.ktc).filter((v) => v > 0);
      const valuesB = b.players.map((p) => p.ktc).filter((v) => v > 0);
      const va = evaluateKtcStyleTrade(valuesA, valuesB);
      const adjA = va.adjustedTotalA;
      const adjB = va.adjustedTotalB;
      const avg = (adjA + adjB) / 2;
      const pctA = avg > 0 ? (adjA - adjB) / avg : 0;
      const even = Math.abs(pctA) < 0.1;
      const winner = even ? null : (adjA > adjB ? 'A' : 'B');
      const positions = [...new Set(
        [...a.players, ...b.players].map((p) => p.pos).filter((p) => SKILL.has(p)),
      )];

      const posKtc = (side) => {
        const o = { QB: 0, RB: 0, WR: 0, TE: 0, other: 0 };
        for (const p of side.players) {
          if (!(p.ktc > 0)) continue;
          if (SKILL.has(p.pos)) o[p.pos] += p.ktc;
          else o.other += p.ktc;
        }
        return o;
      };

      tradesOut.push({
        season: String(league.season),
        date: nyDate(trade.created),
        timeEt: nyTime(trade.created),
        transactionId: String(trade.transaction_id),
        kind,
        faab,
        shape: shapeLabel(a.players.length, b.players.length),
        a,
        b,
        missing: missing.map((p) => p.name),
        priced: missing.length === 0,
        ordinaryA: va.ordinaryA,
        ordinaryB: va.ordinaryB,
        adjA,
        adjB,
        vaA: va.adjustmentForA,
        vaB: va.adjustmentForB,
        appliesAdjustment: va.appliesAdjustment,
        rawWinner: va.rawWinner,
        ordinaryGap: va.ordinaryA - va.ordinaryB,
        adjGap: adjA - adjB,
        adjPctA: pctA,
        evenAt10pct: even,
        ktcWinner: winner,
        positions,
        samePos: positions.length === 1,
        posA: posKtc(a),
        posB: posKtc(b),
      });
    }
  }

  tradesOut.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  const priced = tradesOut.filter((t) => t.priced);
  const clean = priced.filter((t) => {
    const faabAmt = (t.faab || []).reduce((s, w) => s + Number(w.amount || 0), 0);
    return faabAmt <= 1;
  });
  const mixed = clean.filter((t) => !t.samePos);

  function positionStats(sample) {
    const acc = {
      QB: { nPlayers: 0, ktc: 0, overKtc: 0, underKtc: 0, even: 0, ratioW: 0, ratioKtc: 0 },
      RB: { nPlayers: 0, ktc: 0, overKtc: 0, underKtc: 0, even: 0, ratioW: 0, ratioKtc: 0 },
      WR: { nPlayers: 0, ktc: 0, overKtc: 0, underKtc: 0, even: 0, ratioW: 0, ratioKtc: 0 },
      TE: { nPlayers: 0, ktc: 0, overKtc: 0, underKtc: 0, even: 0, ratioW: 0, ratioKtc: 0 },
    };
    for (const t of sample) {
      const ratioA = t.adjB > 0 ? t.adjA / t.adjB : 1;
      const ratioB = t.adjA > 0 ? t.adjB / t.adjA : 1;
      const visit = (side, ratio) => {
        for (const p of side.players) {
          if (!SKILL.has(p.pos) || !(p.ktc > 0)) continue;
          const row = acc[p.pos];
          row.nPlayers += 1;
          row.ktc += p.ktc;
          row.ratioW += ratio * p.ktc;
          row.ratioKtc += p.ktc;
          if (t.ktcWinner == null) row.even += p.ktc;
          else if (ratio > 1) row.overKtc += p.ktc;
          else row.underKtc += p.ktc;
        }
      };
      visit(t.a, ratioA);
      visit(t.b, ratioB);
    }
    const out = {};
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      const r = acc[pos];
      out[pos] = {
        nPlayers: r.nPlayers,
        ktc: Math.round(r.ktc),
        meanRatio: r.ratioKtc ? r.ratioW / r.ratioKtc : null,
        overKtcShare: r.ktc ? r.overKtc / r.ktc : null,
        underKtcShare: r.ktc ? r.underKtc / r.ktc : null,
        evenShare: r.ktc ? r.even / r.ktc : null,
      };
    }
    return out;
  }

  // Net-long position vs KTC+VA residual (trade-level).
  function netLong(sample) {
    const byPos = { QB: [], RB: [], WR: [], TE: [] };
    for (const t of sample) {
      for (const pos of ['QB', 'RB', 'WR', 'TE']) {
        const d = t.posA[pos] - t.posB[pos];
        if (Math.abs(d) < 1) continue;
        // If A is net long this pos, residual for the long side is adjPctA when d>0.
        const residualForLong = d > 0 ? t.adjPctA : -t.adjPctA;
        byPos[pos].push(residualForLong);
      }
    }
    const out = {};
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      const xs = byPos[pos];
      out[pos] = {
        n: xs.length,
        meanResidualWhenLong: mean(xs),
        medianResidualWhenLong: median(xs),
        shareLongSideWonKtc: xs.length
          ? xs.filter((x) => x > 0.03).length / xs.length
          : null,
      };
    }
    return out;
  }

  const shapeCounts = {};
  for (const t of clean) shapeCounts[t.shape] = (shapeCounts[t.shape] || 0) + 1;
  const vaCount = clean.filter((t) => t.appliesAdjustment).length;
  const absOrd = clean.map((t) => Math.abs(t.ordinaryA - t.ordinaryB));
  const absAdj = clean.map((t) => Math.abs(t.adjA - t.adjB));
  const absPct = clean.map((t) => Math.abs(t.adjPctA));

  const payload = {
    generatedAt: new Date().toISOString(),
    ktcBoard: 'sf_ktc_values_historical.csv (SF TE+) + evaluateKtcStyleTrade VA',
    ktcDateRange: { min: ktc.min, max: ktc.max },
    funnel,
    nNoPickTwoTeam: tradesOut.length,
    nPriced: priced.length,
    nCleanNoFaab: clean.length,
    nMixedPos: mixed.length,
    nWithVa: vaCount,
    shapeCounts,
    nEvenAt10pct: clean.filter((t) => t.evenAt10pct).length,
    absOrdinaryMean: mean(absOrd),
    absOrdinaryMedian: median(absOrd),
    absAdjMean: mean(absAdj),
    absAdjMedian: median(absAdj),
    absAdjPctMedian: median(absPct),
    positionStatsAllPriced: positionStats(priced),
    positionStatsClean: positionStats(clean),
    positionStatsMixed: positionStats(mixed),
    netLongClean: netLong(clean),
    netLongMixed: netLong(mixed),
    trades: tradesOut,
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2));

  const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
  const pct = (n) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);

  console.log('FUNNEL', funnel);
  console.log(`no-pick two-team: ${tradesOut.length}  priced: ${priced.length}  no-FAAB: ${clean.length}  VA applied: ${vaCount}`);
  console.log('shapes', shapeCounts);
  console.log('median |ordinary gap|', fmt(median(absOrd)), 'median |adj gap|', fmt(median(absAdj)));
  console.log('\nPosition stats (mixed-position only):');
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const s = payload.positionStatsMixed[pos];
    console.log(
      `  ${pos} n=${s.nPlayers} meanRatio=${s.meanRatio?.toFixed(3)} overShare=${pct(s.overKtcShare)}`,
    );
  }
  console.log('\nNet-long residual (clean):');
  console.log(JSON.stringify(payload.netLongClean, null, 2));
  console.log('\n=== TRADES ===');
  for (const t of tradesOut) {
    const pa = t.a.players.map((p) => `${p.name} (${p.pos} ${p.ktc ?? '?'})`).join(', ');
    const pb = t.b.players.map((p) => `${p.name} (${p.pos} ${p.ktc ?? '?'})`).join(', ');
    const vaNote = t.appliesAdjustment ? ` VA ${fmt(t.vaA || t.vaB)}` : '';
    const win = t.ktcWinner == null ? 'even' : `KTC+VA favors ${t.ktcWinner === 'A' ? t.a.team : t.b.team}`;
    console.log(
      `${t.date} ${t.shape} | ${t.a.team} gets [${pa}]  ${fmt(t.adjA)}  ⇄  ${t.b.team} gets [${pb}]  ${fmt(t.adjB)} | ${win}${vaNote}${t.faab.length ? ' +FAAB' : ''}${t.missing.length ? ' MISSING ' + t.missing.join(',') : ''}`,
    );
  }
  console.log('wrote', OUT_JSON);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
