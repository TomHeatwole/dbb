#!/usr/bin/env node
/**
 * Round-robin FanDuel NCAAF Drive Result markets on the Android emulator.
 *
 * Walks the NCAA Football slate, expands Drive Result (Quick Bets / Drive SGP),
 * logs American odds, and upserts them into Neon fd_drive_odds so /drives
 * can serve live FanDuel lines. Ended games are deleted from the table.
 * When exactly one game is live it stays on that event page and polls odds
 * as fast as Appium allows. --single-game <eventId> forces that pin.
 * --backfill restores the full-slate walk.
 *
 * Usage:
 *   scripts/watch-fanduel-drive-results.sh
 *   node scripts/watch_fanduel_drive_results.mjs
 *   node scripts/watch_fanduel_drive_results.mjs --once --max-games 4
 *   node scripts/watch_fanduel_drive_results.mjs --no-db
 *   node scripts/watch_fanduel_drive_results.mjs --backfill
 *   node scripts/watch_fanduel_drive_results.mjs --single-game 35660086
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  APPIUM,
  DRIVE_OUTCOMES,
  appiumUp,
  collectSlate,
  createSession,
  deleteSession,
  dismissEventOverlays,
  namesOnPage,
  openGame,
  pageLooksFinal,
  pageLooksLikeGame,
  slateMarksGameFinal,
  parseDriveMarkets,
  scrapeDriveResults,
  source,
  sleep,
} from './lib/fanduelAppium.mjs';
import {
  deleteFdDriveOdds,
  inferOffenseSide,
  listFdDriveGameKeys,
  realFdAmerican,
  upsertFdDriveOdds,
} from '../site/lib/fd-drive-odds.mjs';
import {
  fdLiveToDbRow,
  formatFdLiveSpot,
  parseFdLiveSituation,
  situationKey,
} from '../site/src/drives/fdLiveSituation.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LOG = path.join(ROOT, 'example_data', 'ncaaf_drive_results', 'fanduel_drive_results.jsonl');
const DEFAULT_STATE = path.join(ROOT, 'example_data', 'ncaaf_drive_results', 'fanduel_drive_results_state.json');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const FAR_KICKOFF_MS = 3 * DAY_MS;
const FAR_RETRY_MS = DAY_MS;
const LIVE_MISS_BASE_MS = 2 * 60 * 1000;
const LIVE_MISS_CAP_MS = 6 * HOUR_MS;
const GAME_ENDED_AFTER_MS = 8 * HOUR_MS;
const MISSING_SLATE_GRACE_MS = 45 * 60 * 1000;
const PRE_KICKOFF_WAKE_MS = HOUR_MS;
const LIVE_SLATE_LEAD_MS = 2 * 60 * 1000;
const PIN_HEARTBEAT_MS = 20 * 1000;
const IDLE_WITH_UPCOMING_MS = HOUR_MS;
const IDLE_NO_UPCOMING_MS = DAY_MS;

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

const TZ_OFFSET = {
  eastern: '-04:00',
  et: '-04:00',
  central: '-05:00',
  ct: '-05:00',
  mountain: '-06:00',
  mt: '-06:00',
  pacific: '-07:00',
  pt: '-07:00',
};

function loadSiteEnv() {
  const envPath = path.join(ROOT, 'site', '.env.local');
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
      if (!match) continue;
      const key = match[1].trim();
      const val = match[2].trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // optional; --no-db still works
  }
}

function parseArgs(argv) {
  const args = {
    udid: process.env.ANDROID_SERIAL || 'emulator-5554',
    log: DEFAULT_LOG,
    state: DEFAULT_STATE,
    once: false,
    noDb: false,
    backfill: false,
    singleGame: null,
    maxGames: Infinity,
    pauseMs: 800,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--udid') args.udid = argv[++i];
    else if (argv[i] === '--log') args.log = path.resolve(argv[++i]);
    else if (argv[i] === '--state') args.state = path.resolve(argv[++i]);
    else if (argv[i] === '--once') args.once = true;
    else if (argv[i] === '--no-db') args.noDb = true;
    else if (argv[i] === '--backfill') args.backfill = true;
    else if (argv[i] === '--single-game') args.singleGame = String(argv[++i] || '').trim();
    else if (argv[i].startsWith('--single-game=')) args.singleGame = argv[i].slice('--single-game='.length).trim();
    else if (argv[i] === '--max-games') args.maxGames = Number(argv[++i]);
    else if (argv[i] === '--pause-ms') args.pauseMs = Number(argv[++i]);
  }
  return args;
}

function ts() {
  return new Date().toISOString();
}

function clock() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function logLine(msg) {
  process.stdout.write(`${clock()}  ${msg}\n`);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function parseKickoff(game, now = new Date()) {
  const year = now.getFullYear();
  let month = null;
  let day = null;
  const short = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\.\s+(\d{1,2})\/(\d{1,2})/i.exec(game.date || '');
  const long = /([A-Za-z]+)\s+(\d{1,2})/.exec(game.date || '');
  if (short) {
    month = Number(short[1]);
    day = Number(short[2]);
  } else if (long && MONTHS[long[1].toLowerCase()]) {
    month = MONTHS[long[1].toLowerCase()];
    day = Number(long[2]);
  }
  const tm = /(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s*(Eastern|Central|Mountain|Pacific|ET|CT|MT|PT))?/i.exec(game.start || '');
  if (!month || !day || !tm) return null;
  let hour = Number(tm[1]) % 12;
  if (/pm/i.test(tm[3])) hour += 12;
  const zone = (tm[4] || 'central').toLowerCase();
  const offset = TZ_OFFSET[zone] || TZ_OFFSET.central;
  const iso = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(Number(tm[2]))}:00${offset}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function gameIsLive(game, kickoffAt, now = Date.now()) {
  if (game?.final || game?.skipLive) return false;
  if (game?.live) return true;
  if (!kickoffAt) return false;
  const age = now - kickoffAt.getTime();
  return age >= 30_000 && age < GAME_ENDED_AFTER_MS;
}

function gameHasEnded(game, kickoffAt, onSlate, now = Date.now()) {
  if (game?.final) return true;
  if (kickoffAt && now - kickoffAt.getTime() > GAME_ENDED_AFTER_MS) return true;
  if (!onSlate && kickoffAt && now - kickoffAt.getTime() > MISSING_SLATE_GRACE_MS) return true;
  return false;
}

function formatDelay(ms) {
  if (ms >= DAY_MS) return `${Math.round(ms / DAY_MS)}d`;
  if (ms >= HOUR_MS) return `${Math.round(ms / HOUR_MS)}h`;
  if (ms >= 60 * 1000) return `${Math.round(ms / (60 * 1000))}m`;
  return `${Math.round(ms / 1000)}s`;
}

function kickoffOf(game, state) {
  const sched = game.eventId && state.schedule?.[game.eventId];
  if (sched?.kickoffAt) {
    const d = new Date(sched.kickoffAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return parseKickoff(game);
}

function nextUpcomingKickoff(slate, state, now = Date.now()) {
  let soonest = null;
  const take = (kick) => {
    if (!kick || Number.isNaN(kick.getTime()) || kick.getTime() <= now) return;
    if (!soonest || kick < soonest) soonest = kick;
  };
  for (const game of slate || []) {
    if (game.final || game.live) continue;
    take(kickoffOf(game, state));
  }
  const onSlate = new Map((slate || []).filter((g) => g.eventId).map((g) => [g.eventId, g]));
  for (const [eventId, sched] of Object.entries(state.schedule || {})) {
    const row = onSlate.get(eventId);
    if (row?.live || row?.final) continue;
    if (!sched?.kickoffAt) continue;
    take(new Date(sched.kickoffAt));
  }
  return soonest;
}

function slateHasLive(slate, state, now = Date.now()) {
  return (slate || []).some((game) => {
    if (game.final) return false;
    return gameIsLive(game, kickoffOf(game, state), now);
  });
}

function liveGamesOf(slate, state, now = Date.now()) {
  return (slate || []).filter((game) => (
    game.eventId && !game.final && gameIsLive(game, kickoffOf(game, state), now)
  ));
}

function slateRefreshAt(slate, state, now = Date.now()) {
  const next = nextUpcomingKickoff(slate, state, now);
  if (!next) return now + DAY_MS;
  return Math.max(now + 15_000, next.getTime() - LIVE_SLATE_LEAD_MS);
}

function idlePlan(slate, state, now = Date.now()) {
  if (slateHasLive(slate, state, now)) {
    return { ms: 0, reason: 'live games' };
  }
  const next = nextUpcomingKickoff(slate, state, now);
  const unknownUpcoming = (slate || []).some((game) => (
    !game.final && !gameIsLive(game, kickoffOf(game, state), now) && !kickoffOf(game, state)
  ));
  const upcoming = Boolean(next) || unknownUpcoming;
  let ms = upcoming ? IDLE_WITH_UPCOMING_MS : IDLE_NO_UPCOMING_MS;
  let reason = upcoming ? 'no live games; hourly check' : 'no upcoming games; daily check';
  if (next) {
    const wakeBy = next.getTime() - PRE_KICKOFF_WAKE_MS;
    const untilWake = Math.max(0, wakeBy - now);
    if (untilWake < ms) {
      ms = untilWake;
      reason = untilWake === 0
        ? `kickoff within an hour (${next.toLocaleString()})`
        : `wake 1h before ${next.toLocaleString()}`;
    }
  }
  return { ms, reason, nextKickoff: next };
}

function scheduleFor(state, eventId) {
  if (!state.schedule) state.schedule = {};
  if (!state.schedule[eventId]) {
    state.schedule[eventId] = {
      nextTryAt: 0,
      missStreak: 0,
      lastTriedAt: null,
      lastHadMarket: false,
      kickoffAt: null,
    };
  }
  return state.schedule[eventId];
}

function shouldVisit(game, sched, now = Date.now(), opts = {}) {
  if (game.final) return { visit: false, reason: 'final' };
  const live = gameIsLive(game, sched.kickoffAt ? new Date(sched.kickoffAt) : parseKickoff(game), now);
  if (opts.liveOnly && !live) return { visit: false, reason: 'not live' };
  if (opts.hammer && live) return { visit: true, reason: null };
  if (sched.nextTryAt && now < sched.nextTryAt) {
    return { visit: false, reason: `hold ${formatDelay(sched.nextTryAt - now)}` };
  }
  return { visit: true, reason: null };
}

function markTried(game, sched, hadMarket, now = Date.now(), opts = {}) {
  const kickoffAt = sched.kickoffAt ? new Date(sched.kickoffAt) : parseKickoff(game);
  const live = gameIsLive(game, kickoffAt, now);
  sched.lastTriedAt = new Date(now).toISOString();
  sched.lastHadMarket = hadMarket;
  if (kickoffAt) sched.kickoffAt = kickoffAt.toISOString();
  if (opts.hammer && live) {
    sched.missStreak = hadMarket ? 0 : (sched.missStreak || 0) + 1;
    sched.nextTryAt = 0;
    return;
  }
  if (hadMarket) {
    sched.missStreak = 0;
    if (kickoffAt && kickoffAt.getTime() - now > FAR_KICKOFF_MS) {
      sched.nextTryAt = now + FAR_RETRY_MS;
    } else {
      sched.nextTryAt = 0;
    }
    return;
  }
  if (live) {
    sched.missStreak = (sched.missStreak || 0) + 1;
    const delay = Math.min(
      LIVE_MISS_CAP_MS,
      LIVE_MISS_BASE_MS * (2 ** Math.max(0, sched.missStreak - 1)),
    );
    sched.nextTryAt = now + delay;
    return;
  }
  if (kickoffAt && kickoffAt.getTime() - now > FAR_KICKOFF_MS) {
    sched.missStreak = 0;
    sched.nextTryAt = now + FAR_RETRY_MS;
    return;
  }
  sched.missStreak = 0;
  sched.nextTryAt = 0;
}

function loadState(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      markets: raw?.markets && typeof raw.markets === 'object' ? raw.markets : {},
      schedule: raw?.schedule && typeof raw.schedule === 'object' ? raw.schedule : {},
    };
  } catch {
    return { markets: {}, schedule: {} };
  }
}

function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

function appendJsonl(file, rec) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(rec)}\n`);
}

function marketKey(eventId, market) {
  return `${eventId}|${market.marketName}`;
}

function liveOutcomes(outcomes = {}) {
  const out = {};
  for (const row of DRIVE_OUTCOMES) {
    const n = realFdAmerican(outcomes[row.key]);
    if (n != null) out[row.key] = n;
  }
  return out;
}

function outcomesEqual(a = {}, b = {}) {
  const left = liveOutcomes(a);
  const right = liveOutcomes(b);
  return DRIVE_OUTCOMES.every((row) => left[row.key] === right[row.key]);
}

function formatOutcomes(outcomes = {}) {
  return DRIVE_OUTCOMES.map((row) => {
    const v = outcomes[row.key];
    if (v == null) return `${row.label} —`;
    const signed = v > 0 ? `+${v}` : String(v);
    return `${row.label} ${signed}`;
  }).join('  ');
}

function formatDiff(prev, next) {
  const bits = [];
  for (const row of DRIVE_OUTCOMES) {
    if (prev?.[row.key] === next?.[row.key]) continue;
    const a = prev?.[row.key] == null ? '—' : (prev[row.key] > 0 ? `+${prev[row.key]}` : String(prev[row.key]));
    const b = next?.[row.key] == null ? '—' : (next[row.key] > 0 ? `+${next[row.key]}` : String(next[row.key]));
    bits.push(`${row.label} ${a} → ${b}`);
  }
  return bits.join('  ');
}

function matchup(game) {
  return `${game.away} @ ${game.home}`;
}

async function ensureAppium() {
  if (await appiumUp()) return;
  logLine(`starting Appium at ${APPIUM}…`);
  const child = spawn(path.join(ROOT, 'scripts', 'start-appium.sh'), [], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  for (let i = 0; i < 50; i += 1) {
    await sleep(400);
    if (await appiumUp()) return;
  }
  throw new Error(`Appium is not reachable at ${APPIUM}. See /tmp/appium-watch.log`);
}

async function connect(udid) {
  await ensureAppium();
  logLine(`connecting ${APPIUM}  udid=${udid}`);
  const sessionId = await createSession(udid);
  logLine(`session ${sessionId}`);
  await sleep(1500);
  return sessionId;
}

async function writeMarketsToDb(game, markets, kickoffAt, situation = null) {
  let wrote = 0;
  const sit = fdLiveToDbRow(situation, { home: game.home, away: game.away });
  for (const market of markets) {
    const side = inferOffenseSide(market.offense, game.home, game.away);
    if (!side) {
      logLine(`db?   ${matchup(game)}  ${market.marketName}  no offense_side`);
      continue;
    }
    await upsertFdDriveOdds({
      event_id: game.eventId ? String(game.eventId) : null,
      home_team: game.home,
      away_team: game.away,
      kickoff_at: kickoffAt ? kickoffAt.toISOString() : null,
      offense_side: side,
      offense_name: market.offense,
      drive_n: market.drive || 1,
      market_name: market.marketName,
      market_status: 'OPEN',
      td_american: realFdAmerican(market.outcomes.td),
      fg_american: realFdAmerican(market.outcomes.fg),
      punt_american: realFdAmerican(market.outcomes.punt),
      other_american: realFdAmerican(market.outcomes.other),
      ...sit,
    });
    wrote += 1;
  }
  return wrote;
}

async function forgetGame(args, state, game, reason) {
  logLine(`DEL   ${matchup(game)}  ${reason}`);
  if (!args.noDb) {
    try {
      const gone = await deleteFdDriveOdds({
        eventId: game.eventId,
        homeTeam: game.home,
        awayTeam: game.away,
      });
      if (gone?.length) logLine(`db-   removed ${gone.length} row${gone.length === 1 ? '' : 's'}`);
    } catch (err) {
      logLine(`db!   delete failed  ${err.message}`);
    }
  }
  if (game.eventId) {
    delete state.schedule[game.eventId];
    for (const key of Object.keys(state.markets)) {
      if (key.startsWith(`${game.eventId}|`)) delete state.markets[key];
    }
  }
  appendJsonl(args.log, {
    type: 'delete',
    ts: ts(),
    eventId: game.eventId,
    away: game.away,
    home: game.home,
    reason,
  });
}

async function purgeEnded(args, state, slate) {
  const onSlate = new Set(slate.map((g) => g.eventId).filter(Boolean));
  const now = Date.now();
  const known = new Map();
  for (const game of slate) {
    if (game.eventId) known.set(game.eventId, game);
  }
  if (!args.noDb) {
    try {
      const rows = await listFdDriveGameKeys();
      for (const row of rows) {
        const eventId = row.event_id ? String(row.event_id) : null;
        const game = (eventId && known.get(eventId)) || {
          eventId,
          home: row.home_team,
          away: row.away_team,
        };
        const kickoffAt = row.kickoff_at ? new Date(row.kickoff_at) : parseKickoff(game);
        if (gameHasEnded(game, kickoffAt, eventId ? onSlate.has(eventId) : false, now)) {
          await forgetGame(args, state, game, 'game ended');
        }
      }
    } catch (err) {
      logLine(`db!   purge failed  ${err.message}`);
    }
  }
  for (const game of slate.filter((g) => g.final && g.eventId)) {
    await forgetGame(args, state, game, 'slate marked final');
  }
}

function applyMarkets(args, state, game, markets) {
  let news = 0;
  let changes = 0;
  for (const market of markets) {
    const key = marketKey(game.eventId, market);
    const prev = state.markets[key];
    const outcomes = liveOutcomes(market.outcomes);
    if (!Object.keys(outcomes).length) continue;
    const rec = {
      ts: ts(),
      eventId: game.eventId,
      away: game.away,
      home: game.home,
      start: game.start,
      date: game.date,
      marketName: market.marketName,
      offense: market.offense,
      drive: market.drive,
      outcomes,
    };
    if (!prev) {
      news += 1;
      logLine(`NEW   ${matchup(game).padEnd(36)}  ${market.marketName.padEnd(32)}  ${formatOutcomes(market.outcomes)}`);
      appendJsonl(args.log, { type: 'new', ...rec });
    } else if (!outcomesEqual(prev.outcomes, market.outcomes)) {
      changes += 1;
      logLine(`CHG   ${matchup(game).padEnd(36)}  ${market.marketName.padEnd(32)}  ${formatDiff(prev.outcomes, market.outcomes)}`);
      appendJsonl(args.log, { type: 'change', prev: prev.outcomes, ...rec });
    }
    state.markets[key] = {
      ...rec,
      seenAt: ts(),
    };
  }
  return { news, changes };
}

async function pinGame(sessionId, args, state, game, opts = {}) {
  logLine(`pin   ${matchup(game)}  event ${game.eventId}  fast refresh`);
  let ok = await openGame(sessionId, game.eventId, game);
  if (!ok) {
    const lost = await source(sessionId).catch(() => '');
    if (pageLooksFinal(lost) || slateMarksGameFinal(lost, game)) {
      logLine(`over  ${matchup(game)}  event already final`);
      return { opened: true, final: true, news: 0, changes: 0, wrote: 0, polls: 0 };
    }
    logLine(`MISS  ${matchup(game)}  could not pin event ${game.eventId}`);
    return { opened: false, final: false, news: 0, changes: 0, wrote: 0, polls: 0 };
  }
  await scrapeDriveResults(sessionId);
  const sched = scheduleFor(state, game.eventId);
  let news = 0;
  let changes = 0;
  let wrote = 0;
  let polls = 0;
  let lastBeat = Date.now();
  let lastSitKey = '';
  let noMarketAt = 0;
  const until = Number(opts.until) || 0;
  const kickoffAt = kickoffOf(game, state);

  while (true) {
    if (until && Date.now() >= until) {
      logLine(`pin   ${matchup(game)}  next kickoff approaching, releasing`);
      break;
    }
    polls += 1;
    let xml = await source(sessionId);
    if (pageLooksFinal(xml) || slateMarksGameFinal(xml, game)) {
      logLine(`over  ${matchup(game)}  pinned game final after ${polls} polls`);
      return { opened: true, final: true, news, changes, wrote, polls };
    }
    if (!pageLooksLikeGame(xml, game)) {
      if (namesOnPage(xml, game)) {
        xml = await dismissEventOverlays(sessionId, xml);
      }
      if (pageLooksFinal(xml) || slateMarksGameFinal(xml, game)) {
        logLine(`over  ${matchup(game)}  pinned game final after ${polls} polls`);
        return { opened: true, final: true, news, changes, wrote, polls };
      }
      if (!pageLooksLikeGame(xml, game)) {
        ok = false;
        for (let attempt = 0; attempt < 3 && !ok; attempt += 1) {
          if (attempt) await sleep(800);
          ok = await openGame(sessionId, game.eventId, game);
          const landed = await source(sessionId).catch(() => '');
          if (pageLooksFinal(landed) || slateMarksGameFinal(landed, game)) {
            logLine(`over  ${matchup(game)}  pinned game final after ${polls} polls`);
            return { opened: true, final: true, news, changes, wrote, polls };
          }
        }
        if (!ok) {
          const lost = await source(sessionId).catch(() => '');
          if (pageLooksFinal(lost) || slateMarksGameFinal(lost, game)) {
            logLine(`over  ${matchup(game)}  pinned game final after ${polls} polls`);
            return { opened: true, final: true, news, changes, wrote, polls };
          }
          logLine(`MISS  ${matchup(game)}  lost pinned page`);
          return { opened: false, final: false, news, changes, wrote, polls };
        }
      }
    }
    const situation = parseFdLiveSituation(xml);
    const sitKey = situationKey(situation);
    let markets = await scrapeDriveResults(sessionId, { quick: true });
    if (markets.length) {
      noMarketAt = 0;
      const rec = applyMarkets(args, state, game, markets);
      news += rec.news;
      changes += rec.changes;
      const sitChanged = Boolean(sitKey && sitKey !== lastSitKey);
      if ((rec.news || rec.changes || sitChanged) && !args.noDb) {
        try {
          const n = await writeMarketsToDb(game, markets, kickoffAt, situation);
          wrote += n;
          if (n) {
            const sitLabel = formatFdLiveSpot(situation);
            logLine(`db+   ${matchup(game)}  upserted ${n} row${n === 1 ? '' : 's'}${sitLabel ? `  ${sitLabel}` : ''}`);
          }
          if (sitKey) lastSitKey = sitKey;
        } catch (err) {
          logLine(`db!   ${matchup(game)}  ${err.message}`);
        }
      }
      markTried(game, sched, true, Date.now(), { hammer: true });
      saveState(args.state, state);
    } else {
      if (!noMarketAt) noMarketAt = Date.now();
      if (Date.now() - noMarketAt >= 45_000 && !situation) {
        logLine(`over  ${matchup(game)}  no Drive Result for 45s, treating as final`);
        return { opened: true, final: true, news, changes, wrote, polls };
      }
    }
    if (Date.now() - lastBeat >= PIN_HEARTBEAT_MS) {
      const snap = markets.length
        ? markets.map((m) => formatOutcomes(liveOutcomes(m.outcomes))).join(' | ')
        : 'no Drive Result';
      const sitLabel = formatFdLiveSpot(situation);
      logLine(`pin   ${matchup(game)}  ${polls} polls  ${snap}${sitLabel ? `  ${sitLabel}` : ''}`);
      lastBeat = Date.now();
    }
  }
  return { opened: true, final: false, news, changes, wrote, polls };
}

async function resolvePinnedGame(sessionId, args, state, cache) {
  const eventId = String(args.singleGame || '');
  const fromCache = (cache.slate || []).find((g) => g.eventId === eventId)
    || (cache.live || []).find((g) => g.eventId === eventId);
  if (fromCache) return fromCache;
  logLine(`locating event ${eventId}…`);
  const slate = await collectSlate(sessionId, (n, scroll) => {
    if (scroll === 0 || scroll % 4 === 0) logLine(`slate  ${n} games  (scroll ${scroll})`);
  }, { stopAfterLive: !args.backfill });
  cache.slate = slate;
  cache.refreshAt = slateRefreshAt(slate, state);
  for (const game of slate) {
    if (!game.eventId) continue;
    const sched = scheduleFor(state, game.eventId);
    const kickoffAt = parseKickoff(game);
    if (kickoffAt) sched.kickoffAt = kickoffAt.toISOString();
  }
  const hit = slate.find((g) => g.eventId === eventId);
  if (hit) return hit;
  return {
    eventId,
    away: 'Unknown',
    home: 'Unknown',
    live: true,
    final: false,
    start: '',
  };
}

async function visitGame(sessionId, args, state, game) {
  logLine(`open  ${matchup(game)}  event ${game.eventId}`);
  const ok = await openGame(sessionId, game.eventId, game);
  if (!ok) {
    logLine(`MISS  ${matchup(game)}  could not open event ${game.eventId}`);
    const xml = await source(sessionId).catch(() => '');
    return { news: 0, changes: 0, markets: 0, wrote: 0, final: pageLooksFinal(xml) };
  }
  const markets = await scrapeDriveResults(sessionId);
  const xml = await source(sessionId).catch(() => '');
  const ended = pageLooksFinal(xml);
  const situation = parseFdLiveSituation(xml);
  const kickoffAt = parseKickoff(game);
  if (!markets.length) {
    logLine(`skip  ${matchup(game)}  ${ended ? 'final' : 'no Drive Result'}`);
    return { news: 0, changes: 0, markets: 0, wrote: 0, final: ended };
  }
  const { news, changes } = applyMarkets(args, state, game, markets);
  if (!news && !changes) {
    logLine(`same  ${matchup(game)}  ${markets.length} market${markets.length === 1 ? '' : 's'}  ${markets.map((m) => formatOutcomes(m.outcomes)).join(' | ')}`);
  }
  let wrote = 0;
  if (!args.noDb) {
    try {
      wrote = await writeMarketsToDb(game, markets, kickoffAt, situation);
      if (wrote) {
        const sitLabel = formatFdLiveSpot(situation);
        logLine(`db+   ${matchup(game)}  upserted ${wrote} row${wrote === 1 ? '' : 's'}${sitLabel ? `  ${sitLabel}` : ''}`);
      }
    } catch (err) {
      logLine(`db!   ${matchup(game)}  ${err.message}`);
    }
  }
  return { news, changes, markets: markets.length, wrote, final: ended };
}

function shouldLoadSlate(args, cache, now = Date.now()) {
  if (args.backfill) return true;
  if (!cache.slate) return true;
  if (now >= (cache.refreshAt || 0)) return true;
  if (!liveGamesOf(cache.slate, cache.state || { schedule: {} }, now).length && !cache.live?.length) {
    return true;
  }
  return false;
}

async function runCycle(sessionId, args, state, cycle, cache) {
  const now = Date.now();
  const loadSlate = shouldLoadSlate(args, { ...cache, state }, now);
  let slate;
  if (loadSlate) {
    logLine(`cycle ${cycle}  loading NCAA Football slate…`);
    slate = await collectSlate(sessionId, (n, scroll) => {
      if (scroll === 0 || scroll % 4 === 0) logLine(`slate  ${n} games  (scroll ${scroll})`);
    }, { stopAfterLive: !args.backfill });
    for (const game of slate) {
      if (!game.eventId) continue;
      const sched = scheduleFor(state, game.eventId);
      const kickoffAt = parseKickoff(game);
      if (kickoffAt) sched.kickoffAt = kickoffAt.toISOString();
    }
    await purgeEnded(args, state, slate);
    cache.slate = slate;
    cache.refreshAt = slateRefreshAt(slate, state);
  } else {
    slate = cache.slate || [];
    const until = cache.refreshAt ? cache.refreshAt - now : 0;
    logLine(`cycle ${cycle}  hammer ${liveGamesOf(slate, state, now).length} live  next slate ${until > 0 ? formatDelay(until) : 'now'}`);
  }

  const anyLive = slateHasLive(slate, state, now);
  const liveOnly = Boolean(anyLive && !args.backfill);
  const hammer = Boolean(liveOnly && !loadSlate);
  const ranked = (hammer ? liveGamesOf(slate, state, now) : slate.filter((g) => g.eventId));
  const visitList = [];
  let held = 0;
  let farHeld = 0;
  let liveHeld = 0;
  for (const game of ranked) {
    const sched = scheduleFor(state, game.eventId);
    const decision = shouldVisit(game, sched, now, { liveOnly, hammer });
    if (!decision.visit) {
      held += 1;
      if (decision.reason === 'not live') {
        liveHeld += 1;
        continue;
      }
      const liveHold = (sched.missStreak || 0) > 0 || gameIsLive(game, sched.kickoffAt && new Date(sched.kickoffAt), now);
      if (liveHold || game.final) logLine(`hold  ${matchup(game).padEnd(36)}  ${decision.reason}`);
      else farHeld += 1;
      continue;
    }
    visitList.push(game);
  }
  if (liveHeld) logLine(`hold  ${liveHeld} upcoming  (live slate; pass --backfill to scrape them)`);
  if (farHeld) logLine(`hold  ${farHeld} game${farHeld === 1 ? '' : 's'} more than 3 days out (once daily)`);
  const games = visitList.slice(0, Number.isFinite(args.maxGames) ? args.maxGames : visitList.length);
  const liveNow = liveGamesOf(slate, state, Date.now());
  const pinTarget = args.singleGame
    ? games.find((g) => g.eventId === args.singleGame) || liveNow.find((g) => g.eventId === args.singleGame)
    : (!args.backfill && liveNow.length === 1 ? liveNow[0] : null);

  if (pinTarget && !args.backfill && !args.once) {
    const rec = await pinGame(sessionId, args, state, pinTarget, { until: cache.refreshAt });
    if (rec.final) {
      pinTarget.final = true;
      pinTarget.live = false;
      await forgetGame(args, state, pinTarget, 'slate marked final');
      cache.live = [];
      cache.refreshAt = 0;
    } else if (!rec.opened) {
      pinTarget.skipLive = true;
      pinTarget.live = false;
      cache.live = [];
      cache.refreshAt = 0;
      logLine(`pin   ${matchup(pinTarget)}  dropped; will reload NCAA slate`);
    } else {
      cache.live = [pinTarget];
    }
    logLine(`cycle ${cycle}  done  pin ${rec.polls || 0} polls  +${rec.news} new  ${rec.changes} changed  db ${rec.wrote}`);
    const idle = idlePlan(slate, state);
    const keepPin = rec.opened && !rec.final;
    return {
      slate: slate.length,
      visited: rec.opened ? 1 : 0,
      withMarkets: rec.wrote || rec.news ? 1 : 0,
      news: rec.news,
      changes: rec.changes,
      wrote: rec.wrote,
      idle: keepPin ? { ms: 0, reason: 'pinned live game' } : idle,
    };
  }

  logLine(`cycle ${cycle}  ${slate.length} on slate  ${held} held  visiting ${games.length}${liveOnly ? '  live-only' : ''}${hammer ? '  pinned' : ''}`);

  let withMarkets = 0;
  let news = 0;
  let changes = 0;
  let wrote = 0;
  const stillLive = [];
  for (const game of games) {
    const sched = scheduleFor(state, game.eventId);
    try {
      const rec = await visitGame(sessionId, args, state, game);
      withMarkets += rec.markets ? 1 : 0;
      news += rec.news;
      changes += rec.changes;
      wrote += rec.wrote || 0;
      markTried(game, sched, Boolean(rec.markets), Date.now(), { hammer });
      if (rec.final) {
        logLine(`over  ${matchup(game)}  dropping from live pin`);
        game.final = true;
        await forgetGame(args, state, game, 'slate marked final');
      } else if (gameIsLive(game, kickoffOf(game, state))) {
        stillLive.push(game);
      }
      if (!rec.markets && sched.nextTryAt && !hammer) {
        logLine(`back  ${matchup(game)}  next try in ${formatDelay(sched.nextTryAt - Date.now())}`);
      }
      saveState(args.state, state);
      await sleep(args.pauseMs);
    } catch (err) {
      logLine(`ERR   ${matchup(game)}  ${err.message}`);
      throw err;
    }
  }

  cache.slate = slate;
  cache.live = stillLive;
  if (!stillLive.length && anyLive) cache.refreshAt = 0;
  else if (loadSlate || !cache.refreshAt) cache.refreshAt = slateRefreshAt(slate, state);

  logLine(`cycle ${cycle}  done  ${withMarkets}/${games.length} with Drive Result  +${news} new  ${changes} changed  db ${wrote}`);
  const idle = idlePlan(slate, state);
  return { slate: slate.length, visited: games.length, withMarkets, news, changes, wrote, idle };
}

async function main() {
  loadSiteEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!args.noDb && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL missing (site/.env.local). Pass --no-db to log only.');
  }
  const state = loadState(args.state);
  const mode = args.singleGame
    ? `single-game ${args.singleGame}`
    : (args.backfill ? 'backfill (all games)' : 'live pin until next kickoff');
  process.stdout.write(
    `FanDuel Drive Result watcher\n  log    ${args.log}\n  state  ${args.state}\n  db     ${args.noDb ? 'off' : 'neon fd_drive_odds'}\n  mode   ${mode}\n\n`,
  );

  let sessionId = null;
  let cycle = 0;
  const cache = { slate: null, live: [], refreshAt: 0 };
  const run = async () => {
    if (!sessionId) sessionId = await connect(args.udid);
    cycle += 1;
    if (args.singleGame) {
      const game = await resolvePinnedGame(sessionId, args, state, cache);
      if (args.once) {
        const rec = await visitGame(sessionId, args, state, game);
        return {
          slate: cache.slate?.length || 0,
          visited: 1,
          withMarkets: rec.markets ? 1 : 0,
          news: rec.news,
          changes: rec.changes,
          wrote: rec.wrote,
          idle: { ms: 0, reason: 'once' },
        };
      }
      const rec = await pinGame(sessionId, args, state, game, { until: cache.refreshAt });
      if (rec.final) {
        game.final = true;
        game.live = false;
        await forgetGame(args, state, game, 'slate marked final');
        cache.live = [];
        cache.refreshAt = 0;
      } else if (!rec.opened) {
        game.skipLive = true;
        game.live = false;
        cache.live = [];
        cache.refreshAt = 0;
        logLine(`pin   ${matchup(game)}  dropped; will reload NCAA slate`);
      }
      return {
        slate: cache.slate?.length || 0,
        visited: rec.opened ? 1 : 0,
        withMarkets: rec.news || rec.wrote ? 1 : 0,
        news: rec.news,
        changes: rec.changes,
        wrote: rec.wrote,
        idle: rec.final || !rec.opened || args.once
          ? idlePlan(cache.slate || [], state)
          : { ms: 0, reason: 'single-game pin' },
      };
    }
    return runCycle(sessionId, args, state, cycle, cache);
  };

  if (args.once) {
    try {
      await run();
    } finally {
      await deleteSession(sessionId);
    }
    return;
  }

  while (true) {
    try {
      const result = await run();
      const idleMs = result?.idle?.ms || 0;
      if (idleMs > 0) {
        logLine(`idle  sleeping ${formatDelay(idleMs)}  (${result.idle.reason})`);
        await deleteSession(sessionId);
        sessionId = null;
        await sleep(idleMs);
      }
    } catch (err) {
      logLine(`session error: ${err.message}`);
      await deleteSession(sessionId);
      sessionId = null;
      logLine('reconnecting in 8s…');
      await sleep(8000);
    }
  }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`);
    process.exit(1);
  });
}
