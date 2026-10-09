import { extractMgmContracts, extractMgmFixture } from './mgmExtract';
import { extractCaesarsContracts, extractCaesarsHome, extractCaesarsPayload } from './caesarsExtract';
import { applyEnabledExtras, scoreContracts } from './mergeDeep';
import { applyEnabledBooks, attachBookGames, buildGameMarkets } from './rawArbModel';

const mgmFixture = {
  id: 19996455,
  name: { value: 'Washington State at Utah State' },
  startDate: '2026-10-10T01:00:00Z',
  stage: 'PreMatch',
  sport: { id: 11, name: { value: 'Football' } },
  competition: { name: { value: 'NCAAF' } },
  participants: [
    { name: { value: 'Washington State' } },
    { name: { value: 'Utah State' } },
  ],
  optionMarkets: [
    {
      name: { value: 'Moneyline' },
      isMain: true,
      options: [
        { name: { value: 'Washington State' }, status: 'Visible', price: { americanOdds: 165 } },
        { name: { value: 'Utah State' }, status: 'Visible', price: { americanOdds: -200 } },
      ],
    },
    {
      name: { value: 'Spread' },
      spread: 0,
      options: [
        { name: { value: 'Washington State +5.5' }, status: 'Visible', attr: '+5.5', price: { americanOdds: -110 } },
        { name: { value: 'Utah State -5.5' }, status: 'Visible', attr: '-5.5', price: { americanOdds: -110 } },
      ],
    },
    {
      name: { value: '1st half spread' },
      options: [
        { name: { value: 'Washington State +3.5' }, status: 'Visible', attr: '+3.5', price: { americanOdds: -115 } },
        { name: { value: 'Utah State -3.5' }, status: 'Visible', attr: '-3.5', price: { americanOdds: -105 } },
      ],
    },
    {
      name: { value: 'Totals' },
      spread: 0,
      options: [
        { name: { value: 'Over 44' }, status: 'Visible', totalsPrefix: 'Over', price: { americanOdds: -110 } },
        { name: { value: 'Under 44' }, status: 'Visible', totalsPrefix: 'Under', price: { americanOdds: -110 } },
      ],
    },
  ],
};

describe('BetMGM mains', () => {
  it('reads full-game moneyline, spread, and total', () => {
    const game = extractMgmFixture(mgmFixture);
    expect(game.sport).toBe('cfb');
    expect(game.away).toBe('Washington State');
    expect(game.home).toBe('Utah State');
    expect(game.moneyline.away.american).toBe(165);
    expect(game.spread.home.line).toBe(-5.5);
    expect(game.total.over.line).toBe(44);
  });

  it('drops a three-way soccer match result', () => {
    const game = extractMgmFixture({
      ...mgmFixture,
      name: { value: 'Aston Villa - Fenerbahce SK' },
      sport: { id: 4 },
      competition: { name: { value: 'UEFA Champions League' } },
      optionMarkets: [
        {
          name: { value: 'Match result' },
          options: [
            { name: { value: 'Aston Villa' }, status: 'Visible', price: { americanOdds: 110 } },
            { name: { value: 'Tie' }, status: 'Visible', price: { americanOdds: 240 } },
            { name: { value: 'Fenerbahce SK' }, status: 'Visible', price: { americanOdds: 220 } },
          ],
        },
        {
          name: { value: 'Total goals' },
          spread: 0.02,
          options: [
            { name: { value: 'Over 2.5' }, status: 'Visible', totalsPrefix: 'Over', price: { americanOdds: -115 } },
            { name: { value: 'Under 2.5' }, status: 'Visible', totalsPrefix: 'Under', price: { americanOdds: -105 } },
          ],
        },
      ],
    });
    expect(game.sport).toBe('soccer');
    expect(game.home).toBe('Aston Villa');
    expect(game.moneyline).toBeNull();
    expect(game.total.over.line).toBe(2.5);
  });
});

describe('Caesars mains', () => {
  it('reads the homepage six-pack and skips a three-way soccer price', () => {
    const games = extractCaesarsHome({
      eventDisplayGroups: [
        {
          events: [
            {
              id: 'nfl-1',
              type: 'MATCH',
              name: 'Tampa Bay Buccaneers at Dallas Cowboys',
              startTime: '2026-10-09T00:15:00Z',
              sportId: 'americanfootball',
              competitionName: 'NFL',
              eventDisplay: { teams: ['Tampa Bay Buccaneers', 'Dallas Cowboys'] },
              keyMarketGroups: [{
                markets: [
                  {
                    displayName: 'Spread',
                    type: 'two-way-handicap',
                    line: -9,
                    metadata: { period: 'MATCH_INC_OT' },
                    selections: [
                      { type: 'away', active: true, price: { a: -112 } },
                      { type: 'home', active: true, price: { a: -108 } },
                    ],
                  },
                  {
                    displayName: 'Money',
                    type: 'standard-market-template',
                    metadata: { period: 'MATCH_INC_OT' },
                    selections: [
                      { type: 'away', active: true, price: { a: 390 } },
                      { type: 'home', active: true, price: { a: -530 } },
                    ],
                  },
                  {
                    displayName: 'Total ',
                    type: 'over-under',
                    line: 49,
                    metadata: { period: 'MATCH_INC_OT' },
                    selections: [
                      { type: 'over', active: true, price: { a: -107 } },
                      { type: 'under', active: true, price: { a: -113 } },
                    ],
                  },
                ],
              }],
            },
            {
              id: 'soc-1',
              type: 'MATCH',
              name: 'Borussia Dortmund vs Werder Bremen',
              sportId: 'football',
              competitionName: 'Germany - Bundesliga',
              keyMarketGroups: [{
                markets: [{
                  displayName: ' ',
                  type: 'standard-market-template',
                  selections: [
                    { type: 'home', active: true, price: { a: -150 } },
                    { type: 'draw', active: true, price: { a: 280 } },
                    { type: 'away', active: true, price: { a: 400 } },
                  ],
                }],
              }],
            },
          ],
        },
      ],
    });
    expect(games).toHaveLength(1);
    expect(games[0].sport).toBe('nfl');
    expect(games[0].away).toBe('Tampa Bay Buccaneers');
    expect(games[0].spread.away.line).toBe(9);
    expect(games[0].spread.home.line).toBe(-9);
    expect(games[0].total.over.american).toBe(-107);
  });
});

describe('extra book attachment', () => {
  it('hangs BetMGM on the matching game and can drop it from the two-way', () => {
    const base = buildGameMarkets({
      sport: 'nfl',
      home: 'Dallas Cowboys',
      away: 'Tampa Bay Buccaneers',
      openDate: '2026-10-09T00:15:00Z',
      moneyline: {
        fd: { away: { american: 380 }, home: { american: -500 } },
        dk: { away: { american: 370 }, home: { american: -490 } },
      },
    });
    const [attached] = attachBookGames([base], [{
      eventId: 'mgm-1',
      sport: 'nfl',
      home: 'Dallas Cowboys',
      away: 'Tampa Bay Buccaneers',
      openDate: '2026-10-09T00:20:00Z',
      moneyline: { away: { american: 400 }, home: { american: -550 } },
    }], 'mgm');
    expect(attached.mgmEventId).toBe('mgm-1');
    const all = applyEnabledBooks(attached, ['fd', 'dk', 'mgm', 'czr']);
    expect(all.moneyline.twoWay.legs.map((leg) => leg.book)).toContain('mgm');
    const without = applyEnabledBooks(attached, ['fd', 'dk']);
    expect(without.moneyline.mgm).toBeNull();
    expect(without.moneyline.twoWay.legs.every((leg) => leg.book !== 'mgm')).toBe(true);
  });
});

describe('deeper book boards', () => {
  it('reads an @ moneyline and a half spread from BetMGM', () => {
    const game = extractMgmFixture({
      ...mgmFixture,
      name: { value: 'Detroit Lions @ Arizona Cardinals' },
      competition: { name: { value: 'NFL' } },
    });
    expect(game.sport).toBe('nfl');
    expect(game.away).toBe('Detroit Lions');
    expect(game.home).toBe('Arizona Cardinals');

    const contracts = extractMgmContracts({
      optionMarkets: [
        ...mgmFixture.optionMarkets,
        {
          name: { value: 'Cade Otton - Reception Yards' },
          options: [
            { name: { value: 'Over 29.5' }, status: 'Visible', parameters: { optionTypes: ['Over'] }, price: { americanOdds: -125 } },
            { name: { value: 'Under 29.5' }, status: 'Visible', parameters: { optionTypes: ['Under'] }, price: { americanOdds: -105 } },
          ],
        },
      ],
    }, { away: 'Washington State', home: 'Utah State' });
    const half = contracts.find((row) => row.key === '1h|spread|points|game');
    const rec = contracts.find((row) => row.key === 'fg|player_ou|rec_yds|Cade Otton');
    expect(half.mgm.away.line).toBe(3.5);
    expect(rec.mgm.over.line).toBe(29.5);
  });

  it('does not file 1st-half touchdowns under the points total', () => {
    const contracts = extractMgmContracts({
      optionMarkets: [
        {
          name: { value: '1st half totals' },
          options: [
            { name: { value: 'Over 19.5' }, status: 'Visible', parameters: { optionTypes: ['Over'] }, price: { americanOdds: -110 } },
            { name: { value: 'Under 19.5' }, status: 'Visible', parameters: { optionTypes: ['Under'] }, price: { americanOdds: -110 } },
          ],
        },
        {
          name: { value: '1st half TDs' },
          options: [
            { name: { value: 'Over 3.5' }, status: 'Visible', parameters: { optionTypes: ['Over'] }, price: { americanOdds: 475 } },
            { name: { value: 'Under 3.5' }, status: 'Visible', parameters: { optionTypes: ['Under'] }, price: { americanOdds: -700 } },
          ],
        },
      ],
    }, { away: 'Cleveland Browns', home: 'New York Jets' });
    const points = contracts.find((row) => row.key === '1h|total|points|game');
    const tds = contracts.find((row) => row.key === '1h|total|tds|game');
    expect(points.mgm.overs.map((row) => row.line)).toEqual([19.5]);
    expect(tds.mgm.over).toMatchObject({ line: 3.5, american: 475 });
  });

  it('keeps soccer corners and clock slices off the match goal total', () => {
    const line = (title, overLine, overPrice, underPrice) => ({
      name: { value: title },
      options: [
        { name: { value: `Over ${overLine}` }, status: 'Visible', parameters: { optionTypes: ['Over'] }, price: { americanOdds: overPrice } },
        { name: { value: `Under ${overLine}` }, status: 'Visible', parameters: { optionTypes: ['Under'] }, price: { americanOdds: underPrice } },
      ],
    });
    const contracts = extractMgmContracts({
      optionMarkets: [
        line('Total goals', 1.5, -900, 550),
        line('Total goals', 3.5, -102, -135),
        line('Total corners', 9.5, -105, -135),
        line('Total corners', 6.5, -625, 360),
        line('Borussia Dortmund: Total goals, 15:01 - 30:00', 0.5, 195, -285),
      ],
    }, { away: 'SV Werder Bremen', home: 'Borussia Dortmund' });
    const scored = scoreContracts(contracts, ['mgm']);
    const goals = scored.find((row) => row.key === 'fg|total|points|game');
    const corners = scored.find((row) => row.key === 'fg|total|corners|game');
    expect(goals.mgm.overs.map((row) => row.line).sort()).toEqual([1.5, 3.5]);
    expect(goals.mgm.over).toMatchObject({ line: 3.5, american: -102 });
    expect(corners.mgm.unders.map((row) => row.line).sort()).toEqual([6.5, 9.5]);
    expect(scored.some((row) => /Dortmund/.test(row.key))).toBe(false);
  });

  it('reads every competition tab and a Caesars half total', () => {
    const games = extractCaesarsPayload({
      competitions: [{
        events: [{
          id: 'epl-1',
          type: 'MATCH',
          name: '|Arsenal| |vs| |Chelsea|',
          sportId: 'football',
          competitionName: 'England Premier League',
          startTime: '2026-10-10T14:00:00Z',
          eventDisplay: { teams: ['|Arsenal|', '|Chelsea|'] },
          keyMarketGroups: [{
            markets: [{
              displayName: 'Total ',
              type: 'over-under',
              line: 2.5,
              metadata: { period: 'MATCH' },
              selections: [
                { type: 'over', active: true, name: '|Over|', price: { a: -120 } },
                { type: 'under', active: true, name: '|Under|', price: { a: 100 } },
              ],
            }],
          }],
        }],
      }],
    });
    expect(games).toHaveLength(1);
    expect(games[0].sport).toBe('soccer');
    expect(games[0].total.over.line).toBe(2.5);

    const contracts = extractCaesarsContracts({
      keyMarketGroups: [{
        markets: [{
          displayName: '1H Total',
          name: '|1st Half Total|',
          type: 'over-under',
          line: 24.5,
          selections: [
            { type: 'over', active: true, name: '|Over|', price: { a: -110 } },
            { type: 'under', active: true, name: '|Under|', price: { a: -110 } },
          ],
        }],
      }],
    }, { away: 'Tampa Bay Buccaneers', home: 'Dallas Cowboys' });
    expect(contracts[0].key).toBe('1h|total|points|game');
    expect(contracts[0].czr.over.line).toBe(24.5);
  });

  it('drops BetMGM from an extra two-way when that book is off', () => {
    const game = applyEnabledExtras({
      extras: [{
        key: '1h|total|points|game',
        label: '1H O/U',
        kind: 'total',
        main: false,
        fd: { over: { american: -110, line: 24.5 }, under: { american: -110, line: 24.5 } },
        dk: { over: { american: -108, line: 24.5 }, under: { american: -112, line: 24.5 } },
        mgm: { over: { american: 150, line: 24.5 }, under: { american: -180, line: 24.5 } },
      }],
    }, ['fd', 'dk']);
    expect(game.extras[0].twoWay.legs.every((leg) => leg.book !== 'mgm')).toBe(true);
    const withMgm = applyEnabledExtras(game, ['fd', 'dk', 'mgm']);
    expect(withMgm.extras[0].twoWay.legs.map((leg) => leg.book)).toContain('mgm');
  });
});
