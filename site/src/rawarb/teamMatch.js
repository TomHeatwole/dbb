/**
 * Team-name matching so FanDuel "Indianapolis Colts" lines up with
 * DraftKings "IND Colts", and CFB aliases (Texas A&M / TAMU) still hit.
 */

const MASCOT_STOP = new Set([
  'aggies', 'bears', 'bison', 'broncos', 'bruins', 'buckeyes', 'bulldogs',
  'cardinal', 'cavaliers', 'cougars', 'cowboys', 'eagles', 'falcons',
  'gamecocks', 'gators', 'hawkeyes', 'hornets', 'hurricanes', 'jayhawks',
  'longhorns', 'lions', 'mountaineers', 'rebels', 'seminoles', 'spartans',
  'tigers', 'trojans', 'warriors', 'wildcats', 'wolfpack', 'wolverines',
  'university', 'univ', 'the', 'football',
]);

const TEAM_ALIASES = [
  ['jacksonville state', "j'ville st", 'jville st', 'jville state', 'jsu'],
  ['north dakota state', 'nd st', 'ndsu', 'n dakota st'],
  ['eastern michigan', 'e michigan', 'e mich', 'emu'],
  ['sacramento state', 'sac', 'sac state', 'sac st'],
  ['new mexico state', 'nmsu', 'nm state', 'n mexico st'],
  ['florida state', 'florida st', 'fsu'],
  ['hawaii', "hawai'i", 'hawaii rainbow warriors'],
  ['miami florida', 'miami fl', 'miami (fl)', 'miami'],
  ['miami ohio', 'miami oh', 'miami (oh)'],
  ['ole miss', 'mississippi'],
  ['southern california', 'usc', 's california'],
  ['san jose state', 'san josé state', 'sj su', 'sjsu'],
  ['appalachian state', 'app state', 'app st'],
  ['ohio state', 'ohio st'],
  ['penn state', 'penn st', 'psu'],
  ['oklahoma state', 'oklahoma st', 'okst'],
  ['michigan state', 'michigan st', 'msu'],
  ['oregon state', 'oregon st'],
  ['washington state', 'washington st', 'wsu'],
  ['arizona state', 'arizona st', 'asu'],
  ['kansas state', 'kansas st', 'k-state', 'kstate'],
  ['iowa state', 'iowa st'],
  ['utah state', 'utah st'],
  ['fresno state', 'fresno st'],
  ['boise state', 'boise st'],
  ['colorado state', 'colorado st'],
  ['san diego state', 'san diego st', 'sdsu'],
  ['georgia state', 'georgia st'],
  ['georgia southern', 'ga southern'],
  ['georgia tech', 'ga tech'],
  ['texas a&m', 'texas am', 'tamu'],
  ['texas state', 'texas st'],
  ['texas tech', 'tx tech'],
  ['ul monroe', 'ulm', 'louisiana monroe'],
  ['ul lafayette', 'ull', 'louisiana'],
  ['southern miss', 's miss'],
  ['middle tennessee', 'mtsu', 'middle tenn'],
  ['western kentucky', 'w kentucky', 'wku'],
  ['western michigan', 'w michigan', 'wmu'],
  ['central michigan', 'c michigan', 'cmu'],
  ['northern illinois', 'n illinois', 'niu'],
  ['bowling green', 'b green'],
  ['coastal carolina', 'coastal caro'],
  ['south carolina', 's carolina'],
  ['north carolina', 'n carolina', 'unc'],
  ['nc state', 'n carolina st', 'north carolina state'],
  ['virginia tech', 'va tech'],
  ['west virginia', 'w virginia', 'wvu', 'wv'],
  ['notre dame', 'n dame'],
  ['boston college', 'boston col', 'bc'],
  ['mississippi state', 'mississippi st', 'miss st'],
  ['louisiana tech', 'la tech'],
  ['florida international', 'fiu'],
  ['florida atlantic', 'fau'],
  ['connecticut', 'uconn', 'connecticut huskies'],
  ['massachusetts', 'umass', 'u mass', 'massachusetts minutemen'],
  ['utsa', 'ut san antonio', 'texas san antonio'],
  ['utep', 'texas el paso'],
  ['smu', 'southern methodist'],
  ['tcu', 'texas christian'],
  ['ucf', 'central florida'],
  ['usf', 'south florida'],
  ['unlv', 'nevada las vegas'],
  ['byu', 'brigham young'],
  ['lsu', 'louisiana state'],
  ['long island', 'liu', 'long island university'],
  ['new york giants', 'ny giants', 'nyg'],
  ['new york jets', 'ny jets', 'nyj'],
  ['los angeles rams', 'la rams', 'lar'],
  ['los angeles chargers', 'la chargers', 'lac'],
  ['san francisco 49ers', 'sf 49ers', 'sfo'],
  ['tampa bay buccaneers', 'tb buccaneers', 'tam'],
  ['green bay packers', 'gb packers', 'gnb'],
  ['kansas city chiefs', 'kc chiefs', 'kan'],
  ['new england patriots', 'ne patriots', 'nwe'],
  ['new orleans saints', 'no saints', 'nor'],
  ['las vegas raiders', 'lv raiders'],
  ['indianapolis colts', 'ind colts'],
  ['jacksonville jaguars', 'jax jaguars', 'jac jaguars'],
  ['washington commanders', 'was commanders', 'wsh'],
];

const SCHOOL_QUALIFIERS = new Set([
  'state', 'st', 'tech', 'am', 'aandm',
  'southern', 'northern', 'eastern', 'western', 'central', 'middle',
  'coastal', 'international', 'atlantic',
  'north', 'south', 'east', 'west', 'new',
]);

export function normalizeTeam(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['’`]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function expandAlias(raw) {
  const n = normalizeTeam(raw);
  if (!n) return '';
  for (const [canon, ...alts] of TEAM_ALIASES) {
    if (n === canon || alts.includes(n)) return canon;
  }
  return n.replace(/\bst\b/g, 'state').replace(/\s+/g, ' ').trim();
}

function teamTokens(name) {
  return expandAlias(name)
    .split(' ')
    .filter((w) => w && !MASCOT_STOP.has(w) && w.length > 1);
}

export function lastSignificantToken(name) {
  const tokens = expandAlias(name).split(' ').filter(Boolean);
  return tokens[tokens.length - 1] || '';
}

export function namesMatch(a, b) {
  const ca = expandAlias(a);
  const cb = expandAlias(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  const ta = teamTokens(a);
  const tb = teamTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.length === tb.length && ta.every((t) => tb.includes(t)) && tb.every((t) => ta.includes(t))) {
    return true;
  }
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  let contig = false;
  for (let i = 0; i <= longer.length - shorter.length; i += 1) {
    if (shorter.every((w, j) => longer[i + j] === w)) {
      contig = true;
      break;
    }
  }
  if (!contig) return false;
  const extra = longer.filter((t) => !shorter.includes(t));
  return extra.length > 0 && extra.every((t) => !SCHOOL_QUALIFIERS.has(t));
}

/** True only when the label is the team itself — not "Rams Defense" / "Colts TD". */
export function isBareTeamName(label, team) {
  if (!label || !team) return false;
  if (!teamsMatch(label, team) && !namesMatch(label, team)) return false;
  const extra = teamTokens(label).filter((t) => !teamTokens(team).includes(t));
  return extra.length === 0;
}

/** CFB token match, then last-word mascot (IND Colts ↔ Indianapolis Colts). */
export function teamsMatch(a, b) {
  if (namesMatch(a, b)) return true;
  const la = lastSignificantToken(a);
  const lb = lastSignificantToken(b);
  if (!la || !lb || la.length < 3 || lb.length < 3) return false;
  if (SCHOOL_QUALIFIERS.has(la) || SCHOOL_QUALIFIERS.has(lb)) return false;
  return la === lb;
}

export function parseEventTeams(eventName) {
  const raw = String(eventName ?? '').replace(/\s+vs\.?\s+/i, ' @ ');
  if (raw.includes(' @ ')) {
    const [away, home] = raw.split(' @ ').map((s) => s.trim());
    return { home: home || null, away: away || null };
  }
  if (/\s+v\s+/i.test(raw)) {
    const parts = raw.split(/\s+v\s+/i);
    return { home: parts[0]?.trim() || null, away: parts[1]?.trim() || null };
  }
  return { home: null, away: null };
}

export function gamesMatch(a, b) {
  return gameOrientation(a, b) != null;
}

/** `same` | `swap` | null — swap covers neutral-site home/away flips. */
export function gameOrientation(a, b) {
  if (!a?.home || !a?.away || !b?.home || !b?.away) return null;
  if (teamsMatch(a.home, b.home) && teamsMatch(a.away, b.away)) return 'same';
  if (teamsMatch(a.home, b.away) && teamsMatch(a.away, b.home)) return 'swap';
  return null;
}
