import {
  driveBucketFromResult,
  driveSettlementPatches,
  liveLinesResultPatch,
} from './settleDrives';

function firstDrive(id, side, extra = {}) {
  return {
    id,
    phase: 'pregame_first',
    offenseSide: side,
    settledAt: null,
    payload: {
      phase: 'pregame_first',
      offense_side: side,
      model_p_td: 0.28,
      model_p_fg: 0.12,
      model_p_punt: 0.44,
      model_p_other: 0.16,
      live_p_td: 0.30,
      live_p_fg: 0.18,
      live_p_punt: 0.50,
      live_p_other: 0.17,
      dk_td: 140,
      dk_fg: 400,
      dk_punt: -120,
      dk_other: 450,
      ...extra,
    },
  };
}

describe('drives settlement', () => {
  it('maps ESPN FG / missed FG / TD / punt into FD buckets', () => {
    expect(driveBucketFromResult('FG')).toBe('fg');
    expect(driveBucketFromResult('MISSED FG')).toBe('fg');
    expect(driveBucketFromResult('TD')).toBe('td');
    expect(driveBucketFromResult('PUNT')).toBe('punt');
    expect(driveBucketFromResult('INT')).toBe('other');
    expect(driveBucketFromResult('Fumble Return Touchdown')).toBe('other');
  });

  it('settles each team 1st-drive row on that team\'s first completed series', () => {
    const patches = driveSettlementPatches([
      firstDrive(1, 'home'),
      firstDrive(2, 'away'),
    ], {
      drives: [
        { side: 'away', bucket: 'td', period: 1, result: 'TD' },
        { side: 'home', bucket: 'punt', period: 1, result: 'PUNT' },
      ],
    });
    expect(patches).toHaveLength(2);
    const home = patches.find((p) => p.id === 1);
    const away = patches.find((p) => p.id === 2);
    expect(home.patch.result).toBe('punt');
    expect(away.patch.result).toBe('td');
    expect(home.patch.model_p_result).toBe(0.44);
    expect(away.patch.model_logloss).toBeCloseTo(-Math.log(0.28), 5);
  });

  it('waits until a side\'s first drive is complete', () => {
    const patches = driveSettlementPatches([firstDrive(1, 'home'), firstDrive(2, 'away')], {
      drives: [{ side: 'away', bucket: 'td', period: 1, result: 'TD' }],
    });
    expect(patches.map((p) => p.id)).toEqual([2]);
  });

  it('settles HT next-drive on the first 2H series for that offense', () => {
    const ht = {
      id: 3,
      phase: 'halftime_next',
      offenseSide: 'home',
      payload: firstDrive(3, 'home').payload,
    };
    const patches = driveSettlementPatches([ht], {
      drives: [
        { side: 'away', bucket: 'td', period: 1, result: 'TD' },
        { side: 'home', bucket: 'punt', period: 2, result: 'PUNT' },
        { side: 'away', bucket: 'fg', period: 3, result: 'FG' },
      ],
    });
    expect(patches).toEqual([]);
    const yes = driveSettlementPatches([{ ...ht, offenseSide: 'away' }], {
      drives: [
        { side: 'away', bucket: 'td', period: 1, result: 'TD' },
        { side: 'away', bucket: 'fg', period: 3, result: 'FG' },
      ],
    });
    expect(yes[0].patch.result).toBe('fg');
  });

  it('settles live spread/total only when the game is final', () => {
    const live = {
      id: 8,
      phase: 'live_lines',
      payload: { home_spread: -3.5, total: 48.5 },
    };
    expect(driveSettlementPatches([live], {
      finished: false,
      finalScore: { home: 24, away: 17 },
    })).toEqual([]);
    const done = driveSettlementPatches([live], {
      finished: true,
      finalScore: { home: 24, away: 17 },
    });
    expect(done[0].patch.result_spread).toBe('home');
    expect(done[0].patch.result_total).toBe('under');
  });

  it('treats home spread as the home handicap', () => {
    expect(liveLinesResultPatch({ home_spread: -3, total: 50 }, { home: 24, away: 21 }).result_spread).toBe('push');
    expect(liveLinesResultPatch({ home_spread: -3.5, total: 50 }, { home: 28, away: 24 }).result_spread).toBe('home');
    expect(liveLinesResultPatch({ home_spread: -3.5, total: 50 }, { home: 24, away: 21 }).result_spread).toBe('away');
  });
});
