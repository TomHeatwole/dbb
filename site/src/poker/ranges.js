// Jonathan Little's $1/$3 Cash Game Preflop Ranges (100BB)
// Extracted from "The Ultimate $1/$3 Cash Game Preflop Guide"
// Cell colors sampled from the PDF charts; combo-weighted % match the printed headers.
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


const RFI = {
  // UTG RFI: R 12.37%, F 87.63%
  UTG: makeGrid({
    ...fill(['AA','AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','AKo','KK','KQs','KJs','KTs','K9s','AQo','KQo','QQ','QJs','QTs','JJ','JTs','TT','T9s','99','98s','88','77'], 'R')
  }),
  // UTG+1 RFI: R 14.03%, F 85.97%
  'UTG+1': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','AKo','KK','KQs','KJs','KTs','K9s','K8s','AQo','KQo','QQ','QJs','QTs','AJo','JJ','JTs','TT','T9s','99','98s','88','77','66'], 'R')
  }),
  // LJ RFI: R 16.29%, F 83.71%
  LJ: makeGrid({
    ...fill(['AA','AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s','AKo','KK','KQs','KJs','KTs','K9s','K8s','K7s','AQo','KQo','QQ','QJs','QTs','AJo','JJ','JTs','J9s','ATo','TT','T9s','99','98s','88','77','66','55'], 'R')
  }),
  // HJ RFI: R 19.61%, F 80.39%
  HJ: makeGrid({
    ...fill(['AA','AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s','AKo','KK','KQs','KJs','KTs','K9s','K8s','K7s','K6s','AQo','KQo','QQ','QJs','QTs','Q9s','AJo','KJo','QJo','JJ','JTs','J9s','ATo','TT','T9s','T8s','99','98s','88','87s','77','76s','66','55'], 'R')
  }),
  // CO RFI: R 26.09%, F 73.91%
  CO: makeGrid({
    ...fill(['AA','AKs','AQs','AJs','ATs','A9s','A8s','AKo','KK','KQs','KJs','KTs','K9s','K8s','K7s','K6s','K5s','K4s','K3s','K2s','AQo','KQo','QQ','QJs','QTs','Q9s','Q8s','Q7s','Q6s','Q5s','Q4s','AJo','KJo','QJo','JJ','JTs','J9s','J8s','ATo','KTo','QTo','JTo','TT','T9s','T8s','T7s','A9o','99','98s','97s','88','87s','77','76s','66','65s','55','54s','44'], 'R')
  }),
  // BTN RFI: R 40.57%, F 59.43%
  BTN: makeGrid({
    ...fill(['AA','AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s','AKo','KK','KQs','KJs','KTs','K9s','K8s','K7s','K6s','K5s','K4s','K3s','K2s','AQo','KQo','QQ','QJs','QTs','Q9s','Q8s','Q7s','Q6s','Q5s','Q4s','Q3s','Q2s','AJo','KJo','QJo','JJ','JTs','J9s','J8s','J7s','J6s','J5s','ATo','KTo','QTo','JTo','TT','T9s','T8s','T7s','T6s','A9o','K9o','Q9o','J9o','T9o','99','98s','97s','96s','A8o','88','87s','86s','A7o','77','76s','75s','A6o','66','65s','A5o','55','54s','A4o','44','A3o','33','22'], 'R')
  }),
  // SB RFI: R 9.35%, C 66.21%, F 24.43%
  SB: makeGrid({
    ...fill(['AA','AKs','AQs','AJs','ATs','A9s','AKo','KK','KQs','KJs','KTs','K3s','K2s','AQo','QQ','QJs','QTs','Q3s','Q2s','JJ','76s','75s','65s','64s','54s'], 'R'),
    ...fill(['A8s','A7s','A6s','A5s','A4s','A3s','A2s','K9s','K8s','K7s','K6s','K5s','K4s','KQo','Q9s','Q8s','Q7s','Q6s','Q5s','Q4s','AJo','KJo','QJo','JTs','J9s','J8s','J7s','J6s','J5s','J4s','J3s','J2s','ATo','KTo','QTo','JTo','TT','T9s','T8s','T7s','T6s','T5s','T4s','T3s','T2s','A9o','K9o','Q9o','J9o','T9o','99','98s','97s','96s','95s','94s','93s','92s','A8o','K8o','Q8o','J8o','T8o','98o','88','87s','86s','85s','84s','83s','82s','A7o','K7o','Q7o','J7o','T7o','97o','87o','77','74s','73s','72s','A6o','K6o','Q6o','J6o','T6o','96o','86o','76o','66','63s','62s','A5o','K5o','Q5o','J5o','75o','65o','55','53s','52s','A4o','K4o','Q4o','54o','44','43s','42s','A3o','K3o','Q3o','33','32s','A2o','K2o','22'], 'C')
  }),
};

const VS_RFI = {
  // UTG+1 vs UTG: R 3.47%, C 3.77%, F 92.76%
  'UTG+1 vs UTG': makeGrid({
    ...fill(['AA','AKs','A5s','AKo','KK','KQs','KJs','QQ'], '3'),
    ...fill(['AQs','AJs','ATs','KTs','JJ','JTs','TT','99','88','77'], 'C')
  }),
  // LJ vs UTG: R 3.77%, C 4.07%, F 92.16%
  'LJ vs UTG': makeGrid({
    ...fill(['AA','AKs','A5s','A4s','AKo','KK','KQs','KJs','QQ'], '3'),
    ...fill(['AQs','AJs','ATs','KTs','QJs','JJ','JTs','TT','99','88','77'], 'C')
  }),
  // HJ vs UTG: R 4.22%, C 4.68%, F 91.1%
  'HJ vs UTG': makeGrid({
    ...fill(['AA','AKs','A5s','A4s','AKo','KK','KQs','KJs','QQ','JJ'], '3'),
    ...fill(['AQs','AJs','ATs','A9s','KTs','QJs','JTs','TT','T9s','99','88','77','66'], 'C')
  }),
  // CO vs UTG: R 4.52%, C 5.73%, F 89.74%
  'CO vs UTG': makeGrid({
    ...fill(['AA','AKs','A5s','A4s','A3s','AKo','KK','KQs','KJs','QQ','JJ'], '3'),
    ...fill(['AQs','AJs','ATs','A9s','KTs','QJs','QTs','JTs','TT','T9s','99','98s','88','77','66','55'], 'C')
  }),
  // BTN vs UTG: R 7.99%, C 8.75%, F 83.26%
  'BTN vs UTG': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','AKo','KK','K5s','K4s','K3s','AQo','KQo','QQ','QJs','AJo','QJo'], '3'),
    ...fill(['ATs','A9s','A8s','A7s','A6s','KQs','KJs','KTs','K9s','K8s','QTs','JJ','JTs','TT','T9s','99','98s','88','87s','77','76s','66','65s','55','44'], 'C')
  }),
  // SB vs UTG: R 4.22%, C 2.26%, F 93.51%
  'SB vs UTG': makeGrid({
    ...fill(['AA','AKs','AQs','AKo','KK','KQs','KJs','KTs','QQ','JJ'], '3'),
    ...fill(['AJs','ATs','JTs','TT','99','88'], 'C')
  }),
  // BB vs UTG: R 3.62%, C 11.92%, F 84.46%
  'BB vs UTG': makeGrid({
    ...fill(['AA','AKs','AQs','AKo','KK','KQs','QQ','JJ'], '3'),
    ...fill(['AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','KJs','KTs','K9s','AQo','QJs','QTs','JTs','J9s','TT','T9s','T8s','99','98s','88','87s','77','76s','66','65s','55','54s','44','33','22'], 'C')
  }),
  // LJ vs UTG+1: R 4.68%, C 4.07%, F 91.25%
  'LJ vs UTG+1': makeGrid({
    ...fill(['AA','AKs','A9s','A5s','AKo','KK','KQs','KJs','AQo','QQ'], '3'),
    ...fill(['AQs','AJs','ATs','KTs','QJs','JJ','JTs','TT','99','88','77'], 'C')
  }),
  // HJ vs UTG+1: R 4.37%, C 5.13%, F 90.5%
  'HJ vs UTG+1': makeGrid({
    ...fill(['AA','AKs','AQs','AKo','KK','KQs','KJs','AQo','QQ'], '3'),
    ...fill(['AJs','ATs','KTs','QJs','QTs','JJ','JTs','TT','T9s','99','98s','88','77','66'], 'C')
  }),
  // CO vs UTG+1: R 4.68%, C 6.18%, F 89.14%
  'CO vs UTG+1': makeGrid({
    ...fill(['AA','AKs','AQs','AKo','KK','KJs','KTs','K9s','AQo','QQ'], '3'),
    ...fill(['AJs','ATs','A9s','KQs','QJs','QTs','JJ','JTs','TT','T9s','99','98s','88','87s','77','66','55'], 'C')
  }),
  // BTN vs UTG+1: R 8.14%, C 8.3%, F 83.56%
  'BTN vs UTG+1': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','AKo','KK','KQs','K5s','K4s','AQo','KQo','QJs','QTs','Q9s','AJo','QJo'], '3'),
    ...fill(['ATs','A9s','A8s','A7s','A6s','KJs','KTs','K9s','K8s','QQ','JJ','JTs','TT','T9s','99','98s','88','87s','77','76s','66','55','44'], 'C')
  }),
  // SB vs UTG+1: R 4.22%, C 4.07%, F 91.7%
  'SB vs UTG+1': makeGrid({
    ...fill(['AA','AKs','AQs','A5s','AKo','KK','KQs','KJs','QQ','JJ'], '3'),
    ...fill(['AJs','ATs','A4s','KTs','QJs','JTs','TT','99','88','77','66'], 'C')
  }),
  // BB vs UTG+1: R 4.52%, C 12.82%, F 82.65%
  'BB vs UTG+1': makeGrid({
    ...fill(['AA','AKs','AQs','A5s','A4s','AKo','KK','KQs','KJs','QQ','JJ'], '3'),
    ...fill(['AJs','ATs','A9s','A8s','A7s','A6s','A3s','A2s','KTs','K9s','AQo','KQo','QJs','QTs','JTs','J9s','J8s','TT','T9s','T8s','99','98s','97s','88','87s','77','76s','66','65s','55','54s','44','33','22'], 'C')
  }),
  // HJ vs LJ: R 5.28%, C 5.28%, F 89.44%
  'HJ vs LJ': makeGrid({
    ...fill(['AA','AKs','A9s','A8s','A5s','A4s','AKo','KK','KQs','KJs','AQo','QQ'], '3'),
    ...fill(['AQs','AJs','ATs','KTs','QJs','QTs','JJ','JTs','TT','99','88','77','66','55'], 'C')
  }),
  // CO vs LJ: R 5.43%, C 5.73%, F 88.84%
  'CO vs LJ': makeGrid({
    ...fill(['AA','AKs','A8s','A5s','A4s','AKo','KK','KQs','KJs','AQo','QQ','JJ'], '3'),
    ...fill(['AQs','AJs','ATs','A9s','KTs','QJs','QTs','JTs','TT','T9s','99','98s','88','77','66','55'], 'C')
  }),
  // BTN vs LJ: R 5.43%, C 7.99%, F 86.58%
  'BTN vs LJ': makeGrid({
    ...fill(['AA','AKs','A5s','A4s','A3s','AKo','KK','KTs','K9s','AQo','QQ','JJ'], '3'),
    ...fill(['AQs','AJs','ATs','A9s','A8s','KQs','KJs','KQo','QJs','QTs','JTs','TT','T9s','99','98s','88','87s','77','66','55','44'], 'C')
  }),
  // SB vs LJ: R 8.3%, C 5.28%, F 86.43%
  'SB vs LJ': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','AKo','KK','KQs','KJs','K5s','AQo','KQo','QQ','QJs','QTs','QJo','JJ','TT'], '3'),
    ...fill(['ATs','A9s','A8s','A7s','A6s','KTs','AJo','JTs','99','88','77','66','55'], 'C')
  }),
  // BB vs LJ: R 5.58%, C 14.48%, F 79.94%
  'BB vs LJ': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','A5s','AKo','KK','KQs','KJs','KTs','QQ','QJs','JJ','TT'], '3'),
    ...fill(['ATs','A9s','A8s','A7s','A6s','A4s','A3s','A2s','K9s','K8s','K7s','AQo','KQo','QTs','Q9s','AJo','JTs','J9s','T9s','T8s','99','98s','97s','88','87s','86s','77','76s','75s','66','65s','64s','55','54s','53s','44','33','22'], 'C')
  }),
  // CO vs HJ: R 6.64%, C 6.03%, F 87.33%
  'CO vs HJ': makeGrid({
    ...fill(['AA','AKs','A8s','A5s','A4s','A3s','AKo','KK','KTs','K9s','AQo','KQo','QQ','JJ'], '3'),
    ...fill(['AQs','AJs','ATs','A9s','KQs','KJs','QJs','QTs','JTs','TT','T9s','99','98s','88','77','66','55'], 'C')
  }),
  // BTN vs HJ: R 6.79%, C 3.47%, F 89.74%
  'BTN vs HJ': makeGrid({
    ...fill(['AA','AKs','AQs','ATs','A5s','AKo','KK','KQs','KJs','KTs','AQo','QQ','QJs','QTs','JJ','TT'], '3'),
    ...fill(['AJs','A9s','JTs','T9s','99','88','77','66','55'], 'C')
  }),
  // SB vs HJ: R 6.64%, C 2.26%, F 91.1%
  'SB vs HJ': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','A5s','A4s','AKo','KK','KQs','KJs','KTs','AQo','QJs','QTs','JJ','TT'], '3'),
    ...fill(['ATs','A9s','JTs','99','88','77'], 'C')
  }),
  // BB vs HJ: R 7.09%, C 16.29%, F 76.62%
  'BB vs HJ': makeGrid({
    ...fill(['AA','AKs','AQs','ATs','A5s','A4s','AKo','KK','KQs','KJs','KTs','AQo','QQ','QJs','QTs','JJ','TT'], '3'),
    ...fill(['AJs','A9s','A8s','A7s','A6s','A3s','A2s','K9s','K8s','K7s','K6s','KQo','Q9s','Q8s','AJo','KJo','JTs','J9s','J8s','ATo','T9s','T8s','T7s','99','98s','97s','88','87s','86s','85s','77','76s','75s','66','65s','64s','55','54s','53s','44','33','22'], 'C')
  }),
  // BTN vs CO: R 10.71%, C 10.26%, F 79.03%
  'BTN vs CO': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','AKo','KK','K5s','K4s','K3s','K2s','AQo','KQo','Q9s','Q8s','Q7s','AJo','KJo','QJo','ATo','TT'], '3'),
    ...fill(['ATs','A9s','A8s','A7s','A6s','KQs','KJs','KTs','K9s','K8s','K7s','K6s','QQ','QJs','QTs','JJ','JTs','J9s','T9s','T8s','99','98s','88','87s','77','76s','66','65s','55','44'], 'C')
  }),
  // SB vs CO: R 8.6%, C 3.62%, F 87.78%
  'SB vs CO': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','A5s','A4s','AKo','KK','KQs','KJs','KTs','AQo','QQ','QJs','QTs','JJ','JTs','TT','T9s','99','88'], '3'),
    ...fill(['ATs','A9s','A8s','KQo','AJo','77','66'], 'C')
  }),
  // BB vs CO: R 8.75%, C 20.66%, F 70.59%
  'BB vs CO': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','ATs','A5s','A4s','AKo','KK','KQs','KJs','KTs','AQo','QQ','QJs','QTs','JJ','JTs','J9s','TT','T9s','99'], '3'),
    ...fill(['A9s','A8s','A7s','A6s','A3s','A2s','K9s','K8s','K7s','K6s','K5s','K4s','K3s','K2s','KQo','Q9s','Q8s','Q7s','Q6s','AJo','KJo','QJo','J8s','J7s','ATo','KTo','QTo','JTo','T8s','T7s','98s','97s','88','87s','86s','85s','77','76s','75s','66','65s','64s','55','54s','53s','44','43s','33','22'], 'C')
  }),
  // SB vs BTN: R 12.22%, C 4.68%, F 83.11%
  'SB vs BTN': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','ATs','AKo','KK','KQs','KJs','KTs','K9s','K8s','AQo','KQo','QQ','QJs','QTs','AJo','JJ','JTs','J9s','ATo','TT','T9s','T8s','99','88'], '3'),
    ...fill(['A9s','A8s','A7s','A6s','A5s','A4s','A3s','Q9s','KJo','77','66','55'], 'C')
  }),
  // SB vs BB: F 76.32%, R 6.18%, C 17.5%
  'SB vs BB': makeGrid({
    ...fill(['A8s','KQo','AJo','KJo','JTs','J9s','ATo','TT','T9s','99','88'], '3'),
    ...fill(['A7s','A6s','A5s','A4s','A3s','A2s','K9s','K8s','K7s','K6s','K5s','K4s','Q9s','Q8s','Q7s','Q6s','Q5s','Q4s','QJo','J8s','J7s','J6s','KTo','QTo','JTo','T8s','T7s','T6s','A9o','98s','97s','96s','A8o','87s','86s','85s','77','66','55','54s','44','33','22'], 'C')
  }),
  // BB vs BTN: R 12.82%, C 25.04%, F 62.14%
  'BB vs BTN': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','ATs','A5s','A4s','A3s','AKo','KK','KQs','KJs','KTs','AQo','KQo','QQ','QJs','QTs','AJo','JJ','JTs','J9s','ATo','TT','T9s','T8s','99','98s','88'], '3'),
    ...fill(['A9s','A8s','A7s','A6s','A2s','K9s','K8s','K7s','K6s','K5s','K4s','K3s','K2s','Q9s','Q8s','Q7s','Q6s','Q5s','Q4s','Q3s','Q2s','KJo','QJo','J8s','J7s','J6s','J5s','J4s','J3s','J2s','KTo','QTo','JTo','T7s','T6s','A9o','K9o','T9o','97s','96s','A8o','87s','86s','85s','A7o','77','76s','75s','74s','66','65s','64s','63s','55','54s','53s','44','43s','33','22'], 'C')
  }),
  // BB vs SB: R 11.16%, C 33.03%, F 55.81%
  'BB vs SB': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','AKo','KK','KQs','AQo','KQo','QQ','AJo','KJo','QJo','TT','T9s','98s','87s','A5o','A4o'], '3'),
    ...fill(['ATs','A9s','A8s','A7s','A6s','KJs','KTs','K9s','K8s','K7s','K6s','K5s','K4s','K3s','K2s','QJs','QTs','Q9s','Q8s','Q7s','Q6s','Q5s','Q4s','Q3s','Q2s','JJ','JTs','J9s','J8s','J7s','J6s','J5s','J4s','J3s','J2s','ATo','KTo','QTo','JTo','T8s','T7s','T6s','T5s','T4s','T3s','T2s','A9o','K9o','Q9o','J9o','T9o','99','97s','96s','A8o','88','86s','85s','A7o','77','76s','75s','74s','A6o','66','65s','64s','63s','65o','55','54s','53s','54o','44','43s','33','22'], 'C')
  }),
  // BB vs SB LIMP: R 33.79%, C 66.21%
  'BB vs SB LIMP': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','ATs','A9s','A5s','A4s','A3s','A2s','AKo','KK','KQs','KJs','KTs','K3s','K2s','AQo','KQo','QQ','QJs','QTs','AJo','KJo','JJ','JTs','ATo','TT','T9s','T8s','A9o','T9o','99','98s','97s','J8o','T8o','98o','88','87s','86s','85s','84s','83s','76s','75s','74s','73s','66','65s','64s','63s','55','54s','53s','A4o','K4o','Q4o','44','43s','A3o','K3o','Q3o','32s','A2o','K2o','Q2o'], '3'),
    ...fill(['A8s','A7s','A6s','K9s','K8s','K7s','K6s','K5s','K4s','Q9s','Q8s','Q7s','Q6s','Q5s','Q4s','Q3s','Q2s','QJo','J9s','J8s','J7s','J6s','J5s','J4s','J3s','J2s','KTo','QTo','JTo','T7s','T6s','T5s','T4s','T3s','T2s','K9o','Q9o','J9o','96s','95s','94s','93s','92s','A8o','K8o','Q8o','82s','A7o','K7o','Q7o','J7o','T7o','97o','87o','77','72s','A6o','K6o','Q6o','J6o','T6o','96o','86o','76o','62s','A5o','K5o','Q5o','J5o','T5o','95o','85o','75o','65o','52s','J4o','T4o','94o','84o','74o','64o','54o','42s','J3o','T3o','93o','83o','73o','63o','53o','43o','33','J2o','T2o','92o','82o','72o','62o','52o','42o','32o','22'], 'C')
  }),
};

const VS_3BET = {
  // UTG vs UTG+1 3B: R 1.81%, C 2.71%, F 95.48%
  'UTG vs UTG+1 3B': makeGrid({
    ...fill(['AA','AKo','KK'], '4'),
    ...fill(['AKs','AQs','AJs','QQ','JJ','JTs','T9s','98s'], 'C')
  }),
  // UTG vs LJ 3B: R 2.11%, C 3.02%, F 94.87%
  'UTG vs LJ 3B': makeGrid({
    ...fill(['AA','AKs','AKo','KK'], '4'),
    ...fill(['AQs','AJs','QQ','JJ','T9s','98s','88','77'], 'C')
  }),
  // UTG vs HJ 3B: R 2.11%, C 2.71%, F 95.17%
  'UTG vs HJ 3B': makeGrid({
    ...fill(['AA','AKs','AKo','KK'], '4'),
    ...fill(['AQs','AJs','QQ','JJ','98s','88','77'], 'C')
  }),
  // UTG vs CO 3B: R 2.11%, C 4.22%, F 93.67%
  'UTG vs CO 3B': makeGrid({
    ...fill(['AA','AKs','AKo','KK'], '4'),
    ...fill(['AQs','AJs','QQ','JJ','JTs','TT','T9s','99','98s','88','77'], 'C')
  }),
  // UTG vs BTN 3B: R 4.07%, C 7.99%, F 87.93%
  'UTG vs BTN 3B': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','AKo','AQo','KQo'], '4'),
    ...fill(['ATs','A9s','A8s','A7s','A6s','KK','KQs','KJs','KTs','QJo','JTo','TT','T9s','T9o','99','98s','88','77'], 'C')
  }),
  // UTG vs SB 3B: R 2.26%, C 5.28%, F 92.16%
  'UTG vs SB 3B': makeGrid({
    ...fill(['AA','AKo','KK','QQ'], '4'),
    ...fill(['AKs','AQs','AJs','ATs','A5s','KQs','K5s','JJ','JTs','TT','T9s','99','98s','88','77'], 'C')
  }),
  // UTG vs BB 3B: R 1.81%, C 5.13%, F 93.06%
  'UTG vs BB 3B': makeGrid({
    ...fill(['AA','AKo','KK'], '4'),
    ...fill(['AKs','AQs','AJs','ATs','A5s','QQ','JJ','JTs','TT','T9s','99','98s','88','77'], 'C')
  }),
  // UTG+1 vs LJ 3B: R 2.11%, C 4.07%, F 93.82%
  'UTG+1 vs LJ 3B': makeGrid({
    ...fill(['AA','AKs','AKo','KK'], '4'),
    ...fill(['AQs','AJs','KQs','QQ','JJ','JTs','T9s','98s','88','77','66'], 'C')
  }),
  // UTG+1 vs HJ 3B: R 2.11%, C 4.07%, F 93.82%
  'UTG+1 vs HJ 3B': makeGrid({
    ...fill(['AA','AKs','AKo','KK'], '4'),
    ...fill(['AQs','AJs','ATs','KQs','QQ','JJ','JTs','98s','88','77','66'], 'C')
  }),
  // UTG+1 vs CO 3B: R 2.56%, C 4.83%, F 92.61%
  'UTG+1 vs CO 3B': makeGrid({
    ...fill(['AA','AKs','AKo','KK','QQ'], '4'),
    ...fill(['AQs','AJs','ATs','KQs','JJ','JTs','TT','T9s','99','98s','88','77','66'], 'C')
  }),
  // UTG+1 vs BTN 3B: R 4.52%, C 8.45%, F 87.03%
  'UTG+1 vs BTN 3B': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','AKo','KK','AQo','KQo'], '4'),
    ...fill(['ATs','A9s','A8s','A7s','A6s','KQs','KJs','KTs','QQ','QJo','JTo','TT','T9s','T9o','99','98s','88','77','66'], 'C')
  }),
  // UTG+1 vs SB 3B: R 1.36%, C 5.13%, F 93.21%
  'UTG+1 vs SB 3B': makeGrid({
    ...fill(['AA','AKo'], '4'),
    ...fill(['AKs','AQs','AJs','ATs','KK','KQs','QQ','JJ','JTs','T9s','98s','88','77','66'], 'C')
  }),
  // UTG+1 vs BB 3B: R 1.81%, C 5.28%, F 92.91%
  'UTG+1 vs BB 3B': makeGrid({
    ...fill(['AA','AKo','KK'], '4'),
    ...fill(['AKs','AQs','AJs','ATs','KQs','QQ','QJs','QTs','JJ','JTs','T9s','98s','88','77','66'], 'C')
  }),
  // LJ vs HJ 3B: R 2.56%, C 5.28%, F 92.16%
  'LJ vs HJ 3B': makeGrid({
    ...fill(['AA','AKs','AKo','KK','QQ'], '4'),
    ...fill(['AQs','AJs','ATs','KQs','KJs','QJs','QTs','JJ','JTs','T9s','98s','88','77','66','55'], 'C')
  }),
  // LJ vs CO 3B: R 2.87%, C 4.98%, F 92.16%
  'LJ vs CO 3B': makeGrid({
    ...fill(['AA','AKs','AQs','AKo','KK','QQ'], '4'),
    ...fill(['AJs','ATs','KQs','JJ','JTs','TT','T9s','99','98s','88','77','66','55'], 'C')
  }),
  // LJ vs BTN 3B: R 3.47%, C 5.28%, F 91.25%
  'LJ vs BTN 3B': makeGrid({
    ...fill(['AA','AKs','AQs','A5s','AKo','KK','KQs','QQ'], '4'),
    ...fill(['AJs','ATs','A9s','KJs','JJ','JTs','TT','T9s','99','98s','88','77','66','55'], 'C')
  }),
  // LJ vs SB 3B: R 3.17%, C 11.31%, F 85.52%
  'LJ vs SB 3B': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','AKo','KQo'], '4'),
    ...fill(['ATs','A9s','A8s','A7s','A6s','KK','KQs','KJs','KTs','K5s','AQo','QQ','QJs','QJo','JJ','JTo','TT','T9s','T9o','99','98s','88','77','66','55'], 'C')
  }),
  // LJ vs BB 3B: R 0.9%, C 8.14%, F 90.95%
  'LJ vs BB 3B': makeGrid({
    ...fill(['AA','KK'], '4'),
    ...fill(['AKs','AQs','AJs','ATs','A5s','AKo','KQs','KJs','K5s','QQ','QJs','JJ','JTs','TT','T9s','99','98s','88','77','66','55'], 'C')
  }),
  // HJ vs CO 3B: R 3.32%, C 5.13%, F 91.55%
  'HJ vs CO 3B': makeGrid({
    ...fill(['AA','AKs','A5s','AKo','KK','QQ','JJ'], '4'),
    ...fill(['AQs','AJs','ATs','KQs','KJs','QJs','JTs','TT','T9s','99','88','77','66','55'], 'C')
  }),
  // HJ vs BTN 3B: R 3.32%, C 6.64%, F 90.05%
  'HJ vs BTN 3B': makeGrid({
    ...fill(['AA','AKs','A5s','AKo','KK','QQ','JJ'], '4'),
    ...fill(['AQs','AJs','ATs','KQs','KJs','KTs','QJs','QTs','JTs','TT','T9s','99','98s','88','87s','77','76s','66','55'], 'C')
  }),
  // HJ vs SB 3B: R 1.81%, C 8.45%, F 89.74%
  'HJ vs SB 3B': makeGrid({
    ...fill(['AA','AKo','KK'], '4'),
    ...fill(['AKs','AQs','AJs','ATs','A5s','A4s','KQs','KJs','KTs','QQ','QJs','QTs','JJ','JTs','TT','T9s','99','98s','88','87s','77','76s','66','55'], 'C')
  }),
  // HJ vs BB 3B: R 1.81%, C 8.75%, F 89.44%
  'HJ vs BB 3B': makeGrid({
    ...fill(['AA','AKo','KK'], '4'),
    ...fill(['AKs','AQs','AJs','ATs','A9s','A5s','A4s','KQs','KJs','KTs','QQ','QJs','QTs','JJ','JTs','TT','T9s','99','98s','88','87s','77','76s','66','55'], 'C')
  }),
  // CO vs BTN 3B: R 6.64%, C 9.5%, F 83.86%
  'CO vs BTN 3B': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','AKo','KK','K5s','AQo','KQo','AJo','QJo'], '4'),
    ...fill(['ATs','A9s','A8s','A7s','A6s','KQs','KJs','KTs','K9s','QQ','QJs','QTs','JJ','JTs','TT','T9s','T9o','99','88','77','66','65s','55','54s','44'], 'C')
  }),
  // CO vs SB 3B: R 1.36%, C 11.46%, F 87.18%
  'CO vs SB 3B': makeGrid({
    ...fill(['AA','KK','QQ'], '4'),
    ...fill(['AKs','AQs','AJs','ATs','A9s','A8s','A5s','AKo','KQs','KJs','KTs','AQo','QJs','QTs','JJ','JTs','J9s','TT','T9s','99','98s','88','87s','77','76s','66','65s','55','54s','44'], 'C')
  }),
  // CO vs BB 3B: R 2.26%, C 11.16%, F 86.58%
  'CO vs BB 3B': makeGrid({
    ...fill(['AA','AKo','KK','QQ'], '4'),
    ...fill(['AKs','AQs','AJs','ATs','A9s','A8s','A5s','A4s','KQs','KJs','KTs','K9s','AQo','QJs','QTs','JJ','JTs','J9s','TT','T9s','99','98s','88','87s','77','76s','66','65s','55','54s','44'], 'C')
  }),
  // BTN vs SB 3B: R 3.02%, C 14.48%, F 82.5%
  'BTN vs SB 3B': makeGrid({
    ...fill(['AA','AKs','AKo','KK','QQ','JJ'], '4'),
    ...fill(['AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','KQs','KJs','KTs','K9s','K8s','AQo','KQo','QJs','QTs','Q9s','AJo','JTs','J9s','TT','T9s','T8s','99','98s','88','87s','77','76s','66','65s','55','54s','44','33'], 'C')
  }),
  // BTN vs BB 3B: R 3.92%, C 14.48%, F 81.6%
  'BTN vs BB 3B': makeGrid({
    ...fill(['AA','AKs','AKo','KK','AQo','QQ','JJ'], '4'),
    ...fill(['AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s','KQs','KJs','KTs','K9s','K8s','K7s','KQo','QJs','QTs','Q9s','AJo','JTs','J9s','J8s','TT','T9s','T8s','99','98s','88','87s','77','76s','66','65s','55','54s','44','33'], 'C')
  }),
  // SB vs BB 3B: R 4.83%, C 7.54%, F 87.63%
  'SB vs BB 3B': makeGrid({
    ...fill(['AA','AKs','AKo','KK','AQo','KQo','QQ','JJ'], '4'),
    ...fill(['AQs','AJs','ATs','A9s','KQs','KJs','KTs','QJs','QTs','JTs','J9s','TT','T9s','T8s','99','88','77','76s','66','65s','55','54s'], 'C')
  }),
  // BB vs SB LIMP 3B: R 4.98%, C 12.97%, F 82.05%
  'BB vs SB LIMP 3B': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','AQo','KQo','QJo','JTo'], '4'),
    ...fill(['ATs','A9s','A8s','A7s','A6s','AKo','KK','KQs','KJs','KTs','K9s','K5s','K4s','QQ','QJs','QTs','AJo','KJo','JJ','JTs','TT','T9s','99','98s','88','87s','77','76s','66','65s','55','44'], 'C')
  }),
};

const VS_4BET = {
  // UTG+1 vs UTG 4B: R 0.9%, C 0.75%, F 98.34%
  'UTG+1 vs UTG 4B': makeGrid({
    ...fill(['AA','KK'], 'AI'),
    ...fill(['AKs','QQ'], 'C')
  }),
  // LJ vs UTG 4B: R 1.81%, C 0.75%, F 97.44%
  'LJ vs UTG 4B': makeGrid({
    ...fill(['AA','AKo','KK'], 'AI'),
    ...fill(['AKs','QQ'], 'C')
  }),
  // HJ vs UTG 4B: R 1.81%, C 1.21%, F 96.98%
  'HJ vs UTG 4B': makeGrid({
    ...fill(['AA','AKo','KK'], 'AI'),
    ...fill(['AKs','QQ','JJ'], 'C')
  }),
  // CO vs UTG 4B: R 1.81%, C 1.21%, F 96.98%
  'CO vs UTG 4B': makeGrid({
    ...fill(['AA','AKo','KK'], 'AI'),
    ...fill(['AKs','QQ','JJ'], 'C')
  }),
  // BTN vs UTG 4B: R 4.07%, C 3.77%, F 91.86%
  'BTN vs UTG 4B': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','AKo','AQo','KQo'], 'AI'),
    ...fill(['A9s','A8s','A7s','A6s','KK','KQs','QJo','JTo'], 'C')
  }),
  // SB vs UTG 4B: F 95.32%, R 0.45%, C 0.45%  (printed absolute %; chart raises AA/AKo/KK)
  'SB vs UTG 4B': makeGrid({
    ...fill(['AA','AKo','KK'], 'AI'),
    ...fill(['QQ'], 'C')
  }),
  // BB vs UTG 4B: R 0.9%, C 0.75%, F 98.34%
  'BB vs UTG 4B': makeGrid({
    ...fill(['AA','KK'], 'AI'),
    ...fill(['AKs','QQ'], 'C')
  }),
  // LJ vs UTG+1 4B: R 1.81%, C 0.75%, F 97.44%
  'LJ vs UTG+1 4B': makeGrid({
    ...fill(['AA','AKo','KK'], 'AI'),
    ...fill(['AKs','QQ'], 'C')
  }),
  // HJ vs UTG+1 4B: R 1.81%, C 1.06%, F 97.13%
  'HJ vs UTG+1 4B': makeGrid({
    ...fill(['AA','AKo','KK'], 'AI'),
    ...fill(['AKs','AQs','QQ'], 'C')
  }),
  // CO vs UTG+1 4B: R 1.81%, C 1.06%, F 97.13%
  'CO vs UTG+1 4B': makeGrid({
    ...fill(['AA','AKo','KK'], 'AI'),
    ...fill(['AKs','AQs','QQ'], 'C')
  }),
  // BTN vs UTG+1 4B: R 3.17%, C 3.77%, F 92.76%
  'BTN vs UTG+1 4B': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','AQo','KQo'], 'AI'),
    ...fill(['A9s','A8s','A7s','A6s','AKo','KK','KQs','QJo'], 'C')
  }),
  // SB vs UTG+1 4B: C 1.51%, F 93.97%, R 1.36%
  'SB vs UTG+1 4B': makeGrid({
    ...fill(['AA','AKo','KK'], 'AI'),
    ...fill(['AKs','AQs','QQ','JJ'], 'C')
  }),
  // BB vs UTG+1 4B: R 1.81%, C 1.06%, F 97.13%
  'BB vs UTG+1 4B': makeGrid({
    ...fill(['AA','AKo','KK'], 'AI'),
    ...fill(['AKs','AQs','QQ'], 'C')
  }),
  // HJ vs LJ 4B: R 1.81%, C 1.06%, F 97.13%
  'HJ vs LJ 4B': makeGrid({
    ...fill(['AA','AKo','KK'], 'AI'),
    ...fill(['AKs','KQs','QQ'], 'C')
  }),
  // CO vs LJ 4B: R 1.81%, C 1.21%, F 96.98%
  'CO vs LJ 4B': makeGrid({
    ...fill(['AA','AKo','KK'], 'AI'),
    ...fill(['AKs','QQ','JJ'], 'C')
  }),
  // BTN vs LJ 4B: C 1.66%, F 96.98%, R 1.36%
  'BTN vs LJ 4B': makeGrid({
    ...fill(['AA','AKo','KK'], 'AI'),
    ...fill(['AKs','QQ','JJ'], 'C')
  }),
  // SB vs LJ 4B: R 4.07%, C 3.77%, F 91.86%
  'SB vs LJ 4B': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','AKo','AQo','KQo'], 'AI'),
    ...fill(['A9s','A8s','A7s','A6s','KK','KQs','QJo','JTo'], 'C')
  }),
  // BB vs LJ 4B: C 1.51%, F 93.51%, R 1.81%  (printed %; AA+AKs are raise on the chart)
  'BB vs LJ 4B': makeGrid({
    ...fill(['AA','AKs','AKo','KK','QQ'], 'AI'),
    ...fill(['AQs','AJs','JJ','TT'], 'C')
  }),
  // CO vs HJ 4B: R 1.81%, C 1.81%, F 96.38%
  'CO vs HJ 4B': makeGrid({
    ...fill(['AA','AKo','KK'], 'AI'),
    ...fill(['AKs','A5s','KTs','QQ','JJ'], 'C')
  }),
  // BTN vs HJ 4B: C 3.17%, F 95.02%, R 1.81%
  'BTN vs HJ 4B': makeGrid({
    ...fill(['AKo','KK','QQ'], 'AI'),
    ...fill(['AA','AKs','AQs','ATs','KQs','KJs','QJs','JJ','TT'], 'C')
  }),
  // SB vs HJ 4B: R 2.56%, C 1.06%, F 96.38%
  'SB vs HJ 4B': makeGrid({
    ...fill(['AA','AKs','AKo','KK','QQ'], 'AI'),
    ...fill(['AQs','AJs','JJ'], 'C')
  }),
  // BB vs HJ 4B: R 2.56%, C 1.21%, F 96.23%
  'BB vs HJ 4B': makeGrid({
    ...fill(['AA','AKs','AKo','KK','QQ'], 'AI'),
    ...fill(['AQs','JJ','TT'], 'C')
  }),
  // BTN vs CO 4B: R 5.43%, C 5.73%, F 88.54%
  'BTN vs CO 4B': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','KK','AQo','KQo','QJo','JTo'], 'AI'),
    ...fill(['A9s','A8s','A7s','A6s','AKo','KQs','K5s','K4s','QQ','AJo','TT','T9o'], 'C')
  }),
  // SB vs CO 4B: C 0.9%, F 93.51%, R 2.71%
  'SB vs CO 4B': makeGrid({
    ...fill(['AA','AKs','AKo','KK','QQ','JJ','TT'], 'AI'),
    ...fill(['AQs','AJs','KQs'], 'C')
  }),
  // BB vs CO 4B: R 3.47%, C 1.81%, F 94.72%
  'BB vs CO 4B': makeGrid({
    ...fill(['AA','AKs','AKo','KK','QQ','JJ','TT'], 'AI'),
    ...fill(['AQs','AJs','ATs','99','88'], 'C')
  }),
  // SB vs BTN 4B: C 5.28%, R 3.02%, F 91.7%
  'SB vs BTN 4B': makeGrid({
    ...fill(['AKs','AKo','KK','QQ','JJ','TT'], 'AI'),
    ...fill(['AA','AQs','AJs','ATs','A9s','A8s','KQs','KJs','AQo','QJs','QTs','JTs','99','88'], 'C')
  }),
  // SB vs BB 4B: F 98.04%, C 0.6%, R 1.36%
  'SB vs BB 4B': makeGrid({
    ...fill(['TT','99','88'], 'AI'),
    ...fill(['JTs','T9s'], 'C')
  }),
  // BB vs BTN 4B: C 3.02%, R 3.47%, F 93.51%
  'BB vs BTN 4B': makeGrid({
    ...fill(['AKs','AKo','KK','QQ','JJ','TT','99'], 'AI'),
    ...fill(['AA','AQs','AJs','ATs','KQs','KJs','QJs','98s','88'], 'C')
  }),
  // BB vs SB 4B: R 7.84%, C 6.79%, F 85.07%
  'BB vs SB 4B': makeGrid({
    ...fill(['AA','AKs','AQs','AJs','ATs','A9s','KK','AQo','KQo','QJo','JTo','T9o','99','88'], 'AI'),
    ...fill(['A7s','A6s','A5s','A4s','A3s','A2s','AKo','KQs','QQ','AJo','TT','T9s','98s','87s','77','76s','65s'], 'C')
  }),
};

const POSITIONS = ['UTG','UTG+1','LJ','HJ','CO','BTN','SB','BB'];

const SCENARIOS = [
  {
    id: 'rfi',
    label: 'Open',
    description: 'First in. What do you do?',
    actionLabels: { R: 'Raise $12', C: 'Call/Limp', F: 'Fold' },
    actionColors: { R: '#ef4444', C: '#4ade80', F: '#374151' },
    getChart: (myPos) => RFI[myPos] || null,
    needsVillainPos: false,
  },
  {
    id: 'vs_rfi',
    label: 'Against Open',
    description: 'Someone raised in front. What do you do?',
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
    description: 'You opened and got 3-bet.',
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
    description: 'You 3-bet and they 4-bet.',
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
