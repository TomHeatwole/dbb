/** Off-hours ESPN listing cadence. Book scrapes follow the same window unless live. */
export const OFF_HOURS_MS = 2 * 60 * 60 * 1000;
/** Pull books every minute once a listed kickoff is this close. */
export const KICKOFF_LEAD_MS = 15 * 60 * 1000;

export function parseTime(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const ms = Date.parse(value ?? '');
  return Number.isFinite(ms) ? ms : null;
}

export function summarizeListing(matches, now = Date.now()) {
  let liveCount = 0;
  let halfTimeCount = 0;
  const upcoming = [];

  for (const match of matches ?? []) {
    const start = parseTime(match.startTime ?? match.openDate ?? match.kickoffAt);
    const finished = Boolean(match.finished || match.state === 'post');
    const halfTime = Boolean(match.halfTime);
    const inPlay = Boolean(match.inPlay) || halfTime;
    if (finished && !inPlay) continue;
    if (inPlay) {
      liveCount += 1;
      if (halfTime) halfTimeCount += 1;
      continue;
    }
    if (Number.isFinite(start)) {
      if (start <= now) liveCount += 1;
      else upcoming.push(start);
    }
  }

  upcoming.sort((a, b) => a - b);
  return {
    liveCount,
    halfTimeCount,
    upcomingCount: upcoming.length,
    nextKickoffAt: upcoming[0] ?? null,
  };
}

export function espnIsStale(meta, now = Date.now(), windowMs = OFF_HOURS_MS) {
  const last = parseTime(meta?.lastEspnAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= windowMs;
}

export function booksAreStale(meta, now = Date.now(), windowMs = OFF_HOURS_MS) {
  const last = parseTime(meta?.lastBooksAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= windowMs;
}

export function kickoffIsSoon(nextKickoffAt, now = Date.now(), leadMs = KICKOFF_LEAD_MS) {
  const kick = parseTime(nextKickoffAt);
  if (!Number.isFinite(kick)) return false;
  return kick - now <= leadMs;
}

/**
 * Minute cron always fires; this decides whether we even hit ESPN.
 * Stay awake while anything is live (drives needs HT detection) or a kickoff
 * is inside the lead window; otherwise poll listings every 2 hours.
 */
export function shouldFetchEspn(meta, now = Date.now()) {
  if ((meta?.liveCount ?? 0) > 0) return true;
  if ((meta?.halfTimeCount ?? 0) > 0) return true;
  if (kickoffIsSoon(meta?.nextKickoffAt, now)) return true;
  return espnIsStale(meta, now);
}

/**
 * Scrape books while any match is live (SOP/corners odds, drives live
 * spread/total), around kickoff, or on the 2h pregame refresh when
 * fixtures are listed.
 */
export function shouldFetchBooks(sport, listing, meta, now = Date.now()) {
  const liveCount = listing?.liveCount ?? 0;
  const halfTimeCount = listing?.halfTimeCount ?? 0;
  const upcomingCount = listing?.upcomingCount ?? 0;
  const nextKickoffAt = listing?.nextKickoffAt ?? meta?.nextKickoffAt;
  const listed = liveCount > 0 || upcomingCount > 0 || halfTimeCount > 0;

  if ((sport === 'sop' || sport === 'corners' || sport === 'drives') && liveCount > 0) {
    return true;
  }
  if (kickoffIsSoon(nextKickoffAt, now)) return true;
  if (!listed) return false;
  return booksAreStale(meta, now);
}
