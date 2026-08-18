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

export function describeSpot(spot) {
  const scenario = SCENARIOS.find(s => s.id === spot.scenarioId);
  if (spot.scenarioId === 'rfi') {
    return `Everyone folded to you in ${spot.myPos}.`;
  }
  if (spot.scenarioId === 'vs_rfi') {
    return `You're in ${spot.myPos}. ${spot.villainPos} opened.`;
  }
  if (spot.scenarioId === 'vs_3bet') {
    return `You opened from ${spot.myPos}. ${spot.villainPos} 3-bet.`;
  }
  if (spot.scenarioId === 'vs_4bet') {
    return `You 3-bet from ${spot.myPos}. ${spot.villainPos} 4-bet.`;
  }
  return scenario?.description || '';
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
  let hand;
  let key;
  for (let attempt = 0; attempt < 200; attempt++) {
    const type = pickType(mix);
    const pool = SPOTS[type];
    spot = pool[Math.floor(Math.random() * pool.length)];
    cell = pickHand(spot, difficulty);
    if (!cell) continue;
    hand = handLabel(cell.r, cell.c);
    key = questionKey(spot, hand);
    if (!recent.has(key)) break;
  }

  if (!cell) {
    cell = { r: 0, c: 0 };
    spot = SPOTS.rfi[0];
    hand = handLabel(0, 0);
    key = questionKey(spot, hand);
  }

  const scenario = SCENARIOS.find(s => s.id === spot.scenarioId);
  const action = spot.chart[cell.r][cell.c];

  return {
    key,
    scenarioId: spot.scenarioId,
    scenarioLabel: scenario.label,
    myPos: spot.myPos,
    villainPos: spot.villainPos,
    needsVillainPos: scenario.needsVillainPos,
    hand,
    handR: cell.r,
    handC: cell.c,
    correctAction: action,
    chart: spot.chart,
    actionLabels: scenario.actionLabels,
    actionColors: scenario.actionColors,
    prompt: describeSpot(spot),
    cards: cardsFromHand(hand),
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

export { TYPE_IDS };
