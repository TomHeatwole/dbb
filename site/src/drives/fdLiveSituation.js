/**
 * FanDuel live clock / down-and-distance: parse the event-page XML, map
 * Neon columns onto a snapshot, and decide when that snapshot is ahead of ESPN.
 */

import { ytgFromSpot } from './ytgFromSpot.js';
import { isMadeScoreLabel } from './espnDriveChart.js';

function decodeXml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#10;/g, ' ')
    .replace(/[\u00a0\u202f\u2007]/g, ' ');
}

function xmlTexts(xml) {
  const out = [];
  const re = /(?:content-desc|text)="([^"]*)"/g;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    const t = decodeXml(m[1]).replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  }
  return out;
}

function intOrNull(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function ytgOrNull(raw) {
  const n = intOrNull(raw);
  if (n == null || n < 1 || n > 99) return null;
  return n;
}

const DOWN_RE = /(\d)(?:st|nd|rd|th)\s*(?:&|and)\s*(\d{1,2})/i;
const MINUTES_LEFT_RE = /(\d+)\s+minutes?\s+remaining/i;
const QUARTER_RE = /\b(?:QUARTER|Q)\s*([1-4])\b|\b([1-4])(?:st|nd|rd|th)\s+quarter\b/i;
const OT_RE = /\b(?:OT|OVERTIME)\b/i;
const HALF_RE = /\bHALFTIME\b/i;
const LIVE_SCORE_RE = /(?:Live|In[- ]play)\s+game\s+(.+?)\s+(\d+)\s+(.+?)\s+(\d+)\s+(?:QUARTER|Q[1-4]|HALF(?:TIME)?|OT|OVERTIME)\b/i;
const AT_SPOT_RE = /\b(?:at|on)\s+(?:the\s+)?([A-Za-z.'][A-Za-z.' ]*?)\s+(\d{1,2})\b/i;
const BALL_ON_RE = /\bball on\s+(?:the\s+)?([A-Za-z.'][A-Za-z.' ]*?)\s+(\d{1,2})\b/i;
const BARE_SPOT_RE = /^([A-Za-z.][A-Za-z.' ]{0,28}?)\s+(\d{1,2})$/;
const SPOT_NOISE = /drive|quarter|result|touchdown|field goal|punt|odds|live game|in-?play|timeout|minutes? remaining/i;
const HAS_BALL_RE = /^(.+?)\s+(?:has (?:the )?ball|possession|on offense)$/i;
const ARROW_LEFT_RE = /arrow(?:\s+pointing)?\s+left|pointing left|possession(?:_| )?(?:away|left)|ic_possession_left|[◀◄←◂]/i;
const ARROW_RIGHT_RE = /arrow(?:\s+pointing)?\s+right|pointing right|possession(?:_| )?(?:home|right)|ic_possession_right|[▶►→▸]/i;
const ARROW_TEAM_RE = /^(?:[◀◄←]\s*)(.+?)(?:\s+[▶►→])?$|^(.+?)\s+[▶►→]$/;

function parseClockToken(text, { allowLoose = false } = {}) {
  const raw = String(text || '');
  const mmss = raw.match(/\b(\d{1,2})\s*:\s*(\d{2})\b/);
  if (mmss) {
    const min = Number(mmss[1]);
    const sec = Number(mmss[2]);
    if (min > 15 || sec > 59) return null;
    const trimmed = raw.trim();
    const tight = trimmed.length <= 8
      || QUARTER_RE.test(trimmed)
      || DOWN_RE.test(trimmed)
      || /remaining|left|clock|qtr|quarter/i.test(trimmed);
    if (!tight && !allowLoose) return null;
    return {
      clockSeconds: min * 60 + sec,
      clock: `${min}:${String(sec).padStart(2, '0')}`,
      clockApproximate: false,
    };
  }
  const mins = raw.match(MINUTES_LEFT_RE);
  if (mins) {
    const min = Number(mins[1]);
    return {
      clockSeconds: min * 60,
      clock: `${min}:00`,
      clockApproximate: true,
    };
  }
  return null;
}

function parsePeriodToken(text) {
  const t = String(text || '');
  if (HALF_RE.test(t)) {
    return { period: 2, halfTime: true, clockSeconds: 0, clock: 'Halftime' };
  }
  if (OT_RE.test(t) && !QUARTER_RE.test(t) && !/\b[1-4]Q\b/i.test(t)) {
    return { period: 5 };
  }
  const q = t.match(QUARTER_RE)
    || t.match(/\b([1-4])Q\b/i)
    || t.match(/\bQTR\s*([1-4])\b/i)
    || t.match(/\bQuarter\s+([1-4])\b/i);
  if (q) return { period: Number(q[1] || q[2]) };
  return null;
}

function parseSpotToken(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || SPOT_NOISE.test(t)) return null;
  const ball = t.match(BALL_ON_RE);
  if (ball) return `${ball[1].trim()} ${ball[2]}`;
  const at = t.match(AT_SPOT_RE);
  if (at) return `${at[1].trim()} ${at[2]}`;
  const bare = t.match(BARE_SPOT_RE);
  if (!bare) return null;
  const yl = Number(bare[2]);
  if (!Number.isFinite(yl) || yl < 0 || yl > 50) return null;
  const name = bare[1].trim();
  if (name.length < 2 || /^(q|ot|down)$/i.test(name)) return null;
  return `${name} ${yl}`;
}

function parsePossessionToken(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (ARROW_LEFT_RE.test(t) && !ARROW_TEAM_RE.test(t)) return { possessionArrow: 'left' };
  if (ARROW_RIGHT_RE.test(t) && !ARROW_TEAM_RE.test(t)) return { possessionArrow: 'right' };
  const named = t.match(HAS_BALL_RE);
  if (named) return { possessionName: named[1].trim() };
  const arrowTeam = t.match(ARROW_TEAM_RE);
  if (arrowTeam) {
    const name = (arrowTeam[1] || arrowTeam[2] || '').trim();
    if (name && !SPOT_NOISE.test(name) && !/^\d+$/.test(name)) {
      return { possessionName: name };
    }
  }
  return null;
}

export function resolveFdPossessionSide(sit, teams = {}) {
  if (!sit) return null;
  if (sit.possession === 'home' || sit.possession === 'away') return sit.possession;
  if (sit.possessionSide === 'home' || sit.possessionSide === 'away') return sit.possessionSide;
  const name = String(sit.possessionName || '').trim();
  if (name) {
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const n = norm(name);
    const home = norm(teams.home);
    const away = norm(teams.away);
    if (n && n === home && n !== away) return 'home';
    if (n && n === away && n !== home) return 'away';
    const homeHit = home && (n.includes(home) || home.includes(n));
    const awayHit = away && (n.includes(away) || away.includes(n));
    if (homeHit && !awayHit) return 'home';
    if (awayHit && !homeHit) return 'away';
    if (homeHit && awayHit) return home.length >= away.length ? 'home' : 'away';
  }
  if (sit.possessionArrow === 'left') return 'away';
  if (sit.possessionArrow === 'right') return 'home';
  return null;
}

function parseDownToken(text) {
  const t = String(text || '');
  const m = t.match(DOWN_RE);
  if (m) {
    const down = Number(m[1]);
    const distance = Number(m[2]);
    if (down >= 1 && down <= 4 && distance >= 0 && distance <= 99) {
      return { down, distance };
    }
  }
  const alt = t.match(/\bdown\s*(\d)\b[\s,]*distance\s*(\d{1,2})\b/i);
  if (alt) {
    const down = Number(alt[1]);
    const distance = Number(alt[2]);
    if (down >= 1 && down <= 4 && distance >= 0 && distance <= 99) {
      return { down, distance };
    }
  }
  return null;
}

function formatClock(seconds, fallback) {
  if (fallback) return fallback;
  const sec = Number(seconds);
  if (!Number.isFinite(sec) || sec < 0) return null;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function downDistanceLabel(down, distance) {
  const d = Number(down);
  const ytg = Number(distance);
  if (!Number.isFinite(d) || d < 1) return null;
  const ord = d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
  if (!Number.isFinite(ytg)) return `${d}${ord} down`;
  return `${d}${ord} & ${ytg}`;
}

export function formatDownAndDistance(down, distance) {
  return downDistanceLabel(down, distance);
}

function periodClockLabel(sit) {
  if (!sit) return null;
  if (sit.halfTime || sit.clock === 'Halftime') return 'Halftime';
  const p = Number(sit.period);
  const period = Number.isFinite(p) && p > 0
    ? (p > 4 ? (p === 5 ? 'OT' : `OT${p - 4}`) : `Q${p}`)
    : null;
  const clock = sit.clock && sit.clock !== '0:00' && !/halftime/i.test(sit.clock)
    ? sit.clock
    : formatClock(sit.clockSeconds);
  if (period && clock) return `${period} ${clock}`;
  return period || clock || null;
}

function isGoalToGo(sit) {
  if (!sit) return false;
  if (/goal/i.test(String(sit.downDistance || ''))) return true;
  const dist = Number(sit.distance);
  const ytg = Number(sit.yardsToEndzone);
  if (!Number.isFinite(ytg) || ytg < 1 || ytg > 10) return false;
  if (!Number.isFinite(dist)) return ytg <= 10;
  return dist >= ytg;
}

function downOrdinal(down) {
  const d = Number(down);
  if (!Number.isFinite(d) || d < 1) return null;
  const ord = d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
  return `${d}${ord}`;
}

/** Spoken down/distance for lag compare: "4th and Goal", "1st and 10". */
export function formatDownAndDistanceSpoken(sit) {
  if (!sit) return null;
  const ord = downOrdinal(sit.down);
  if (isGoalToGo(sit)) return ord ? `${ord} and Goal` : 'Goal';
  const posted = String(sit.downDistance || '').replace(/\s+/g, ' ').trim();
  if (posted) {
    return posted
      .replace(/\s*&\s*/g, ' and ')
      .replace(/\band\s+goal\b/i, 'and Goal');
  }
  if (!ord) return null;
  const dist = Number(sit.distance);
  if (!Number.isFinite(dist)) return `${ord} down`;
  return `${ord} and ${dist}`;
}

function formatYardline(sit) {
  if (!sit) return null;
  const raw = String(sit.possessionText || '').replace(/^\s*at\s+/i, '').trim();
  if (raw) return `at ${raw}`;
  const ytg = Number(sit.yardsToEndzone);
  if (!Number.isFinite(ytg) || ytg < 1 || ytg > 99) return null;
  if (ytg === 50) return 'midfield';
  if (ytg > 50) return `at own ${100 - ytg}`;
  return `at opp ${ytg}`;
}

/**
 * Full live spot for ESPN vs FanDuel lag copy:
 * "Q3 2:08  4th and Goal  at SMU 9"
 */
export function formatLiveSituationLine(sit) {
  if (!sit || typeof sit !== 'object') return '';
  const bits = [
    periodClockLabel(sit),
    formatDownAndDistanceSpoken(sit),
    formatYardline(sit),
  ].filter(Boolean);
  return bits.join('  ');
}

function clockSecondsOf(sit) {
  const sec = intOrNull(sit?.clockSeconds);
  if (sec != null && sec >= 0) return sec;
  const clock = String(sit?.clock || '').trim();
  const m = clock.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * ESPN's clock has run further than FanDuel's (less time left, or a later quarter).
 * Missing FanDuel period/clock is not "ahead."
 */
export function espnClockAheadOfFd(espn, fd) {
  if (!espn || !fd) return false;
  const ePeriod = intOrNull(espn.period);
  const fPeriod = intOrNull(fd.period);
  if (ePeriod != null && fPeriod != null && ePeriod > fPeriod) return true;
  if (ePeriod != null && fPeriod != null && ePeriod < fPeriod) return false;
  const eClock = clockSecondsOf(espn);
  const fClock = clockSecondsOf(fd);
  if (eClock == null || fClock == null) return false;
  return eClock + 2 < fClock;
}

function spotToken(sit) {
  return String(sit?.possessionText || '').replace(/^\s*at\s+/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * True only when both sources posted a field and those values conflict.
 * Missing quarter / yardline on FanDuel is not a discrepancy. Hidden
 * yards-to-endzone on FanDuel is ignored — it is often leftover from an
 * earlier snap and is not shown in the compare line.
 */
export function liveSpotsDisagree(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;

  const aHalf = Boolean(a.halfTime || a.clock === 'Halftime');
  const bHalf = Boolean(b.halfTime || b.clock === 'Halftime');
  if (aHalf !== bHalf) return true;

  const aPeriod = intOrNull(a.period);
  const bPeriod = intOrNull(b.period);
  if (aPeriod != null && bPeriod != null && aPeriod !== bPeriod) return true;

  const aClock = clockSecondsOf(a);
  const bClock = clockSecondsOf(b);
  if (aClock != null && bClock != null && Math.abs(aClock - bClock) > 8) return true;

  const aDown = intOrNull(a.down);
  const bDown = intOrNull(b.down);
  if (aDown != null && bDown != null && aDown !== bDown) return true;

  if (!(isGoalToGo(a) && isGoalToGo(b))) {
    const aDist = intOrNull(a.distance);
    const bDist = intOrNull(b.distance);
    if (aDist != null && bDist != null && aDist !== bDist) return true;
  }

  const aSpot = spotToken(a);
  const bSpot = spotToken(b);
  if (aSpot && bSpot && aSpot !== bSpot) return true;

  return false;
}

/** Posted clock / down / distance agree. FanDuel omitting yardline still counts as a match. */
export function liveSnapsAgree(a, b) {
  if (!a || !b) return false;
  const aDown = intOrNull(a.down);
  const bDown = intOrNull(b.down);
  const aClock = clockSecondsOf(a);
  const bClock = clockSecondsOf(b);
  if (aDown == null || bDown == null) return false;
  if (aClock == null || bClock == null) return false;
  return !liveSpotsDisagree(a, b);
}

export function formatFdLiveSpot(sit) {
  if (!sit) return '';
  if (sit.halfTime || sit.clock === 'Halftime') return 'Halftime';
  const period = Number.isFinite(Number(sit.period))
    ? (Number(sit.period) > 4 ? 'OT' : `Q${sit.period}`)
    : null;
  const clock = sit.clock && sit.clock !== '0:00'
    ? sit.clock
    : formatClock(sit.clockSeconds);
  const down = sit.downDistance || downDistanceLabel(sit.down, sit.distance);
  return [period, clock, down].filter(Boolean).join(' · ');
}

export function parseFdLiveSituation(xml) {
  const texts = xmlTexts(xml);
  const blob = texts.join(' | ');
  const out = {};

  const liveScore = blob.match(LIVE_SCORE_RE);
  if (liveScore) {
    out.awayScore = intOrNull(liveScore[2]);
    out.homeScore = intOrNull(liveScore[4]);
  }

  for (const text of texts) {
    const period = parsePeriodToken(text);
    if (period) {
      if (out.period == null) out.period = period.period;
      if (period.halfTime) {
        out.halfTime = true;
        if (out.clockSeconds == null) out.clockSeconds = 0;
        if (!out.clock) out.clock = 'Halftime';
      }
    }
    const down = parseDownToken(text);
    if (down && out.down == null) {
      out.down = down.down;
      out.distance = down.distance;
      out.downDistance = downDistanceLabel(down.down, down.distance);
    }
    const spot = parseSpotToken(text);
    if (spot && !out.possessionText) {
      out.possessionText = spot;
    }
    const poss = parsePossessionToken(text);
    if (poss) {
      if (poss.possessionName && !out.possessionName) out.possessionName = poss.possessionName;
      if (poss.possessionArrow && !out.possessionArrow) out.possessionArrow = poss.possessionArrow;
    }
  }

  const allowLooseClock = out.down != null || out.period != null;
  for (const text of texts) {
    const clock = parseClockToken(text, { allowLoose: allowLooseClock });
    if (clock && (out.clockSeconds == null || (out.clockApproximate && !clock.clockApproximate))) {
      out.clockSeconds = clock.clockSeconds;
      out.clock = clock.clock;
      out.clockApproximate = clock.clockApproximate;
    }
  }

  if (!out.clock && out.clockSeconds != null) {
    out.clock = formatClock(out.clockSeconds);
  }
  const situationText = formatFdLiveSpot(out);
  if (situationText) out.situationText = situationText;
  const possessionSide = resolveFdPossessionSide(out);
  if (possessionSide) out.possession = possessionSide;

  if (
    out.period == null
    && out.clockSeconds == null
    && out.down == null
    && !out.halfTime
  ) {
    return null;
  }
  return out;
}

export function fdLiveFromRows(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((row) => (
    row
    && (row.period != null || row.clock_seconds != null || row.down != null || row.clock_text)
  ));
  if (!list.length) return null;
  list.sort((a, b) => {
    const ta = a.fetched_at ? new Date(a.fetched_at).getTime() : 0;
    const tb = b.fetched_at ? new Date(b.fetched_at).getTime() : 0;
    return tb - ta;
  });
  const row = list[0];
  const down = intOrNull(row.down);
  const distance = intOrNull(row.distance);
  const clockSeconds = intOrNull(row.clock_seconds);
  const period = intOrNull(row.period);
  const halfTime = String(row.clock_text || '').toLowerCase() === 'halftime';
  return {
    period,
    clockSeconds,
    clock: row.clock_text || formatClock(clockSeconds),
    clockApproximate: false,
    down,
    distance,
    downDistance: downDistanceLabel(down, distance),
    yardsToEndzone: ytgOrNull(row.yards_to_endzone),
    possessionText: row.possession_text || null,
    possessionName: row.possession_name || null,
    possessionArrow: row.possession_arrow || null,
    possession: row.possession_side === 'home' || row.possession_side === 'away'
      ? row.possession_side
      : null,
    homeScore: intOrNull(row.home_score),
    awayScore: intOrNull(row.away_score),
    situationText: row.situation_text || formatFdLiveSpot({
      period, clock: row.clock_text, clockSeconds, down, distance, halfTime,
    }),
    halfTime,
    fetchedAt: row.fetched_at ? new Date(row.fetched_at).toISOString() : null,
  };
}

export function situationKey(sit) {
  if (!sit) return '';
  return [
    sit.period ?? '',
    sit.clockSeconds ?? '',
    sit.down ?? '',
    sit.distance ?? '',
    sit.yardsToEndzone ?? '',
  ].join('|');
}

function espnSitFrom(espn) {
  if (!espn) return null;
  const homeScore = espn.homeScore ?? espn.score?.home;
  const awayScore = espn.awayScore ?? espn.score?.away;
  return {
    period: intOrNull(espn.period),
    clockSeconds: intOrNull(espn.clockSeconds),
    clock: espn.clock || null,
    down: intOrNull(espn.down),
    distance: intOrNull(espn.distance),
    yardsToEndzone: intOrNull(espn.yardsToEndzone),
    homeScore: intOrNull(homeScore),
    awayScore: intOrNull(awayScore),
    halfTime: Boolean(espn.halfTime || espn.state === 'halftime'),
    state: espn.state || null,
  };
}

function hasAnySpot(sit) {
  return Boolean(
    sit
    && (
      sit.period != null
      || sit.clockSeconds != null
      || sit.down != null
      || sit.halfTime
      || (sit.homeScore != null && sit.awayScore != null)
    ),
  );
}

/**
 * True when FanDuel's posted situation is further into the play than ESPN.
 * Missing fields are ignored. Clock slack is wider for "N minutes remaining".
 */
export function fdStateAheadOfEspn(fdRaw, espnRaw) {
  const fd = fdRaw && typeof fdRaw === 'object' ? fdRaw : null;
  const espn = espnSitFrom(espnRaw);
  if (!hasAnySpot(fd) || !espn) return false;

  const fdPts = (Number.isFinite(fd.homeScore) ? fd.homeScore : 0)
    + (Number.isFinite(fd.awayScore) ? fd.awayScore : 0);
  const espnPts = (Number.isFinite(espn.homeScore) ? espn.homeScore : 0)
    + (Number.isFinite(espn.awayScore) ? espn.awayScore : 0);
  if (
    Number.isFinite(fd.homeScore)
    && Number.isFinite(fd.awayScore)
    && Number.isFinite(espn.homeScore)
    && Number.isFinite(espn.awayScore)
    && fdPts > espnPts
  ) {
    return true;
  }

  if (fd.halfTime && !espn.halfTime && Number(espn.period) === 2) return true;

  const fdPeriod = intOrNull(fd.period);
  const espnPeriod = intOrNull(espn.period);
  if (fdPeriod != null && espnPeriod != null && fdPeriod > espnPeriod) return true;
  if (espnClockAheadOfFd(espn, fd)) return false;

  const slack = fd.clockApproximate ? 45 : 12;
  const fdClock = intOrNull(fd.clockSeconds);
  const espnClock = intOrNull(espn.clockSeconds);
  const samePeriod = (
    (fdPeriod != null && espnPeriod != null && fdPeriod === espnPeriod)
    || (fdPeriod == null || espnPeriod == null)
  );
  if (
    samePeriod
    && fdClock != null
    && espnClock != null
    && fdClock + slack < espnClock
  ) {
    return true;
  }

  const clocksClose = fdClock == null || espnClock == null
    || Math.abs(fdClock - espnClock) <= Math.max(slack, 20);

  if (samePeriod && clocksClose) {
    const fdDown = intOrNull(fd.down);
    const espnDown = intOrNull(espn.down);
    if (fdDown != null && espnDown != null && fdDown !== espnDown) return true;

    if (
      fdDown != null
      && espnDown != null
      && fdDown === espnDown
      && intOrNull(fd.distance) != null
      && intOrNull(espn.distance) != null
      && fd.distance <= espn.distance - 3
    ) {
      return true;
    }

    const fdYtg = intOrNull(fd.yardsToEndzone);
    const espnYtg = intOrNull(espn.yardsToEndzone);
    if (
      fdYtg != null
      && espnYtg != null
      && fdYtg <= espnYtg - 5
    ) {
      return true;
    }
  }

  if (
    (espnPeriod == null && espnClock == null && espn.down == null && !espn.halfTime)
    && (fdPeriod != null || fd.down != null || fd.halfTime)
  ) {
    return true;
  }

  return false;
}

const SERIES_OVER_PLAY = /punt|interception|intercepted|fumble|safety|turnover on downs|downs turnover|field goal missed|missed field goal|blocked/i;

function lastPlayEndedSeries(type, text) {
  if (isMadeScoreLabel(type) || isMadeScoreLabel(text)) return true;
  return SERIES_OVER_PLAY.test(type) || SERIES_OVER_PLAY.test(text);
}

function finiteYtg(raw) {
  const y = Number(raw);
  return Number.isFinite(y) && y >= 1 && y <= 99 ? y : NaN;
}

/**
 * When FanDuel's live header is ahead of ESPN, copy that snap onto `live`
 * so the model and labels use FD instead of a stale ESPN spot.
 */
export function applyFdAheadLive(game) {
  if (!game?.inPlay || game.live?.spotSource === 'fd') return game;
  const espn = game.live ?? {};
  const fd = espn.fd || game.fdLive;
  if (!fd || typeof fd !== 'object') return game;
  if (!fdStateAheadOfEspn(fd, espn)) return game;

  const live = { ...espn, fd };
  const fdDown = Number(fd.down);
  const espnDown = Number(espn.down);
  const downChanged = Number.isFinite(fdDown) && fdDown >= 1
    && Number.isFinite(espnDown) && espnDown >= 1
    && fdDown !== espnDown;

  if (Number.isFinite(Number(fd.period)) && Number(fd.period) > 0) live.period = Number(fd.period);
  const fdClock = Number(fd.clockSeconds);
  if (Number.isFinite(fdClock) && fdClock >= 0) {
    live.clockSeconds = fdClock;
    if (fd.clock) live.clock = fd.clock;
  } else if (fd.clock) {
    live.clock = fd.clock;
  }
  if (Number.isFinite(fdDown) && fdDown >= 1) {
    live.down = fdDown;
    if (Number.isFinite(Number(fd.distance))) live.distance = Number(fd.distance);
    live.downDistance = fd.downDistance || downDistanceLabel(fdDown, live.distance);
  }
  if (fd.halfTime) {
    live.halfTime = true;
    live.state = 'halftime';
  }

  let possession = resolveFdPossessionSide(fd, game.teams)
    || (fd.possession === 'home' || fd.possession === 'away' ? fd.possession : null);
  if (!possession) {
    const playSide = espn.lastPlaySide;
    if (
      (playSide === 'home' || playSide === 'away')
      && !lastPlayEndedSeries(espn.lastPlayType, espn.lastPlay)
    ) {
      possession = playSide;
    }
  }
  if (possession) {
    live.possession = possession;
    live.possessionName = possession === 'away'
      ? (game.teams?.away ?? fd.possessionName ?? live.possessionName)
      : (game.teams?.home ?? fd.possessionName ?? live.possessionName);
  } else if (fd.possessionName) {
    live.possessionName = fd.possessionName;
  }

  let ytg = finiteYtg(fd.yardsToEndzone);
  if (!Number.isFinite(ytg) && fd.possessionText) {
    ytg = finiteYtg(ytgFromSpot(fd.possessionText, {
      possession: live.possession,
      home: game.teams?.home,
      away: game.teams?.away,
    }));
  }
  if (Number.isFinite(ytg)) live.yardsToEndzone = ytg;
  else if (downChanged) live.yardsToEndzone = null;
  if (fd.possessionText) live.possessionText = fd.possessionText;
  else if (downChanged) live.possessionText = null;

  const hs = Number(fd.homeScore);
  const as = Number(fd.awayScore);
  if (Number.isFinite(hs) && Number.isFinite(as) && hs + as > 0) {
    live.homeScore = hs;
    live.awayScore = as;
  }

  live.spotSource = 'fd';
  live.fdAheadOfEspn = true;
  return { ...game, live };
}

export function fdLiveToDbRow(sit, teams = {}) {
  if (!sit) return {};
  const possessionSide = resolveFdPossessionSide(sit, teams);
  return {
    period: sit.period ?? null,
    clock_seconds: sit.clockSeconds ?? null,
    clock_text: sit.clock ?? null,
    down: sit.down ?? null,
    distance: sit.distance ?? null,
    yards_to_endzone: ytgOrNull(sit.yardsToEndzone),
    possession_text: sit.possessionText ?? null,
    possession_side: possessionSide,
    home_score: sit.homeScore ?? null,
    away_score: sit.awayScore ?? null,
    situation_text: sit.situationText || formatFdLiveSpot(sit) || null,
  };
}
