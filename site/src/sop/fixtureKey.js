/** Canonical team slugs so FanDuel / DraftKings fixture names merge. */

const TEAM_SLUG_ALIASES = {
  hull: 'hull',
  'hull-city': 'hull',
  'nottm-forest': 'nottingham-forest',
  'nottingham-forest': 'nottingham-forest',
  'man-utd': 'man-utd',
  'manchester-united': 'man-utd',
  'man-city': 'man-city',
  'manchester-city': 'man-city',
  tottenham: 'tottenham',
  'tottenham-hotspur': 'tottenham',
  newcastle: 'newcastle',
  'newcastle-united': 'newcastle',
  brighton: 'brighton',
  'brighton-hove-albion': 'brighton',
  'brighton-and-hove-albion': 'brighton',
  bournemouth: 'bournemouth',
  'afc-bournemouth': 'bournemouth',
  ipswich: 'ipswich',
  'ipswich-town': 'ipswich',
  leeds: 'leeds',
  'leeds-united': 'leeds',
  wolves: 'wolves',
  wolverhampton: 'wolves',
  'wolverhampton-wanderers': 'wolves',
  psg: 'psg',
  'paris-st-g': 'psg',
  'paris-st-germain': 'psg',
  'paris-saint-germain': 'psg',
  inter: 'inter',
  'inter-milan': 'inter',
  internazionale: 'inter',
  'fc-internazionale': 'inter',
  betis: 'betis',
  'real-betis': 'betis',
  psv: 'psv',
  'psv-eindhoven': 'psv',
  shakhtar: 'shakhtar',
  'shakhtar-donetsk': 'shakhtar',
  roma: 'roma',
  'as-roma': 'roma',
  bayern: 'bayern',
  'bayern-munich': 'bayern',
  'bayern-munchen': 'bayern',
  'fc-bayern': 'bayern',
  'fc-bayern-munich': 'bayern',
  sabah: 'sabah',
  'fc-sabah': 'sabah',
  'sabah-fk': 'sabah',
  dortmund: 'dortmund',
  'borussia-dortmund': 'dortmund',
  porto: 'porto',
  'fc-porto': 'porto',
  sporting: 'sporting',
  'sporting-cp': 'sporting',
  'sporting-lisbon': 'sporting',
  atletico: 'atletico',
  'atletico-madrid': 'atletico',
  'atletico-de-madrid': 'atletico',
  glimt: 'glimt',
  'bodo-glimt': 'glimt',
  'bodo-glimt-fk': 'glimt',
  leipzig: 'leipzig',
  'rb-leipzig': 'leipzig',
  brugge: 'brugge',
  'club-brugge': 'brugge',
  'club-brugge-kv': 'brugge',
  aek: 'aek',
  'aek-athens': 'aek',
  lask: 'lask',
  'lask-linz': 'lask',
  slovan: 'slovan',
  'slovan-bratislava': 'slovan',
  'sk-slovan-bratislava': 'slovan',
};

export function fdNameToSlug(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+vs\.?\s+/gi, '-vs-')
    .replace(/\s+v\s+/gi, '-vs-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeTeamSlug(team) {
  const slug = fdNameToSlug(team);
  return TEAM_SLUG_ALIASES[slug] ?? slug;
}

export function splitFixtureTeams(name) {
  return String(name ?? '')
    .split(/\s+vs\.?\s+|\s+v\s+/i)
    .map((team) => team.trim())
    .filter(Boolean);
}

export function fixtureTeamKey(name) {
  const parts = splitFixtureTeams(name)
    .map((team) => normalizeTeamSlug(team))
    .filter(Boolean)
    .sort();
  return parts.length === 2 ? parts.join('|') : null;
}

/** Loose key used when both sides already share FanDuel-style "Home v Away" names. */
export function gameMergeKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\s+vs\.?\s+/gi, '|')
    .replace(/\s+v\s+/gi, '|')
    .replace(/[^a-z0-9|]+/g, '')
    .trim();
}
