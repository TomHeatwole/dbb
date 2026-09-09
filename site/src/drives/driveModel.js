/**
 * NCAAF drive-result model — LightGBM joint probabilities vs FanDuel/DK
 * four-way settlement (OTD / FGA / Punt / Other), FanDuel board order.
 *
 * Drive-start trees for pregame 1st-drive and the opponent's next drive.
 * Snap trees for the live current drive when ESPN has down / distance /
 * yards-to-goal. Trained 2023–24, held out 2025.
 */

import {
  americanToImpliedProb,
  analyzeAgainstBreakeven,
  computeKellyStake,
  formatAmericanOdds,
  probToAmerican,
} from '../sop/sopModel.js';
import { DRIVE_RESULT_MODEL, scoreLgbmLayer } from './driveResultLgbm.js';
import { isMadeScoreLabel } from './espnDriveChart.js';
import { predictOpponentStart } from './nextDriveStart.js';
import { ytgFromSpot } from './ytgFromSpot.js';
import { formatDownAndDistance, formatDownAndDistanceSpoken, formatLiveSituationLine, liveSpotsDisagree, liveSnapsAgree, espnClockAheadOfFd, applyFdAheadLive } from './fdLiveSituation.js';

export { applyFdAheadLive };

/** ESPN scrape: example_data/ncaaf_drive_results/espn_ncaaf_drives.csv */
export const RAW_DRIVE_N = 113712;

/** Callers who go on 4th far more than the trees assume. UI warning only. */
export const PUNT_STYLE_WARNINGS = [
  {
    id: 'fau',
    label: 'FAU',
    needles: ['florida atlantic', 'fau'],
    detail: 'Zach Kittley goes for it on 4th more than almost anyone in FBS (67% go vs punt in 2025). The model still prices FAU like the league, so this punt edge is probably overstated.',
  },
  {
    id: 'army',
    label: 'Army',
    needles: ['army black knights', 'army west point', 'army'],
    detail: 'Army almost never punts on 4th-and-short (91% go on 4th & 1–2 outside FG range). Option identity — the model still prices them like a normal punt team, so this edge is probably overstated.',
  },
];

export const DRIVE_BUCKETS = [
  {
    key: 'td',
    label: 'OTD',
    n: 29888,
    runnerHints: ['offensive touchdown', 'offensive td', 'touchdown', 'td'],
  },
  {
    key: 'fg',
    label: 'FGA',
    n: 13698,
    runnerHints: ['field goal attempt', 'fg attempt', 'field goal'],
  },
  {
    key: 'punt',
    label: 'Punt',
    n: 41261,
    runnerHints: ['punt'],
  },
  {
    key: 'other',
    label: 'Other',
    n: 28865,
    runnerHints: ['other', 'any other'],
  },
];

for (const bucket of DRIVE_BUCKETS) {
  bucket.p = bucket.n / RAW_DRIVE_N;
  bucket.fairAmerican = probToAmerican(bucket.p);
}

export const RAW_MODEL_META = {
  id: 'raw-ratio',
  label: 'Raw ratio',
  sample: RAW_DRIVE_N,
  seasons: '2023–25',
  note: 'Unconditional ESPN drive frequencies. Fallback when the joint model cannot score.',
};

export const LGBM_HOLDOUT = {
  driveStart: { logloss: 1.1544, raw: 1.3238, acc: 0.499, n: 39573 },
  snap: { logloss: 1.0389, raw: 1.3597, acc: 0.552, n: 258190 },
  nextDrive: { logloss: 1.2558, raw: 1.3258, acc: 0.445, n: 36046, ytgMae: 10.13 },
};

export const LGBM_MODEL_META = {
  id: 'lgbm-joint',
  label: 'Joint LightGBM',
  trainSeasons: DRIVE_RESULT_MODEL.meta?.trainSeasons ?? [2023, 2024],
  testSeason: DRIVE_RESULT_MODEL.meta?.testSeason ?? 2025,
  note: DRIVE_RESULT_MODEL.meta?.note
    ?? 'Joint P(result | clock, field, score, spread, total).',
};

const FP_CODES = DRIVE_RESULT_MODEL.meta?.fpCodes ?? {
  deep: 0, kickoff: 1, midfield: 2, favorable: 3,
};
const HALF_CODES = DRIVE_RESULT_MODEL.meta?.halfCodes ?? { h1: 0, h2: 1, ot: 2 };
const DIST_CODES = DRIVE_RESULT_MODEL.meta?.distCodes ?? {
  short: 0, med: 1, long: 2, xlong: 3,
};
const TIME_CODES = DRIVE_RESULT_MODEL.meta?.timeCodes ?? { late: 0, mid: 1, early: 2 };

export function formatSharePct(p) {
  if (!Number.isFinite(p)) return '—';
  return `${(p * 100).toFixed(1)}%`;
}

export function formatEdgePoints(points) {
  if (!Number.isFinite(points)) return '—';
  const abs = Math.abs(points);
  const body = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1);
  const sign = points > 0 ? '+' : points < 0 ? '−' : '';
  return `${sign}${body}%`;
}

function normalizeName(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['’`]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\bst\b/g, 'state')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameWords(s) {
  return normalizeName(s).split(' ').filter(Boolean);
}

/**
 * How strongly `needle` (a team name) appears as a phrase in `hay`
 * (runner, market, or possession). Longer phrases beat shorter ones so
 * "Texas State" outranks "Texas" inside "1st Texas State Drive Result".
 */
export function nameMatchScore(hay, needle) {
  const h = normalizeName(hay);
  const n = normalizeName(needle);
  if (!h || !n) return 0;
  if (h === n) return 1000 + n.length;
  const hWords = nameWords(h);
  const nWords = nameWords(n);
  if (!nWords.length || nWords.length > hWords.length) return 0;
  for (let i = 0; i <= hWords.length - nWords.length; i += 1) {
    if (nWords.every((w, j) => hWords[i + j] === w)) {
      return 100 + nWords.length * 20 + n.length;
    }
  }
  return 0;
}

export function puntStyleWarningForOffense(name) {
  const hay = String(name ?? '').trim();
  if (!hay) return null;
  let best = null;
  let bestScore = 0;
  for (const row of PUNT_STYLE_WARNINGS) {
    for (const needle of row.needles) {
      let score = nameMatchScore(hay, needle);
      if (!score) {
        const n = normalizeName(needle);
        const h = normalizeName(hay);
        if (n && n.length <= 4 && (h === n || h.startsWith(`${n} `) || nameWords(h).includes(n))) {
          score = 50 + n.length;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = { id: row.id, label: row.label, detail: row.detail };
      }
    }
  }
  return best;
}

function pickNamedSide(named, home, away) {
  const homeScore = nameMatchScore(named, home);
  const awayScore = nameMatchScore(named, away);
  if (homeScore > awayScore && homeScore > 0) return 'home';
  if (awayScore > homeScore && awayScore > 0) return 'away';
  return null;
}

function fpCode(ytg) {
  const y = Number(ytg);
  if (!Number.isFinite(y)) return NaN;
  if (y >= 86) return FP_CODES.deep;
  if (y >= 70) return FP_CODES.kickoff;
  if (y >= 45) return FP_CODES.midfield;
  if (y >= 1) return FP_CODES.favorable;
  return NaN;
}

function halfCode(period) {
  const p = Number(period);
  if (p === 1 || p === 2) return HALF_CODES.h1;
  if (p === 3 || p === 4) return HALF_CODES.h2;
  if (p > 4) return HALF_CODES.ot;
  return NaN;
}

function distCode(distance) {
  const d = Number(distance);
  if (!Number.isFinite(d)) return NaN;
  if (d <= 3) return DIST_CODES.short;
  if (d <= 6) return DIST_CODES.med;
  if (d <= 10) return DIST_CODES.long;
  return DIST_CODES.xlong;
}

function timeCode(secLeftHalf) {
  const s = Number(secLeftHalf);
  if (!Number.isFinite(s)) return NaN;
  if (s <= 180) return TIME_CODES.late;
  if (s <= 480) return TIME_CODES.mid;
  return TIME_CODES.early;
}

export function secondsLeftInGame(period, clockSec) {
  const p = Number(period);
  const c = Number(clockSec);
  if (!Number.isFinite(p) || p <= 0) return Number.isFinite(c) ? c : NaN;
  if (!Number.isFinite(c)) return NaN;
  if (p <= 4) return (4 - p) * 900 + c;
  return c;
}

export function secondsLeftInHalf(period, clockSec) {
  const p = Number(period);
  const c = Number(clockSec);
  if (!Number.isFinite(c)) return NaN;
  if (p === 1 || p === 3) return 900 + c;
  if (p === 2 || p === 4) return c;
  return c;
}

function finiteClock(v) {
  if (v == null || v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function parseDisplayClock(display) {
  const s = String(display ?? '').trim();
  const m = s.match(/^(\d+):(\d{2})$/);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Quarter seconds 0–900. Null does not become 0. Half-clocks (15:01–30:00) fold into the quarter. */
export function liveClockSeconds(live) {
  let sec = finiteClock(live?.clockSeconds);
  if (!Number.isFinite(sec)) sec = parseDisplayClock(live?.clock);
  if (!Number.isFinite(sec)) return NaN;
  if (sec > 1800) return NaN;
  if (sec > 900) return sec - 900;
  return sec;
}

export function isHalftimeLive(live) {
  if (live?.halfTime) return true;
  const blob = [live?.state, live?.statusText, live?.clock].filter(Boolean).join(' ');
  if (/STATUS_HALFTIME|half\s*-?\s*time|halftime/i.test(blob)) return true;
  const period = Number(live?.period);
  const sec = liveClockSeconds(live);
  return period === 2 && sec === 0;
}

function normalizeLiveClock(live) {
  if (isHalftimeLive(live)) {
    return { period: 3, clockSec: 900, halfKickoff: true };
  }
  const period = Number(live?.period);
  const clockSec = liveClockSeconds(live);
  const blob = [live?.statusText, live?.clock].filter(Boolean).join(' ');
  const endOfQuarter = clockSec === 0 || /end of\s*(1st|3rd)/i.test(blob);
  if (endOfQuarter && (period === 1 || period === 3)) {
    return { period: period + 1, clockSec: 900, halfKickoff: false };
  }
  return {
    period: Number.isFinite(period) && period > 0 ? period : NaN,
    clockSec,
    halfKickoff: false,
  };
}

export function extractHomeSpread(game) {
  const runners = game?.lines?.spread?.runners ?? [];
  const home = game?.teams?.home;
  const away = game?.teams?.away;
  let bestHome = null;
  let bestHomeScore = 0;
  let bestAway = null;
  let bestAwayScore = 0;
  for (const runner of runners) {
    if (!Number.isFinite(runner.handicap)) continue;
    const homeScore = nameMatchScore(runner.runnerName, home);
    const awayScore = nameMatchScore(runner.runnerName, away);
    if (homeScore > awayScore && homeScore > bestHomeScore) {
      bestHomeScore = homeScore;
      bestHome = runner;
    }
    if (awayScore > homeScore && awayScore > bestAwayScore) {
      bestAwayScore = awayScore;
      bestAway = runner;
    }
  }
  if (bestHome) return bestHome.handicap;
  if (bestAway) return -bestAway.handicap;
  const finite = runners.filter((r) => Number.isFinite(r.handicap));
  if (finite.length === 1) return finite[0].handicap;
  return NaN;
}

export function extractOverUnder(game) {
  const runners = game?.lines?.total?.runners ?? [];
  const over = runners.find((r) => /over/i.test(r.runnerName ?? '') && Number.isFinite(r.handicap));
  if (over) return over.handicap;
  const any = runners.find((r) => Number.isFinite(r.handicap));
  return any ? any.handicap : NaN;
}

export function flipSide(side) {
  if (side === 'home') return 'away';
  if (side === 'away') return 'home';
  return null;
}

export function livePossessionSide(game) {
  const live = game?.live;
  if (live?.possession === 'home' || live?.possession === 'away') return live.possession;
  return pickNamedSide(live?.possessionName || '', game?.teams?.home, game?.teams?.away);
}

export function hasLiveOffensiveSnap(game) {
  const live = game?.live;
  const down = Number(live?.down);
  if (!Number.isFinite(down) || down < 1) return false;
  const ytg = Number(live?.yardsToEndzone);
  return Number.isFinite(ytg) && ytg >= 1 && ytg <= 99;
}

/** Live card with no ESPN attach — model falls back to own-25 kickoff. */
export function espnStateUnreachable(game) {
  if (!game?.inPlay || isHalftimeLive(game.live)) return false;
  if (game.debug?.espnMatched === true || game.espnId) return false;
  return true;
}

const SERIES_OVER_PLAY = /punt|interception|intercepted|fumble|safety|turnover on downs|downs turnover|field goal missed|missed field goal|blocked/i;
const DEAD_BALL_CLOCK = /timeout|two-minute|two minute|end (of )?(the )?(1st|2nd|3rd|4th|first|second|third|fourth|quarter|period|half)/i;

export function playYardageFromText(text) {
  const s = String(text ?? '');
  const loss = s.match(/loss of (\d+)\s*yards?/i);
  if (loss) return -Number(loss[1]);
  const forY = s.match(/for (-?\d+)\s*yards?/i);
  if (forY) return Number(forY[1]);
  return null;
}

function lastPlayEndedSeries(type, text) {
  if (isMadeScoreLabel(type) || isMadeScoreLabel(text)) return true;
  return SERIES_OVER_PLAY.test(type) || SERIES_OVER_PLAY.test(text);
}

function isDeadBallClockPlay(type, text) {
  return DEAD_BALL_CLOCK.test(type) || DEAD_BALL_CLOCK.test(text);
}

/**
 * ESPN often updates lastPlay before down / distance / YTG. FanDuel live
 * drive SGP reprices on the actual snap. Scoring the lagged spot vs those
 * prices invents edges that are not there.
 */
export function espnSituationLagsLastPlay(game) {
  const live = game?.live;
  if (!game?.inPlay || isHalftimeLive(live)) return false;
  const type = String(live?.lastPlayType ?? '');
  const text = String(live?.lastPlay ?? '');
  if (!type && !text) return false;
  if (!hasLiveOffensiveSnap(game)) return false;
  if (isDeadBallClockPlay(type, text)) return false;

  const playSide = live?.lastPlaySide;
  const poss = livePossessionSide(game);
  const sameTeam = !playSide || !poss || playSide === poss;
  if (sameTeam && lastPlayEndedSeries(type, text)) return true;

  const yards = Number.isFinite(Number(live?.lastPlayYards))
    ? Number(live.lastPlayYards)
    : playYardageFromText(text);
  const startYl = Number(live?.lastPlayStartYardLine);
  const sitYl = Number(live?.yardLine);
  const endYl = Number(live?.lastPlayEndYardLine);
  const down = Number(live?.down);
  const distance = Number(live?.distance);

  if (
    Number.isFinite(startYl)
    && Number.isFinite(sitYl)
    && Math.abs(startYl - sitYl) <= 1
    && Number.isFinite(yards)
    && Math.abs(yards) >= 3
  ) {
    return true;
  }

  if (
    Number.isFinite(endYl)
    && Number.isFinite(sitYl)
    && Math.abs(endYl - sitYl) >= 8
    && Number.isFinite(yards)
    && Math.abs(yards) >= 3
  ) {
    return true;
  }

  if (
    Number.isFinite(yards)
    && yards >= 3
    && Number.isFinite(down)
    && down > 1
    && Number.isFinite(distance)
    && yards >= distance
  ) {
    return true;
  }

  return false;
}

export function liveSpotKey(game) {
  const live = game?.live ?? {};
  return [
    live.possession ?? '',
    live.down ?? '',
    live.distance ?? '',
    live.yardsToEndzone ?? '',
    live.period ?? '',
    live.clock ?? '',
    live.lastPlayId || live.lastPlay || '',
  ].join('|');
}

function fdAmericanOf(market, key) {
  const quote = market?.outcomes?.[key];
  if (Number.isFinite(quote?.fd?.american) && quote.fd.american !== 0) return quote.fd.american;
  if (market?.source === 'dk') return null;
  return Number.isFinite(quote?.american) && quote.american !== 0 ? quote.american : null;
}

export function driveOddsKey(game) {
  return (game?.driveMarkets ?? [])
    .map((market) => [
      market?.driveN ?? '',
      market?.offenseSide ?? '',
      fdAmericanOf(market, 'td'),
      fdAmericanOf(market, 'fg'),
      fdAmericanOf(market, 'punt'),
      fdAmericanOf(market, 'other'),
    ].join(':'))
    .sort()
    .join('|');
}

export function oddsMovedWhileSpotHeld(prev, next) {
  if (!next?.inPlay || !prev) return false;
  const spot = liveSpotKey(next);
  if (!spot || spot === '||||||') return false;
  if (liveSpotKey(prev) !== spot) return false;
  const nextOdds = driveOddsKey(next);
  if (!nextOdds) return false;
  return driveOddsKey(prev) !== nextOdds;
}

/** Keep the lag flag until ESPN's down/clock/last play actually changes. */
export function applyOddsAheadFlags(prevGames, nextGames) {
  const prevById = new Map((prevGames ?? []).map((game) => [String(game?.eventId ?? ''), game]));
  return (nextGames ?? []).map((game) => {
    const id = String(game?.eventId ?? '');
    const prev = prevById.get(id);
    const held = oddsMovedWhileSpotHeld(prev, game);
    const stillHeld = Boolean(prev?.live?.oddsAheadOfSpot)
      && liveSpotKey(prev) === liveSpotKey(game);
    if (!held && !stillHeld) return game;
    return {
      ...game,
      live: { ...(game.live ?? {}), oddsAheadOfSpot: true },
    };
  });
}

export function situationUntrusted(game) {
  return spotLagKind(game) === 'espnBehind';
}

/**
 * espnBehind: model is on a stale ESPN spot (FD / last play already moved).
 * oddsStale: ESPN is ahead of FanDuel, so the posted price may be old.
 */
export function spotLagKind(game) {
  const view = applyFdAheadLive(game);
  if (view.live?.spotSource === 'fd') return null;
  if (!view?.inPlay || isHalftimeLive(view.live)) return null;
  const espn = view?.live;
  const fd = espn?.fd || game?.fdLive;
  if (liveSnapsAgree(espn, fd)) return null;
  const behind = Boolean(espn?.oddsAheadOfSpot)
    || Boolean(espn?.fdAheadOfEspn)
    || espnSituationLagsLastPlay(game);
  if (behind) {
    if (espnClockAheadOfFd(espn, fd)) return 'oddsStale';
    return 'espnBehind';
  }
  if (liveSpotsDisagree(espn, fd) || espnClockAheadOfFd(espn, fd)) return 'oddsStale';
  return null;
}

function impliedDownAndDistance(live) {
  const type = live?.lastPlayType;
  const text = live?.lastPlay;
  if (lastPlayEndedSeries(type, text)) {
    const blob = `${type || ''} ${text || ''}`;
    const why = /punt/i.test(blob) ? 'a punt'
      : /intercept/i.test(blob) ? 'an interception'
        : /fumble/i.test(blob) ? 'a fumble'
          : /missed|no good/i.test(blob) ? 'a missed FG'
            : /field goal/i.test(blob) ? 'a field goal'
              : (isMadeScoreLabel(type) || isMadeScoreLabel(text)) ? 'a score'
                : 'a change of possession';
    return { label: 'drive over', why };
  }
  const down = Number(live?.down);
  const distance = Number(live?.distance);
  const yards = Number.isFinite(Number(live?.lastPlayYards))
    ? Number(live.lastPlayYards)
    : playYardageFromText(text);
  if (!Number.isFinite(down) || !Number.isFinite(distance) || !Number.isFinite(yards)) return null;
  if (yards >= distance) {
    const ytg = Number(live?.yardsToEndzone);
    const nextYtg = Number.isFinite(ytg) ? ytg - yards : NaN;
    const label = Number.isFinite(nextYtg) && nextYtg > 0 && nextYtg < 10 ? '1st & Goal' : '1st & 10';
    return { label, why: `gained ${yards}` };
  }
  if (down >= 4) return { label: 'drive over', why: `gained ${yards} on 4th` };
  return {
    label: formatDownAndDistance(down + 1, Math.max(1, distance - yards)),
    why: yards === 0 ? 'no gain' : yards < 0 ? `loss of ${-yards}` : `gained ${yards}`,
  };
}

/** ESPN’s posted situation vs FanDuel (or the last play) — full clock / down / yardline. */
export function describeSpotLag(game) {
  const kind = spotLagKind(game);
  if (!kind) return null;
  const live = game?.live ?? {};
  const fd = live.fd || game?.fdLive || null;
  const implied = impliedDownAndDistance(live);
  const espnLine = formatLiveSituationLine(live);
  const fdLine = formatLiveSituationLine(fd);
  const espnSpot = formatDownAndDistanceSpoken(live) || live.downDistance
    || formatDownAndDistance(live.down, live.distance);
  const impliedSpot = implied?.label || null;
  const lastPlayLine = implied?.label
    ? `${implied.label}${implied.why ? ` (${implied.why})` : ''}`
    : null;

  const fdDiffers = liveSpotsDisagree(live, fd) || espnClockAheadOfFd(live, fd);
  const rows = [];
  rows.push({ key: 'espn', label: 'ESPN shows', value: espnLine || '—' });
  if (fdLine && fdDiffers) {
    rows.push({ key: 'fd', label: 'FD shows', value: fdLine });
  } else if (lastPlayLine && lastPlayLine !== espnSpot) {
    rows.push({ key: 'play', label: 'Last play', value: lastPlayLine });
  }

  const text = rows.map((row) => `${row.label}: ${row.value}`).join('\n');
  return {
    kind,
    espnBehind: kind === 'espnBehind',
    espnSpot,
    impliedSpot: fdLine || impliedSpot,
    espnLine: espnLine || null,
    fdLine: fdLine || null,
    lastPlayLine: fdDiffers ? null : lastPlayLine,
    rows,
    text,
  };
}

/**
 * Team that just scored a TD / made FG. That series is over; ESPN often
 * still tags them as possession through the PAT. Kickoff goes the other way.
 */
export function scoringSideAfterMadeKick(game) {
  if (!game?.inPlay || isHalftimeLive(game.live)) return null;
  if (hasLiveOffensiveSnap(game)) return null;
  const chart = game?.live?.driveChart;
  if (chart?.currentSide === 'home' || chart?.currentSide === 'away') return null;
  const driveResult = chart?.currentResult;
  const playResult = game?.live?.lastPlayType || game?.live?.lastPlay;
  if (!isMadeScoreLabel(driveResult) && !isMadeScoreLabel(playResult)) return null;
  if (isMadeScoreLabel(driveResult) && (chart?.finishedSide === 'home' || chart?.finishedSide === 'away')) {
    return chart.finishedSide;
  }
  if (game?.live?.lastPlaySide === 'home' || game?.live?.lastPlaySide === 'away') {
    return game.live.lastPlaySide;
  }
  return null;
}

/** Who is actually up now. After a score, the other team is getting the kickoff. */
export function firstUpSide(game) {
  const view = applyFdAheadLive(game);
  if (!view?.inPlay || view?.live?.state === 'pre') return null;
  if (isHalftimeLive(view.live)) return null;
  if (view.live?.spotSource === 'fd') {
    const fdPoss = livePossessionSide(view);
    if (fdPoss) return fdPoss;
  }
  if (hasLiveOffensiveSnap(view)) {
    const snapPoss = livePossessionSide(view);
    if (snapPoss) return snapPoss;
  }
  const book = bookLiveDrive(view);
  if (book?.lead) return book.lead;
  const scorer = scoringSideAfterMadeKick(view);
  if (scorer) return flipSide(scorer);
  const chartSide = view?.live?.driveChart?.currentSide;
  if (chartSide === 'home' || chartSide === 'away') return chartSide;
  const finished = view?.live?.driveChart?.finishedSide;
  // Punt / INT / missed FG: series is over, but the next snap is not a kickoff.
  if (finished === 'home' || finished === 'away') return null;
  return livePossessionSide(view);
}

export function situationOffenseLabel(game) {
  const view = applyFdAheadLive(game);
  if (!view?.inPlay) return null;
  if (isHalftimeLive(view.live)) return 'Halftime';
  const side = firstUpSide(view);
  const name = side === 'away'
    ? (view?.teams?.away ?? view?.live?.possessionName)
    : side === 'home'
      ? (view?.teams?.home ?? view?.live?.possessionName)
      : null;
  if (scoringSideAfterMadeKick(view) && name) return `${name} gets the ball`;
  if (name) return `${name} on offense`;
  if (view?.live?.period || view?.live?.clock || view?.live?.statusText) return 'Between possessions';
  return null;
}

export function inferOffenseSide(game, market = null) {
  const row = market || game?.nextDrive;
  const home = game?.teams?.home;
  const away = game?.teams?.away;
  // Market title first: DK "1st Texas Drive Result" vs a stale offenseSide
  // that confused Texas with Texas State.
  const fromMarketName = pickNamedSide(row?.marketName || '', home, away);
  if (fromMarketName) return fromMarketName;
  const fromOffenseName = pickNamedSide(row?.offenseName || '', home, away);
  if (fromOffenseName) return fromOffenseName;
  if (row?.offenseSide === 'home' || row?.offenseSide === 'away') {
    return row.offenseSide;
  }

  // Untitled live FanDuel "Drive Result" is the current possession.
  // The waiting team's next-drive card gets an explicit offenseSide.
  return livePossessionSide(game);
}

export function resolveOffenseTeam(game, market = null) {
  const side = inferOffenseSide(game, market);
  const row = market || game?.nextDrive;
  const liveName = game?.live?.possessionName || null;
  const name = side === 'away'
    ? (game?.teams?.away || row?.offenseName || liveName || null)
    : side === 'home'
      ? (game?.teams?.home || row?.offenseName || liveName || null)
      : (row?.offenseName || liveName || null);
  return { side, name };
}

export function possessiveTeam(name) {
  const raw = String(name ?? '').trim();
  if (!raw) return '';
  return /s$/i.test(raw) ? `${raw}'` : `${raw}'s`;
}

export function listDriveMarkets(game, { granular = false } = {}) {
  const raw = Array.isArray(game?.driveMarkets) && game.driveMarkets.length
    ? game.driveMarkets
    : (game?.nextDrive ? [game.nextDrive] : []);
  if (!raw.length) return [];
  const hasFlag = raw.some((market) => typeof market?.granular === 'boolean');
  if (!hasFlag) return raw;
  const match = raw.filter((market) => Boolean(market.granular) === Boolean(granular));
  if (match.length) return match;
  const fallback = raw.filter((market) => Boolean(market.granular) !== Boolean(granular));
  return fallback.length ? fallback : raw;
}

/** Both team cards whenever we can name home and away. */
export function shouldShowBothDriveSides(game) {
  return Boolean(game?.teams?.home && game?.teams?.away);
}

/** current = team with the ball (or next up); next = opponent after that. */
export function driveCardRole(game, pred) {
  if (!game?.inPlay || game?.live?.state === 'pre') return 'first';
  if (isHalftimeLive(game.live)) return 'next';
  if (pred?.layer === 'snap' || pred?.firstUp) return 'current';
  if (pred?.afterPriorDrive || pred?.predictedStart) return 'next';
  const poss = firstUpSide(game);
  const side = pred?.side;
  if (poss && side && side === poss) return 'current';
  if (poss && side && side !== poss) return 'next';
  return 'next';
}

export function driveNumberFromName(name) {
  const n = String(name ?? '');
  const ordinal = n.match(/(\d+)(?:st|nd|rd|th)\s+drive/i);
  if (ordinal) return Number(ordinal[1]);
  const numbered = n.match(/\bdrive\s+(\d+)\b/i);
  if (numbered) return Number(numbered[1]);
  return null;
}

export function marketDriveNumber(market) {
  const n = Number(market?.driveN);
  if (Number.isFinite(n) && n >= 1) return n;
  return driveNumberFromName(market?.marketName);
}

function marketTeamSide(game, market) {
  return pickNamedSide(market?.marketName || '', game?.teams?.home, game?.teams?.away)
    || pickNamedSide(market?.offenseName || '', game?.teams?.home, game?.teams?.away)
    || (market?.offenseSide === 'home' || market?.offenseSide === 'away' ? market.offenseSide : null);
}

/** Highest FanDuel/DK drive N still on the board for each team. */
export function bookDriveHighs(game) {
  const highs = { home: 0, away: 0 };
  const rows = Array.isArray(game?.driveMarkets) ? game.driveMarkets : [];
  for (const market of rows) {
    const side = marketTeamSide(game, market);
    const n = marketDriveNumber(market);
    if ((side === 'home' || side === 'away') && Number.isFinite(n) && n > highs[side]) {
      highs[side] = n;
    }
  }
  return highs;
}

/**
 * When FanDuel has opened Drive N+1 for one team and the other is still on N,
 * that new series is the live possession. Stale ESPN currentSide / leftover
 * Drive N markets should not keep the previous team "current."
 */
export function bookLiveDrive(game) {
  const highs = bookDriveHighs(game);
  if (highs.home < 1 || highs.away < 1) return null;
  if (highs.home === highs.away) return null;
  const lead = highs.home > highs.away ? 'home' : 'away';
  const n = Math.max(highs.home, highs.away);
  const trailN = Math.min(highs.home, highs.away);
  if (n !== trailN + 1) return null;
  return { lead, n, trailN };
}

/** True when this book market is the drive we are actually pricing. */
export function marketMatchesDriveNumber(game, market, side, extras = {}) {
  const wanted = driveNumberForSide(game, side, { ...extras, market: undefined });
  const got = marketDriveNumber(market);
  if (!Number.isFinite(wanted)) return true;
  if (Number.isFinite(got)) return got === wanted;
  return wanted === 1;
}

export function formatDriveOrdinal(n) {
  const i = Math.round(Number(n));
  if (!Number.isFinite(i) || i < 1) return null;
  const mod100 = i % 100;
  const mod10 = i % 10;
  const suf = mod100 >= 11 && mod100 <= 13
    ? 'th'
    : mod10 === 1 ? 'st'
      : mod10 === 2 ? 'nd'
        : mod10 === 3 ? 'rd'
          : 'th';
  return `${i}${suf}`;
}

/** ESPN chart first; book name is only a fallback when we have no chart. */
export function driveNumberForSide(game, side, extras = {}) {
  const role = extras.role ?? driveCardRole(game, extras.pred);
  if (role === 'first' || !game?.inPlay || game?.live?.state === 'pre') return 1;
  const book = bookLiveDrive(game);
  if (book?.lead && (side === 'home' || side === 'away')) {
    return book.n;
  }
  const chart = game?.live?.driveChart;
  if (chart && (side === 'home' || side === 'away')) {
    const startedRaw = side === 'home' ? chart.homeStarted : chart.awayStarted;
    const completedRaw = side === 'home' ? chart.homeCompleted : chart.awayCompleted;
    let started = Number(startedRaw);
    if (!Number.isFinite(started)) {
      const completed = Number(completedRaw);
      if (!Number.isFinite(completed) || completed < 0) {
        started = NaN;
      } else {
        started = completed + (chart.currentSide === side ? 1 : 0);
      }
    }
    if (Number.isFinite(started) && started >= 0) {
      const up = firstUpSide(game);
      const chartHere = chart.currentSide === side;
      if (up && up !== side) return started + 1;
      if (chartHere) return started || 1;
      return started + 1;
    }
  }
  const fromMarket = marketDriveNumber(extras.market);
  if (Number.isFinite(fromMarket) && fromMarket >= 1) return fromMarket;
  return null;
}

function driveSideShell(game, side) {
  return {
    offenseSide: side,
    offenseName: side === 'away' ? game?.teams?.away : game?.teams?.home,
    marketName: null,
    outcomes: {},
    synthetic: true,
  };
}

function marketSide(market, home, away) {
  return pickNamedSide(market?.marketName || '', home, away)
    || pickNamedSide(market?.offenseName || '', home, away)
    || (market?.offenseSide === 'home' || market?.offenseSide === 'away' ? market.offenseSide : null);
}

function pickMarketForSide(game, side, rows) {
  const wanted = driveNumberForSide(game, side);
  const numbered = rows.filter((market) => Number.isFinite(marketDriveNumber(market)));
  if (Number.isFinite(wanted)) {
    const match = numbered.find((market) => marketDriveNumber(market) === wanted);
    if (match) return match;
    if (wanted === 1) {
      return rows.find((market) => !Number.isFinite(marketDriveNumber(market))) || null;
    }
    return null;
  }
  return rows[0] || null;
}

function pairBothDriveSides(game, books) {
  const home = game?.teams?.home;
  const away = game?.teams?.away;
  const bySide = { away: [], home: [] };
  const untitled = [];
  for (const market of books) {
    const side = marketSide(market, home, away);
    if (side) bySide[side].push(market);
    else untitled.push(market);
  }
  const poss = firstUpSide(game);
  for (const market of untitled) {
    if (poss && !bySide[poss].length) bySide[poss].push(market);
    else if (!bySide.away.length) bySide.away.push(market);
    else if (!bySide.home.length) bySide.home.push(market);
  }
  const stamp = (side) => {
    const row = pickMarketForSide(game, side, bySide[side]);
    if (!row) return driveSideShell(game, side);
    return {
      ...row,
      offenseSide: side,
      offenseName: side === 'away' ? away : home,
    };
  };
  return [stamp('away'), stamp('home')];
}

/** Book markets plus a card for each team. Live: current drive, then next. */
export function listDriveSides(game, opts = {}) {
  const view = applyFdAheadLive(game);
  const books = listDriveMarkets(view, opts);
  if (!shouldShowBothDriveSides(view)) return books;
  const pair = pairBothDriveSides(view, books);
  const poss = firstUpSide(view);
  if (!poss) return pair;
  const current = pair.find((row) => row.offenseSide === poss);
  const next = pair.find((row) => row.offenseSide !== poss);
  return [current, next].filter(Boolean);
}

export function hasDriveLine(game) {
  return listDriveMarkets(game).length > 0;
}

function scoreDiffForOffense(game, side) {
  const home = Number(game?.score?.home);
  const away = Number(game?.score?.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return NaN;
  if (side === 'away') return away - home;
  if (side === 'home') return home - away;
  return NaN;
}

const EMPTY_SO_FAR = {
  so_far_td: 0,
  so_far_fg: 0,
  so_far_punt: 0,
  so_far_other: 0,
};

const MISSING_SO_FAR = {
  so_far_td: NaN,
  so_far_fg: NaN,
  so_far_punt: NaN,
  so_far_other: NaN,
};

/**
 * Game-wide drive index + completed-result counts the drive-start trees
 * were trained on (not FanDuel's per-team "Drive 6").
 */
export function driveStartPriors(game, { nextDrive = false } = {}) {
  const inPlay = Boolean(game?.inPlay) && game?.live?.state !== 'pre';
  if (!inPlay) {
    return { drive_n: 1, ...EMPTY_SO_FAR };
  }
  const chart = game?.live?.driveChart;
  const home = Number(chart?.homeStarted);
  const away = Number(chart?.awayStarted);
  const started = (Number.isFinite(home) ? home : 0) + (Number.isFinite(away) ? away : 0);
  const hasStarted = Number.isFinite(home) || Number.isFinite(away);
  const currentLive = chart?.currentSide === 'home' || chart?.currentSide === 'away';
  const soFar = chart?.soFar;
  const completedKnown = Boolean(
    soFar
    && Number.isFinite(soFar.td)
    && Number.isFinite(soFar.fg)
    && Number.isFinite(soFar.punt)
    && Number.isFinite(soFar.other),
  );

  let driveN = NaN;
  if (hasStarted) {
    driveN = nextDrive || !currentLive ? started + 1 : Math.max(1, started);
  }

  let counts = MISSING_SO_FAR;
  if (completedKnown) {
    counts = {
      so_far_td: soFar.td,
      so_far_fg: soFar.fg,
      so_far_punt: soFar.punt,
      so_far_other: soFar.other,
    };
  } else if (hasStarted) {
    const completed = currentLive ? started - 1 : started;
    if (completed <= 0) counts = { ...EMPTY_SO_FAR };
  }

  return { drive_n: driveN, ...counts };
}

/**
 * Build the feature map the trees expect. `layer` is driveStart | snap.
 */
export function featuresFromGame(game) {
  const view = applyFdAheadLive(game);
  const live = view?.live ?? {};
  const inPlay = Boolean(view?.inPlay) && live.state !== 'pre';
  const clock = normalizeLiveClock(live);
  const period = clock.period;
  const clockSec = clock.clockSec;
  const ytgRaw = Number(live.yardsToEndzone);
  let ytgLive = Number.isFinite(ytgRaw) && ytgRaw >= 1 && ytgRaw <= 99 ? ytgRaw : NaN;
  if (!Number.isFinite(ytgLive)) {
    const fromText = ytgFromSpot(live.possessionText, {
      possession: livePossessionSide(view),
      home: view?.teams?.home,
      away: view?.teams?.away,
    });
    if (Number.isFinite(fromText)) ytgLive = fromText;
  }
  const down = Number(live.down);
  const distance = Number(live.distance);
  const poss = livePossessionSide(view);
  const side = inferOffenseSide(view, view?.nextDrive);
  const firstUp = firstUpSide(view);
  const isWaiting = Boolean(inPlay && firstUp && side && side !== firstUp);
  const hasSnap = Number.isFinite(down) && down > 0
    && Number.isFinite(ytgLive) && ytgLive >= 1 && ytgLive <= 99;
  const pricingCurrentDrive = Boolean(side && firstUp && side === firstUp && hasSnap);
  const canSnap = pricingCurrentDrive
    && inPlay
    && !clock.halfKickoff
    && Number.isFinite(down)
    && down > 0
    && Number.isFinite(ytgLive)
    && ytgLive >= 1
    && ytgLive <= 99;

  const homeSpread = extractHomeSpread(game);
  const ou = extractOverUnder(game);
  const offenseSpread = !side
    ? NaN
    : side === 'away'
      ? (Number.isFinite(homeSpread) ? -homeSpread : NaN)
      : (Number.isFinite(homeSpread) ? homeSpread : NaN);
  const expOff = Number.isFinite(ou) && Number.isFinite(offenseSpread)
    ? (ou - offenseSpread) / 2
    : NaN;
  const expDef = Number.isFinite(ou) && Number.isFinite(offenseSpread)
    ? (ou + offenseSpread) / 2
    : NaN;
  const scoreDiff = scoreDiffForOffense(view, side || 'home');

  if (isWaiting) {
    const sit = {
      down: hasSnap ? down : 1,
      distance: hasSnap && Number.isFinite(distance) ? distance : 10,
      yardsToEndzone: hasSnap ? ytgLive : 75,
      scoreDiff: scoreDiffForOffense(view, firstUp),
      period,
      clockSeconds: Number.isFinite(clockSec) ? clockSec : NaN,
    };
    const nextStart = Number.isFinite(sit.period) && Number.isFinite(sit.clockSeconds)
      ? predictOpponentStart(sit)
      : null;
    const predictedYtg = Number(nextStart?.expectedYtg);
    const predictedClock = nextStart?.expectedClock;
    const ytg = Number.isFinite(predictedYtg) ? predictedYtg : 75;
    const startPeriod = Number.isFinite(predictedClock?.period) ? predictedClock.period : period;
    const startClock = Number.isFinite(predictedClock?.clockSec) ? predictedClock.clockSec : clockSec;
    const secLeft = Number.isFinite(startPeriod) && Number.isFinite(startClock)
      ? secondsLeftInGame(startPeriod, startClock)
      : NaN;
    return {
      layer: 'driveStart',
      assumed: !Number.isFinite(predictedYtg),
      predictedStart: Number.isFinite(predictedYtg),
      afterPriorDrive: true,
      priorSide: firstUp,
      side,
      features: {
        ytg,
        sec_left: secLeft,
        clock_sec: startClock,
        period: startPeriod,
        score_diff: Number.isFinite(scoreDiff) ? scoreDiff : 0,
        offense_spread: offenseSpread,
        over_under: ou,
        exp_off: expOff,
        exp_def: expDef,
        ...driveStartPriors(view, { nextDrive: true }),
        is_home: side === 'away' ? 0 : side === 'home' ? 1 : NaN,
        fp_code: fpCode(ytg),
        half_code: halfCode(startPeriod),
      },
    };
  }

  if (inPlay && firstUp && side === firstUp && !canSnap) {
    const ytg = Number.isFinite(ytgLive) ? ytgLive : 75;
    const startPeriod = Number.isFinite(period) ? period : 1;
    const startClock = Number.isFinite(clockSec) ? clockSec : (clock.halfKickoff ? 900 : NaN);
    const secLeft = Number.isFinite(startPeriod) && Number.isFinite(startClock)
      ? secondsLeftInGame(startPeriod, startClock)
      : NaN;
    return {
      layer: 'driveStart',
      assumed: false,
      predictedStart: false,
      afterPriorDrive: false,
      firstUp: true,
      side,
      features: {
        ytg,
        sec_left: secLeft,
        clock_sec: startClock,
        period: startPeriod,
        score_diff: Number.isFinite(scoreDiff) ? scoreDiff : 0,
        offense_spread: offenseSpread,
        over_under: ou,
        exp_off: expOff,
        exp_def: expDef,
        ...driveStartPriors(view, { nextDrive: false }),
        is_home: side === 'away' ? 0 : side === 'home' ? 1 : NaN,
        fp_code: fpCode(ytg),
        half_code: halfCode(startPeriod),
      },
    };
  }

  if (canSnap) {
    const secLeft = secondsLeftInGame(period, clockSec);
    return {
      layer: 'snap',
      assumed: false,
      firstUp: true,
      side,
      features: {
        down,
        distance: Number.isFinite(distance) ? distance : 10,
        ytg: ytgLive,
        sec_left: secLeft,
        clock_sec: clockSec,
        period: Number.isFinite(period) ? period : NaN,
        score_diff: scoreDiff,
        offense_spread: offenseSpread,
        over_under: ou,
        exp_off: expOff,
        exp_def: expDef,
        fp_code: fpCode(ytgLive),
        dist_code: distCode(Number.isFinite(distance) ? distance : 10),
        half_code: halfCode(period),
        time_code: timeCode(secondsLeftInHalf(period, clockSec)),
      },
    };
  }

  const nextStart = inPlay
    && !clock.halfKickoff
    && !pricingCurrentDrive
    && Number.isFinite(down)
    && down > 0
    && Number.isFinite(ytgLive)
    && ytgLive >= 1
    && ytgLive <= 99
    ? predictOpponentStart({
      down,
      distance: Number.isFinite(distance) ? distance : 10,
      yardsToEndzone: ytgLive,
      scoreDiff: scoreDiffForOffense(view, poss),
      period,
      clockSeconds: clockSec,
    })
    : null;
  const predictedYtg = Number(nextStart?.expectedYtg);
  const predictedClock = nextStart?.expectedClock;
  const assumedKickoff = !inPlay || clock.halfKickoff || (!Number.isFinite(predictedYtg) && !Number.isFinite(ytgLive));
  const ytg = Number.isFinite(predictedYtg) ? predictedYtg : (assumedKickoff ? 75 : ytgLive);
  const startPeriod = !inPlay
    ? 1
    : (Number.isFinite(predictedClock?.period) ? predictedClock.period : (Number.isFinite(period) ? period : 1));
  const startClock = !inPlay
    ? 900
    : (Number.isFinite(predictedClock?.clockSec) ? predictedClock.clockSec : clockSec);
  const secLeft = !inPlay
    ? 3600
    : (Number.isFinite(startPeriod) && Number.isFinite(startClock)
      ? secondsLeftInGame(startPeriod, startClock)
      : NaN);
  return {
    layer: 'driveStart',
    assumed: assumedKickoff && !Number.isFinite(predictedYtg),
    predictedStart: Boolean(Number.isFinite(predictedYtg)),
    side,
    features: {
      ytg,
      sec_left: secLeft,
      clock_sec: startClock,
      period: startPeriod,
      score_diff: Number.isFinite(scoreDiff) ? scoreDiff : 0,
      offense_spread: offenseSpread,
      over_under: ou,
      exp_off: expOff,
      exp_def: expDef,
      ...driveStartPriors(view, { nextDrive: Boolean(inPlay && !pricingCurrentDrive) }),
      is_home: side === 'away' ? 0 : side === 'home' ? 1 : NaN,
      fp_code: fpCode(ytg),
      half_code: halfCode(startPeriod),
    },
  };
}

export function predictDriveResult(game) {
  const built = featuresFromGame(game);
  const scored = scoreLgbmLayer(built.layer, built.features);
  if (!scored) return null;
  return {
    ...built,
    p: scored.p,
    model: {
      ...LGBM_MODEL_META,
      layer: built.layer,
      layerLabel: built.layer === 'snap'
        ? 'Live snap'
        : (built.afterPriorDrive
          ? 'After current possession'
          : (built.predictedStart ? 'Next drive start' : 'Drive start')),
    },
  };
}

export function evaluateDriveGame(game, {
  kellyEnabled = false,
  kellyBudget = 0,
  kellyFraction = 1,
  market = null,
} = {}) {
  const nextDrive = market ?? game?.nextDrive ?? null;
  const base = applyFdAheadLive(game);
  const view = nextDrive && nextDrive !== base.nextDrive
    ? { ...base, nextDrive }
    : base;
  const pred = predictDriveResult(view);
  const offense = resolveOffenseTeam(view, nextDrive);
  const outcomes = marketMatchesDriveNumber(view, nextDrive, offense.side, { pred })
    ? (nextDrive?.outcomes ?? {})
    : {};
  const kind = spotLagKind(view);
  const situationLag = Boolean(view?.inPlay && kind && (
    pred?.layer === 'snap' || pred?.afterPriorDrive || pred?.firstUp
  ));
  const rows = DRIVE_BUCKETS.map((bucket) => {
    const modelP = pred?.p?.[bucket.key];
    const p = Number.isFinite(modelP) ? modelP : bucket.p;
    const fairAmerican = probToAmerican(p);
    const quote = outcomes[bucket.key] ?? null;
    const source = nextDrive?.source;
    const fdAmerican = Number.isFinite(quote?.fd?.american) && quote.fd.american !== 0
      ? quote.fd.american
      : (source !== 'dk' && Number.isFinite(quote?.american) && quote.american !== 0 ? quote.american : null);
    const dkAmerican = Number.isFinite(quote?.dk?.american) && quote.dk.american !== 0
      ? quote.dk.american
      : (source === 'dk' && Number.isFinite(quote?.american) && quote.american !== 0 ? quote.american : null);
    const american = fdAmerican ?? dkAmerican
      ?? (Number.isFinite(quote?.american) && quote.american !== 0 ? quote.american : null);
    const fdAnalysis = analyzeAgainstBreakeven(fdAmerican, fairAmerican);
    const dkAnalysis = analyzeAgainstBreakeven(dkAmerican, fairAmerican);
    const analysis = (dkAnalysis?.edgePoints ?? -Infinity) > (fdAnalysis?.edgePoints ?? -Infinity)
      ? dkAnalysis
      : fdAnalysis;
    const offeredForKelly = (analysis === dkAnalysis ? dkAmerican : fdAmerican) ?? american;
    const profitable = Boolean(analysis?.profitable && offeredForKelly != null);
    const kellyStake = kellyEnabled && profitable
      ? computeKellyStake({
        winProb: p,
        offeredAmerican: offeredForKelly,
        bankroll: kellyBudget,
        kellyFraction,
      })
      : null;
    return {
      key: bucket.key,
      label: bucket.label,
      n: bucket.n,
      rawP: bucket.p,
      p,
      fairAmerican,
      rawFairAmerican: bucket.fairAmerican,
      american,
      fdAmerican,
      dkAmerican,
      dualBooks: fdAmerican != null && dkAmerican != null,
      runnerName: quote?.runnerName ?? null,
      legs: Array.isArray(quote?.legs) ? quote.legs : null,
      analysis,
      fdAnalysis,
      dkAnalysis,
      profitable,
      edgePoints: analysis?.edgePoints ?? null,
      kellyStake,
      styleWarning: null,
    };
  });

  const puntWarn = puntStyleWarningForOffense(offense.name);
  if (puntWarn) {
    const puntRow = rows.find((row) => row.key === 'punt');
    if (puntRow?.profitable) puntRow.styleWarning = puntWarn;
  }

  const implied = rows.map((row) => americanToImpliedProb(row.american));
  const vigSum = implied.every((p) => Number.isFinite(p))
    ? implied.reduce((a, b) => a + b, 0)
    : null;
  if (Number.isFinite(vigSum) && vigSum > 0) {
    rows.forEach((row, i) => {
      row.marketP = implied[i] / vigSum;
      row.modelVsMarket = row.p - row.marketP;
    });
  }

  return {
    model: pred?.model ?? RAW_MODEL_META,
    pred,
    rows,
    evCount: rows.filter((row) => row.profitable).length,
    hasBook: rows.some((row) => row.american != null),
    vigPct: Number.isFinite(vigSum) ? (vigSum - 1) * 100 : null,
    marketName: nextDrive?.marketName ?? null,
    market: nextDrive,
    offenseName: offense.name,
    offenseSide: offense.side,
    driveNumber: driveNumberForSide(view, offense.side, { pred }),
    situationLag,
    situationLagKind: situationLag ? kind : null,
    situationLagDetail: situationLag ? describeSpotLag(view) : null,
  };
}

export { formatAmericanOdds };
