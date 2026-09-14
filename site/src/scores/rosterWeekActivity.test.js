import { rosterWeekActivity } from './rosterWeekActivity';

const row = (id) => ({ id });

test('allGamesFinished when every labeled player is done or on bye', () => {
  const activity = rosterWeekActivity(
    {
      starters: [row('1'), row('2')],
      bench: [row('3')],
    },
    {
      1: { completed: true, text: 'Final' },
      2: { live: false, completed: true, text: 'Final' },
      3: { text: 'BYE' },
    }
  );
  expect(activity).toEqual({
    live: 0,
    yetToPlay: 0,
    labeled: 3,
    allGamesFinished: true,
  });
});

test('not finished while anyone is live or yet to play', () => {
  expect(rosterWeekActivity(
    { starters: [row('1')], bench: [] },
    { 1: { live: true, text: 'Q2' } }
  ).allGamesFinished).toBe(false);

  expect(rosterWeekActivity(
    { starters: [row('1')], bench: [] },
    { 1: { completed: false, text: 'Sun 1:00' } }
  ).allGamesFinished).toBe(false);
});

test('empty labels do not count as finished', () => {
  expect(rosterWeekActivity(
    { starters: [row('1'), row('2')], bench: [] },
    {}
  )).toEqual({
    live: 0,
    yetToPlay: 0,
    labeled: 0,
    allGamesFinished: false,
  });
});
