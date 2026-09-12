/**
 * Soccer competitions for SOP / SOP2.
 * FanDuel ids come from sbapi attachments.competitions; DK ids from nash league feeds.
 */

export const SOP_TIMING_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live Only' },
  { key: 'future', label: 'Future only' },
];

export const SOP_SOCCER_LEAGUES = [
  {
    key: 'pl',
    name: 'Premier League',
    short: 'EPL',
    tone: 'pl',
    core: true,
    fdId: 10932509,
    dkId: '40253',
    dkSeo: 'england---premier-league',
    espnSlug: 'eng.1',
  },
  {
    key: 'ucl',
    name: 'Champions League',
    short: 'UCL',
    tone: 'ucl',
    core: true,
    fdId: 228,
    dkId: '40685',
    dkSeo: 'uefa-champions-league',
    espnSlug: 'uefa.champions',
  },
  {
    key: 'lal',
    name: 'La Liga',
    short: 'LAL',
    tone: 'lal',
    fdId: 117,
    dkId: '40031',
    dkSeo: 'spain---la-liga',
    espnSlug: 'esp.1',
  },
  {
    key: 'bun',
    name: 'Bundesliga',
    short: 'BUN',
    tone: 'bun',
    fdId: 59,
    dkId: '40481',
    dkSeo: 'germany---1.bundesliga',
    espnSlug: 'ger.1',
  },
  {
    key: 'sea',
    name: 'Serie A',
    short: 'SEA',
    tone: 'sea',
    fdId: 81,
    dkId: '40030',
    dkSeo: 'italy---serie-a',
    espnSlug: 'ita.1',
  },
  {
    key: 'fl1',
    name: 'Ligue 1',
    short: 'FL1',
    tone: 'fl1',
    fdId: 55,
    dkId: '40032',
    dkSeo: 'france---ligue-1',
    espnSlug: 'fra.1',
  },
  {
    key: 'uel',
    name: 'Europa League',
    short: 'UEL',
    tone: 'uel',
    fdId: 2005,
    dkId: '41410',
    dkSeo: 'europa-league',
    espnSlug: 'uefa.europa',
  },
  {
    key: 'uecl',
    name: 'Conference League',
    short: 'UECL',
    tone: 'uecl',
    fdId: 12375833,
    dkId: '205493',
    dkSeo: 'europa-conference-league',
    espnSlug: 'uefa.europa.conf',
  },
  {
    key: 'mls',
    name: 'MLS',
    short: 'MLS',
    tone: 'mls',
    fdId: 141,
    dkId: '89345',
    dkSeo: 'usa---mls',
    espnSlug: 'usa.1',
  },
];

const BY_KEY = new Map(SOP_SOCCER_LEAGUES.map((league) => [league.key, league]));
const BY_FD_ID = new Map(SOP_SOCCER_LEAGUES.map((league) => [Number(league.fdId), league]));

export function leagueByKey(key) {
  return BY_KEY.get(key) ?? null;
}

export function leagueByFdId(competitionId) {
  const id = Number(competitionId);
  if (!Number.isFinite(id)) return null;
  return BY_FD_ID.get(id) ?? null;
}

export function slugCompetitionKey(name, competitionId) {
  const slug = String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  if (slug) return slug;
  return Number.isFinite(Number(competitionId)) ? `comp-${competitionId}` : 'other';
}

export function shortCompetitionLabel(name, fallback = 'SOC') {
  const raw = String(name ?? '').trim();
  if (!raw) return fallback;
  const words = raw.replace(/\([^)]*\)/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  const initials = words
    .filter((word) => !/^(the|and|of|-)$/i.test(word))
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  return (initials || raw).slice(0, 4);
}

export function competitionMetaForFd(competitionId, competitions = {}) {
  const known = leagueByFdId(competitionId);
  if (known) {
    return {
      competitionId: known.fdId,
      competition: known.key,
      competitionName: known.name,
    };
  }

  const raw = competitions[competitionId] ?? competitions[String(competitionId)] ?? {};
  const name = raw.name || `Soccer ${competitionId}`;
  return {
    competitionId: Number(competitionId) || competitionId,
    competition: slugCompetitionKey(name, competitionId),
    competitionName: name,
  };
}

export function competitionBadge(game) {
  const league = leagueByKey(game?.competition);
  return {
    key: game?.competition ?? null,
    short: league?.short ?? shortCompetitionLabel(game?.competitionName, 'SOC'),
    name: league?.name ?? game?.competitionName ?? game?.competition ?? 'Soccer',
    tone: league?.tone ?? 'other',
  };
}

function quoteHasNextGoalMethod(quote) {
  if (!quote || typeof quote !== 'object') return false;
  if (Number.isFinite(quote.american)) return true;
  return Boolean(quote.runnerName);
}

function bookHasNextGoalMethod(book) {
  if (!book || typeof book !== 'object') return false;
  if (book.goalTypes && Object.values(book.goalTypes).some((q) => Number.isFinite(q?.american))) {
    return true;
  }
  return quoteHasNextGoalMethod(book.noGoalMarkets?.nextGoalMethod);
}

/** True when FanDuel or DraftKings posted a Next Goal Method market. */
export function gameHasNextGoalMethod(game) {
  return bookHasNextGoalMethod(game) || bookHasNextGoalMethod(game?.dk);
}

export function gameMatchesTiming(game, timing) {
  if (timing === 'live') return Boolean(game?.inPlay);
  if (timing === 'future') return !game?.inPlay && !game?.espn?.finished;
  return true;
}

export function collectLeagueOptions(games) {
  const byKey = new Map();
  for (const game of games ?? []) {
    const badge = competitionBadge(game);
    const key = badge.key || slugCompetitionKey(badge.name);
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        name: badge.name,
        short: badge.short,
        tone: badge.tone,
      });
    }
  }

  const knownOrder = new Map(SOP_SOCCER_LEAGUES.map((league, index) => [league.key, index]));
  return [...byKey.values()].sort((a, b) => {
    const ai = knownOrder.has(a.key) ? knownOrder.get(a.key) : 1000;
    const bi = knownOrder.has(b.key) ? knownOrder.get(b.key) : 1000;
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });
}

export function gameMatchesLeagues(game, disabledLeagues) {
  if (!disabledLeagues || disabledLeagues.size === 0) return true;
  const key = game?.competition || slugCompetitionKey(game?.competitionName);
  return !disabledLeagues.has(key);
}

export function filterSopBookGames(games, { timing = 'all', disabledLeagues = null, teamQuery = '' } = {}) {
  const q = String(teamQuery ?? '').trim().toLowerCase();
  return (games ?? []).filter((game) => {
    if (!gameMatchesTiming(game, timing)) return false;
    if (!gameMatchesLeagues(game, disabledLeagues)) return false;
    if (!q) return true;
    const parts = [
      game.name,
      game.competitionName,
      game.teams?.home,
      game.teams?.away,
      ...(String(game.name ?? '').split(/\s+v\s+/i)),
    ]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase());
    return parts.some((part) => part.includes(q));
  });
}

export function dkLeagueEntries(scope = 'core') {
  const list = SOP_SOCCER_LEAGUES.filter((league) => {
    if (!league.dkId) return false;
    return scope === 'all' ? true : Boolean(league.core);
  });
  return list.map((league) => ({
    id: String(league.dkId),
    seo: league.dkSeo,
    competition: league.key,
    competitionName: league.name,
    competitionId: league.fdId,
  }));
}

export function espnLeagueKeys(scope = 'core', games = []) {
  if (scope === 'all' && games.length) {
    const keys = new Set();
    for (const game of games) {
      const league = leagueByKey(game.competition);
      if (league?.espnSlug) keys.add(league.key);
    }
    if (keys.size) return [...keys];
  }
  return SOP_SOCCER_LEAGUES
    .filter((league) => league.espnSlug && (scope === 'all' || league.core))
    .map((league) => league.key);
}

export function espnScoreboardConfig(leagueKey) {
  const league = leagueByKey(leagueKey);
  const slug = league?.espnSlug;
  if (!slug) return null;
  return {
    urls: [
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`,
      `https://site.web.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`,
    ],
    referer: `https://www.espn.com/soccer/scoreboard/_/league/${slug}`,
  };
}

export function espnLeagueSlugMap() {
  return Object.fromEntries(
    SOP_SOCCER_LEAGUES
      .filter((league) => league.espnSlug)
      .map((league) => [league.key, league.espnSlug]),
  );
}
