jest.mock('../utils/database', () => ({
  updatePlayers: jest.fn(),
  readCurrentWeekPlayersSnapshot: jest.fn(),
  readPlayersSnapshot: jest.fn(),
}));

import { STARTER_POSITION_NAMES } from '../utils/global_constants';
import { startSitWithProjections } from './projectionScoring';

function player(id, position, name) {
  return { [id]: { full_name: name, position } };
}

function runPuppyBowl() {
  const playersData = {
    ...player('purdy', 'QB', 'Brock Purdy'),
    ...player('jones', 'QB', 'M. Jones'),
    ...player('ward', 'QB', 'M. Ward'),
    ...player('love', 'QB', 'Jordan Love'),
    ...player('rb1', 'RB', 'RB One'),
    ...player('rb2', 'RB', 'RB Two'),
    ...player('rb3', 'RB', 'RB Three'),
    ...player('puka', 'WR', 'P. Nacua'),
    ...player('waddle', 'WR', 'J. Waddle'),
    ...player('burden', 'WR', 'L. Burden'),
    ...player('washington', 'WR', 'M. Washington'),
    ...player('ferguson', 'TE', 'T. Ferguson'),
    ...player('loveland', 'TE', 'C. Loveland'),
    ...player('laporta', 'TE', 'S. LaPorta'),
    ...player('flexrb', 'RB', 'Bench RB'),
  };
  const labels = {
    purdy: { completed: true, live: false, text: 'Final' },
    jones: { completed: true, live: false, text: 'Final' },
    puka: { completed: true, live: false, text: 'Final' },
    ferguson: { completed: true, live: false, text: 'Final' },
  };
  const projected = {
    purdy: 18,
    love: 14.5,
    jones: 12,
    ward: 17.1,
    rb1: 10,
    rb2: 9,
    rb3: 8,
    puka: 13.4,
    waddle: 9.2,
    burden: 8.4,
    washington: 6.1,
    ferguson: 3.6,
    loveland: 11.2,
    laporta: 11.1,
    flexrb: 5.0,
  };
  const teamScore = {
    starters: [
      { id: 'purdy', pts: 21.1 },
      { id: 'rb1', pts: 0 },
      { id: 'rb2', pts: 0 },
      { id: 'rb3', pts: 0 },
      { id: 'puka', pts: 7.4 },
      { id: 'waddle', pts: 0 },
      { id: 'burden', pts: 0 },
      { id: 'ferguson', pts: 0 },
      { id: 'loveland', pts: 0 },
      { id: 'laporta', pts: 0 },
      { id: 'jones', pts: 0 },
    ],
    bench: [
      { id: 'washington', pts: 0 },
      { id: 'ward', pts: 0 },
      { id: 'love', pts: 0 },
      { id: 'flexrb', pts: 0 },
    ],
  };
  return startSitWithProjections(
    teamScore,
    playersData,
    {},
    labels,
    {},
    {},
    projected,
    'scores'
  );
}

function starterById(result, id) {
  return (result.starters || []).find((p) => String(p.id) === id);
}

function slotOf(result, id) {
  const index = (result.starters || []).findIndex((p) => String(p.id) === id);
  return index >= 0 ? STARTER_POSITION_NAMES[index] : null;
}

function inStarters(result, id) {
  return Boolean(starterById(result, id));
}

describe('higher-projection bench hints', () => {
  it('keeps a finished WR at WR and does not hint a lower bench proj', () => {
    const result = runPuppyBowl();
    expect(inStarters(result, 'puka')).toBe(true);
    expect(slotOf(result, 'puka')).toMatch(/^WR/);
    expect(starterById(result, 'puka').higherBenchProj).toBeUndefined();
  });

  it('keeps a big QB score at QB1 with no lower-proj hint', () => {
    const result = runPuppyBowl();
    expect(slotOf(result, 'purdy')).toBe('QB1');
    expect(starterById(result, 'purdy').higherBenchProj).toBeUndefined();
  });

  it('drops a completed 0.0 for the higher-proj player who has not played', () => {
    const result = runPuppyBowl();
    expect(inStarters(result, 'ferguson')).toBe(false);
    expect(inStarters(result, 'jones')).toBe(false);
    expect(inStarters(result, 'washington')).toBe(true);
    expect(slotOf(result, 'loveland')).toBe('TE1');
  });

  it('keeps a live 0.0 over an unplayed bench player', () => {
    const result = startSitWithProjections(
      {
        starters: [
          { id: 'qb-start', pts: 0 },
          { id: 'rb1', pts: 0 },
          { id: 'rb2', pts: 0 },
          { id: 'rb3', pts: 0 },
          { id: 'puka', pts: 0 },
          { id: 'waddle', pts: 0 },
          { id: 'burden', pts: 0 },
          { id: 'ferguson', pts: 0 },
          { id: 'loveland', pts: 0 },
          { id: 'laporta', pts: 0 },
          { id: 'jones', pts: 0 },
        ],
        bench: [
          { id: 'washington', pts: 0 },
          { id: 'ward', pts: 0 },
          { id: 'flexrb', pts: 0 },
        ],
      },
      {
        ...player('qb-start', 'QB', 'Started QB'),
        ...player('jones', 'QB', 'M. Jones'),
        ...player('ward', 'QB', 'M. Ward'),
        ...player('rb1', 'RB', 'RB One'),
        ...player('rb2', 'RB', 'RB Two'),
        ...player('rb3', 'RB', 'RB Three'),
        ...player('puka', 'WR', 'P. Nacua'),
        ...player('waddle', 'WR', 'J. Waddle'),
        ...player('burden', 'WR', 'L. Burden'),
        ...player('washington', 'WR', 'M. Washington'),
        ...player('ferguson', 'TE', 'T. Ferguson'),
        ...player('loveland', 'TE', 'C. Loveland'),
        ...player('laporta', 'TE', 'S. LaPorta'),
        ...player('flexrb', 'RB', 'Bench RB'),
      },
      {},
      { puka: { live: true, completed: false, text: 'Q2' } },
      {},
      {},
      {
        'qb-start': 18,
        jones: 12,
        ward: 17.1,
        rb1: 10,
        rb2: 9,
        rb3: 8,
        puka: 13.4,
        waddle: 9.2,
        burden: 8.4,
        washington: 6.1,
        ferguson: 3.6,
        loveland: 11.2,
        laporta: 11.1,
        flexrb: 5.0,
      },
      'scores'
    );
    expect(inStarters(result, 'puka')).toBe(true);
  });

  it('drops a finished PUP/OUT/IR even if they have a small score', () => {
    const result = startSitWithProjections(
      {
        starters: [
          { id: 'qb-start', pts: 0 },
          { id: 'rb1', pts: 0 },
          { id: 'rb2', pts: 0 },
          { id: 'rb3', pts: 0 },
          { id: 'puka', pts: 4.0 },
          { id: 'waddle', pts: 0 },
          { id: 'burden', pts: 0 },
          { id: 'ferguson', pts: 0 },
          { id: 'loveland', pts: 0 },
          { id: 'laporta', pts: 0 },
          { id: 'jones', pts: 0 },
        ],
        bench: [
          { id: 'washington', pts: 0 },
          { id: 'ward', pts: 0 },
          { id: 'flexrb', pts: 0 },
        ],
      },
      {
        ...player('qb-start', 'QB', 'Started QB'),
        ...player('jones', 'QB', 'M. Jones'),
        ...player('ward', 'QB', 'M. Ward'),
        ...player('rb1', 'RB', 'RB One'),
        ...player('rb2', 'RB', 'RB Two'),
        ...player('rb3', 'RB', 'RB Three'),
        puka: { full_name: 'P. Nacua', position: 'WR', injury_status: 'PUP' },
        ...player('waddle', 'WR', 'J. Waddle'),
        ...player('burden', 'WR', 'L. Burden'),
        ...player('washington', 'WR', 'M. Washington'),
        ...player('ferguson', 'TE', 'T. Ferguson'),
        ...player('loveland', 'TE', 'C. Loveland'),
        ...player('laporta', 'TE', 'S. LaPorta'),
        ...player('flexrb', 'RB', 'Bench RB'),
      },
      {},
      { puka: { completed: true, live: false, text: 'Final' } },
      {},
      {},
      {
        'qb-start': 18,
        jones: 12,
        ward: 17.1,
        rb1: 10,
        rb2: 9,
        rb3: 8,
        puka: 13.4,
        waddle: 9.2,
        burden: 8.4,
        washington: 6.1,
        ferguson: 3.6,
        loveland: 11.2,
        laporta: 11.1,
        flexrb: 5.0,
      },
      'scores'
    );
    expect(inStarters(result, 'puka')).toBe(false);
    expect(inStarters(result, 'washington')).toBe(true);
  });

  function runDrakeHiggins(mayePts = 8) {
    return startSitWithProjections(
      {
        starters: [
          { id: 'maye', pts: mayePts },
          { id: 'rb1', pts: 0 },
          { id: 'rb2', pts: 0 },
          { id: 'rb3', pts: 0 },
          { id: 'wr1', pts: 0 },
          { id: 'wr2', pts: 0 },
          { id: 'wr3', pts: 0 },
          { id: 'te1', pts: 0 },
          { id: 'flex1', pts: 0 },
          { id: 'flex2', pts: 0 },
          { id: 'stafford', pts: 4 },
        ],
        bench: [
          { id: 'lamar', pts: 0 },
          { id: 'jcm', pts: 0 },
        ],
      },
      {
        ...player('maye', 'QB', 'Drake Maye'),
        ...player('lamar', 'QB', 'Lamar Jackson'),
        ...player('stafford', 'QB', 'Matthew Stafford'),
        ...player('jcm', 'RB', 'Jacory Croskey-Merritt'),
        ...player('rb1', 'RB', 'RB One'),
        ...player('rb2', 'RB', 'RB Two'),
        ...player('rb3', 'RB', 'RB Three'),
        ...player('wr1', 'WR', 'WR One'),
        ...player('wr2', 'WR', 'WR Two'),
        ...player('wr3', 'WR', 'WR Three'),
        ...player('te1', 'TE', 'TE One'),
        ...player('flex1', 'TE', 'TE Two'),
        ...player('flex2', 'WR', 'WR Four'),
      },
      {},
      {
        maye: { live: true, completed: false, text: 'Q2' },
        stafford: { completed: true, live: false, text: 'Final' },
      },
      {},
      {},
      {
        maye: 18,
        lamar: 24,
        stafford: 17.8,
        jcm: 7.9,
        rb1: 16,
        rb2: 15.5,
        rb3: 15.2,
        wr1: 16,
        wr2: 15.5,
        wr3: 15.2,
        te1: 16,
        flex1: 15.8,
        flex2: 15.6,
      },
      'scores'
    );
  }

  it('hints Lamar on the QB and slides JCM onto SUPER', () => {
    const result = runDrakeHiggins();
    expect(slotOf(result, 'maye')).toBe('QB1');
    expect(slotOf(result, 'stafford')).toBe('SUPER');
    expect(inStarters(result, 'jcm')).toBe(false);
    expect(starterById(result, 'maye').higherBenchProj).toEqual(expect.objectContaining({
      id: 'lamar',
      name: 'Lamar Jackson',
    }));
    expect(starterById(result, 'stafford').higherBenchProj).toEqual(expect.objectContaining({
      id: 'jcm',
      name: 'Jacory Croskey-Merritt',
    }));
  });

  it('uses current + pregame × time left as the live outlook', () => {
    const result = startSitWithProjections(
      {
        starters: [
          { id: 'maye', pts: 8 },
          { id: 'rb1', pts: 0 },
          { id: 'rb2', pts: 0 },
          { id: 'rb3', pts: 0 },
          { id: 'wr1', pts: 0 },
          { id: 'wr2', pts: 0 },
          { id: 'wr3', pts: 0 },
          { id: 'te1', pts: 0 },
          { id: 'flex1', pts: 0 },
          { id: 'flex2', pts: 0 },
          { id: 'stafford', pts: 0 },
        ],
        bench: [],
      },
      {
        ...player('maye', 'QB', 'Drake Maye'),
        ...player('stafford', 'QB', 'Matthew Stafford'),
        ...player('rb1', 'RB', 'RB One'),
        ...player('rb2', 'RB', 'RB Two'),
        ...player('rb3', 'RB', 'RB Three'),
        ...player('wr1', 'WR', 'WR One'),
        ...player('wr2', 'WR', 'WR Two'),
        ...player('wr3', 'WR', 'WR Three'),
        ...player('te1', 'TE', 'TE One'),
        ...player('flex1', 'TE', 'TE Two'),
        ...player('flex2', 'WR', 'WR Four'),
      },
      {},
      { maye: { live: true, completed: false, timeRemainingFrac: 0.5, text: 'Q2' } },
      {},
      {},
      { maye: 16, stafford: 14, rb1: 10, rb2: 9, rb3: 8, wr1: 10, wr2: 9, wr3: 8, te1: 8, flex1: 7, flex2: 6 },
      'scores'
    );
    const maye = starterById(result, 'maye');
    expect(maye.actualPts).toBe(8);
    expect(maye.projRemaining).toBe(8);
    expect(maye.currentExpected).toBe(16);
  });

  it('locks an Out player at the current score with no leftover', () => {
    const result = startSitWithProjections(
      {
        starters: [
          { id: 'maye', pts: 5.2 },
          { id: 'rb1', pts: 0 },
          { id: 'rb2', pts: 0 },
          { id: 'rb3', pts: 0 },
          { id: 'wr1', pts: 0 },
          { id: 'wr2', pts: 0 },
          { id: 'wr3', pts: 0 },
          { id: 'te1', pts: 0 },
          { id: 'flex1', pts: 0 },
          { id: 'flex2', pts: 0 },
          { id: 'stafford', pts: 0 },
        ],
        bench: [],
      },
      {
        ...player('maye', 'QB', 'Drake Maye'),
        ...player('stafford', 'QB', 'Matthew Stafford'),
        ...player('rb1', 'RB', 'RB One'),
        ...player('rb2', 'RB', 'RB Two'),
        ...player('rb3', 'RB', 'RB Three'),
        ...player('wr1', 'WR', 'WR One'),
        ...player('wr2', 'WR', 'WR Two'),
        ...player('wr3', 'WR', 'WR Three'),
        ...player('te1', 'TE', 'TE One'),
        ...player('flex1', 'TE', 'TE Two'),
        ...player('flex2', 'WR', 'WR Four'),
      },
      {},
      { maye: { live: true, completed: false, timeRemainingFrac: 0.6, text: 'Q2' } },
      { maye: 'Out' },
      {},
      { maye: 18, stafford: 14, rb1: 10, rb2: 9, rb3: 8, wr1: 10, wr2: 9, wr3: 8, te1: 8, flex1: 7, flex2: 6 },
      'scores'
    );
    const maye = starterById(result, 'maye');
    expect(maye.actualPts).toBe(5.2);
    expect(maye.projRemaining).toBe(0);
    expect(maye.currentExpected).toBe(5.2);
    expect(maye.ptsSource).toBe('actual');
  });

  it('does not hint a bench player whose game is already final', () => {
    const result = startSitWithProjections(
      {
        starters: [
          { id: 'mclaurin', pts: 7.7 },
          { id: 'rb1', pts: 10 },
          { id: 'rb2', pts: 9 },
          { id: 'rb3', pts: 8 },
          { id: 'wr1', pts: 10 },
          { id: 'wr2', pts: 9 },
          { id: 'wr3', pts: 8 },
          { id: 'te1', pts: 8 },
          { id: 'flex1', pts: 7 },
          { id: 'flex2', pts: 6 },
          { id: 'qb1', pts: 18 },
        ],
        bench: [
          { id: 'corum', pts: 3.2 },
        ],
      },
      {
        ...player('mclaurin', 'WR', 'Terry McLaurin'),
        ...player('corum', 'RB', 'Blake Corum'),
        ...player('qb1', 'QB', 'QB One'),
        ...player('rb1', 'RB', 'RB One'),
        ...player('rb2', 'RB', 'RB Two'),
        ...player('rb3', 'RB', 'RB Three'),
        ...player('wr1', 'WR', 'WR One'),
        ...player('wr2', 'WR', 'WR Two'),
        ...player('wr3', 'WR', 'WR Three'),
        ...player('te1', 'TE', 'TE One'),
        ...player('flex1', 'TE', 'TE Two'),
        ...player('flex2', 'WR', 'WR Four'),
      },
      {},
      {
        mclaurin: { completed: true, live: false, text: 'Final' },
        corum: { completed: true, live: false, text: 'Final' },
        qb1: { completed: true, live: false, text: 'Final' },
        rb1: { completed: true, live: false, text: 'Final' },
        rb2: { completed: true, live: false, text: 'Final' },
        rb3: { completed: true, live: false, text: 'Final' },
        wr1: { completed: true, live: false, text: 'Final' },
        wr2: { completed: true, live: false, text: 'Final' },
        wr3: { completed: true, live: false, text: 'Final' },
        te1: { completed: true, live: false, text: 'Final' },
        flex1: { completed: true, live: false, text: 'Final' },
        flex2: { completed: true, live: false, text: 'Final' },
      },
      {},
      {},
      {
        mclaurin: 6.5,
        corum: 7.9,
        qb1: 18,
        rb1: 10,
        rb2: 9,
        rb3: 8,
        wr1: 10,
        wr2: 9,
        wr3: 8,
        te1: 8,
        flex1: 7,
        flex2: 6,
      },
      'scores'
    );
    const hinted = (result.starters || []).some((p) => p && p.higherBenchProj && String(p.higherBenchProj.id) === 'corum');
    expect(hinted).toBe(false);
  });

  it('slides Lamar to SUPER when the QB has already outscored him', () => {
    const result = runDrakeHiggins(26);
    expect(starterById(result, 'maye').higherBenchProj).toBeUndefined();
    expect(starterById(result, 'stafford').higherBenchProj).toEqual(expect.objectContaining({
      id: 'lamar',
      name: 'Lamar Jackson',
    }));
  });
});

