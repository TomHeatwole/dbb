import { uniqueScoreboardDates } from './espnScoreboardDates';

describe('ESPN scoreboard dates vs FanDuel UTC kickoffs', () => {
  it('keeps Sunday’s ESPN board for a late SMU @ FSU kickoff after midnight ET', () => {
    const dates = uniqueScoreboardDates(
      ['2026-09-08T01:20:00.000Z'],
      new Date('2026-09-08T04:11:00.000Z'),
    );
    expect(dates).toContain('20260907');
    expect(dates).toContain('20260908');
  });

  it('still includes yesterday when FanDuel has already rolled the openDate to UTC tomorrow', () => {
    const dates = uniqueScoreboardDates(
      [],
      new Date('2026-09-08T04:11:00.000Z'),
    );
    expect(dates).toContain('20260907');
  });
});
