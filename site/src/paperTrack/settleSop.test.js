import {
  buildSopResultPatch,
  classifySopGoalType,
  parseGoalScoreAfter,
  sopSettlementPatches,
} from './settleSop';

function row(id, score, extra = {}) {
  return {
    id,
    settledAt: null,
    payload: {
      score_home: score.home,
      score_away: score.away,
      model_sop_p: 0.6,
      live_sop_p: 0.55,
      model_no_goal_p: 0.2,
      live_no_goal_p: 0.2,
      model_header_p: 0.12,
      fd_sop: -120,
      ...extra,
    },
  };
}

describe('SOP settlement', () => {
  it('reads SOP / header / PK from ESPN commentary', () => {
    expect(classifySopGoalType({
      description: 'Goal! Arsenal 1, Chelsea 0. Saka left footed shot from the centre of the box.',
    })).toBe('sop');
    expect(classifySopGoalType({
      description: 'Goal! Arsenal 1, Chelsea 0. Havertz header from the centre of the box.',
    })).toBe('header');
    expect(classifySopGoalType({
      description: 'Goal! Arsenal 1, Chelsea 1. Palmer converts the penalty with a left footed shot.',
    })).toBe('pk');
  });

  it('parses the score after a goal against home/away names', () => {
    expect(parseGoalScoreAfter(
      'Goal! Chelsea 1, Arsenal 0. Neto left footed shot.',
      'Arsenal',
      'Chelsea',
    )).toEqual({ home: 0, away: 1 });
  });

  it('settles 0-0 snaps as the first goal and leaves the new scoreline open', () => {
    const patches = sopSettlementPatches([
      row(1, { home: 0, away: 0 }),
      row(2, { home: 0, away: 0 }),
      row(3, { home: 1, away: 0 }),
    ], {
      goals: [{
        type: 'sop',
        label: 'SOP',
        scoreAfter: { home: 1, away: 0 },
      }],
      finished: false,
    });
    expect(patches.map((p) => p.id).sort()).toEqual([1, 2]);
    expect(patches[0].patch.result).toBe('sop');
    expect(patches[0].patch.hit_sop).toBe(true);
  });

  it('marks leftover scorelines no-goal only after a finished match with every goal classified', () => {
    const live = row(4, { home: 1, away: 0 });
    const open = sopSettlementPatches([live], {
      goals: [{ type: 'sop', scoreAfter: { home: 1, away: 0 } }],
      finished: false,
      scoringPlayCount: 1,
    });
    expect(open).toEqual([]);

    const done = sopSettlementPatches([live], {
      goals: [{ type: 'sop', scoreAfter: { home: 1, away: 0 } }],
      finished: true,
      scoringPlayCount: 1,
    });
    expect(done).toHaveLength(1);
    expect(done[0].patch.result).toBe('no-goal');
    expect(done[0].patch.hit_no_goal).toBe(true);
  });

  it('does not no-goal-settle when a scoring play is still unclassified', () => {
    const patches = sopSettlementPatches([row(5, { home: 0, away: 0 })], {
      goals: [],
      finished: true,
      scoringPlayCount: 1,
    });
    expect(patches).toEqual([]);
  });

  it('skips rows that already have settled_at', () => {
    const patches = sopSettlementPatches([{
      id: 9,
      settledAt: '2026-10-17T12:00:00Z',
      payload: { score_home: 0, score_away: 0, model_sop_p: 0.5 },
    }], {
      goals: [{ type: 'header', scoreAfter: { home: 1, away: 0 } }],
      finished: true,
      scoringPlayCount: 1,
    });
    expect(patches).toEqual([]);
  });

  it('records SOP log-loss against the posted SOP price', () => {
    const patch = buildSopResultPatch({
      model_sop_p: 0.5,
      live_sop_p: 0.5,
      model_header_p: 0.15,
    }, 'header');
    expect(patch.hit_sop).toBe(false);
    expect(patch.model_sop_logloss).toBeCloseTo(-Math.log(0.5), 8);
  });
});
