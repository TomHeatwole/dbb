// Jonathan Little's $1/$3 Cash Game Preflop Ranges (100BB)
// Based on "The Ultimate $1/$3 Cash Game Preflop Guide"
//
// Actions: R = Raise/Open, C = Call, 3 = 3-Bet, 4 = 4-Bet, AI = All-In, F = Fold

const RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];

export function handLabel(r, c) {
  if (r === c) return RANKS[r] + RANKS[c];
  if (c > r) return RANKS[r] + RANKS[c] + 's';
  return RANKS[c] + RANKS[r] + 'o';
}

function emptyGrid() {
  return Array.from({ length: 13 }, () => Array(13).fill('F'));
}

function makeGrid(entries) {
  const g = emptyGrid();
  for (const [hand, action] of Object.entries(entries)) {
    const idxOf = r => RANKS.indexOf(r);
    if (hand.length === 2) {
      const i = idxOf(hand[0]);
      g[i][i] = action;
    } else if (hand[2] === 's') {
      const r = idxOf(hand[0]), c = idxOf(hand[1]);
      g[r][c] = action;
    } else {
      const r = idxOf(hand[0]), c = idxOf(hand[1]);
      g[c][r] = action;
    }
  }
  return g;
}

function fill(hands, action) {
  const obj = {};
  hands.forEach(h => { obj[h] = action; });
  return obj;
}

// ═══════════════════════════════════════════════
// SECTION 1: RAISE FIRST IN (RFI)
// ═══════════════════════════════════════════════

const RFI = {
  // Page 4: UTG RFI - Raise 12.37%, Fold 87.63%
  UTG: makeGrid({
    ...fill(['AA','KK','QQ','JJ','TT','99','88','77'], 'R'),
    ...fill(['66','55'], 'R'),
    ...fill(['AKs','AQs','AJs','ATs','A5s','A4s'], 'R'),
    ...fill(['KQs','KJs','KTs'], 'R'),
    ...fill(['QJs','QTs'], 'R'),
    ...fill(['JTs'], 'R'),
    ...fill(['T9s'], 'R'),
    ...fill(['98s'], 'R'),
    ...fill(['87s'], 'R'),
    ...fill(['76s'], 'R'),
    ...fill(['AKo','AQo'], 'R'),
    ...fill(['KQo'], 'R'),
  }),
  // Page 4: UTG+1 RFI - Raise 14.03%, Fold 85.97%
  'UTG+1': makeGrid({
    ...fill(['AA','KK','QQ','JJ','TT','99','88','77','66','55'], 'R'),
    ...fill(['AKs','AQs','AJs','ATs','A9s','A5s','A4s','A3s'], 'R'),
    ...fill(['KQs','KJs','KTs'], 'R'),
    ...fill(['QJs','QTs'], 'R'),
    ...fill(['JTs','J9s'], 'R'),
    ...fill(['T9s'], 'R'),
    ...fill(['98s'], 'R'),
    ...fill(['87s'], 'R'),
    ...fill(['76s'], 'R'),
    ...fill(['65s'], 'R'),
    ...fill(['AKo','AQo','AJo'], 'R'),
    ...fill(['KQo'], 'R'),
  }),
  // Page 4: LJ RFI - Raise 18.29%, Fold 81.71%
  LJ: makeGrid({
    ...fill(['AA','KK','QQ','JJ','TT','99','88','77','66','55','44'], 'R'),
    ...fill(['AKs','AQs','AJs','ATs','A9s','A8s','A5s','A4s','A3s','A2s'], 'R'),
    ...fill(['KQs','KJs','KTs','K9s'], 'R'),
    ...fill(['QJs','QTs','Q9s'], 'R'),
    ...fill(['JTs','J9s'], 'R'),
    ...fill(['T9s','T8s'], 'R'),
    ...fill(['98s','97s'], 'R'),
    ...fill(['87s','86s'], 'R'),
    ...fill(['76s'], 'R'),
    ...fill(['65s'], 'R'),
    ...fill(['54s'], 'R'),
    ...fill(['AKo','AQo','AJo','ATo'], 'R'),
    ...fill(['KQo','KJo'], 'R'),
    ...fill(['QJo'], 'R'),
  }),
  // Page 4: HJ RFI - Raise 19.67%, Fold 80.39% (≈80.33%)
  HJ: makeGrid({
    ...fill(['AA','KK','QQ','JJ','TT','99','88','77','66','55','44','33'], 'R'),
    ...fill(['AKs','AQs','AJs','ATs','A9s','A8s','A7s','A5s','A4s','A3s','A2s'], 'R'),
    ...fill(['KQs','KJs','KTs','K9s','K8s'], 'R'),
    ...fill(['QJs','QTs','Q9s','Q8s'], 'R'),
    ...fill(['JTs','J9s','J8s'], 'R'),
    ...fill(['T9s','T8s'], 'R'),
    ...fill(['98s','97s'], 'R'),
    ...fill(['87s','86s'], 'R'),
    ...fill(['76s','75s'], 'R'),
    ...fill(['65s','64s'], 'R'),
    ...fill(['54s'], 'R'),
    ...fill(['43s'], 'R'),
    ...fill(['AKo','AQo','AJo','ATo','A9o'], 'R'),
    ...fill(['KQo','KJo','KTo'], 'R'),
    ...fill(['QJo','QTo'], 'R'),
    ...fill(['JTo'], 'R'),
  }),
  // Page 4: CO RFI - Raise 26.05%, Fold 73.91% (≈73.95%)
  CO: makeGrid({
    ...fill(['AA','KK','QQ','JJ','TT','99','88','77','66','55','44','33','22'], 'R'),
    ...fill(['AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s'], 'R'),
    ...fill(['KQs','KJs','KTs','K9s','K8s','K7s','K6s','K5s'], 'R'),
    ...fill(['QJs','QTs','Q9s','Q8s','Q7s'], 'R'),
    ...fill(['JTs','J9s','J8s','J7s'], 'R'),
    ...fill(['T9s','T8s','T7s'], 'R'),
    ...fill(['98s','97s','96s'], 'R'),
    ...fill(['87s','86s','85s'], 'R'),
    ...fill(['76s','75s'], 'R'),
    ...fill(['65s','64s'], 'R'),
    ...fill(['54s','53s'], 'R'),
    ...fill(['43s'], 'R'),
    ...fill(['AKo','AQo','AJo','ATo','A9o','A8o'], 'R'),
    ...fill(['KQo','KJo','KTo','K9o'], 'R'),
    ...fill(['QJo','QTo','Q9o'], 'R'),
    ...fill(['JTo','J9o'], 'R'),
    ...fill(['T9o'], 'R'),
  }),
  // Page 4: BTN RFI - Raise 40.57%, Fold 59.43%
  BTN: makeGrid({
    ...fill(['AA','KK','QQ','JJ','TT','99','88','77','66','55','44','33','22'], 'R'),
    ...fill(['AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s'], 'R'),
    ...fill(['KQs','KJs','KTs','K9s','K8s','K7s','K6s','K5s','K4s','K3s','K2s'], 'R'),
    ...fill(['QJs','QTs','Q9s','Q8s','Q7s','Q6s','Q5s','Q4s'], 'R'),
    ...fill(['JTs','J9s','J8s','J7s','J6s'], 'R'),
    ...fill(['T9s','T8s','T7s','T6s'], 'R'),
    ...fill(['98s','97s','96s','95s'], 'R'),
    ...fill(['87s','86s','85s'], 'R'),
    ...fill(['76s','75s','74s'], 'R'),
    ...fill(['65s','64s','63s'], 'R'),
    ...fill(['54s','53s','52s'], 'R'),
    ...fill(['43s','42s'], 'R'),
    ...fill(['32s'], 'R'),
    ...fill(['AKo','AQo','AJo','ATo','A9o','A8o','A7o','A6o','A5o','A4o','A3o','A2o'], 'R'),
    ...fill(['KQo','KJo','KTo','K9o','K8o','K7o'], 'R'),
    ...fill(['QJo','QTo','Q9o','Q8o'], 'R'),
    ...fill(['JTo','J9o','J8o'], 'R'),
    ...fill(['T9o','T8o'], 'R'),
    ...fill(['98o','97o'], 'R'),
    ...fill(['87o','86o'], 'R'),
    ...fill(['76o','75o'], 'R'),
    ...fill(['65o'], 'R'),
    ...fill(['54o'], 'R'),
  }),
  // Page 5: SB RFI - Raise 9.35%, Call 66.21%, Fold 24.43%
  SB: makeGrid({
    ...fill(['AA','KK','QQ','JJ','TT','99'], 'R'),
    ...fill(['AKs','AQs','AJs','ATs','A9s','A8s'], 'R'),
    ...fill(['KQs','KJs'], 'R'),
    ...fill(['AKo','AQo','AJo'], 'R'),
    ...fill(['88','77','66','55','44','33','22'], 'C'),
    ...fill(['A7s','A6s','A5s','A4s','A3s','A2s'], 'C'),
    ...fill(['KTs','K9s','K8s','K7s','K6s','K5s','K4s','K3s','K2s'], 'C'),
    ...fill(['QJs','QTs','Q9s','Q8s','Q7s','Q6s','Q5s','Q4s'], 'C'),
    ...fill(['JTs','J9s','J8s','J7s','J6s'], 'C'),
    ...fill(['T9s','T8s','T7s','T6s'], 'C'),
    ...fill(['98s','97s','96s','95s'], 'C'),
    ...fill(['87s','86s','85s','84s'], 'C'),
    ...fill(['76s','75s','74s','73s'], 'C'),
    ...fill(['65s','64s','63s','62s'], 'C'),
    ...fill(['54s','53s','52s'], 'C'),
    ...fill(['43s','42s'], 'C'),
    ...fill(['32s'], 'C'),
    ...fill(['ATo','A9o','A8o','A7o','A6o','A5o','A4o','A3o','A2o'], 'C'),
    ...fill(['KQo','KJo','KTo','K9o','K8o','K7o','K6o','K5o'], 'C'),
    ...fill(['QJo','QTo','Q9o','Q8o','Q7o'], 'C'),
    ...fill(['JTo','J9o','J8o','J7o'], 'C'),
    ...fill(['T9o','T8o','T7o'], 'C'),
    ...fill(['98o','97o','96o'], 'C'),
    ...fill(['87o','86o','85o'], 'C'),
    ...fill(['76o','75o'], 'C'),
    ...fill(['65o','64o'], 'C'),
    ...fill(['54o','53o'], 'C'),
    ...fill(['43o'], 'C'),
  }),
};

// ═══════════════════════════════════════════════
// SECTION 2: VS RFI (Facing an open raise)
// Actions: C = Call, 3 = 3-Bet, F = Fold
// ═══════════════════════════════════════════════

const VS_RFI = {
  // Page 6: UTG+1 vs UTG - Raise $40: 3.47%, Call: 3.77%, Fold: 92.76%
  'UTG+1 vs UTG': makeGrid({
    ...fill(['AA','KK','QQ'], '3'),
    ...fill(['JJ','TT'], 'C'),
    ...fill(['AKs'], '3'),
    ...fill(['AQs','AJs'], 'C'),
    ...fill(['KQs'], 'C'),
    ...fill(['AKo'], 'C'),
  }),
  // Page 6: LJ vs UTG - Raise $40: 3.77%, Call: 4.07%, Fold: 92.16%
  'LJ vs UTG': makeGrid({
    ...fill(['AA','KK','QQ'], '3'),
    ...fill(['JJ','TT','99'], 'C'),
    ...fill(['AKs'], '3'),
    ...fill(['AQs','AJs','ATs'], 'C'),
    ...fill(['KQs','KJs'], 'C'),
    ...fill(['QJs'], 'C'),
    ...fill(['JTs'], 'C'),
    ...fill(['AKo'], 'C'),
  }),
  // Page 6: HJ vs UTG - Raise $40: 4.22%, Call: 4.68%, Fold: 91.00% (≈91.10%)
  'HJ vs UTG': makeGrid({
    ...fill(['AA','KK','QQ'], '3'),
    ...fill(['AKs','A5s'], '3'),
    ...fill(['JJ','TT','99'], 'C'),
    ...fill(['AQs','AJs','ATs'], 'C'),
    ...fill(['KQs','KJs'], 'C'),
    ...fill(['QJs','QTs'], 'C'),
    ...fill(['JTs'], 'C'),
    ...fill(['T9s'], 'C'),
    ...fill(['AKo'], '3'),
  }),
  // Page 6: CO vs UTG - Raise $40: 4.52%, Call: 5.73%, Fold: 89.74% (≈89.75%)
  'CO vs UTG': makeGrid({
    ...fill(['AA','KK','QQ'], '3'),
    ...fill(['AKs','A5s','A4s'], '3'),
    ...fill(['JJ','TT','99','88'], 'C'),
    ...fill(['AQs','AJs','ATs','A9s'], 'C'),
    ...fill(['KQs','KJs','KTs'], 'C'),
    ...fill(['QJs','QTs'], 'C'),
    ...fill(['JTs','J9s'], 'C'),
    ...fill(['T9s'], 'C'),
    ...fill(['98s'], 'C'),
    ...fill(['87s'], 'C'),
    ...fill(['76s'], 'C'),
    ...fill(['AKo'], '3'),
  }),
  // Page 6: BTN vs UTG - Raise $40: 5.43%, Call: 7.39%, Fold: 87.18%
  'BTN vs UTG': makeGrid({
    ...fill(['AA','KK','QQ','AKs'], '3'),
    ...fill(['A5s','A4s'], '3'),
    ...fill(['JJ','TT','99','88','77'], 'C'),
    ...fill(['AQs','AJs','ATs','A9s','A8s'], 'C'),
    ...fill(['KQs','KJs','KTs','K9s'], 'C'),
    ...fill(['QJs','QTs','Q9s'], 'C'),
    ...fill(['JTs','J9s'], 'C'),
    ...fill(['T9s','T8s'], 'C'),
    ...fill(['98s','97s'], 'C'),
    ...fill(['87s','86s'], 'C'),
    ...fill(['76s','75s'], 'C'),
    ...fill(['65s'], 'C'),
    ...fill(['54s'], 'C'),
    ...fill(['AKo'], '3'),
    ...fill(['AQo','AJo'], 'C'),
    ...fill(['KQo'], 'C'),
  }),
  // Page 6: SB vs UTG - Raise $40: 4.22%, Call: 2.26%, Fold: 93.51%
  'SB vs UTG': makeGrid({
    ...fill(['AA','KK','QQ','AKs'], '3'),
    ...fill(['A5s'], '3'),
    ...fill(['JJ','TT'], 'C'),
    ...fill(['AQs'], 'C'),
    ...fill(['AKo'], '3'),
  }),
  // Page 7: BB vs UTG - Raise $40: 3.62%, Call: 11.92%, Fold: 84.46%
  'BB vs UTG': makeGrid({
    ...fill(['AA','KK','QQ'], '3'),
    ...fill(['AKs'], '3'),
    ...fill(['JJ','TT','99','88','77','66','55'], 'C'),
    ...fill(['AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s'], 'C'),
    ...fill(['KQs','KJs','KTs','K9s','K8s'], 'C'),
    ...fill(['QJs','QTs','Q9s','Q8s'], 'C'),
    ...fill(['JTs','J9s','J8s'], 'C'),
    ...fill(['T9s','T8s'], 'C'),
    ...fill(['98s','97s'], 'C'),
    ...fill(['87s','86s'], 'C'),
    ...fill(['76s','75s'], 'C'),
    ...fill(['65s','64s'], 'C'),
    ...fill(['54s','53s'], 'C'),
    ...fill(['43s'], 'C'),
    ...fill(['AKo'], '3'),
    ...fill(['AQo','AJo','ATo'], 'C'),
    ...fill(['KQo','KJo'], 'C'),
    ...fill(['QJo','QTo'], 'C'),
    ...fill(['JTo'], 'C'),
    ...fill(['T9o'], 'C'),
  }),

  // Page 7: LJ vs UTG+1 - Raise $40: 4.68%, Call: 4.07%, Fold: 91.25%
  'LJ vs UTG+1': makeGrid({
    ...fill(['AA','KK','QQ'], '3'),
    ...fill(['AKs','A5s'], '3'),
    ...fill(['JJ','TT'], 'C'),
    ...fill(['AQs','AJs'], 'C'),
    ...fill(['KQs'], 'C'),
    ...fill(['AKo'], '3'),
  }),
  // Page 7: HJ vs UTG+1 - Raise $40: 4.37%, Call: 5.03%, Fold: 90.50% (≈90.60%)
  'HJ vs UTG+1': makeGrid({
    ...fill(['AA','KK','QQ'], '3'),
    ...fill(['AKs','A5s'], '3'),
    ...fill(['JJ','TT','99'], 'C'),
    ...fill(['AQs','AJs','ATs'], 'C'),
    ...fill(['KQs','KJs'], 'C'),
    ...fill(['QJs'], 'C'),
    ...fill(['JTs'], 'C'),
    ...fill(['T9s'], 'C'),
    ...fill(['AKo'], '3'),
  }),
  // Page 7: CO vs UTG+1 - Raise $40: 4.68%, Call: 6.85%, Fold: 88.94% (≈88.47%)
  'CO vs UTG+1': makeGrid({
    ...fill(['AA','KK','QQ'], '3'),
    ...fill(['AKs','A5s','A4s'], '3'),
    ...fill(['JJ','TT','99','88'], 'C'),
    ...fill(['AQs','AJs','ATs','A9s'], 'C'),
    ...fill(['KQs','KJs','KTs'], 'C'),
    ...fill(['QJs','QTs'], 'C'),
    ...fill(['JTs','J9s'], 'C'),
    ...fill(['T9s'], 'C'),
    ...fill(['98s'], 'C'),
    ...fill(['87s'], 'C'),
    ...fill(['76s'], 'C'),
    ...fill(['AKo'], '3'),
    ...fill(['AQo'], 'C'),
  }),
  // Page 7: BTN vs UTG+1 - Raise $40: 5.28%, Call: 7.24%, Fold: 87.48%
  'BTN vs UTG+1': makeGrid({
    ...fill(['AA','KK','QQ','AKs','A5s','A4s'], '3'),
    ...fill(['JJ','TT','99','88','77'], 'C'),
    ...fill(['AQs','AJs','ATs','A9s'], 'C'),
    ...fill(['KQs','KJs','KTs','K9s'], 'C'),
    ...fill(['QJs','QTs','Q9s'], 'C'),
    ...fill(['JTs','J9s'], 'C'),
    ...fill(['T9s','T8s'], 'C'),
    ...fill(['98s','97s'], 'C'),
    ...fill(['87s','86s'], 'C'),
    ...fill(['76s','75s'], 'C'),
    ...fill(['65s'], 'C'),
    ...fill(['54s'], 'C'),
    ...fill(['AKo'], '3'),
    ...fill(['AQo','AJo'], 'C'),
    ...fill(['KQo'], 'C'),
  }),
  // Page 7: SB vs UTG+1 - Raise $40: 4.22%, Call: 4.07%, Fold: 91.70%
  'SB vs UTG+1': makeGrid({
    ...fill(['AA','KK','QQ','AKs','A5s'], '3'),
    ...fill(['JJ','TT'], 'C'),
    ...fill(['AQs','AJs'], 'C'),
    ...fill(['AKo'], '3'),
  }),
  // Page 8: BB vs UTG+1 - Raise $40: 4.52%, Call: 12.82%, Fold: 82.65%
  'BB vs UTG+1': makeGrid({
    ...fill(['AA','KK','QQ','AKs'], '3'),
    ...fill(['A5s'], '3'),
    ...fill(['JJ','TT','99','88','77','66','55'], 'C'),
    ...fill(['AQs','AJs','ATs','A9s','A8s','A7s','A6s','A4s','A3s','A2s'], 'C'),
    ...fill(['KQs','KJs','KTs','K9s','K8s'], 'C'),
    ...fill(['QJs','QTs','Q9s','Q8s'], 'C'),
    ...fill(['JTs','J9s','J8s'], 'C'),
    ...fill(['T9s','T8s'], 'C'),
    ...fill(['98s','97s'], 'C'),
    ...fill(['87s','86s'], 'C'),
    ...fill(['76s','75s'], 'C'),
    ...fill(['65s','64s'], 'C'),
    ...fill(['54s','53s'], 'C'),
    ...fill(['43s'], 'C'),
    ...fill(['AKo'], '3'),
    ...fill(['AQo','AJo','ATo'], 'C'),
    ...fill(['KQo','KJo'], 'C'),
    ...fill(['QJo','QTo'], 'C'),
    ...fill(['JTo'], 'C'),
    ...fill(['T9o'], 'C'),
  }),

  // Page 8: HJ vs LJ - Raise $40: 5.28%, Call: 5.28%, Fold: 89.44%
  'HJ vs LJ': makeGrid({
    ...fill(['AA','KK','QQ','AKs','A5s'], '3'),
    ...fill(['JJ','TT','99'], 'C'),
    ...fill(['AQs','AJs','ATs'], 'C'),
    ...fill(['KQs','KJs'], 'C'),
    ...fill(['QJs','QTs'], 'C'),
    ...fill(['JTs'], 'C'),
    ...fill(['T9s'], 'C'),
    ...fill(['98s'], 'C'),
    ...fill(['AKo'], '3'),
  }),
  // Page 8: CO vs LJ - Raise $40: 5.73%, Call: 5.73%, Fold: 88.54% (≈88.54%)
  'CO vs LJ': makeGrid({
    ...fill(['AA','KK','QQ','AKs','A5s','A4s'], '3'),
    ...fill(['JJ','TT','99','88'], 'C'),
    ...fill(['AQs','AJs','ATs','A9s'], 'C'),
    ...fill(['KQs','KJs','KTs'], 'C'),
    ...fill(['QJs','QTs'], 'C'),
    ...fill(['JTs','J9s'], 'C'),
    ...fill(['T9s'], 'C'),
    ...fill(['98s'], 'C'),
    ...fill(['87s'], 'C'),
    ...fill(['76s'], 'C'),
    ...fill(['AKo'], '3'),
    ...fill(['AQo'], 'C'),
    ...fill(['KQo'], 'C'),
  }),
  // Page 8: BTN vs LJ - Raise $40: 5.73%, Call: 7.99%, Fold: 86.58% (≈86.28%)
  'BTN vs LJ': makeGrid({
    ...fill(['AA','KK','QQ','AKs','A5s','A4s'], '3'),
    ...fill(['JJ','TT','99','88','77','66'], 'C'),
    ...fill(['AQs','AJs','ATs','A9s','A8s'], 'C'),
    ...fill(['KQs','KJs','KTs','K9s'], 'C'),
    ...fill(['QJs','QTs','Q9s'], 'C'),
    ...fill(['JTs','J9s'], 'C'),
    ...fill(['T9s','T8s'], 'C'),
    ...fill(['98s','97s'], 'C'),
    ...fill(['87s','86s'], 'C'),
    ...fill(['76s','75s'], 'C'),
    ...fill(['65s'], 'C'),
    ...fill(['54s'], 'C'),
    ...fill(['AKo'], '3'),
    ...fill(['AQo','AJo'], 'C'),
    ...fill(['KQo'], 'C'),
  }),
  // Page 8: SB vs LJ - Raise $40: 5.58%, Call: 4.07%, Fold: 90.35%
  'SB vs LJ': makeGrid({
    ...fill(['AA','KK','QQ','AKs','A5s','A4s'], '3'),
    ...fill(['JJ','TT'], 'C'),
    ...fill(['AQs','AJs'], 'C'),
    ...fill(['KQs'], 'C'),
    ...fill(['AKo'], '3'),
  }),
  // Page 8: BB vs LJ - Raise $40: 5.58%, Call: 14.48%, Fold: 79.94%
  'BB vs LJ': makeGrid({
    ...fill(['AA','KK','QQ','AKs'], '3'),
    ...fill(['A5s','A4s'], '3'),
    ...fill(['JJ','TT','99','88','77','66','55'], 'C'),
    ...fill(['AQs','AJs','ATs','A9s','A8s','A7s','A6s','A3s','A2s'], 'C'),
    ...fill(['KQs','KJs','KTs','K9s','K8s','K7s'], 'C'),
    ...fill(['QJs','QTs','Q9s','Q8s'], 'C'),
    ...fill(['JTs','J9s','J8s'], 'C'),
    ...fill(['T9s','T8s','T7s'], 'C'),
    ...fill(['98s','97s'], 'C'),
    ...fill(['87s','86s'], 'C'),
    ...fill(['76s','75s'], 'C'),
    ...fill(['65s','64s'], 'C'),
    ...fill(['54s','53s'], 'C'),
    ...fill(['43s'], 'C'),
    ...fill(['32s'], 'C'),
    ...fill(['AKo'], '3'),
    ...fill(['AQo','AJo','ATo','A9o'], 'C'),
    ...fill(['KQo','KJo','KTo'], 'C'),
    ...fill(['QJo','QTo'], 'C'),
    ...fill(['JTo'], 'C'),
    ...fill(['T9o'], 'C'),
  }),

  // Page 9: CO vs HJ - Raise $40: 6.64%, Call: 6.03%, Fold: 87.32%
  'CO vs HJ': makeGrid({
    ...fill(['AA','KK','QQ','AKs','A5s','A4s'], '3'),
    ...fill(['AQs'], '3'),
    ...fill(['JJ','TT','99','88'], 'C'),
    ...fill(['AJs','ATs','A9s'], 'C'),
    ...fill(['KQs','KJs','KTs'], 'C'),
    ...fill(['QJs','QTs'], 'C'),
    ...fill(['JTs','J9s'], 'C'),
    ...fill(['T9s'], 'C'),
    ...fill(['98s'], 'C'),
    ...fill(['87s'], 'C'),
    ...fill(['76s'], 'C'),
    ...fill(['AKo'], '3'),
    ...fill(['AQo'], 'C'),
    ...fill(['KQo'], 'C'),
  }),
  // Page 9: BTN vs HJ - Raise $40: 6.79%, Call: 3.47%, Fold: 89.74%
  'BTN vs HJ': makeGrid({
    ...fill(['AA','KK','QQ','AKs','AQs','A5s','A4s','A3s'], '3'),
    ...fill(['JJ','TT','99','88','77','66'], 'C'),
    ...fill(['AJs','ATs','A9s','A8s'], 'C'),
    ...fill(['KQs','KJs','KTs','K9s'], 'C'),
    ...fill(['QJs','QTs','Q9s'], 'C'),
    ...fill(['JTs','J9s'], 'C'),
    ...fill(['T9s','T8s'], 'C'),
    ...fill(['98s','97s'], 'C'),
    ...fill(['87s','86s'], 'C'),
    ...fill(['76s','75s'], 'C'),
    ...fill(['65s','64s'], 'C'),
    ...fill(['54s'], 'C'),
    ...fill(['AKo'], '3'),
    ...fill(['AQo','AJo'], 'C'),
    ...fill(['KQo','KJo'], 'C'),
    ...fill(['QJo'], 'C'),
    ...fill(['JTo'], 'C'),
  }),
  // Page 9: SB vs HJ - Raise $40: 6.64%, Call: 2.26%, Fold: 91.00% (≈91.10%)
  'SB vs HJ': makeGrid({
    ...fill(['AA','KK','QQ','AKs','AQs','A5s','A4s'], '3'),
    ...fill(['JJ','TT'], 'C'),
    ...fill(['AJs'], 'C'),
    ...fill(['KQs'], 'C'),
    ...fill(['AKo'], '3'),
  }),
  // Page 9: BB vs HJ - Raise $40: 7.09%, Call: 16.29%, Fold: 76.62%
  'BB vs HJ': makeGrid({
    ...fill(['AA','KK','QQ','AKs','A5s','A4s'], '3'),
    ...fill(['AQs'], '3'),
    ...fill(['JJ','TT','99','88','77','66','55','44'], 'C'),
    ...fill(['AJs','ATs','A9s','A8s','A7s','A6s','A3s','A2s'], 'C'),
    ...fill(['KQs','KJs','KTs','K9s','K8s','K7s'], 'C'),
    ...fill(['QJs','QTs','Q9s','Q8s','Q7s'], 'C'),
    ...fill(['JTs','J9s','J8s'], 'C'),
    ...fill(['T9s','T8s','T7s'], 'C'),
    ...fill(['98s','97s','96s'], 'C'),
    ...fill(['87s','86s'], 'C'),
    ...fill(['76s','75s'], 'C'),
    ...fill(['65s','64s'], 'C'),
    ...fill(['54s','53s'], 'C'),
    ...fill(['43s'], 'C'),
    ...fill(['AKo'], '3'),
    ...fill(['AQo','AJo','ATo','A9o'], 'C'),
    ...fill(['KQo','KJo','KTo'], 'C'),
    ...fill(['QJo','QTo'], 'C'),
    ...fill(['JTo','J9o'], 'C'),
    ...fill(['T9o'], 'C'),
    ...fill(['98o'], 'C'),
  }),

  // Page 9: BTN vs CO - Raise $40: 9.20%, Call: 9.05%, Fold: 81.75%
  'BTN vs CO': makeGrid({
    ...fill(['AA','KK','QQ','JJ','AKs','AQs','A5s','A4s','A3s','A2s'], '3'),
    ...fill(['TT','99','88','77','66','55'], 'C'),
    ...fill(['AJs','ATs','A9s','A8s','A7s','A6s'], 'C'),
    ...fill(['KQs','KJs','KTs','K9s','K8s'], 'C'),
    ...fill(['QJs','QTs','Q9s','Q8s'], 'C'),
    ...fill(['JTs','J9s','J8s'], 'C'),
    ...fill(['T9s','T8s','T7s'], 'C'),
    ...fill(['98s','97s','96s'], 'C'),
    ...fill(['87s','86s','85s'], 'C'),
    ...fill(['76s','75s'], 'C'),
    ...fill(['65s','64s'], 'C'),
    ...fill(['54s','53s'], 'C'),
    ...fill(['43s'], 'C'),
    ...fill(['AKo','AQo'], '3'),
    ...fill(['AJo','ATo','A9o'], 'C'),
    ...fill(['KQo','KJo','KTo'], 'C'),
    ...fill(['QJo','QTo'], 'C'),
    ...fill(['JTo','J9o'], 'C'),
    ...fill(['T9o'], 'C'),
    ...fill(['98o'], 'C'),
  }),
  // Page 9: SB vs CO - Raise $40: 8.60%, Call: 3.62%, Fold: 87.78%
  'SB vs CO': makeGrid({
    ...fill(['AA','KK','QQ','JJ','AKs','AQs','A5s','A4s'], '3'),
    ...fill(['TT','99'], 'C'),
    ...fill(['AJs','ATs'], 'C'),
    ...fill(['KQs','KJs'], 'C'),
    ...fill(['QJs'], 'C'),
    ...fill(['JTs'], 'C'),
    ...fill(['AKo','AQo'], '3'),
  }),
  // Page 10: BB vs CO - Raise $40: 8.75%, Call: 20.86%, Fold: 70.50% (≈70.39%)
  'BB vs CO': makeGrid({
    ...fill(['AA','KK','QQ','JJ','AKs','AQs','A5s','A4s','A3s'], '3'),
    ...fill(['TT','99','88','77','66','55','44','33'], 'C'),
    ...fill(['AJs','ATs','A9s','A8s','A7s','A6s','A2s'], 'C'),
    ...fill(['KQs','KJs','KTs','K9s','K8s','K7s','K6s'], 'C'),
    ...fill(['QJs','QTs','Q9s','Q8s','Q7s','Q6s'], 'C'),
    ...fill(['JTs','J9s','J8s','J7s'], 'C'),
    ...fill(['T9s','T8s','T7s'], 'C'),
    ...fill(['98s','97s','96s'], 'C'),
    ...fill(['87s','86s','85s'], 'C'),
    ...fill(['76s','75s','74s'], 'C'),
    ...fill(['65s','64s','63s'], 'C'),
    ...fill(['54s','53s','52s'], 'C'),
    ...fill(['43s','42s'], 'C'),
    ...fill(['32s'], 'C'),
    ...fill(['AKo','AQo'], '3'),
    ...fill(['AJo','ATo','A9o','A8o','A7o'], 'C'),
    ...fill(['KQo','KJo','KTo','K9o','K8o'], 'C'),
    ...fill(['QJo','QTo','Q9o','Q8o'], 'C'),
    ...fill(['JTo','J9o','J8o'], 'C'),
    ...fill(['T9o','T8o'], 'C'),
    ...fill(['98o','97o'], 'C'),
    ...fill(['87o','86o'], 'C'),
    ...fill(['76o'], 'C'),
    ...fill(['65o'], 'C'),
  }),

  // Page 10: SB vs BTN - Raise $40: 12.22%, Call: 4.68%, Fold: 83.11%
  'SB vs BTN': makeGrid({
    ...fill(['AA','KK','QQ','JJ','TT','AKs','AQs','AJs','A5s','A4s','A3s','A2s','K9s'], '3'),
    ...fill(['99','88'], 'C'),
    ...fill(['ATs','A9s','A8s','A7s','A6s'], 'C'),
    ...fill(['KQs','KJs','KTs'], 'C'),
    ...fill(['QJs','QTs','Q9s'], 'C'),
    ...fill(['JTs','J9s'], 'C'),
    ...fill(['T9s'], 'C'),
    ...fill(['AKo','AQo','AJo'], '3'),
    ...fill(['KQo'], 'C'),
  }),
  // Page 10: BB vs BTN - Raise $40: 12.82%, Call: 25.04%, Fold: 62.14% (≈62.14%)
  'BB vs BTN': makeGrid({
    ...fill(['AA','KK','QQ','JJ','TT','AKs','AQs','AJs','A8s','A5s','A4s','A3s','A2s'], '3'),
    ...fill(['99','88','77','66','55','44','33','22'], 'C'),
    ...fill(['ATs','A9s','A7s','A6s'], 'C'),
    ...fill(['KQs','KJs','KTs','K9s','K8s','K7s','K6s','K5s'], 'C'),
    ...fill(['QJs','QTs','Q9s','Q8s','Q7s','Q6s','Q5s'], 'C'),
    ...fill(['JTs','J9s','J8s','J7s','J6s'], 'C'),
    ...fill(['T9s','T8s','T7s','T6s'], 'C'),
    ...fill(['98s','97s','96s','95s'], 'C'),
    ...fill(['87s','86s','85s','84s'], 'C'),
    ...fill(['76s','75s','74s','73s'], 'C'),
    ...fill(['65s','64s','63s','62s'], 'C'),
    ...fill(['54s','53s','52s'], 'C'),
    ...fill(['43s','42s'], 'C'),
    ...fill(['32s'], 'C'),
    ...fill(['AKo','AQo','AJo'], '3'),
    ...fill(['ATo','A9o','A8o','A7o','A6o','A5o','A4o','A3o','A2o'], 'C'),
    ...fill(['KQo','KJo','KTo','K9o','K8o','K7o','K6o'], 'C'),
    ...fill(['QJo','QTo','Q9o','Q8o','Q7o'], 'C'),
    ...fill(['JTo','J9o','J8o','J7o'], 'C'),
    ...fill(['T9o','T8o','T7o'], 'C'),
    ...fill(['98o','97o','96o'], 'C'),
    ...fill(['87o','86o','85o'], 'C'),
    ...fill(['76o','75o'], 'C'),
    ...fill(['65o','64o'], 'C'),
    ...fill(['54o','53o'], 'C'),
    ...fill(['43o'], 'C'),
  }),

  // Page 10: SB vs BB (RFI) - not "vs RFI" scenario, it's the SB open chart duplicated
  // This is the SB opening range which is same as RFI.SB
  'SB vs BB': makeGrid({
    ...fill(['AA','KK','QQ','JJ','TT','99'], 'R'),
    ...fill(['AKs','AQs','AJs','ATs','A9s','A8s'], 'R'),
    ...fill(['KQs','KJs'], 'R'),
    ...fill(['AKo','AQo','AJo'], 'R'),
    ...fill(['88','77','66','55','44','33','22'], 'C'),
    ...fill(['A7s','A6s','A5s','A4s','A3s','A2s'], 'C'),
    ...fill(['KTs','K9s','K8s','K7s','K6s','K5s','K4s','K3s','K2s'], 'C'),
    ...fill(['QJs','QTs','Q9s','Q8s','Q7s','Q6s','Q5s','Q4s'], 'C'),
    ...fill(['JTs','J9s','J8s','J7s','J6s'], 'C'),
    ...fill(['T9s','T8s','T7s','T6s'], 'C'),
    ...fill(['98s','97s','96s','95s'], 'C'),
    ...fill(['87s','86s','85s','84s'], 'C'),
    ...fill(['76s','75s','74s','73s'], 'C'),
    ...fill(['65s','64s','63s','62s'], 'C'),
    ...fill(['54s','53s','52s'], 'C'),
    ...fill(['43s','42s'], 'C'),
    ...fill(['32s'], 'C'),
    ...fill(['ATo','A9o','A8o','A7o','A6o','A5o','A4o','A3o','A2o'], 'C'),
    ...fill(['KQo','KJo','KTo','K9o','K8o','K7o','K6o','K5o'], 'C'),
    ...fill(['QJo','QTo','Q9o','Q8o','Q7o'], 'C'),
    ...fill(['JTo','J9o','J8o','J7o'], 'C'),
    ...fill(['T9o','T8o','T7o'], 'C'),
    ...fill(['98o','97o','96o'], 'C'),
    ...fill(['87o','86o','85o'], 'C'),
    ...fill(['76o','75o'], 'C'),
    ...fill(['65o','64o'], 'C'),
    ...fill(['54o','53o'], 'C'),
    ...fill(['43o'], 'C'),
  }),
  // Page 10: BB vs SB (vs SB raise) - Raise $40: 9.50%, Call: 35.90%, Fold: 54.60%
  'BB vs SB': makeGrid({
    ...fill(['AA','KK','QQ','JJ','TT','99','AKs','AQs','AJs','ATs','A9s','A8s','A5s','A4s','A3s','A2s','K9s','Q9s'], '3'),
    ...fill(['88','77','66','55','44','33','22'], 'C'),
    ...fill(['A7s','A6s'], 'C'),
    ...fill(['KQs','KJs','KTs','K8s','K7s','K6s','K5s','K4s'], 'C'),
    ...fill(['QJs','QTs','Q8s','Q7s','Q6s'], 'C'),
    ...fill(['JTs','J9s','J8s','J7s','J6s'], 'C'),
    ...fill(['T9s','T8s','T7s','T6s'], 'C'),
    ...fill(['98s','97s','96s','95s'], 'C'),
    ...fill(['87s','86s','85s','84s'], 'C'),
    ...fill(['76s','75s','74s','73s'], 'C'),
    ...fill(['65s','64s','63s','62s'], 'C'),
    ...fill(['54s','53s','52s'], 'C'),
    ...fill(['43s','42s'], 'C'),
    ...fill(['32s'], 'C'),
    ...fill(['AKo','AQo','AJo','ATo','A9o'], '3'),
    ...fill(['A8o','A7o','A6o','A5o','A4o','A3o','A2o'], 'C'),
    ...fill(['KQo','KJo','KTo','K9o','K8o','K7o','K6o','K5o'], 'C'),
    ...fill(['QJo','QTo','Q9o','Q8o','Q7o'], 'C'),
    ...fill(['JTo','J9o','J8o','J7o'], 'C'),
    ...fill(['T9o','T8o','T7o'], 'C'),
    ...fill(['98o','97o','96o'], 'C'),
    ...fill(['87o','86o','85o'], 'C'),
    ...fill(['76o','75o'], 'C'),
    ...fill(['65o','64o'], 'C'),
    ...fill(['54o','53o'], 'C'),
    ...fill(['43o'], 'C'),
  }),
  // Page 10: BB vs SB LIMP - Raise $12: 33.79%, Call: 66.21%
  'BB vs SB LIMP': makeGrid({
    ...fill(['AA','KK','QQ','JJ','TT','99','88','AKs','AQs','AJs','ATs','A9s','A8s','A7s','A5s','A4s','A3s','A2s'], 'R'),
    ...fill(['KQs','KJs','KTs','K9s','K8s','K7s','K6s','K5s','Q9s','J9s'], 'R'),
    ...fill(['77','66','55','44','33','22'], 'C'),
    ...fill(['A6s'], 'C'),
    ...fill(['K4s','K3s','K2s'], 'C'),
    ...fill(['QJs','QTs','Q8s','Q7s','Q6s','Q5s','Q4s'], 'C'),
    ...fill(['JTs','J8s','J7s','J6s'], 'C'),
    ...fill(['T9s','T8s','T7s','T6s'], 'C'),
    ...fill(['98s','97s','96s','95s'], 'C'),
    ...fill(['87s','86s','85s','84s'], 'C'),
    ...fill(['76s','75s','74s','73s'], 'C'),
    ...fill(['65s','64s','63s','62s'], 'C'),
    ...fill(['54s','53s','52s'], 'C'),
    ...fill(['43s','42s'], 'C'),
    ...fill(['32s'], 'C'),
    ...fill(['AKo','AQo','AJo','ATo','A9o','A8o','A7o','A6o','A5o'], 'R'),
    ...fill(['A4o','A3o','A2o'], 'C'),
    ...fill(['KQo','KJo','KTo','K9o','K8o'], 'R'),
    ...fill(['K7o','K6o','K5o','K4o'], 'C'),
    ...fill(['QJo','QTo','Q9o'], 'R'),
    ...fill(['Q8o','Q7o','Q6o'], 'C'),
    ...fill(['JTo','J9o'], 'R'),
    ...fill(['J8o','J7o'], 'C'),
    ...fill(['T9o','T8o'], 'C'),
    ...fill(['98o','97o','96o'], 'C'),
    ...fill(['87o','86o','85o'], 'C'),
    ...fill(['76o','75o'], 'C'),
    ...fill(['65o','64o'], 'C'),
    ...fill(['54o','53o'], 'C'),
    ...fill(['43o'], 'C'),
  }),
};

// ═══════════════════════════════════════════════
// SECTION 3: VS 3-BET (You opened, villain 3-bets)
// Actions: C = Call, 4 = 4-Bet, F = Fold
// ═══════════════════════════════════════════════

const VS_3BET = {
  // Page 11: UTG vs UTG+1 3-Bet - Raise $100: 14.63%, Call: 21.95%, Fold: 63.41%
  'UTG vs UTG+1 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs'], '4'),
    ...fill(['JJ','TT','AQs','AJs','ATs','KQs','AKo'], 'C'),
  }),
  // Page 11: UTG vs LJ 3-Bet - Raise $100: 12.07%, Call: 24.39%, Fold: 58.54% (≈63.54%)
  'UTG vs LJ 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs'], '4'),
    ...fill(['JJ','TT','AQs','AJs','ATs','KQs','QJs','JTs','AKo'], 'C'),
  }),
  // Page 11: UTG vs HJ 3-Bet - Raise $100: 13.07%, Call: 21.95%, Fold: 60.98% (≈64.98%)
  'UTG vs HJ 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs'], '4'),
    ...fill(['JJ','TT','AQs','AJs','ATs','KQs','AKo'], 'C'),
  }),
  // Page 11: UTG vs CO 3-Bet - Raise $100: 12.07%, Call: 34.95%, Fold: 48.78% (≈52.98%)
  'UTG vs CO 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','A5s'], '4'),
    ...fill(['JJ','TT','99','AQs','AJs','ATs','KQs','KJs','QJs','JTs','T9s','AKo','AQo'], 'C'),
  }),
  // Page 11: UTG vs BTN 3-Bet - Raise $100: 14.63%, Call: 39.02%, Fold: 46.34%
  'UTG vs BTN 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','A5s','A4s'], '4'),
    ...fill(['JJ','TT','99','AQs','AJs','ATs','KQs','KJs','QJs','QTs','JTs','T9s','98s','87s','76s','AKo','AQo'], 'C'),
  }),
  // Page 11: UTG vs SB 3-Bet - Raise $100: 18.29%, Call: 40.24%, Fold: 41.46%
  'UTG vs SB 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','AQs','A5s','A4s'], '4'),
    ...fill(['JJ','TT','99','AJs','ATs','KQs','KJs','KTs','QJs','QTs','JTs','T9s','98s','87s','76s','65s','AKo','AQo'], 'C'),
  }),
  // Page 12: UTG vs BB 3-Bet - Raise $100: 14.63%, Call: 41.46%, Fold: 43.90%
  'UTG vs BB 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','AQs','A5s','A4s'], '4'),
    ...fill(['JJ','TT','99','AJs','ATs','KQs','KJs','KTs','QJs','QTs','JTs','T9s','98s','87s','76s','65s','AKo','AQo'], 'C'),
  }),

  // Page 12: UTG+1 vs LJ 3-Bet - Raise $100: 15.05%, Call: 29.03%, Fold: 55.91%
  'UTG+1 vs LJ 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','A5s'], '4'),
    ...fill(['JJ','TT','99','AQs','AJs','ATs','KQs','KJs','QJs','JTs','T9s','AKo','AQo'], 'C'),
  }),
  // Page 12: UTG+1 vs HJ 3-Bet - Raise $100: 15.05%, Call: 29.03%, Fold: 55.91%
  'UTG+1 vs HJ 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','A5s'], '4'),
    ...fill(['JJ','TT','99','AQs','AJs','ATs','KQs','KJs','QJs','JTs','T9s','AKo','AQo'], 'C'),
  }),
  // Page 12: UTG+1 vs CO 3-Bet - Raise $100: 18.28%, Call: 34.41%, Fold: 47.31%
  'UTG+1 vs CO 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','AQs','A5s','A4s'], '4'),
    ...fill(['JJ','TT','99','AJs','ATs','KQs','KJs','KTs','QJs','QTs','JTs','T9s','98s','87s','76s','AKo','AQo'], 'C'),
  }),
  // Page 12: UTG+1 vs BTN 3-Bet - Raise $100: 15.05%, Call: 37.63%, Fold: 47.31%
  'UTG+1 vs BTN 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','AQs','A5s','A4s'], '4'),
    ...fill(['JJ','TT','99','AJs','ATs','KQs','KJs','KTs','QJs','QTs','JTs','T9s','98s','87s','76s','65s','AKo','AQo'], 'C'),
  }),
  // Page 12: UTG+1 vs SB 3-Bet - Raise $100: 9.68%, Call: 36.56%, Fold: 53.76%
  'UTG+1 vs SB 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','A5s'], '4'),
    ...fill(['JJ','TT','99','AQs','AJs','ATs','KQs','KJs','KTs','QJs','QTs','JTs','T9s','98s','87s','76s','AKo','AQo'], 'C'),
  }),
  // Page 13: UTG+1 vs BB 3-Bet - Raise $100: 12.90%, Call: 37.63%, Fold: 49.46%
  'UTG+1 vs BB 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','AQs','A5s','A4s'], '4'),
    ...fill(['JJ','TT','99','AJs','ATs','KQs','KJs','KTs','QJs','QTs','JTs','T9s','98s','87s','76s','65s','AKo','AQo'], 'C'),
  }),

  // Page 13: LJ vs HJ 3-Bet - Raise $100: 5.56%, Call: 32.47%, Fold: 51.85% (≈61.97%)
  'LJ vs HJ 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','A5s'], '4'),
    ...fill(['JJ','TT','99','AQs','AJs','ATs','KQs','KJs','QJs','JTs','T9s','98s','AKo','AQo'], 'C'),
  }),
  // Page 13: LJ vs CO 3-Bet - Raise $100 (5.56%) + Raise $100 (12.04%): Call 30.56%, Fold 51.85%
  'LJ vs CO 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','AQs','A5s','A4s'], '4'),
    ...fill(['JJ','TT','99','AJs','ATs','KQs','KJs','KTs','QJs','QTs','JTs','T9s','98s','87s','76s','AKo','AQo'], 'C'),
  }),
  // Page 13: LJ vs BTN 3-Bet - Raise $100 (5.56%) + Raise $100 (15.74%): Call 32.47%, Fold 46.23%
  'LJ vs BTN 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','AQs','A5s','A4s'], '4'),
    ...fill(['JJ','TT','99','88','AJs','ATs','KQs','KJs','KTs','QJs','QTs','JTs','T9s','98s','87s','76s','65s','AKo','AQo'], 'C'),
  }),
  // Page 13: LJ vs SB 3-Bet - Raise $100: 5.56%, Call: 48.5%, Fold: 46.30% (≈45.94%)
  'LJ vs SB 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','A5s'], '4'),
    ...fill(['JJ','TT','99','88','AQs','AJs','ATs','KQs','KJs','KTs','QJs','QTs','JTs','T9s','98s','87s','76s','65s','AKo','AQo'], 'C'),
  }),
  // Page 13: LJ vs BB 3-Bet - Raise $100: 5.56%, Call: 48.5%, Fold: 46.30% (≈45.94%)
  'LJ vs BB 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','AQs','A5s','A4s'], '4'),
    ...fill(['JJ','TT','99','88','AJs','ATs','KQs','KJs','KTs','QJs','QTs','JTs','T9s','98s','87s','76s','65s','AKo','AQo'], 'C'),
  }),

  // Page 14: HJ vs CO 3-Bet - Raise $100 (4.62%) + Raise $100 (12.31%): Call 26.15%, Fold 56.92%
  'HJ vs CO 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','AQs','A5s','A4s'], '4'),
    ...fill(['JJ','TT','99','AJs','ATs','KQs','KJs','KTs','QJs','QTs','JTs','T9s','98s','AKo','AQo'], 'C'),
  }),
  // Page 14: HJ vs BTN 3-Bet - Raise $100 (4.62%) + Raise $100 (12.31%): Call 33.85%, Fold 49.23%
  'HJ vs BTN 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','AQs','A5s','A4s'], '4'),
    ...fill(['JJ','TT','99','88','AJs','ATs','A9s','KQs','KJs','KTs','QJs','QTs','JTs','T9s','98s','87s','76s','65s','AKo','AQo'], 'C'),
  }),
  // Page 14: HJ vs SB 3-Bet - Raise $100 (4.62%) + Raise $100 (4.62%): Call 43.08%, Fold 47.69%
  'HJ vs SB 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','AQs','A5s','A4s'], '4'),
    ...fill(['JJ','TT','99','88','AJs','ATs','KQs','KJs','KTs','QJs','QTs','JTs','T9s','98s','87s','76s','65s','AKo','AQo'], 'C'),
  }),
  // Page 14: HJ vs BB 3-Bet - Raise $100 (4.62%) + Raise $100 (4.62%): Call 44.62%, Fold 46.15%
  'HJ vs BB 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','AQs','A5s','A4s'], '4'),
    ...fill(['JJ','TT','99','88','AJs','ATs','A9s','KQs','KJs','KTs','QJs','QTs','JTs','T9s','98s','87s','76s','65s','54s','AKo','AQo'], 'C'),
  }),

  // Page 14: CO vs BTN 3-Bet - Raise $100: 16.18%, Call: 27.17%, Fold: 56.65%
  'CO vs BTN 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','AQs','A5s','A4s','A3s'], '4'),
    ...fill(['JJ','TT','99','88','AJs','ATs','A9s','KQs','KJs','KTs','K9s','QJs','QTs','JTs','J9s','T9s','98s','87s','76s','AKo','AQo','AJo'], 'C'),
  }),
  // Page 14: CO vs SB 3-Bet - Raise $100: 5.20%, Call: 43.93%, Fold: 50.87%
  'CO vs SB 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','AQs','A5s','A4s'], '4'),
    ...fill(['JJ','TT','99','88','AJs','ATs','A9s','KQs','KJs','KTs','K9s','QJs','QTs','JTs','J9s','T9s','98s','87s','76s','65s','AKo','AQo','AJo'], 'C'),
  }),
  // Page 15: CO vs BB 3-Bet - Raise $100: 8.67%, Call: 42.77%, Fold: 48.55%
  'CO vs BB 3B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','AQs','A5s','A4s','A3s'], '4'),
    ...fill(['JJ','TT','99','88','AJs','ATs','A9s','A8s','KQs','KJs','KTs','K9s','QJs','QTs','JTs','J9s','T9s','T8s','98s','97s','87s','76s','65s','AKo','AQo','AJo'], 'C'),
  }),

  // Page 15: BTN vs SB 3-Bet - Raise $100: 7.43%, Call: 35.69%, Fold: 56.88%
  'BTN vs SB 3B': makeGrid({
    ...fill(['AA','KK','QQ','JJ','AKs','AQs','AJs','A5s','A4s','A3s','A2s'], '4'),
    ...fill(['TT','99','88','77','66','ATs','A9s','A8s','A7s','A6s','KQs','KJs','KTs','K9s','K8s','QJs','QTs','Q9s','JTs','J9s','T9s','T8s','98s','97s','87s','86s','76s','75s','65s','54s','AKo','AQo','AJo','ATo','KQo','KJo','QJo'], 'C'),
  }),
  // Page 15: BTN vs BB 3-Bet - Raise $100: 8.67%, Call: 35.89%, Fold: 54.65% (≈55.44%)
  'BTN vs BB 3B': makeGrid({
    ...fill(['AA','KK','QQ','JJ','AKs','AQs','AJs','ATs','A5s','A4s','A3s','A2s','K9s'], '4'),
    ...fill(['TT','99','88','77','66','55','44','A9s','A8s','A7s','A6s','KQs','KJs','KTs','K8s','K7s','QJs','QTs','Q9s','Q8s','JTs','J9s','J8s','T9s','T8s','T7s','98s','97s','96s','87s','86s','85s','76s','75s','65s','64s','54s','53s','43s','AKo','AQo','AJo','ATo','A9o','KQo','KJo','KTo','QJo','QTo','JTo'], 'C'),
  }),

  // Page 15: SB vs BB 3-Bet - Raise $100: 34.04%, Call: 53.83%, Fold: 12.77% (≈12.13%)
  'SB vs BB 3B': makeGrid({
    ...fill(['AA','KK','QQ','JJ','TT','AKs','AQs','AJs','ATs','A5s','A4s','A3s','A2s'], '4'),
    ...fill(['99','88','77','66','55','A9s','A8s','A7s','A6s','KQs','KJs','KTs','K9s','K8s','K7s','QJs','QTs','Q9s','Q8s','JTs','J9s','J8s','T9s','T8s','98s','97s','87s','86s','76s','75s','65s','64s','54s','53s','43s','AKo','AQo','AJo','ATo','A9o','A8o','KQo','KJo','KTo','K9o','QJo','QTo','JTo','T9o'], 'C'),
  }),

  // Page 15: BB vs SB LIMP 3-Bet - Raise $100: 6.81%, Call: 31.72%, Fold: 61.67% (≈61.47%)
  'BB vs SB LIMP 3B': makeGrid({
    ...fill(['AA','KK','QQ','JJ','AKs','AQs','AJs','A5s','A4s'], '4'),
    ...fill(['TT','99','88','ATs','A9s','A8s','A7s','A6s','KQs','KJs','KTs','K9s','QJs','QTs','Q9s','JTs','J9s','T9s','T8s','98s','97s','87s','76s','65s','AKo','AQo','AJo','ATo','KQo','KJo','QJo'], 'C'),
  }),
};

// ═══════════════════════════════════════════════
// SECTION 4: VS 4-BET (You 3-bet, villain 4-bets)
// Actions: C = Call, AI = All-In, F = Fold
// ═══════════════════════════════════════════════

const VS_4BET = {
  // Page 16: UTG+1 vs UTG 4-Bet - Raise $300: 26.09%, Call: 21.74%, Fold: 52.17%
  'UTG+1 vs UTG 4B': makeGrid({
    ...fill(['AA','KK','QQ'], 'AI'),
    ...fill(['AKs','JJ','AKo'], 'C'),
  }),
  // Page 16: LJ vs UTG 4-Bet - Raise $300: 48.00%, Call: 20.00%, Fold: 32.00%
  'LJ vs UTG 4B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','JJ'], 'AI'),
    ...fill(['AQs','AKo'], 'C'),
  }),
  // Page 16: HJ vs UTG 4-Bet - Raise $300: 42.86%, Call: 28.57%, Fold: 28.57%
  'HJ vs UTG 4B': makeGrid({
    ...fill(['AA','KK','QQ','AKs'], 'AI'),
    ...fill(['JJ','AQs','AKo'], 'C'),
  }),
  // Page 16: CO vs UTG 4-Bet - Raise $300: 40.00%, Call: 26.67%, Fold: 33.33%
  'CO vs UTG 4B': makeGrid({
    ...fill(['AA','KK','QQ','AKs'], 'AI'),
    ...fill(['JJ','AQs','AKo'], 'C'),
  }),
  // Page 16: BTN vs UTG 4-Bet - Raise $300: 31.58%, Call: 26.32%, Fold: 42.11%
  'BTN vs UTG 4B': makeGrid({
    ...fill(['AA','KK','QQ'], 'AI'),
    ...fill(['AKs','JJ','AQs','AKo'], 'C'),
  }),
  // Page 16: SB vs UTG 4-Bet - Raise $300: 28.57%, Call: 10.71%, Fold: 60.71%
  'SB vs UTG 4B': makeGrid({
    ...fill(['AA','KK','QQ'], 'AI'),
    ...fill(['AKs','AKo'], 'C'),
  }),
  // Page 17: BB vs UTG 4-Bet - Raise $300: 33.33%, Call: 20.83%, Fold: 54.17% (≈45.83%)
  'BB vs UTG 4B': makeGrid({
    ...fill(['AA','KK','QQ','AKs'], 'AI'),
    ...fill(['JJ','AQs','AKo'], 'C'),
  }),

  // Page 17: LJ vs UTG+1 4-Bet - Raise $300: 38.71%, Call: 16.13%, Fold: 45.16%
  'LJ vs UTG+1 4B': makeGrid({
    ...fill(['AA','KK','QQ','AKs'], 'AI'),
    ...fill(['JJ','AQs','AKo'], 'C'),
  }),
  // Page 17: HJ vs UTG+1 4-Bet - Raise $300: 41.38%, Call: 24.14%, Fold: 34.48%
  'HJ vs UTG+1 4B': makeGrid({
    ...fill(['AA','KK','QQ','AKs'], 'AI'),
    ...fill(['JJ','AQs','AJs','AKo'], 'C'),
  }),
  // Page 17: CO vs UTG+1 4-Bet - Raise $300: 38.71%, Call: 22.58%, Fold: 38.71%
  'CO vs UTG+1 4B': makeGrid({
    ...fill(['AA','KK','QQ','AKs'], 'AI'),
    ...fill(['JJ','AQs','AKo'], 'C'),
  }),
  // Page 17: BTN vs UTG+1 4-Bet - Raise $300: 25.71%, Call: 28.57%, Fold: 45.71%
  'BTN vs UTG+1 4B': makeGrid({
    ...fill(['AA','KK','QQ'], 'AI'),
    ...fill(['AKs','JJ','AQs','AKo'], 'C'),
  }),
  // Page 17: SB vs UTG+1 4-Bet - Raise $300: 42.86%, Call: 35.71%, Fold: 21.43%
  'SB vs UTG+1 4B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','JJ'], 'AI'),
    ...fill(['AQs','AJs','ATs','AKo','AQo'], 'C'),
  }),
  // Page 18: BB vs UTG+1 4-Bet - Raise $300: 46.67%, Call: 23.33%, Fold: 36.67% (≈30.00%)
  'BB vs UTG+1 4B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','AQs','JJ'], 'AI'),
    ...fill(['TT','AJs','AKo'], 'C'),
  }),

  // Page 18: HJ vs LJ 4-Bet - Raise $300: 34.29%, Call: 20.00%, Fold: 45.71%
  'HJ vs LJ 4B': makeGrid({
    ...fill(['AA','KK','QQ','AKs'], 'AI'),
    ...fill(['JJ','AQs','AKo'], 'C'),
  }),
  // Page 18: CO vs LJ 4-Bet - Raise $300: 31.58%, Call: 21.05%, Fold: 47.37%
  'CO vs LJ 4B': makeGrid({
    ...fill(['AA','KK','QQ','AKs'], 'AI'),
    ...fill(['JJ','AQs','AKo'], 'C'),
  }),
  // Page 18: BTN vs LJ 4-Bet - Raise $300: 23.68%, Call: 28.95%, Fold: 47.37%
  'BTN vs LJ 4B': makeGrid({
    ...fill(['AA','KK','QQ'], 'AI'),
    ...fill(['AKs','JJ','AQs','AJs','AKo'], 'C'),
  }),
  // Page 18: SB vs LJ 4-Bet - Raise $300: 32.43%, Call: 27.03%, Fold: 40.54%
  'SB vs LJ 4B': makeGrid({
    ...fill(['AA','KK','QQ','AKs'], 'AI'),
    ...fill(['JJ','AQs','AJs','AKo'], 'C'),
  }),
  // Page 18: BB vs LJ 4-Bet - Raise $300: 45.95%, Call: 27.03%, Fold: 27.03%
  'BB vs LJ 4B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','AQs','JJ'], 'AI'),
    ...fill(['TT','AJs','ATs','AKo'], 'C'),
  }),

  // Page 19: CO vs HJ 4-Bet - Raise $300: 27.27%, Call: 27.27%, Fold: 45.45%
  'CO vs HJ 4B': makeGrid({
    ...fill(['AA','KK','QQ'], 'AI'),
    ...fill(['AKs','JJ','AQs','AJs','AKo'], 'C'),
  }),
  // Page 19: BTN vs HJ 4-Bet - Raise $300: 26.67%, Call: 46.67%, Fold: 26.67%
  'BTN vs HJ 4B': makeGrid({
    ...fill(['AA','KK','QQ','JJ'], 'AI'),
    ...fill(['AKs','TT','AQs','AJs','ATs','KQs','AKo','AQo'], 'C'),
  }),
  // Page 19: SB vs HJ 4-Bet - Raise $300: 36.17%, Call: 14.89%, Fold: 48.94%
  'SB vs HJ 4B': makeGrid({
    ...fill(['AA','KK','QQ','AKs'], 'AI'),
    ...fill(['JJ','AQs','AKo'], 'C'),
  }),
  // Page 19: BB vs HJ 4-Bet - Raise $300: 36.17%, Call: 17.02%, Fold: 46.81%
  'BB vs HJ 4B': makeGrid({
    ...fill(['AA','KK','QQ','AKs','JJ'], 'AI'),
    ...fill(['AQs','AJs','AKo'], 'C'),
  }),

  // Page 19: BTN vs CO 4-Bet - Raise $300: 26.15%, Call: 30.77%, Fold: 43.08%
  'BTN vs CO 4B': makeGrid({
    ...fill(['AA','KK','QQ','JJ'], 'AI'),
    ...fill(['AKs','TT','AQs','AJs','KQs','AKo','AQo'], 'C'),
  }),
  // Page 19: SB vs CO 4-Bet - Raise $300: 40.35%, Call: 10.53%, Fold: 49.12%
  'SB vs CO 4B': makeGrid({
    ...fill(['AA','KK','QQ','JJ','AKs'], 'AI'),
    ...fill(['TT','AQs','AKo'], 'C'),
  }),
  // Page 20: BB vs CO 4-Bet - Raise $300: 37.70%, Call: 19.67%, Fold: 42.62%
  'BB vs CO 4B': makeGrid({
    ...fill(['AA','KK','QQ','JJ','AKs'], 'AI'),
    ...fill(['TT','AQs','AJs','KQs','AKo','AQo'], 'C'),
  }),

  // Page 20: SB vs BTN 4-Bet - Raise $300: 23.53%, Call: 41.18%, Fold: 35.29%
  'SB vs BTN 4B': makeGrid({
    ...fill(['AA','KK','QQ','JJ','TT'], 'AI'),
    ...fill(['AKs','99','AQs','AJs','ATs','KQs','KJs','QJs','AKo','AQo','AJo'], 'C'),
  }),
  // Page 20: BB vs BTN 4-Bet - Raise $300: 27.06%, Call: 23.53%, Fold: 49.41%
  'BB vs BTN 4B': makeGrid({
    ...fill(['AA','KK','QQ','JJ','TT'], 'AI'),
    ...fill(['AKs','99','88','AQs','AJs','ATs','KQs','KJs','QJs','AKo','AQo','AJo'], 'C'),
  }),

  // Page 20: SB vs BB 4-Bet - Raise $300: 21.98%, Call: 9.78%, Fold: 68.29% (≈68.24%)
  'SB vs BB 4B': makeGrid({
    ...fill(['AA','KK','QQ','JJ','TT'], 'AI'),
    ...fill(['AKs','99','AQs','AJs','AKo'], 'C'),
  }),

  // Page 20: BB vs SB 4-Bet - Raise $300: 48.15%, Call: 51.85%
  'BB vs SB 4B': makeGrid({
    ...fill(['AA','KK','QQ','JJ','TT','99'], 'AI'),
    ...fill(['AKs','88','77','AQs','AJs','ATs','A9s','KQs','KJs','KTs','QJs','QTs','JTs','AKo','AQo','AJo','ATo','KQo'], 'C'),
  }),
};

// ═══════════════════════════════════════════════
// Scenario definitions for the UI
// ═══════════════════════════════════════════════

const POSITIONS = ['UTG','UTG+1','LJ','HJ','CO','BTN','SB','BB'];

const SCENARIOS = [
  {
    id: 'rfi',
    label: 'Open',
    description: 'Everyone folds to you. What do you open?',
    actionLabels: { R: 'Raise $12', C: 'Call/Limp', F: 'Fold' },
    actionColors: { R: '#ef4444', C: '#4ade80', F: '#374151' },
    getChart: (myPos) => RFI[myPos] || null,
    needsVillainPos: false,
  },
  {
    id: 'vs_rfi',
    label: 'Against Open',
    description: 'Someone opened. What do you do?',
    actionLabels: { '3': '3-Bet $40', C: 'Call $12', R: 'Raise', F: 'Fold' },
    actionColors: { '3': '#ef4444', C: '#4ade80', R: '#ef4444', F: '#374151' },
    getChart: (myPos, villainPos) => {
      if (myPos === 'BB' && villainPos === 'SB') {
        return VS_RFI['BB vs SB'];
      }
      const key = `${myPos} vs ${villainPos}`;
      return VS_RFI[key] || null;
    },
    needsVillainPos: true,
    villainLabel: 'Who opened?',
  },
  {
    id: 'vs_3bet',
    label: '3-Bet',
    description: 'You opened and then faced a 3-bet. Pick your seat and the 3-bettor.',
    actionLabels: { '4': '4-Bet $100', C: 'Call', F: 'Fold' },
    actionColors: { '4': '#ef4444', C: '#4ade80', F: '#374151' },
    getChart: (myPos, villainPos) => {
      const key = `${myPos} vs ${villainPos} 3B`;
      return VS_3BET[key] || null;
    },
    needsVillainPos: true,
    villainLabel: 'Who 3-bet?',
  },
  {
    id: 'vs_4bet',
    label: '4-Bet',
    description: 'You 3-bet and then faced a 4-bet. Pick your seat and the 4-bettor.',
    actionLabels: { AI: 'All-In $300', C: 'Call', F: 'Fold' },
    actionColors: { AI: '#ef4444', C: '#4ade80', F: '#374151' },
    getChart: (myPos, villainPos) => {
      const key = `${myPos} vs ${villainPos} 4B`;
      return VS_4BET[key] || null;
    },
    needsVillainPos: true,
    villainLabel: 'Who 4-bet?',
  },
];

export { RANKS, POSITIONS, SCENARIOS, RFI, VS_RFI, VS_3BET, VS_4BET };
