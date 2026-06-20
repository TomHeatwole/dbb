/**
 * Manual KTC historical name → Sleeper player_id overrides.
 * Used when fuzzy matching fails (nicknames, spelling, duplicate names).
 */
const KTC_HISTORICAL_SLEEPER_ALIASES = {
  'Gabriel Davis': '6943', // Sleeper: Gabe Davis
  'Jeffery Wilson': '5284', // Sleeper: Jeff Wilson (KTC misspelling)
  'Andrew Ogletree': '8489', // Sleeper: Drew Ogletree
  'Josh Palmer': '7670', // Sleeper: Joshua Palmer
  'Nyheim Hines': '5347', // Sleeper: Nyheim Miller-Hines
  'Mike Williams': '4068', // younger WR (Clemson); not 748 (Syracuse, b.1987)
};

function lookupSleeperAlias(ktcName, sleeperPool) {
  const sleeperId = KTC_HISTORICAL_SLEEPER_ALIASES[ktcName];
  if (!sleeperId) return null;
  const candidate = sleeperPool.find((c) => c.sleeperId === sleeperId);
  if (!candidate) {
    throw new Error(`alias sleeper_id ${sleeperId} for "${ktcName}" not found in players.txt`);
  }
  return { candidate, strategy: 'alias' };
}

module.exports = {
  KTC_HISTORICAL_SLEEPER_ALIASES,
  lookupSleeperAlias,
};
