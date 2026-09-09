import test from 'node:test';
import assert from 'node:assert/strict';
import {
  goalTypeFromEspnPlayType,
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

test('goalTypeFromEspnPlayType maps ESPN type tokens', () => {
  assert.equal(goalTypeFromEspnPlayType({ type: 'goal---header' }), 'header');
  assert.equal(goalTypeFromEspnPlayType({ type: 'penalty---scored' }), 'pk');
  assert.equal(goalTypeFromEspnPlayType({ type: 'goal---free-kick' }), 'fk');
  assert.equal(goalTypeFromEspnPlayType({ type: 'own-goal' }), 'og');
  assert.equal(goalTypeFromEspnPlayType({ type: 'goal' }), 'sop');
});
