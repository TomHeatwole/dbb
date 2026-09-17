import {
  afterOpponentStartMix,
  blendDriveResultProbs,
  knownOpeningReceiveSide,
  predictPregameFirstDriveStartForRole,
  receiveStartMix,
  spreadBin,
} from './pregameFirstDriveStart.js';
import { evaluateDriveGame, featuresFromGame } from './driveModel.js';

function texasStateAtTexas(overrides = {}) {
  return {
    teams: { home: 'Texas', away: 'Texas State' },
    inPlay: false,
    lines: {
      spread: {
        runners: [
          { runnerName: 'Texas State', handicap: 29.5, american: -110 },
          { runnerName: 'Texas', handicap: -29.5, american: -110 },
        ],
      },
      total: { runners: [{ handicap: 60.5, american: -110 }] },
    },
    driveMarkets: [
      { offenseSide: 'away', marketName: '1st Texas State Drive Result', offenseName: 'Texas State' },
      { offenseSide: 'home', marketName: '1st Texas Drive Result', offenseName: 'Texas' },
    ],
    ...overrides,
  };
}

describe('pregame first-drive field position', () => {
  const game = texasStateAtTexas();

  it('does not assume home receives when coin toss is unknown', () => {
    expect(knownOpeningReceiveSide(game)).toBeNull();
  });

  it('uses explicit openingReceiveSide when provided', () => {
    expect(knownOpeningReceiveSide({ openingReceiveSide: 'away' })).toBe('away');
  });

  it('maps offense spread into spread bins', () => {
    expect(spreadBin(-29.5)?.id).toBe('fav_le_21');
    expect(spreadBin(29.5)?.id).toBe('dog_ge_21');
  });

  it('returns different expected spots for receive vs kick roles', () => {
    const receive = predictPregameFirstDriveStartForRole('receive', -29.5);
    const kick = predictPregameFirstDriveStartForRole('afterOpponent', -29.5);
    expect(receive.expectedYtg).toBeGreaterThan(kick.expectedYtg);
  });

  it('spreads going-second starts across field bins after a punt', () => {
    const bins = afterOpponentStartMix('punt', -29.5);
    const mass = bins.reduce((s, b) => s + b.p, 0);
    expect(mass).toBeCloseTo(1, 5);
    expect(bins.length).toBeGreaterThan(3);
    const mid = bins.find((b) => b.id === 'own_36_50');
    expect(mid?.p).toBeGreaterThan(0.15);
  });

  it('keeps kickoff returns mostly in the own-21–35 bin', () => {
    const bins = receiveStartMix(-29.5);
    const kickoff = bins.find((b) => b.id === 'own_21_35');
    expect(kickoff?.p).toBeGreaterThan(0.7);
  });

  it('blends model probabilities 50/50 across coin toss scenarios', () => {
    const gameWithSide = { ...game, nextDrive: { offenseSide: 'home' } };
    const receiveOnly = evaluateDriveGame(
      { ...gameWithSide, openingReceiveSide: 'home' },
      { market: game.driveMarkets[1] },
    );
    const kickOnly = evaluateDriveGame(
      { ...gameWithSide, openingReceiveSide: 'away' },
      { market: game.driveMarkets[1] },
    );
    const blended = evaluateDriveGame(gameWithSide, { market: game.driveMarkets[1] });

    expect(blended.pred.pregameCoinTossBlend).toBe(true);
    expect(blended.pred.pregameScenarios).toHaveLength(2);

    const tdRecv = receiveOnly.rows.find((r) => r.key === 'td').p;
    const tdKick = kickOnly.rows.find((r) => r.key === 'td').p;
    const tdBlend = blended.rows.find((r) => r.key === 'td').p;
    expect(tdBlend).toBeCloseTo(0.5 * tdRecv + 0.5 * tdKick, 5);
  });

  it('does not blend when coin toss winner is known', () => {
    const pred = evaluateDriveGame(
      { ...game, openingReceiveSide: 'home', nextDrive: { offenseSide: 'home' } },
      { market: game.driveMarkets[1] },
    ).pred;
    expect(pred.pregameCoinTossBlend).toBeFalsy();
    expect(pred.pregameRole).toBe('receive');
  });

  it('models going second as opponent-open result × start bins', () => {
    const pred = evaluateDriveGame(
      { ...game, openingReceiveSide: 'away', nextDrive: { offenseSide: 'home' } },
      { market: game.driveMarkets[1] },
    ).pred;
    expect(pred.pregameAfterOpponent).toBe(true);
    expect(pred.features.drive_n).toBe(2);
    expect(pred.openingResultP.punt).toBeGreaterThan(pred.openingResultP.td);
    expect(pred.openingResultP.punt + pred.openingResultP.td
      + pred.openingResultP.fg + pred.openingResultP.other).toBeCloseTo(1, 5);
  });

  it('gives a -29 favorite more TD going second than a +29 dog', () => {
    const texasSecond = evaluateDriveGame(
      { ...game, openingReceiveSide: 'away', nextDrive: { offenseSide: 'home' } },
      { market: game.driveMarkets[1] },
    );
    const txstSecond = evaluateDriveGame(
      { ...game, openingReceiveSide: 'home', nextDrive: { offenseSide: 'away' } },
      { market: game.driveMarkets[0] },
    );
    const texasTd = texasSecond.rows.find((r) => r.key === 'td').p;
    const txstTd = txstSecond.rows.find((r) => r.key === 'td').p;
    expect(texasTd).toBeGreaterThan(txstTd + 0.12);
  });

  it('featuresFromGame alone does not pick a coin toss side pregame', () => {
    const built = featuresFromGame({ ...game, nextDrive: { offenseSide: 'home' } });
    expect(built.pregameFirstDrive).toBeFalsy();
  });
});

describe('blendDriveResultProbs', () => {
  it('averages class probabilities', () => {
    const p = blendDriveResultProbs([
      { p: { td: 0.4, punt: 0.3, fg: 0.1, other: 0.2 } },
      { p: { td: 0.2, punt: 0.5, fg: 0.1, other: 0.2 } },
    ]);
    expect(p.td).toBeCloseTo(0.3);
    expect(p.punt).toBeCloseTo(0.4);
  });
});
