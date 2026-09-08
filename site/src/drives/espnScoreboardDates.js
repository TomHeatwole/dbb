const DAY_MS = 24 * 60 * 60 * 1000;
const TEN_DAYS_MS = 10 * DAY_MS;
const SCOREBOARD_TZS = ['UTC', 'America/New_York'];

export function yyyymmddFromIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export function yyyymmddInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!year || !month || !day) return null;
  return `${year}${month}${day}`;
}

/**
 * ESPN college-football scoreboard `dates=` is the local kickoff calendar day.
 * FanDuel openDate is UTC, so a 9:20pm ET Sunday game is already Monday UTC
 * and vanishes from today's board after midnight unless we keep yesterday.
 */
export function uniqueScoreboardDates(openDates, now = new Date()) {
  const dates = new Set();
  for (const offset of [-1, 0, 1]) {
    const d = new Date(now.getTime() + offset * DAY_MS);
    for (const tz of SCOREBOARD_TZS) {
      dates.add(yyyymmddInTimeZone(d, tz));
    }
  }
  for (const iso of openDates ?? []) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) continue;
    if (Math.abs(t - now.getTime()) > TEN_DAYS_MS) continue;
    const kick = new Date(t);
    dates.add(yyyymmddFromIso(iso));
    dates.add(yyyymmddInTimeZone(kick, 'America/New_York'));
    dates.add(yyyymmddInTimeZone(new Date(t - DAY_MS), 'America/New_York'));
  }
  return [...dates].filter(Boolean).slice(0, 12);
}
