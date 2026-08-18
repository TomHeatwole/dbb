import { POSITIONS, SCENARIOS, RFI, VS_RFI, VS_3BET, VS_4BET, handLabel } from './ranges';

const TYPE_IDS = ['rfi', 'vs_rfi', 'vs_3bet', 'vs_4bet'];

function parseVsRfiKey(key) {
  if (key.includes('LIMP')) return null;
  const parts = key.split(' vs ');
  if (parts.length !== 2) return null;
  return { myPos: parts[0], villainPos: parts[1] };
}

function parse3BetKey(key) {
  if (key.includes('LIMP')) return null;
  const match = key.match(/^(.+) vs (.+) 3B$/);
  if (!match) return null;
  return { myPos: match[1], villainPos: match[2] };
}

function parse4BetKey(key) {
  const match = key.match(/^(.+) vs (.+) 4B$/);
  if (!match) return null;
  return { myPos: match[1], villainPos: match[2] };
}

function buildSpots() {
  const spots = { rfi: [], vs_rfi: [], vs_3bet: [], vs_4bet: [] };

  for (const pos of POSITIONS) {
    if (RFI[pos]) {
      spots.rfi.push({ scenarioId: 'rfi', myPos: pos, villainPos: '', chart: RFI[pos] });
    }
  }

  for (const [key, chart] of Object.entries(VS_RFI)) {
    const parsed = parseVsRfiKey(key);
    if (!parsed) continue;
    spots.vs_rfi.push({ scenarioId: 'vs_rfi', ...parsed, chart });
  }

  for (const [key, chart] of Object.entries(VS_3BET)) {
    const parsed = parse3BetKey(key);
    if (!parsed) continue;
    spots.vs_3bet.push({ scenarioId: 'vs_3bet', ...parsed, chart });
  }

  for (const [key, chart] of Object.entries(VS_4BET)) {
    const parsed = parse4BetKey(key);
    if (!parsed) continue;
    spots.vs_4bet.push({ scenarioId: 'vs_4bet', ...parsed, chart });
  }

  return spots;
}

const SPOTS = buildSpots();

export function getSpotCounts() {
  return {
    rfi: SPOTS.rfi.length,
    vs_rfi: SPOTS.vs_rfi.length,
    vs_3bet: SPOTS.vs_3bet.length,
    vs_4bet: SPOTS.vs_4bet.length,
  };
}

export function defaultMix() {
  return getSpotCounts();
}

function isBorderline(grid, r, c) {
  const action = grid[r][c];
  const neighbors = [
    [r - 1, c],
    [r + 1, c],
    [r, c - 1],
    [r, c + 1],
    [r - 1, c - 1],
    [r - 1, c + 1],
    [r + 1, c - 1],
    [r + 1, c + 1],
  ];
  return neighbors.some(([nr, nc]) => (
    nr >= 0 && nr < 13 && nc >= 0 && nc < 13 && grid[nr][nc] !== action
  ));
}

function pickWeighted(items, getWeight) {
  const weights = items.map(getWeight);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let roll = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

function pickType(mix) {
  const available = TYPE_IDS.filter(id => (mix[id] || 0) > 0 && SPOTS[id].length > 0);
  if (available.length === 0) {
    return pickWeighted(TYPE_IDS, id => SPOTS[id].length);
  }
  return pickWeighted(available, id => mix[id]);
}

function reachedThisSpot(spot, r, c) {
  if (spot.scenarioId === 'rfi' || spot.scenarioId === 'vs_rfi') return true;

  if (spot.scenarioId === 'vs_3bet') {
    const prior = RFI[spot.myPos];
    return Boolean(prior && prior[r][c] === 'R');
  }

  if (spot.scenarioId === 'vs_4bet') {
    const prior = VS_RFI[`${spot.myPos} vs ${spot.villainPos}`];
    return Boolean(prior && prior[r][c] === '3');
  }

  return true;
}

function buildReachMask(spot) {
  return Array.from({ length: 13 }, (_, r) =>
    Array.from({ length: 13 }, (_, c) => reachedThisSpot(spot, r, c))
  );
}

function pickHand(spot, difficulty) {
  const cells = [];
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      if (!reachedThisSpot(spot, r, c)) continue;
      cells.push({ r, c, border: isBorderline(spot.chart, r, c) });
    }
  }
  if (cells.length === 0) return null;
  const d = Math.max(0, Math.min(1, difficulty));
  return pickWeighted(cells, cell => (1 - d) + d * (cell.border ? 1 : 0));
}

function questionKey(spot, hand) {
  return `${spot.scenarioId}|${spot.myPos}|${spot.villainPos}|${hand}`;
}

const TYPE_LABELS = {
  rfi: 'Open',
  vs_rfi: 'Against Open',
  vs_3bet: '3-Bet',
  vs_4bet: '4-Bet',
};

function youAre(pos) {
  switch (pos) {
    case 'UTG': return "You're UTG";
    case 'UTG+1': return "You're UTG+1";
    case 'LJ': return "You're in the lojack";
    case 'HJ': return "You're in the hijack";
    case 'CO': return "You're in the cutoff";
    case 'BTN': return "You're on the button";
    case 'SB': return "You're in the small blind";
    case 'BB': return "You're in the big blind";
    default: return `You're in ${pos}`;
  }
}

function seat(pos) {
  switch (pos) {
    case 'UTG': return 'UTG';
    case 'UTG+1': return 'UTG+1';
    case 'LJ': return 'the lojack';
    case 'HJ': return 'the hijack';
    case 'CO': return 'the cutoff';
    case 'BTN': return 'the button';
    case 'SB': return 'the small blind';
    case 'BB': return 'the big blind';
    default: return pos;
  }
}

function fromSeat(pos) {
  if (pos === 'UTG' || pos === 'UTG+1') return pos;
  return seat(pos);
}

function cap(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function describeSpot(spot) {
  const { scenarioId, myPos, villainPos } = spot;
  if (scenarioId === 'rfi') {
    if (myPos === 'UTG') return "You're UTG, first to act.";
    if (myPos === 'BTN') return 'Folded to you on the button.';
    if (myPos === 'UTG+1') return 'Folded to you in UTG+1.';
    return `Folded to you in ${seat(myPos)}.`;
  }
  if (scenarioId === 'vs_rfi') {
    return `${cap(seat(villainPos))} opens. ${youAre(myPos)}.`;
  }
  if (scenarioId === 'vs_3bet') {
    const open = myPos === 'UTG' || myPos === 'UTG+1'
      ? `You open ${myPos}`
      : `You open from ${seat(myPos)}`;
    return `${open}. ${cap(seat(villainPos))} 3-bets.`;
  }
  if (scenarioId === 'vs_4bet') {
    return `${cap(seat(villainPos))} opens, you 3-bet from ${fromSeat(myPos)}, ${seat(villainPos)} 4-bets.`;
  }
  return '';
}

function cardsToText(cards = []) {
  return cards.map(card => `${card.rank}${card.suit}`).join(' ');
}

function difficultyLabel(difficulty) {
  if (difficulty === 0) return 'Easy';
  if (difficulty === 100) return 'Hard';
  return `${difficulty}% hard`;
}

export function formatQuizExport({
  questions,
  guesses,
  mix,
  difficulty,
  continuous,
  immediate,
  questionCount,
  sessionKind = 'quiz',
}) {
  const total = questions.length;
  const correctCount = questions.reduce((sum, q, i) => (
    guesses[i] && guesses[i] === q.correctAction ? sum + 1 : sum
  ), 0);
  const missCount = questions.reduce((sum, q, i) => (
    guesses[i] && guesses[i] !== q.correctAction ? sum + 1 : sum
  ), 0);
  const skipped = questions.filter((_, i) => !guesses[i]).length;
  const mixLine = TYPE_IDS.map(id => `${TYPE_LABELS[id]} ${mix?.[id] ?? 0}`).join(' / ');
  const pct = total ? Math.round((correctCount / total) * 100) : 0;

  const missByScenario = {};
  const missByPair = {};
  let borderlineMisses = 0;
  let interiorMisses = 0;
  questions.forEach((q, i) => {
    if (!guesses[i] || guesses[i] === q.correctAction) return;
    const label = q.scenarioLabel || TYPE_LABELS[q.scenarioId] || q.scenarioId;
    missByScenario[label] = (missByScenario[label] || 0) + 1;
    const pair = `${q.actionLabels[guesses[i]] || guesses[i]} → ${q.actionLabels[q.correctAction] || q.correctAction}`;
    missByPair[pair] = (missByPair[pair] || 0) + 1;
    if (q.borderline) borderlineMisses += 1;
    else interiorMisses += 1;
  });

  const lines = [
    'Preflop quiz results',
    "Source: Jonathan Little's Ultimate $1/$3 Cash Game Preflop Guide (100BB)",
    `Exported: ${new Date().toISOString()}`,
    '',
    'This dump is for another model to diagnose leaks. Chart = correct action from the guide.',
    'Borderline = the hand sits on a range edge (neighbors have a different action). Interior misses are more likely real leaks.',
    '',
    'Settings',
    `- Mode: ${sessionKind === 'hands' ? 'Hand player (each street is one question; the first action counts)' : 'Quiz'}`,
    sessionKind === 'hands'
      ? `- Length: ${total} streets`
      : `- Length: ${continuous ? 'continuous' : `${questionCount} questions`} (${total} answered/shown)`,
    sessionKind === 'hands' ? null : `- Mix weights: ${mixLine}`,
    sessionKind === 'hands' ? null : `- Difficulty: ${difficultyLabel(difficulty)}`,
    sessionKind === 'hands' ? '- Scoring: first click on each street' : `- Scoring: ${immediate ? 'show answer immediately' : 'score at the end'}`,
    '',
    `Score: ${correctCount}/${total} (${pct}%)`,
    `Misses: ${missCount}`,
    skipped ? `Unanswered: ${skipped}` : null,
    '',
    '========== MISS SUMMARY ==========',
    missCount === 0 ? 'No misses.' : null,
    ...Object.entries(missByScenario).map(([k, n]) => `- ${k}: ${n}`),
    missCount ? `- Borderline misses: ${borderlineMisses}` : null,
    missCount ? `- Interior misses: ${interiorMisses}` : null,
    ...Object.entries(missByPair).map(([k, n]) => `- ${k}: ${n}`),
    '',
    '========== QUESTIONS ==========',
  ].filter(line => line !== null);

  questions.forEach((q, i) => {
    const guess = guesses[i];
    const correct = guess && guess === q.correctAction;
    const status = !guess ? 'SKIPPED' : (correct ? 'CORRECT' : 'WRONG');
    const yourLabel = guess ? (q.actionLabels[guess] || guess) : '—';
    const chartLabel = q.actionLabels[q.correctAction] || q.correctAction;
    lines.push('');
    lines.push(`--- Question ${i + 1} [${status}] ---`);
    lines.push(`Scenario: ${q.scenarioLabel} (${q.scenarioId})`);
    lines.push(`Spot: ${q.prompt}`);
    if (q.sessionNote) lines.push(`Context: ${q.sessionNote}`);
    lines.push(`Hero: ${q.myPos}`);
    lines.push(`Villain: ${q.villainPos || '—'}`);
    lines.push(`Hand: ${q.hand} (${cardsToText(q.cards)})`);
    lines.push(`Borderline: ${q.borderline ? 'yes (near a range edge)' : 'no (interior / more obvious)'}`);
    lines.push(`Your answer: ${yourLabel} [${guess || 'none'}]`);
    lines.push(`Chart: ${chartLabel} [${q.correctAction}]`);
  });

  lines.push('');
  lines.push('========== END ==========');
  return `${lines.join('\n')}\n`;
}

const SUIT_CYCLE = ['s', 'h', 'd', 'c'];

export function cardsFromHand(hand) {
  const rank1 = hand[0] === 'T' ? '10' : hand[0];
  const rank2 = hand[1] === 'T' ? '10' : hand[1];
  const pair = hand.length === 2;
  const suited = hand[2] === 's';
  const seed = (hand.charCodeAt(0) * 7 + hand.charCodeAt(1) * 13) % 4;
  const suitA = SUIT_CYCLE[seed];
  const suitB = pair || !suited
    ? SUIT_CYCLE[(seed + 1) % 4]
    : suitA;
  return [
    { rank: rank1, suit: suitA },
    { rank: rank2, suit: suitB },
  ];
}

export function generateQuestion(mix, difficulty, recentKeys = []) {
  const recent = new Set(recentKeys);
  let spot;
  let cell;
  let key;
  for (let attempt = 0; attempt < 200; attempt++) {
    const type = pickType(mix);
    const pool = SPOTS[type];
    spot = pool[Math.floor(Math.random() * pool.length)];
    cell = pickHand(spot, difficulty);
    if (!cell) continue;
    key = questionKey(spot, handLabel(cell.r, cell.c));
    if (!recent.has(key)) break;
  }

  if (!cell) {
    cell = { r: 0, c: 0 };
    spot = SPOTS.rfi[0];
  }

  return questionFromSpot(spot, cell.r, cell.c);
}

function questionFromSpot(spot, r, c, cards) {
  const scenario = SCENARIOS.find(s => s.id === spot.scenarioId);
  const hand = handLabel(r, c);
  const action = spot.chart[r][c];
  return {
    key: questionKey(spot, hand),
    scenarioId: spot.scenarioId,
    scenarioLabel: scenario.label,
    myPos: spot.myPos,
    villainPos: spot.villainPos,
    needsVillainPos: scenario.needsVillainPos,
    hand,
    handR: r,
    handC: c,
    correctAction: action,
    chart: spot.chart,
    actionLabels: scenario.actionLabels,
    actionColors: scenario.actionColors,
    prompt: describeSpot(spot),
    cards: cards || cardsFromHand(hand),
    reachMask: buildReachMask(spot),
    borderline: isBorderline(spot.chart, r, c),
  };
}

export function generateQuiz(count, mix, difficulty) {
  const questions = [];
  const recent = [];
  for (let i = 0; i < count; i++) {
    const q = generateQuestion(mix, difficulty, recent);
    questions.push(q);
    recent.push(q.key);
  }
  return questions;
}

function pickItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function findSpot(scenarioId, myPos, villainPos) {
  return SPOTS[scenarioId].find(s => s.myPos === myPos && s.villainPos === (villainPos || ''));
}

function pickHandCell(spot, preferPlay) {
  const cells = [];
  const play = [];
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      if (!reachedThisSpot(spot, r, c)) continue;
      const cell = { r, c };
      cells.push(cell);
      if (spot.chart[r][c] !== 'F') play.push(cell);
    }
  }
  if (!cells.length) return { r: 0, c: 0 };
  if (preferPlay && play.length) return pickItem(play);
  return pickItem(cells);
}

export function generateHand() {
  const pool = [...SPOTS.rfi, ...SPOTS.vs_rfi];
  const spot = pickItem(pool);
  const cell = pickHandCell(spot, Math.random() < 0.7);
  return questionFromSpot(spot, cell.r, cell.c);
}

export function isStreetTerminal(action) {
  return action === 'F' || action === 'C' || action === 'AI';
}

export function continueHand(street) {
  if (!street || isStreetTerminal(street.correctAction)) return null;

  if (street.scenarioId === 'rfi' && street.correctAction === 'R') {
    const heroIdx = POSITIONS.indexOf(street.myPos);
    const villains = POSITIONS.filter((pos, i) => (
      i > heroIdx && VS_3BET[`${street.myPos} vs ${pos} 3B`]
    ));
    if (!villains.length) return null;
    const next = findSpot('vs_3bet', street.myPos, pickItem(villains));
    if (!next) return null;
    return questionFromSpot(next, street.handR, street.handC, street.cards);
  }

  if (street.scenarioId === 'vs_rfi' && street.correctAction === '3') {
    const next = findSpot('vs_4bet', street.myPos, street.villainPos);
    if (!next) return null;
    return questionFromSpot(next, street.handR, street.handC, street.cards);
  }

  return null;
}

export function streetOverReason(street) {
  if (!street) return 'Hand over.';
  if (street.correctAction === 'F') return 'You fold. Hand over.';
  if (street.correctAction === 'C') return 'You call. Seeing a flop — preflop over.';
  if (street.correctAction === 'AI') return 'You shove. Hand over.';
  if (street.correctAction === '4') return 'You 4-bet. This guide has no facing-jam chart — hand over.';
  if (street.correctAction === 'R') return 'You raise. Nobody 3-bets — hand over.';
  if (street.correctAction === '3') return 'You 3-bet. They fold — hand over.';
  return 'Hand over.';
}

export function shuffleItems(items) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function fetchPreflopDiagnostics(exportPayload) {
  const promptRes = await fetch('/data/preflop_diagnostics_prompt.txt', { cache: 'no-store' });
  if (!promptRes.ok) throw new Error('Could not load diagnostics prompt.');
  const systemPrompt = (await promptRes.text()).trim();
  const dump = formatQuizExport(exportPayload);
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: dump }],
      systemPrompt,
      mode: 'plain',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data.message || 'Empty diagnosis. Try again.';
}

export { TYPE_IDS, TYPE_LABELS };
