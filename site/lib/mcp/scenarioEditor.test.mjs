import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOwnerAliases,
  applyScenarioEditorOperations,
  findMatchingScenarioTrade,
  findScenarioTeam,
  resolvePlayerName,
  summarizeTrade,
} from './scenarioEditor.mjs';

const PLAYERS = {
  '100': { full_name: "Ja'Marr Chase", first_name: "Ja'Marr", last_name: 'Chase', position: 'WR' },
  '200': { full_name: 'Puka Nacua', first_name: 'Puka', last_name: 'Nacua', position: 'WR' },
  '300': { full_name: 'Chase Brown', first_name: 'Chase', last_name: 'Brown', position: 'RB' },
  '400': { full_name: 'George Kittle', first_name: 'George', last_name: 'Kittle', position: 'TE' },
  '500': { full_name: 'Joe Burrow', first_name: 'Joe', last_name: 'Burrow', position: 'QB' },
};

const snapshot = {
  season: '2025',
  teams: [
    { rosterId: 1, teamName: 'Burrowhead', ownerName: 'Alex' },
    { rosterId: 2, teamName: 'Puka Pack', ownerName: 'Jack' },
  ],
  rosters: {
    1: ['100', '300', '500'],
    2: ['200'],
  },
  originalRosters: {
    1: ['100', '300', '500'],
    2: ['200'],
  },
};

test('resolves Jamar Chase to Ja\'Marr among rostered players', () => {
  const found = resolvePlayerName('Jamar Chase', { rosters: snapshot.rosters, playersData: PLAYERS });
  assert.equal(found.playerId, '100');
  assert.equal(found.rosterId, '1');
});

test('resolves Puka by first name among rostered players', () => {
  const found = resolvePlayerName('Puka', { rosters: snapshot.rosters, playersData: PLAYERS });
  assert.equal(found.playerId, '200');
  assert.equal(found.rosterId, '2');
});

test('trade swaps Chase and Puka onto the correct teams', () => {
  const result = applyScenarioEditorOperations(
    [{ type: 'trade', players_a: ['Jamar Chase'], players_b: ['Puka Nacua'] }],
    snapshot,
    PLAYERS,
  );
  assert.equal(result.ok, true);
  const byRid = Object.fromEntries(result.edits.map((e) => [e.rosterId, e]));
  assert.deepEqual(byRid[1].add, ['200']);
  assert.deepEqual(byRid[1].drop, ['100']);
  assert.deepEqual(byRid[2].add, ['100']);
  assert.deepEqual(byRid[2].drop, ['200']);
  assert.match(result.summary, /Traded/i);
});

test('add steals a player from their current team', () => {
  const result = applyScenarioEditorOperations(
    [{ type: 'add', team: 'Jack', players: ["Ja'Marr Chase"] }],
    snapshot,
    PLAYERS,
  );
  assert.equal(result.ok, true);
  const byRid = Object.fromEntries(result.edits.map((e) => [e.rosterId, e]));
  assert.ok(byRid[1].drop.includes('100'));
  assert.ok(byRid[2].add.includes('100'));
});

test('drop removes a player without adding them elsewhere', () => {
  const result = applyScenarioEditorOperations(
    [{ type: 'drop', players: ['Chase Brown'] }],
    snapshot,
    PLAYERS,
  );
  assert.equal(result.ok, true);
  const team1 = result.edits.find((e) => e.rosterId === 1);
  assert.deepEqual(team1.drop, ['300']);
  assert.deepEqual(team1.add, []);
});

test('add free agent onto a named team', () => {
  const result = applyScenarioEditorOperations(
    [{ type: 'add', team: 'Burrowhead', players: ['George Kittle'] }],
    snapshot,
    PLAYERS,
  );
  assert.equal(result.ok, true);
  const team1 = result.edits.find((e) => e.rosterId === 1);
  assert.ok(team1.add.includes('400'));
});

test('reset restores original rosters', () => {
  const edited = {
    ...snapshot,
    rosters: { 1: ['200'], 2: ['100', '300', '500'] },
  };
  const result = applyScenarioEditorOperations([{ type: 'reset' }], edited, PLAYERS);
  assert.equal(result.ok, true);
  assert.equal(result.reset, true);
});

test('ambiguous last-name-only Chase does not silently pick one', () => {
  const found = resolvePlayerName('Chase', { rosters: snapshot.rosters, playersData: PLAYERS });
  assert.ok(found.error);
});

test('add with keep_on_other_teams copies Chase without dropping him', () => {
  const result = applyScenarioEditorOperations(
    [{ type: 'add', team: 'Jack', players: ["Ja'Marr Chase"], keep_on_other_teams: true }],
    snapshot,
    PLAYERS,
  );
  assert.equal(result.ok, true);
  const byRid = Object.fromEntries(result.edits.map((e) => [e.rosterId, e]));
  assert.equal(byRid[1], undefined);
  assert.deepEqual(byRid[2].add, ['100']);
  assert.deepEqual(byRid[2].drop, []);
  assert.match(result.summary, /without removing/i);
});

test('copy type and exclusive:false also keep the player on both teams', () => {
  const copied = applyScenarioEditorOperations(
    [{ type: 'copy', team: 'Puka Pack', players: ["Ja'Marr Chase"] }],
    snapshot,
    PLAYERS,
  );
  const exclusiveFalse = applyScenarioEditorOperations(
    [{ type: 'add', team: 'Jack', players: ["Ja'Marr Chase"], exclusive: 'false' }],
    snapshot,
    PLAYERS,
  );
  for (const result of [copied, exclusiveFalse]) {
    assert.equal(result.ok, true);
    const team1 = result.edits.find((e) => e.rosterId === 1);
    const team2 = result.edits.find((e) => e.rosterId === 2);
    assert.equal(team1, undefined);
    assert.deepEqual(team2.add, ['100']);
  }
});

const LEAGUE_TEAMS = applyOwnerAliases(
  [
    { rosterId: 1, teamName: 'Team Tom', ownerName: 'Tom Heatwole' },
    { rosterId: 2, teamName: 'Aidan Ball', ownerName: 'johntoms' },
    { rosterId: 3, teamName: 'The Boomers', ownerName: 'Jeff Heatwole' },
    { rosterId: 4, teamName: 'Let James Cook', ownerName: 'Jack Mehr' },
    { rosterId: 8, teamName: 'Lord Pittsy', ownerName: 'dwol11' },
    { rosterId: 10, teamName: 'Eat It While She Sleeper', ownerName: 'GIVEDADDYASPIKE' },
  ],
  new Map([
    ['tom', 1],
    ['heatwole', 3],
    ['aidan', 2],
    ['toms', 2],
    ['jeff', 3],
    ['drew', 8],
    ['wolanski', 8],
    ['mac', 10],
    ['sochor', 10],
  ]),
);

test('findScenarioTeam resolves owner first names and nicknames', () => {
  assert.equal(findScenarioTeam(LEAGUE_TEAMS, 'mac').rosterId, 10);
  assert.equal(findScenarioTeam(LEAGUE_TEAMS, 'Aidan').rosterId, 2);
  assert.equal(findScenarioTeam(LEAGUE_TEAMS, 'Drew').rosterId, 8);
  assert.equal(findScenarioTeam(LEAGUE_TEAMS, 'Jack').rosterId, 4);
});

test('findScenarioTeam treats an ambiguous shared last name as no match', () => {
  const bothHeatwoles = [
    { rosterId: 1, teamName: 'Team Tom', ownerName: 'Tom Heatwole', aliases: ['tom', 'heatwole'] },
    { rosterId: 3, teamName: 'The Boomers', ownerName: 'Jeff Heatwole', aliases: ['jeff', 'heatwole'] },
  ];
  assert.equal(findScenarioTeam(bothHeatwoles, 'heatwole'), null);
  assert.equal(findScenarioTeam(bothHeatwoles, 'tom').rosterId, 1);
});

test('add to a first-name team steals the player onto that roster', () => {
  const result = applyScenarioEditorOperations(
    [{ type: 'add', team: 'Mac', players: ["Ja'Marr Chase"] }],
    {
      ...snapshot,
      teams: LEAGUE_TEAMS,
      rosters: { 1: ['100'], 10: [] },
      originalRosters: { 1: ['100'], 10: [] },
    },
    PLAYERS,
  );
  assert.equal(result.ok, true);
  const byRid = Object.fromEntries(result.edits.map((e) => [e.rosterId, e]));
  assert.ok(byRid[1].drop.includes('100'));
  assert.ok(byRid[10].add.includes('100'));
});

test('per-roster alias lists keep a shared last name ambiguous', () => {
  const teams = applyOwnerAliases(
    [
      { rosterId: 1, teamName: 'A', ownerName: 'Tom' },
      { rosterId: 3, teamName: 'B', ownerName: 'Jeff' },
    ],
    new Map([
      ['1', ['tom', 'heatwole']],
      ['3', ['jeff', 'heatwole']],
    ]),
  );
  assert.equal(findScenarioTeam(teams, 'heatwole'), null);
  assert.equal(findScenarioTeam(teams, 'tom').rosterId, 1);
  assert.ok(teams[0].aliases.includes('heatwole'));
  assert.ok(teams[1].aliases.includes('heatwole'));
});

const MAC_AIDAN_TRADE = summarizeTrade({
  transaction_id: 't1',
  created: 1_700_000_000_000,
  roster_ids: [2, 10],
  adds: { '100': 10, '200': 2 },
  drops: { '100': 2, '200': 10 },
  draft_picks: [{ season: '2027', round: 1, owner_id: 2 }],
}, PLAYERS);

test('summarizeTrade infers both sides and keeps pick labels', () => {
  assert.equal(MAC_AIDAN_TRADE.players.length, 2);
  const chase = MAC_AIDAN_TRADE.players.find((p) => p.playerId === '100');
  assert.equal(chase.fromRosterId, '2');
  assert.equal(chase.toRosterId, '10');
  assert.ok(MAC_AIDAN_TRADE.picks.some((p) => /2027 Rd 1/.test(p)));
});

test('reverse_trade between Mac and Aidan sends the players back', () => {
  const result = applyScenarioEditorOperations(
    [{ type: 'reverse_trade', teams: ['Mac', 'Aidan'] }],
    {
      season: '2025',
      teams: LEAGUE_TEAMS,
      rosters: { 2: ['200'], 10: ['100'] },
      originalRosters: { 2: ['200'], 10: ['100'] },
      trades: [MAC_AIDAN_TRADE],
    },
    PLAYERS,
  );
  assert.equal(result.ok, true);
  const byRid = Object.fromEntries(result.edits.map((e) => [e.rosterId, e]));
  assert.deepEqual(byRid[2].add, ['100']);
  assert.deepEqual(byRid[2].drop, ['200']);
  assert.deepEqual(byRid[10].add, ['200']);
  assert.deepEqual(byRid[10].drop, ['100']);
  assert.match(result.summary, /Reversed/i);
  assert.match(result.summary, /picks were ignored/i);
});

test('reverse_trade prefers a deal still reflected on the current rosters', () => {
  const laterNoop = summarizeTrade({
    transaction_id: 'later',
    created: 9_000_000_000_000,
    roster_ids: [2, 10],
    adds: { '300': 2 },
    drops: { '300': 10 },
  }, PLAYERS);
  const live = { ...MAC_AIDAN_TRADE, id: 'live', created: 5 };
  const picked = findMatchingScenarioTrade(
    [laterNoop, live],
    ['2', '10'],
    '',
    { 2: ['200'], 10: ['100'] },
  );
  assert.equal(picked.id, 'live');
});
