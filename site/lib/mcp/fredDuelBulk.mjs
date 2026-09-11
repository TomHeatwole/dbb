/**
 * HwangAI bulk-offer clerk for FredDuel.
 *
 * The model extracts a batch of proposed lines; this module resolves team
 * names, fills safe defaults (min take $1, 24h expiry), and either returns
 * post-ready drafts or a missing-info list the model must ask about.
 * Nothing here posts to the exchange.
 */

import { applyOwnerAliases, findScenarioTeam } from './scenarioEditor.mjs';

const KINDS = new Set(['season', 'weekly', 'custom']);

const SEASON_OUTCOMES = new Set([
  'win_league', 'make_playoffs', 'miss_playoffs',
  'finish_better', 'finish_worse', 'finish_above_team',
  'season_outscore_14', 'season_outscore_17',
  'points_over_14', 'points_under_14', 'points_over_17', 'points_under_17',
]);

const WEEKLY_OUTCOMES = new Set([
  'weekly_outscore', 'weekly_finish_above', 'weekly_finish_below',
  'weekly_points_over', 'weekly_points_under',
]);

const PLACE_LINES = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5];

const OUTCOME_NEEDS = {
  finish_better: 'place',
  finish_worse: 'place',
  finish_above_team: 'opponent',
  season_outscore_14: 'opponent',
  season_outscore_17: 'opponent',
  points_over_14: 'points',
  points_under_14: 'points',
  points_over_17: 'points',
  points_under_17: 'points',
  weekly_outscore: 'opponent',
  weekly_finish_above: 'place',
  weekly_finish_below: 'place',
  weekly_points_over: 'points',
  weekly_points_under: 'points',
};

const EXPIRY_MS = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
};

const DEFAULT_EXPIRY = '24h';
const DEFAULT_MIN_TAKE = 1;

function asArray(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function roundCents(x) {
  return Math.round((Number(x) + Number.EPSILON) * 100) / 100;
}

function isValidLine(line) {
  return Number.isInteger(line) && (line >= 100 || line <= -100);
}

function formatLine(line) {
  const n = Number(line);
  return n > 0 ? `+${n}` : `${n}`;
}

function maxStakeForExposure(exposure, line) {
  if (exposure <= 0) return 0;
  const floorCents = (v) => Math.floor((Number(v) + 1e-9) * 100) / 100;
  if (line > 0) return floorCents(exposure * (100 / line));
  return floorCents(exposure * (-line / 100));
}

function lineFromProbability(p) {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null;
  let line;
  if (p >= 0.5) {
    line = -Math.round((100 * p) / (1 - p));
    if (line > -100) line = -100;
  } else {
    line = Math.round((100 * (1 - p)) / p);
    if (line < 100) line = 100;
  }
  return line;
}

/** Parse +150 / -110 / even / 50% / 2/1 into an American integer, or null. */
export function parseFlexibleLine(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.round(raw);
    return isValidLine(n) ? n : null;
  }
  const text = String(raw).trim().toLowerCase();
  if (!text) return null;
  if (text === 'even' || text === 'ev' || text === 'even money') return 100;

  const pct = text.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (pct) {
    const p = Number(pct[1]) / 100;
    return lineFromProbability(p);
  }

  const frac = text.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (frac) {
    const a = Number(frac[1]);
    const b = Number(frac[2]);
    if (b > 0) return lineFromProbability(b / (a + b));
  }

  const cleaned = text.replace(/odds|american|line/g, '').trim();
  if (/^[+-]?\d+$/.test(cleaned)) {
    const n = parseInt(cleaned, 10);
    return isValidLine(n) ? n : null;
  }
  return null;
}

function parseMoney(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const text = String(raw).replace(/[$,]/g, '').replace(/\s*(each|apiece|per)\b/i, '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function parseExpiry(raw, now = Date.now()) {
  if (raw == null || raw === '') return null;
  const text = String(raw).trim().toLowerCase();
  if (EXPIRY_MS[text]) return now + EXPIRY_MS[text];
  const hours = text.match(/^(\d+(?:\.\d+)?)\s*h(ours?)?$/);
  if (hours) return now + Number(hours[1]) * 60 * 60 * 1000;
  const days = text.match(/^(\d+(?:\.\d+)?)\s*d(ays?)?$/);
  if (days) return now + Number(days[1]) * 24 * 60 * 60 * 1000;
  const iso = new Date(raw).getTime();
  if (Number.isFinite(iso)) return iso;
  return null;
}

function fmtPoints(points) {
  const n = Number(points);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '?';
}

function describeMarket(market) {
  if (!market) return '';
  const team = market.teamName || 'Team ?';
  const opp = market.opponentName || 'Team ?';
  const { outcome, place, points, week } = market;
  if (market.kind === 'season') {
    switch (outcome) {
      case 'win_league': return `${team} to win the league`;
      case 'make_playoffs': return `${team} to make the playoffs`;
      case 'miss_playoffs': return `${team} to miss the playoffs`;
      case 'finish_better': return `${team} to finish better than ${place} place`;
      case 'finish_worse': return `${team} to finish worse than ${place} place`;
      case 'finish_above_team': return `${team} to finish better than ${opp} in the standings`;
      case 'season_outscore_14': return `${team} to outscore ${opp} (weeks 1-14)`;
      case 'season_outscore_17': return `${team} to outscore ${opp} (weeks 1-17)`;
      case 'points_over_14': return `${team} to score more than ${fmtPoints(points)} points (weeks 1-14)`;
      case 'points_under_14': return `${team} to score fewer than ${fmtPoints(points)} points (weeks 1-14)`;
      case 'points_over_17': return `${team} to score more than ${fmtPoints(points)} points (weeks 1-17)`;
      case 'points_under_17': return `${team} to score fewer than ${fmtPoints(points)} points (weeks 1-17)`;
      default: return `${team} — ${outcome}`;
    }
  }
  if (market.kind === 'weekly') {
    const wk = `week ${week}`;
    switch (outcome) {
      case 'weekly_outscore': return `${team} to outscore ${opp} in ${wk}`;
      case 'weekly_finish_above': return `${team} to finish better than ${place} in ${wk} scoring`;
      case 'weekly_finish_below': return `${team} to finish worse than ${place} in ${wk} scoring`;
      case 'weekly_points_over': return `${team} to score more than ${fmtPoints(points)} points in ${wk}`;
      case 'weekly_points_under': return `${team} to score fewer than ${fmtPoints(points)} points in ${wk}`;
      default: return `${team} — ${outcome} (${wk})`;
    }
  }
  return '';
}

function resolveTeam(teams, query, identity) {
  if (query == null || String(query).trim() === '') return null;
  const q = String(query).trim();
  if (/^(my|mine|me|us|our)(\s+team)?$/i.test(q) && identity?.rosterId != null) {
    return teams.find((t) => Number(t.rosterId) === Number(identity.rosterId)) || null;
  }
  return findScenarioTeam(teams, q);
}

function pick(obj, key, fallback) {
  if (obj && obj[key] != null && obj[key] !== '') return obj[key];
  return fallback;
}

/**
 * Appended to the system prompt so the model can name teams correctly.
 */
export function formatFredDuelContext(snapshot) {
  const teams = snapshot?.teams || [];
  const week = snapshot?.currentWeek ?? 1;
  const lines = [
    '════════════════════════════════════════',
    'FREDDUEL BOARD',
    '════════════════════════════════════════',
    `Upcoming week (weekly bets lock to this): ${week}`,
    '',
    'Teams (name, owner, roster id — use any of these):',
  ];
  for (const t of teams) {
    const aliases = (t.aliases || []).filter(Boolean).join(', ');
    lines.push(
      `- ${t.teamName || 'Team'} | owner: ${t.ownerName || '—'} | rosterId ${t.rosterId}`
      + (aliases ? ` | also: ${aliases}` : ''),
    );
  }
  lines.push(
    '',
    'Structured outcomes you may use:',
    'Season: win_league, make_playoffs, miss_playoffs, finish_better, finish_worse,',
    'finish_above_team, season_outscore_14, season_outscore_17,',
    'points_over_14, points_under_14, points_over_17, points_under_17.',
    'Weekly: weekly_outscore, weekly_finish_above, weekly_finish_below,',
    'weekly_points_over, weekly_points_under.',
    'Place lines: 1.5 2.5 3.5 4.5 5.5 6.5 7.5 8.5 9.5.',
    'If it does not fit a structured outcome, use marketKind custom with a title.',
  );
  return lines.join('\n');
}

export function buildFredDuelSnapshot(fredduel, ownerNamesMap) {
  const teams = applyOwnerAliases(fredduel?.teams || [], ownerNamesMap);
  return {
    teams,
    currentWeek: Number(fredduel?.currentWeek) || 1,
    identity: fredduel?.identity || null,
  };
}

function validateStructured(kind, offer, teams, identity, currentWeek) {
  const missing = [];
  const notes = [];
  const team = resolveTeam(teams, offer.team, identity);
  if (!team) {
    missing.push(offer.team ? `which team "${offer.team}" is` : 'the team for this bet');
  }
  const outcome = String(offer.outcome || '').trim();
  const allowed = kind === 'season' ? SEASON_OUTCOMES : WEEKLY_OUTCOMES;
  if (!allowed.has(outcome)) {
    missing.push('a structured outcome (or switch this one to custom)');
  }
  const needs = OUTCOME_NEEDS[outcome];
  let opponent = null;
  let place = null;
  let points = null;
  let week = kind === 'weekly' ? (Number(offer.week) || currentWeek) : undefined;

  if (kind === 'weekly') {
    if (!Number.isInteger(week) || week < 1 || week > 17) {
      week = currentWeek;
      notes.push(`Weekly bet defaulted to the upcoming week (${currentWeek}).`);
    }
  }

  if (needs === 'opponent') {
    opponent = resolveTeam(teams, offer.opponent, identity);
    if (!opponent) {
      missing.push(offer.opponent ? `which opponent "${offer.opponent}" is` : 'the opponent');
    } else if (team && Number(opponent.rosterId) === Number(team.rosterId)) {
      missing.push('a different opponent than the subject team');
    }
  }
  if (needs === 'place') {
    place = Number(offer.place);
    if (!PLACE_LINES.includes(place)) {
      missing.push('a place line (1.5 through 9.5)');
    }
  }
  if (needs === 'points') {
    points = Number(offer.points);
    if (!Number.isFinite(points) || points <= 0) {
      missing.push('a points total');
    }
  }

  if (missing.length || !team) {
    return { missing, notes, market: null, title: '' };
  }

  const market = {
    kind,
    teamRosterId: Number(team.rosterId),
    teamName: team.teamName,
    outcome,
    ...(needs === 'place' ? { place } : {}),
    ...(needs === 'points' ? { points } : {}),
    ...(needs === 'opponent' ? {
      opponentRosterId: Number(opponent.rosterId),
      opponentName: opponent.teamName,
    } : {}),
    ...(kind === 'weekly' ? { week } : {}),
  };
  return { missing: [], notes, market, title: describeMarket(market) };
}

/**
 * Validate a proposed batch. Returns either post-ready drafts or a
 * missing-info report the model should ask about — never posts.
 */
export function proposeFredDuelOffers(args, snapshot) {
  const teams = snapshot?.teams || [];
  const identity = snapshot?.identity || null;
  const currentWeek = snapshot?.currentWeek || 1;
  const defaults = args?.defaults && typeof args.defaults === 'object' ? args.defaults : {};
  const offers = asArray(args?.offers);

  if (!offers.length) {
    return {
      ok: false,
      drafts: [],
      toolMessage: 'No offers in the proposal. Ask the user what they want to lay, then call again.',
    };
  }

  const now = Date.now();
  const defaultLine = parseFlexibleLine(defaults.line);
  const defaultExposure = parseMoney(defaults.maxExposure);
  const defaultMinTake = parseMoney(defaults.minTake);
  const defaultPerPerson = defaults.maxExposurePerPerson == null || defaults.maxExposurePerPerson === ''
    ? null
    : parseMoney(defaults.maxExposurePerPerson);
  const defaultExpiryMs = parseExpiry(defaults.expiresIn || DEFAULT_EXPIRY, now)
    || (now + EXPIRY_MS[DEFAULT_EXPIRY]);

  const problems = [];
  const drafts = [];

  offers.forEach((raw, idx) => {
    const n = idx + 1;
    const kind = String(raw?.marketKind || raw?.kind || '').trim().toLowerCase();
    const label = raw?.title || raw?.team || `offer ${n}`;
    if (!KINDS.has(kind)) {
      problems.push(`#${n} (${label}): say whether this is season, weekly, or custom.`);
      return;
    }

    const line = parseFlexibleLine(pick(raw, 'line', defaultLine));
    const exposure = parseMoney(pick(raw, 'maxExposure', defaultExposure));
    const minTake = parseMoney(pick(raw, 'minTake', defaultMinTake ?? DEFAULT_MIN_TAKE)) ?? DEFAULT_MIN_TAKE;
    const perRaw = pick(raw, 'maxExposurePerPerson', defaultPerPerson);
    const perPerson = perRaw == null || perRaw === '' || perRaw === false
      ? null
      : parseMoney(perRaw);
    const expiresAtMs = parseExpiry(pick(raw, 'expiresIn', defaults.expiresIn), now) || defaultExpiryMs;

    const missing = [];
    if (line == null) missing.push('odds (an American line like +150 or -110)');
    if (exposure == null || exposure < 1) missing.push('max exposure (most they are willing to lose on this line)');
    if (expiresAtMs <= now) missing.push('an expiry in the future');
    if (expiresAtMs > now + 366 * 24 * 60 * 60 * 1000) missing.push('an expiry within a year');

    let market = null;
    let title = '';
    let description = '';
    const notes = [];

    if (kind === 'custom') {
      title = String(raw?.title || '').trim();
      description = String(raw?.description || '').trim();
      if (!title) missing.push('a title for this custom bet');
    } else {
      const structured = validateStructured(kind, raw, teams, identity, currentWeek);
      missing.push(...structured.missing);
      notes.push(...structured.notes);
      market = structured.market;
      title = structured.title;
    }

    if (line != null && exposure != null && exposure >= 1) {
      const maxStake = maxStakeForExposure(exposure, line);
      if (minTake > maxStake) {
        missing.push(
          `a min take that fits this book (at ${formatLine(line)}, $${exposure} exposure covers at most a $${maxStake} take)`,
        );
      }
      if (perPerson != null) {
        if (perPerson < 1) missing.push('a per-person cap of at least $1, or leave it off');
        else if (perPerson > exposure) missing.push('a per-person cap that does not exceed total exposure');
      }
    }

    if (missing.length) {
      problems.push(`#${n} (${label}): still need ${missing.join('; ')}.`);
      return;
    }

    drafts.push({
      marketKind: kind,
      market,
      title: title.slice(0, 200),
      description: description.slice(0, 2000),
      line,
      maxExposure: roundCents(exposure),
      maxExposurePerPerson: perPerson != null ? roundCents(perPerson) : null,
      minTake: roundCents(minTake),
      expiresAt: new Date(expiresAtMs).toISOString(),
      notes,
    });
  });

  if (problems.length) {
    return {
      ok: false,
      drafts: [],
      toolMessage: [
        'Proposal is not ready to show the user. Do NOT claim the lines are staged.',
        'Ask for the missing pieces in one tight message, then call this tool again.',
        ...problems,
      ].join('\n'),
    };
  }

  const summary = drafts.map((d, i) => (
    `${i + 1}. ${d.title} at ${formatLine(d.line)}, $${d.maxExposure} exposure`
  )).join('\n');

  return {
    ok: true,
    drafts,
    toolMessage: [
      `Validated ${drafts.length} offer${drafts.length === 1 ? '' : 's'}. The page will open a review dialog.`,
      'The user still has to click Confirm and post lines. Do not say they are live.',
      summary,
    ].join('\n'),
    summary: `${drafts.length} offer${drafts.length === 1 ? '' : 's'} ready to review. Nothing is live until you confirm.`,
  };
}

export const FREDDUEL_FILE_MAX_COUNT = 3;
export const FREDDUEL_FILE_MAX_PDF = 2 * 1024 * 1024;
export const FREDDUEL_FILE_MAX_TEXT = 200 * 1024;

const PDF_MIME = 'application/pdf';

function base64ByteLength(data) {
  const s = String(data || '').replace(/\s+/g, '');
  if (!s) return 0;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((s.length * 3) / 4) - pad);
}

function looksLikePdf(b64) {
  try {
    const head = Buffer.from(String(b64 || '').slice(0, 24), 'base64').toString('latin1');
    return head.startsWith('%PDF');
  } catch {
    return false;
  }
}

/**
 * Turn uploaded FredDuel files into Gemini parts. Text/CSV should already be
 * inlined in the user message; this is for PDFs. Images are rejected.
 */
export function fredDuelFilesToGeminiParts(files) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return { parts: [], error: null };

  if (list.length > FREDDUEL_FILE_MAX_COUNT) {
    return { parts: [], error: `Attach at most ${FREDDUEL_FILE_MAX_COUNT} files.` };
  }

  const parts = [];
  let pdfBytes = 0;
  for (const file of list) {
    const name = String(file?.name || 'file').slice(0, 120);
    const mime = String(file?.mimeType || '').toLowerCase();
    const data = String(file?.data || '').replace(/\s+/g, '');
    if (mime.startsWith('image/')) {
      return { parts: [], error: 'Images are not supported. Attach a .txt, .csv, or .pdf.' };
    }
    if (mime !== PDF_MIME) {
      return { parts: [], error: `Unsupported file type for ${name}. Use .txt, .csv, or .pdf.` };
    }
    const bytes = base64ByteLength(data);
    if (!data || bytes < 8) {
      return { parts: [], error: `${name} is empty.` };
    }
    if (bytes > FREDDUEL_FILE_MAX_PDF) {
      return { parts: [], error: `${name} is over 2 MB.` };
    }
    pdfBytes += bytes;
    if (pdfBytes > FREDDUEL_FILE_MAX_PDF) {
      return { parts: [], error: 'PDFs together must stay under 2 MB.' };
    }
    if (!looksLikePdf(data)) {
      return { parts: [], error: `${name} does not look like a PDF.` };
    }
    parts.push({
      inlineData: { mimeType: PDF_MIME, data },
    });
  }
  return { parts, error: null };
}

/** Append validated PDF parts onto the latest user turn. */
export function attachFredDuelFilesToContents(contents, files) {
  const { parts, error } = fredDuelFilesToGeminiParts(files);
  if (error) return { error };
  if (!parts.length) return { error: null };
  const list = Array.isArray(contents) ? contents : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.role === 'user') {
      list[i].parts = [...(list[i].parts || []), ...parts];
      return { error: null };
    }
  }
  list.push({ role: 'user', parts });
  return { error: null };
}
