import test from 'node:test';
import assert from 'node:assert/strict';
import { hasClassifiableCommentary } from './classify-goal-type.mjs';
import {
  extractScoringPlays,
  parseGoalActors,
} from './espn-soccer-goals.mjs';

test('parseGoalActors reads scorer, team, and own goals', () => {
  assert.deepEqual(
    parseGoalActors('Goal! Club Brugge 0, Aston Villa 1. John McGinn (Aston Villa) left footed shot from the right side of the box.'),
    { scorer: 'John McGinn', teamName: 'Aston Villa', ownGoal: false },
  );
  assert.deepEqual(
    parseGoalActors('Own Goal by Renato Veiga, Villarreal. Borussia Dortmund 1, Villarreal 0.'),
    { scorer: 'Renato Veiga', teamName: 'Villarreal', ownGoal: true },
  );
});

test('extractScoringPlays keeps ESPN scoring keyEvents', () => {
  const plays = extractScoringPlays({
    keyEvents: [
      { id: '1', scoringPlay: true, text: 'Goal! Porto 0, Man City 1. Erling Haaland (Manchester City) header from the centre of the box.', clock: { displayValue: "45'" }, type: { type: 'goal---header' } },
      { id: '2', scoringPlay: false, text: 'Yellow Card.' },
    ],
  });
  assert.equal(plays.length, 1);
  assert.equal(plays[0].scorer, 'Erling Haaland');
  assert.equal(plays[0].clock, "45'");
  assert.equal(plays[0].classifiable, true);
});

test('extractScoringPlays keeps a goal before ESPN writes commentary', () => {
  const plays = extractScoringPlays({
    keyEvents: [
      {
        id: '52125195',
        scoringPlay: true,
        shortText: 'Raphinha Goal',
        clock: { displayValue: "3'" },
        type: { type: 'goal' },
        team: { displayName: 'Barcelona' },
        participants: [{ athlete: { displayName: 'Raphinha' } }],
      },
    ],
  });
  assert.equal(plays.length, 1);
  assert.equal(plays[0].scorer, 'Raphinha');
  assert.equal(plays[0].teamName, 'Barcelona');
  assert.equal(plays[0].classifiable, false);
});

test('extractScoringPlays reads goals from commentary when keyEvents is empty', () => {
  const plays = extractScoringPlays({
    commentary: [
      {
        play: {
          id: '9',
          scoringPlay: true,
          text: 'Goal! Barcelona 2, Feyenoord 0. Ferran Torres (Barcelona) right footed shot from the centre of the box.',
          clock: { displayValue: "27'" },
          type: { type: 'goal' },
        },
      },
    ],
  });
  assert.equal(plays.length, 1);
  assert.equal(plays[0].scorer, 'Ferran Torres');
  assert.equal(plays[0].classifiable, true);
});

test('hasClassifiableCommentary waits for a how-it-was-scored write-up', () => {
  assert.equal(hasClassifiableCommentary(''), false);
  assert.equal(hasClassifiableCommentary('Raphinha Goal'), false);
  assert.equal(hasClassifiableCommentary('Goal! Barcelona 1, Feyenoord 0.'), false);
  assert.equal(
    hasClassifiableCommentary('Goal! Barcelona 1, Feyenoord 0. Raphinha (Barcelona) left footed shot from the centre of the box to the bottom left corner.'),
    true,
  );
});
