import test from 'node:test';
import assert from 'node:assert/strict';
import {
  goalTypeFromEspnPlayType,
  hasClassifiableCommentary,
  parseGoalTypeReply,
} from './classify-goal-type.mjs';

test('parseGoalTypeReply accepts only the five labels', () => {
  assert.equal(parseGoalTypeReply('SOP'), 'sop');
  assert.equal(parseGoalTypeReply('Header\n'), 'header');
  assert.equal(parseGoalTypeReply('"PK"'), 'pk');
  assert.equal(parseGoalTypeReply('FK'), 'fk');
  assert.equal(parseGoalTypeReply('Own Goal'), 'og');
  assert.equal(parseGoalTypeReply('maybe a header'), null);
});

test('hasClassifiableCommentary rejects stub ESPN goal text', () => {
  assert.equal(hasClassifiableCommentary('Goal!'), false);
  assert.equal(hasClassifiableCommentary('Raphinha Goal'), false);
  assert.equal(
    hasClassifiableCommentary('Own Goal by Renato Veiga, Villarreal. Borussia Dortmund 1, Villarreal 0.'),
    true,
  );
});

test('goalTypeFromEspnPlayType maps ESPN type tokens', () => {
  assert.equal(goalTypeFromEspnPlayType({ type: 'goal---header' }), 'header');
  assert.equal(goalTypeFromEspnPlayType({ type: 'penalty---scored' }), 'pk');
  assert.equal(goalTypeFromEspnPlayType({ type: 'goal---free-kick' }), 'fk');
  assert.equal(goalTypeFromEspnPlayType({ type: 'own-goal' }), 'og');
  assert.equal(goalTypeFromEspnPlayType({ type: 'goal' }), 'sop');
});
