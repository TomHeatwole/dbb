import { buildGameMarkets } from './rawArbModel';
import { extraRowsForDisplay } from './mergeDeep';
import { isNycBlockedExtra, nycVisibleExtras } from './nycFilter';

describe('nyc filter', () => {
  const hockey = buildGameMarkets({
    sport: 'hockey',
    home: 'Eisbaren Berlin',
    away: 'Nuremberg Ice Tigers',
    moneyline: {
      fd: { away: { american: 190 }, home: { american: -250 } },
      dk: { away: { american: 170 }, home: { american: -220 } },
    },
  });
  const mlb = buildGameMarkets({
    sport: 'mlb',
    home: 'Yankees',
    away: 'Red Sox',
    total: {
      fd: { over: { american: -110, line: 8.5 }, under: { american: -110, line: 8.5 } },
      dk: { over: { american: -105, line: 8.5 }, under: { american: -115, line: 8.5 } },
    },
  });

  it('blocks all hockey props', () => {
    const extras = [
      { key: '1p|moneyline|winner|game', label: '1P ML', kind: 'moneyline', twoWay: { pSum: 0.95, hasArb: true, legs: [] } },
      { key: 'fg|player_ou|goals|Player', label: 'Player Goals', kind: 'player_ou', twoWay: { pSum: 1.05, legs: [] } },
    ];
    expect(isNycBlockedExtra(extras[0], hockey)).toBe(true);
    expect(isNycBlockedExtra(extras[1], hockey)).toBe(true);
    expect(nycVisibleExtras({ ...hockey, extras }, true)).toHaveLength(0);
    const { promoted, rest } = extraRowsForDisplay({ ...hockey, extras }, { filterNyc: true });
    expect(promoted).toHaveLength(0);
    expect(rest).toHaveLength(0);
  });

  it('blocks mlb alt lines and extra innings but keeps player props', () => {
    const extras = [
      {
        key: 'fg|total|points|game',
        label: 'Alt O/U 9.5',
        kind: 'total',
        main: true,
        twoWay: { pSum: 0.97, hasArb: true, legs: [] },
      },
      {
        key: 'fg|spread|points|game',
        label: 'Alt spread -1.5',
        kind: 'spread',
        main: true,
        twoWay: { pSum: 0.98, hasArb: true, legs: [] },
      },
      {
        key: 'fg|yesno|points|game',
        label: 'Extra Innings?',
        kind: 'yesno',
        twoWay: { pSum: 1.02, legs: [] },
      },
      {
        key: 'fg|player_ou|strikeouts|Gerrit Cole',
        label: 'Gerrit Cole Ks',
        kind: 'player_ou',
        twoWay: { pSum: 1.04, hasArb: false, legs: [] },
      },
      {
        key: 'f5|total|points|game',
        label: 'F5 O/U',
        kind: 'total',
        twoWay: { pSum: 1.03, legs: [] },
      },
    ];
    expect(isNycBlockedExtra(extras[0], mlb)).toBe(true);
    expect(isNycBlockedExtra(extras[1], mlb)).toBe(true);
    expect(isNycBlockedExtra(extras[2], mlb)).toBe(true);
    expect(isNycBlockedExtra(extras[3], mlb)).toBe(false);
    expect(isNycBlockedExtra(extras[4], mlb)).toBe(false);
    expect(nycVisibleExtras({ ...mlb, extras }, true).map((r) => r.label)).toEqual([
      'Gerrit Cole Ks',
      'F5 O/U',
    ]);
  });
});
