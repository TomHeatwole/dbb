import { isGamblingRoute } from './gamblingNav';

describe('isGamblingRoute', () => {
  it('matches the four gambling pages', () => {
    expect(isGamblingRoute('/corners')).toBe(true);
    expect(isGamblingRoute('/corners/arb')).toBe(true);
    expect(isGamblingRoute('/drives')).toBe(true);
    expect(isGamblingRoute('/SOP2')).toBe(true);
    expect(isGamblingRoute('/rawarb')).toBe(true);
  });

  it('does not match dynasty or other betting pages', () => {
    expect(isGamblingRoute('/home/')).toBe(false);
    expect(isGamblingRoute('/SOP')).toBe(false);
    expect(isGamblingRoute('/FredDuel')).toBe(false);
    expect(isGamblingRoute('/dk')).toBe(false);
  });
});
