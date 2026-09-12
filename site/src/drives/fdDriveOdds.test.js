import {
  fdDriveMarketFromRow,
  fdDriveRowsForGame,
  mergeFdAndDkMarkets,
} from './fdDriveOdds';

const smuRow = {
  event_id: '35660086',
  home_team: 'Florida State',
  away_team: 'SMU',
  offense_side: 'away',
  offense_name: 'SMU',
  drive_n: 1,
  market_name: '1st SMU Drive Result',
  td_american: 310,
  fg_american: 480,
  punt_american: -155,
  other_american: 610,
};

const fsuRow = {
  ...smuRow,
  offense_side: 'home',
  offense_name: 'Florida State',
  market_name: '1st Florida State Drive Result',
  td_american: 280,
  fg_american: 450,
  punt_american: -135,
  other_american: 590,
};

describe('fdDriveOdds', () => {
  it('maps a Neon row onto the four-way FD market', () => {
    const market = fdDriveMarketFromRow(smuRow);
    expect(market.source).toBe('fd');
    expect(market.offenseSide).toBe('away');
    expect(market.outcomes.td.american).toBe(310);
    expect(market.outcomes.punt.american).toBe(-155);
  });

  it('matches a game by FanDuel event id', () => {
    const game = {
      eventId: 35660086,
      teams: { home: 'Florida State Seminoles', away: 'SMU Mustangs' },
    };
    const markets = fdDriveRowsForGame(game, [smuRow, fsuRow], () => false);
    expect(markets).toHaveLength(2);
    expect(markets.map((m) => m.offenseSide).sort()).toEqual(['away', 'home']);
  });

  it('matches a game by team names when event id is missing', () => {
    const namesMatch = (a, b) => String(a).includes(String(b)) || String(b).includes(String(a));
    const game = {
      eventId: 999,
      teams: { home: 'Florida State', away: 'SMU' },
    };
    const rows = [{ ...smuRow, event_id: null }, { ...fsuRow, event_id: null }];
    expect(fdDriveRowsForGame(game, rows, namesMatch)).toHaveLength(2);
  });

  it('does not fold a live DK drive onto a different FD drive number', () => {
    const fd = [{
      ...fdDriveMarketFromRow(smuRow),
      driveN: 1,
    }];
    const dk = [{
      source: 'dk',
      offenseSide: 'away',
      offenseName: 'SMU',
      driveN: 6,
      marketName: '6th SMU Drive Result',
      outcomes: { td: { american: 250 }, punt: { american: -140 } },
    }];
    const merged = mergeFdAndDkMarkets(fd, dk);
    expect(merged).toHaveLength(2);
    expect(merged.find((m) => m.driveN === 1).outcomes.td.dk).toBeUndefined();
    expect(merged.find((m) => m.driveN === 6).outcomes.td.american).toBe(250);
  });

  it('merges live DK onto the FanDuel row with the same drive number', () => {
    const fd = [{
      ...fdDriveMarketFromRow({ ...smuRow, drive_n: 6, market_name: '6th SMU Drive Result' }),
    }];
    const dk = [{
      source: 'dk',
      offenseSide: 'away',
      offenseName: 'SMU',
      driveN: 6,
      marketName: '6th SMU Drive Result',
      outcomes: { td: { american: 250 }, punt: { american: -140 } },
    }];
    const merged = mergeFdAndDkMarkets(fd, dk);
    expect(merged).toHaveLength(1);
    expect(merged[0].outcomes.td.fd.american).toBe(310);
    expect(merged[0].outcomes.td.dk.american).toBe(250);
  });

  it('merges DK 1st-drive onto the matching FD side', () => {
    const fd = [fdDriveMarketFromRow(smuRow), fdDriveMarketFromRow(fsuRow)];
    const dk = [{
      source: 'dk',
      offenseSide: 'away',
      offenseName: 'SMU',
      marketName: '1st SMU Drive Result',
      outcomes: { td: { american: 250 }, punt: { american: -140 } },
    }];
    const merged = mergeFdAndDkMarkets(fd, dk);
    const smu = merged.find((m) => m.offenseSide === 'away');
    expect(smu.source).toBe('fd');
    expect(smu.outcomes.td.fd.american).toBe(310);
    expect(smu.outcomes.td.dk.american).toBe(250);
    expect(merged.find((m) => m.offenseSide === 'home').outcomes.td.american).toBe(280);
  });

  it('drops FanDuel 0 as an unpriced leg, not a real American line', () => {
    const market = fdDriveMarketFromRow({
      ...smuRow,
      td_american: 0,
      fg_american: 0,
      punt_american: 0,
      other_american: 500,
    });
    expect(market.outcomes.td).toBeUndefined();
    expect(market.outcomes.fg).toBeUndefined();
    expect(market.outcomes.punt).toBeUndefined();
    expect(market.outcomes.other.american).toBe(500);
  });

  it('drops FanDuel ±100000 lock sentinels', () => {
    const market = fdDriveMarketFromRow({
      ...smuRow,
      td_american: -100000,
      fg_american: 100000,
      punt_american: -20000,
      other_american: 500,
    });
    expect(market.outcomes.td).toBeUndefined();
    expect(market.outcomes.fg).toBeUndefined();
    expect(market.outcomes.punt.american).toBe(-20000);
    expect(market.outcomes.other.american).toBe(500);
  });
});
