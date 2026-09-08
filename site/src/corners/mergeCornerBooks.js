/** Match FanDuel corner rows with DraftKings / Kalshi by canonical fixture. */

const TEAM_ALIASES = {
  'afc bournemouth': 'bournemouth',
  'everton fc': 'everton',
  'fulham fc': 'fulham',
  'arsenal fc': 'arsenal',
  'chelsea fc': 'chelsea',
  'liverpool fc': 'liverpool',
  'brentford fc': 'brentford',
  'sunderland afc': 'sunderland',
  'hull city': 'hull',
  'coventry city': 'coventry',
  'leicester city': 'leicester',
  'ipswich town': 'ipswich',
  'leeds united': 'leeds',
  'nottingham forest': 'nottingham forest',
  'nottm forest': 'nottingham forest',
  "nott'm forest": 'nottingham forest',
  'notts forest': 'nottingham forest',
  'manchester united': 'man utd',
  'man utd': 'man utd',
  'man united': 'man utd',
  'manchester city': 'man city',
  'man city': 'man city',
  'tottenham hotspur': 'tottenham',
  tottenham: 'tottenham',
  spurs: 'tottenham',
  'newcastle united': 'newcastle',
  'brighton and hove albion': 'brighton',
  'brighton hove albion': 'brighton',
  'brighton & hove albion': 'brighton',
  'west ham united': 'west ham',
  'wolverhampton wanderers': 'wolves',
  wolverhampton: 'wolves',
  'crystal palace': 'crystal palace',
  palace: 'crystal palace',
  'aston villa': 'villa',
  villa: 'villa',
  'sheffield united': 'sheff utd',
  'west bromwich albion': 'west brom',
  psg: 'psg',
  'paris st g': 'psg',
  'paris st germain': 'psg',
  'paris saint germain': 'psg',
  inter: 'inter',
  'inter milan': 'inter',
  internazionale: 'inter',
  betis: 'betis',
  'real betis': 'betis',
  psv: 'psv',
  'psv eindhoven': 'psv',
  shakhtar: 'shakhtar',
  'shakhtar donetsk': 'shakhtar',
  roma: 'roma',
  'as roma': 'roma',
  bayern: 'bayern',
  'bayern munich': 'bayern',
  'bayern munchen': 'bayern',
  'fc bayern': 'bayern',
  sabah: 'sabah',
  'fc sabah': 'sabah',
  'sabah fk': 'sabah',
  dortmund: 'dortmund',
  'borussia dortmund': 'dortmund',
  porto: 'porto',
  'fc porto': 'porto',
  sporting: 'sporting',
  'sporting cp': 'sporting',
  'sporting lisbon': 'sporting',
  atletico: 'atletico',
  'atletico madrid': 'atletico',
  glimt: 'glimt',
  'bodo glimt': 'glimt',
  leipzig: 'leipzig',
  'rb leipzig': 'leipzig',
  brugge: 'brugge',
  'club brugge': 'brugge',
  aek: 'aek',
  'aek athens': 'aek',
  lask: 'lask',
  'lask linz': 'lask',
  slovan: 'slovan',
  'slovan bratislava': 'slovan',
};

function stripTeamDecorators(name) {
  return String(name ?? '')
    .replace(/^afc\s+/, '')
    .replace(/\s+afc$/, '')
    .replace(/\s+fc$/, '')
    .replace(/\s+town$/, '')
    .replace(/\s+united$/, '')
    .replace(/\s+hotspur$/, '')
    .trim();
}

function normalizeTeamName(name) {
  let s = String(name ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = TEAM_ALIASES[s] ?? s;
  const stripped = stripTeamDecorators(s);
  s = TEAM_ALIASES[stripped] ?? stripped;
  if (s.endsWith(' city') && s !== 'man city') {
    const short = s.replace(/\s+city$/, '');
    s = TEAM_ALIASES[short] ?? short;
  }
  return TEAM_ALIASES[s] ?? s;
}

export function cornerFixtureKey(name) {
  const stripped = String(name ?? '').replace(/:.*$/, '').trim();
  const parts = stripped.split(/\s+vs\.?\s+|\s+v\s+/i);
  if (parts.length !== 2) return null;
  const pair = [normalizeTeamName(parts[0]), normalizeTeamName(parts[1])].filter(Boolean);
  if (pair.length !== 2) return null;
  return pair.sort().join('|');
}

function indexByFixture(games) {
  const byKey = new Map();
  for (const game of games ?? []) {
    const key = cornerFixtureKey(game.name);
    if (key) byKey.set(key, game);
  }
  return byKey;
}

function dkHasQuotes(game) {
  if (!game) return false;
  if (game.total?.over?.american != null || game.total?.under?.american != null) return true;
  if ((game.totals ?? []).some((row) => row?.over?.american != null || row?.under?.american != null)) {
    return true;
  }
  if (game.firstHalfTotal?.over?.american != null || game.firstHalfTotal?.under?.american != null) {
    return true;
  }
  if (game.secondHalfTotal?.over?.american != null || game.secondHalfTotal?.under?.american != null) {
    return true;
  }
  if ((game.intervals ?? []).some((row) => row?.yes?.american != null || row?.no?.american != null)) {
    return true;
  }
  return false;
}

function klshHasQuotes(game) {
  return (game?.plus ?? []).some((row) => row?.american != null);
}

function windowHasQuotes(window) {
  if (!window) return false;
  if ((window.plus ?? []).some((row) => row?.american != null)) return true;
  if ((window.overUnder ?? []).some((row) => row?.over?.american != null || row?.under?.american != null)) {
    return true;
  }
  return false;
}

function fdHasQuotes(game) {
  if (dkHasQuotes(game)) return true;
  if (game?.numberOfCorners?.unders?.length || game?.numberOfCorners?.overs?.length) return true;
  if (windowHasQuotes(game?.next5) || windowHasQuotes(game?.next10)) return true;
  if (game?.teamCorners && Object.values(game.teamCorners).some(Boolean)) return true;
  return false;
}

export function gameHasFdOrDkCornerLines(game) {
  return fdHasQuotes(game) || dkHasQuotes(game?.dk);
}

function dkPayloadFor(dk) {
  return {
    total: dk.total ?? null,
    totals: dk.totals ?? null,
    firstHalfTotal: dk.firstHalfTotal ?? null,
    secondHalfTotal: dk.secondHalfTotal ?? null,
    intervals: dk.intervals ?? null,
    dkEventId: dk.dkEventId ?? dk.eventId ?? null,
    error: dk.error ?? null,
  };
}

function teamsFromName(name) {
  const parts = String(name ?? '').split(/\s+vs\.?\s+|\s+v\s+/i);
  if (parts.length !== 2) return { home: null, away: null };
  return { home: parts[0].trim(), away: parts[1].trim() };
}

function dkOnlyToFdShape(dk) {
  const dkEventId = dk.dkEventId ?? dk.eventId ?? null;
  return {
    eventId: dkEventId != null ? `dk-${dkEventId}` : dk.eventId,
    name: dk.name,
    openDate: dk.openDate ?? null,
    inPlay: Boolean(dk.inPlay),
    score: dk.score ?? { home: 0, away: 0 },
    scoreDisplay: dk.scoreDisplay ?? '0-0',
    teams: dk.teams ?? teamsFromName(dk.name),
    competition: dk.competition ?? 'ucl',
    competitionId: dk.competitionId ?? null,
    competitionName: dk.competitionName ?? 'Champions League',
    totals: [],
    total: null,
    firstHalfTotal: null,
    numberOfCorners: null,
    teamCorners: null,
    next5: null,
    next10: null,
    dk: dkPayloadFor(dk),
  };
}

export function mergeDkCornersIntoFdGames(fdGames, dkPayload) {
  const dkGames = dkPayload?.games ?? [];
  const byKey = indexByFixture(dkGames);
  const used = new Set();

  const merged = (fdGames ?? []).map((game) => {
    const dk = byKey.get(cornerFixtureKey(game.name));
    if (!dk || !dkHasQuotes(dk)) return { ...game, dk: null };
    used.add(dk);
    return { ...game, dk: dkPayloadFor(dk) };
  });

  for (const dk of dkGames) {
    if (used.has(dk) || !dkHasQuotes(dk)) continue;
    merged.push(dkOnlyToFdShape(dk));
  }

  return merged;
}

/** Premier League stays on the board; UCL only if FD or DK posted corner lines. */
export function keepCornersDisplayGames(games) {
  return (games ?? []).filter((game) => {
    if (game?.competition === 'ucl') return gameHasFdOrDkCornerLines(game);
    return true;
  });
}

export function mergeKalshiCornersIntoFdGames(fdGames, kalshiPayload) {
  const byKey = indexByFixture(kalshiPayload?.games);
  return (fdGames ?? []).map((game) => {
    const klsh = byKey.get(cornerFixtureKey(game.name));
    if (!klsh || !klshHasQuotes(klsh)) return { ...game, klsh: null };
    return {
      ...game,
      klsh: {
        plus: klsh.plus ?? [],
        eventTicker: klsh.eventTicker ?? null,
        error: klsh.error ?? null,
      },
    };
  });
}

export function dkCornerGamesLoaded(dkPayload) {
  return (dkPayload?.games ?? []).some((g) => dkHasQuotes(g));
}

export function kalshiCornerGamesLoaded(kalshiPayload) {
  return (kalshiPayload?.games ?? []).some((g) => klshHasQuotes(g));
}
