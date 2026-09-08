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
});
