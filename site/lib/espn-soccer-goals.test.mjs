import test from 'node:test';
import assert from 'node:assert/strict';
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
});
