/**
 * FanDuel event types + DraftKings leagues we can actually pair.
 * Only two-sided events that exist on both books are kept.
 */

export const FD_EVENT_TYPES = [
  { id: 6423, defaultSport: 'cfb' },
  { id: 7522, defaultSport: 'hoop' },
  { id: 7511, defaultSport: 'base' },
  { id: 7524, defaultSport: 'hockey' },
  { id: 1, defaultSport: 'soccer' },
  { id: 2, defaultSport: 'tennis' },
  { id: 6, defaultSport: 'boxing' },
  { id: 5, defaultSport: 'rugby' },
  { id: 1477, defaultSport: 'rugby' },
  { id: 4, defaultSport: 'cricket' },
  { id: 998917, defaultSport: 'volleyball' },
];

export const FD_COMPETITION_SPORT = {
  12282733: 'nfl',
  12529073: 'cfb',
  12488538: 'cfl',
  11353530: 'cfl',
  10547864: 'nba',
  11428089: 'nba',
  11295025: 'wnba',
  11196870: 'mlb',
  12550521: 'nhl',
  12634197: 'hockey',
};

export const DK_LEAGUES = [
  { id: '88808', sport: 'nfl', path: 'football/nfl' },
  { id: '87637', sport: 'cfb', path: 'football/ncaaf' },
  { id: '154752', sport: 'cfb', path: 'football/ncaa-fcs' },
  { id: '33567', sport: 'cfl', path: 'football/cfl' },
  { id: '42648', sport: 'nba', path: 'basketball/nba' },
  { id: '79507', sport: 'nba', path: 'basketball/nba-preseason' },
  { id: '92483', sport: 'ncaab', path: 'basketball/ncaab' },
  { id: '94682', sport: 'wnba', path: 'basketball/wnba' },
  { id: '42161', sport: 'hoop', path: 'basketball/euroleague' },
  { id: '44863', sport: 'hoop', path: 'basketball/turkey---bsl' },
  { id: '73069', sport: 'hoop', path: 'basketball/greece---basket-league' },
  { id: '84240', sport: 'mlb', path: 'baseball/mlb' },
  { id: '42133', sport: 'nhl', path: 'hockey/nhl' },
  { id: '84813', sport: 'hockey', path: 'hockey/ncaa-hockey' },
  { id: '40480', sport: 'hockey', path: 'hockey/finnish-sm-liiga' },
  { id: '38522', sport: 'hockey', path: 'hockey/swedish-hockey-league' },
  { id: '23223', sport: 'hockey', path: 'hockey/german-del' },
  { id: '59537', sport: 'hockey', path: 'hockey/czech-extraliga' },
  { id: '9034', sport: 'mma', path: 'mma/ufc' },
  { id: '72061', sport: 'boxing', path: 'boxing/boxing' },
  { id: '78723', sport: 'tennis', path: 'tennis/wta-beijing' },
  { id: '78720', sport: 'tennis', path: 'tennis/atp-beijing' },
  { id: '78721', sport: 'tennis', path: 'tennis/atp-tokyo' },
  { id: '40253', sport: 'soccer', path: 'soccer/england---premier-league' },
  { id: '40685', sport: 'soccer', path: 'soccer/uefa-champions-league' },
  { id: '40031', sport: 'soccer', path: 'soccer/spain---la-liga' },
  { id: '40481', sport: 'soccer', path: 'soccer/germany---1.bundesliga' },
  { id: '40030', sport: 'soccer', path: 'soccer/italy---serie-a' },
  { id: '40032', sport: 'soccer', path: 'soccer/france---ligue-1' },
  { id: '41410', sport: 'soccer', path: 'soccer/europa-league' },
  { id: '205493', sport: 'soccer', path: 'soccer/europa-conference-league' },
  { id: '89345', sport: 'soccer', path: 'soccer/usa---mls' },
  { id: '110988', sport: 'soccer', path: 'soccer/uefa-nations-league' },
  { id: '56803', sport: 'soccer', path: 'soccer/friendly-international' },
  { id: '197584', sport: 'soccer', path: 'soccer/concacaf-nations-league' },
  { id: '40817', sport: 'soccer', path: 'soccer/england---championship' },
  { id: '40818', sport: 'soccer', path: 'soccer/scotland---premiership' },
  { id: '44525', sport: 'soccer', path: 'soccer/mexico---liga-mx' },
  { id: '38529', sport: 'soccer', path: 'soccer/brazil---serie-a' },
  { id: '21638', sport: 'cricket', path: 'cricket/one-day-internationals' },
  { id: '91402', sport: 'rugby', path: 'rugbyunion/six-nations' },
  { id: '82508', sport: 'rugby', path: 'rugbyleague/nrl-premiership' },
];

export const SPORT_META = {
  nfl: { label: 'NFL', match: 'loose' },
  cfb: { label: 'CFB', match: 'loose' },
  cfl: { label: 'CFL', match: 'loose' },
  nba: { label: 'NBA', match: 'loose' },
  ncaab: { label: 'NCAAB', match: 'loose' },
  wnba: { label: 'WNBA', match: 'loose' },
  hoop: { label: 'Hoops', match: 'loose' },
  mlb: { label: 'MLB', match: 'loose' },
  base: { label: 'Baseball', match: 'loose' },
  nhl: { label: 'NHL', match: 'loose' },
  hockey: { label: 'Hockey', match: 'loose' },
  soccer: { label: 'Soccer', match: 'strict' },
  tennis: { label: 'Tennis', match: 'person' },
  mma: { label: 'MMA', match: 'person' },
  boxing: { label: 'Boxing', match: 'person' },
  rugby: { label: 'Rugby', match: 'strict' },
  cricket: { label: 'Cricket', match: 'strict' },
  volleyball: { label: 'Volleyball', match: 'strict' },
};

export const SPORT_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'cfb', label: 'CFB' },
  { id: 'nfl', label: 'NFL' },
  { id: 'nba', label: 'NBA' },
  { id: 'mlb', label: 'MLB' },
  { id: 'nhl', label: 'NHL' },
  { id: 'soccer', label: 'Soccer' },
  { id: 'tennis', label: 'Tennis' },
  { id: 'mma', label: 'MMA' },
  { id: 'boxing', label: 'Boxing' },
  { id: 'wnba', label: 'WNBA' },
  { id: 'ncaab', label: 'NCAAB' },
  { id: 'hoop', label: 'Hoops' },
  { id: 'cfl', label: 'CFL' },
  { id: 'hockey', label: 'Hockey' },
  { id: 'rugby', label: 'Rugby' },
  { id: 'cricket', label: 'Cricket' },
  { id: 'volleyball', label: 'Volley' },
];

export const ML_MARKET_NAMES = ['Moneyline', 'Money Line', 'Winner', 'Draw No Bet', 'To Win'];
export const SOCCER_ML_MARKET_NAMES = ['Draw No Bet', 'Moneyline (2-way)', '2-Way Moneyline', '2 Way Moneyline'];

export function mlMarketNamesForSport(sport) {
  return sport === 'soccer' ? SOCCER_ML_MARKET_NAMES : ML_MARKET_NAMES;
}
export const SPREAD_MARKET_NAMES = [
  'Spread', 'Puck Line', 'Run Line', 'Point Spread', 'Game Spread',
  'Asian Handicap', 'Handicap', 'Game Handicap', 'Set Handicap',
];
export const TOTAL_MARKET_NAMES = [
  'Total Points', 'Total', 'Total Runs', 'Total Goals', 'Total Games',
  'Total Sets', 'Total Rounds', 'Total Corners', 'Total Goals - Full Time',
];

const SKIP_EVENT = /futures|awards|draft|outright|specials|top region|player awards|daily specials|outrights/i;
const SKIP_COMP = /futures|awards|draft|efootball|ebasketball|h2h gg|e-?sport|outright/i;

export function dkReferer(league) {
  return `https://sportsbook.draftkings.com/leagues/${league.path}`;
}

export function sportFromFd(eventTypeId, competitionId, competitionName = '') {
  const known = FD_COMPETITION_SPORT[Number(competitionId)];
  if (known) return known;
  if (SKIP_COMP.test(competitionName)) return null;
  const et = FD_EVENT_TYPES.find((row) => row.id === Number(eventTypeId));
  return et?.defaultSport ?? null;
}

export function matchModeForSport(sport) {
  return SPORT_META[sport]?.match || 'loose';
}

export function sportLabel(sport) {
  return SPORT_META[sport]?.label || String(sport || '').toUpperCase();
}

export function isTwoSidedName(name) {
  return /(?:\s@\s|\svs\.?\s|\sv\s)/i.test(String(name ?? ''));
}

export function isSkippableEventName(name) {
  return SKIP_EVENT.test(String(name ?? ''));
}

export function isSkippableCompetition(name) {
  return SKIP_COMP.test(String(name ?? ''));
}

export function hasDrawSide(names) {
  return (names ?? []).some((name) => /\bdraw\b|\btie\b|neither|^x$/i.test(String(name ?? '').trim()));
}

export function isTwoWayWinnerName(marketName) {
  return /draw no bet|2[\s-]?way|to qualify/i.test(String(marketName ?? ''))
    && !/3[\s-]?way/i.test(String(marketName ?? ''));
}

/** Set-combo / listed-set "Moneyline" is not the match winner. */
export function isNonMatchWinnerMarket(name, hint = '') {
  return /both win set|listed set|win a set|both players to win/i.test(`${name ?? ''} ${hint ?? ''}`);
}

/** 1X2 / match-result. Draw No Bet is the only soccer 2-way winner we keep. */
export function isThreeWayMoneyline(marketName, runnerNames = []) {
  const name = String(marketName ?? '');
  if (isTwoWayWinnerName(name)) return false;
  if (/3[\s-]?way|1x2|match result/i.test(name)) return true;
  if (hasDrawSide(runnerNames)) return true;
  if (/moneyline|winner|to win|match result/i.test(name) && (runnerNames ?? []).length >= 3) {
    return true;
  }
  return false;
}

export function sportFiltersFor() {
  return SPORT_FILTERS;
}

export function leagueByDkId(id) {
  return DK_LEAGUES.find((row) => String(row.id) === String(id)) ?? null;
}
