/**
 * FanDuel live clock / down-and-distance: parse the event-page XML, map
 * Neon columns onto a snapshot, and decide when that snapshot is ahead of ESPN.
 */

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

const DOWN_RE = /(\d)(?:st|nd|rd|th)\s*(?:&|and)\s*(\d{1,2})/i;
const MINUTES_LEFT_RE = /(\d+)\s+minutes?\s+remaining/i;
const QUARTER_RE = /\b(?:QUARTER|Q)\s*([1-4])\b|\b([1-4])(?:st|nd|rd|th)\s+quarter\b/i;
const OT_RE = /\b(?:OT|OVERTIME)\b/i;
const HALF_RE = /\bHALFTIME\b/i;
const LIVE_SCORE_RE = /(?:Live|In[- ]play)\s+game\s+(.+?)\s+(\d+)\s+(.+?)\s+(\d+)\s+(?:QUARTER|Q[1-4]|HALF(?:TIME)?|OT|OVERTIME)\b/i;
const AT_SPOT_RE = /\b(?:at|on)\s+(?:the\s+)?([A-Za-z.'][A-Za-z.' ]*?)\s+(\d{1,2})\b/i;

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
    const spot = text.match(AT_SPOT_RE);
    if (spot && !out.possessionText) {
      out.possessionText = `${spot[1].trim()} ${spot[2]}`;
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
    yardsToEndzone: intOrNull(row.yards_to_endzone),
    possessionText: row.possession_text || null,
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
    if (fdDown != null && espnDown != null && fdDown > espnDown) return true;

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

export function fdLiveToDbRow(sit) {
  if (!sit) return {};
  return {
    period: sit.period ?? null,
    clock_seconds: sit.clockSeconds ?? null,
    clock_text: sit.clock ?? null,
    down: sit.down ?? null,
    distance: sit.distance ?? null,
    yards_to_endzone: sit.yardsToEndzone ?? null,
    possession_text: sit.possessionText ?? null,
    home_score: sit.homeScore ?? null,
    away_score: sit.awayScore ?? null,
    situation_text: sit.situationText || formatFdLiveSpot(sit) || null,
  };
}
