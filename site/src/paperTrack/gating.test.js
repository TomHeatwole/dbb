import {
  booksAreStale,
  kickoffIsSoon,
  OFF_HOURS_MS,
  shouldFetchBooks,
  shouldFetchEspn,
  summarizeListing,
} from './gating';

const HOUR = 60 * 60 * 1000;
const now = Date.parse('2026-10-16T18:00:00Z');

describe('paper-track gating', () => {
  it('summarizes live, HT, and next kickoff without treating finished games as upcoming', () => {
    const listing = summarizeListing([
      { startTime: '2026-10-16T17:00:00Z', inPlay: true, halfTime: false },
      { startTime: '2026-10-16T16:00:00Z', inPlay: true, halfTime: true },
      { startTime: '2026-10-16T20:00:00Z', inPlay: false, finished: false },
      { startTime: '2026-10-16T12:00:00Z', inPlay: false, finished: true, state: 'post' },
    ], now);
    expect(listing.liveCount).toBe(2);
    expect(listing.halfTimeCount).toBe(1);
    expect(listing.upcomingCount).toBe(1);
    expect(listing.nextKickoffAt).toBe(Date.parse('2026-10-16T20:00:00Z'));
  });

  it('stays idle off-hours when ESPN was checked recently and nothing is live', () => {
    const meta = {
      liveCount: 0,
      halfTimeCount: 0,
      lastEspnAt: new Date(now - HOUR).toISOString(),
      nextKickoffAt: new Date(now + 6 * HOUR).toISOString(),
    };
    expect(shouldFetchEspn(meta, now)).toBe(false);
  });

  it('wakes ESPN on the 2h cadence and when kickoff is inside the lead window', () => {
    expect(shouldFetchEspn({
      liveCount: 0,
      lastEspnAt: new Date(now - OFF_HOURS_MS - 1).toISOString(),
      nextKickoffAt: new Date(now + 6 * HOUR).toISOString(),
    }, now)).toBe(true);
    expect(shouldFetchEspn({
      liveCount: 0,
      lastEspnAt: new Date(now - 60_000).toISOString(),
      nextKickoffAt: new Date(now + 10 * 60 * 1000).toISOString(),
    }, now)).toBe(true);
  });

  it('scrapes SOP and drives books while live, and on pregame windows', () => {
    const live = { liveCount: 3, halfTimeCount: 0, upcomingCount: 2, nextKickoffAt: now + 3 * HOUR };
    const ht = { liveCount: 3, halfTimeCount: 1, upcomingCount: 2, nextKickoffAt: now + 3 * HOUR };
    const pregame = { liveCount: 0, halfTimeCount: 0, upcomingCount: 4, nextKickoffAt: now + 3 * HOUR };
    const empty = { liveCount: 0, halfTimeCount: 0, upcomingCount: 0, nextKickoffAt: null };
    const stale = { lastBooksAt: new Date(now - OFF_HOURS_MS - 1).toISOString() };
    const fresh = { lastBooksAt: new Date(now - 60_000).toISOString() };

    expect(shouldFetchBooks('sop', live, fresh, now)).toBe(true);
    expect(shouldFetchBooks('corners', live, fresh, now)).toBe(true);
    expect(shouldFetchBooks('drives', live, fresh, now)).toBe(true);
    expect(shouldFetchBooks('drives', ht, fresh, now)).toBe(true);
    expect(shouldFetchBooks('sop', pregame, stale, now)).toBe(true);
    expect(shouldFetchBooks('drives', pregame, stale, now)).toBe(true);
    expect(shouldFetchBooks('sop', pregame, fresh, now)).toBe(false);
    expect(shouldFetchBooks('sop', empty, stale, now)).toBe(false);
  });

  it('treats a kickoff inside 15 minutes as soon', () => {
    expect(kickoffIsSoon(now + 10 * 60 * 1000, now)).toBe(true);
    expect(kickoffIsSoon(now + HOUR, now)).toBe(false);
    expect(booksAreStale({ lastBooksAt: null }, now)).toBe(true);
  });
});
