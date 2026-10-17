import {
  finiteNum,
  impliedProb,
  logLoss,
  multiLogLoss,
  scoreKey,
} from './settleMath.js';

export const SOP_RESULT_TYPES = ['sop', 'header', 'pk', 'fk', 'og', 'no-goal'];

export function classifySopGoalType(play) {
  const text = String(play?.description ?? play?.text ?? '');
  if (/own goal/i.test(text)) return 'og';
  if (/\bpenalty\b/i.test(text) && /convert|scored/i.test(text)) return 'pk';
  if (/left[- ]footed|right[- ]footed/i.test(text) && !/header|headed/i.test(text)) return 'sop';
  if (/header|headed/i.test(text)) return 'header';
  if (/from a free[- ]kick|free[- ]kick/i.test(text)) return 'fk';
  const typed = play?.goalType ?? play?.type ?? null;
  if (SOP_RESULT_TYPES.includes(typed) && typed !== 'no-goal') return typed;
  return null;
}

function canon(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function teamMatch(a, b) {
  const ca = canon(a);
  const cb = canon(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (ca.includes(cb) || cb.includes(ca)) return true;
  const ta = ca.split(' ');
  const tb = cb.split(' ');
  const [sh, lo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return sh.every((w) => lo.some((x) => x === w || x.startsWith(w) || w.startsWith(x)));
}

export function parseGoalScoreAfter(text, home, away) {
  const m = String(text ?? '').match(/goal!\s+(.+?)\s+(\d+),\s+(.+?)\s+(\d+)/i);
  if (!m) return null;
  const aScore = Number(m[2]);
  const bScore = Number(m[4]);
  if (!Number.isFinite(aScore) || !Number.isFinite(bScore)) return null;
  if (teamMatch(m[1], home) && teamMatch(m[3], away)) return { home: aScore, away: bScore };
  if (teamMatch(m[1], away) && teamMatch(m[3], home)) return { home: bScore, away: aScore };
  return null;
}

function postedProb(payload, key) {
  const live = finiteNum(payload?.[`live_${key}_p`]);
  if (live != null && live > 0) return live;
  return impliedProb(payload?.[`fd_${key}`]) ?? impliedProb(payload?.[`dk_${key}`]);
}

export function buildSopResultPatch(payload, result, label = null) {
  const ySop = result === 'sop' ? 1 : 0;
  const modelSop = finiteNum(payload?.model_sop_p);
  const liveSop = postedProb(payload, 'sop');
  const modelResult = result === 'no-goal'
    ? finiteNum(payload?.model_no_goal_p)
    : finiteNum(payload?.[`model_${result}_p`]);
  const liveResult = result === 'no-goal'
    ? finiteNum(payload?.live_no_goal_p)
    : postedProb(payload, result);
  return {
    result,
    result_label: label || result,
    hit_sop: result === 'sop',
    hit_no_goal: result === 'no-goal',
    model_p_result: modelResult,
    live_p_result: liveResult,
    model_logloss: multiLogLoss(modelResult),
    market_logloss: liveResult != null ? multiLogLoss(liveResult) : null,
    model_sop_logloss: modelSop != null ? logLoss(modelSop, ySop) : null,
    market_sop_logloss: liveSop != null ? logLoss(liveSop, ySop) : null,
  };
}

function isSettled(row) {
  return Boolean(row?.settledAt || row?.payload?.settled_at);
}

/**
 * Stamp SOP snapshots whose scoreline is the one just before each classified
 * goal. Leftover scorelines become no-goal only when the match is finished
 * and every ESPN scoring play was classified.
 */
export function sopSettlementPatches(rows, {
  goals = [],
  finished = false,
  scoringPlayCount = null,
} = {}) {
  const patches = [];
  const pending = (rows ?? []).filter((row) => !isSettled(row));
  const done = new Set();
  let score = { home: 0, away: 0 };

  for (const goal of goals) {
    const type = goal?.type;
    if (!SOP_RESULT_TYPES.includes(type) || type === 'no-goal') continue;
    const before = scoreKey(score.home, score.away);
    for (const row of pending) {
      if (done.has(row.id)) continue;
      const payload = row.payload || {};
      if (scoreKey(payload.score_home, payload.score_away) !== before) continue;
      patches.push({
        id: row.id,
        patch: buildSopResultPatch(payload, type, goal.label || type),
      });
      done.add(row.id);
    }
    const after = goal.scoreAfter;
    if (!after || !Number.isFinite(after.home) || !Number.isFinite(after.away)) break;
    score = { home: after.home, away: after.away };
  }

  const classified = goals.filter((g) => SOP_RESULT_TYPES.includes(g?.type) && g.type !== 'no-goal').length;
  const plays = scoringPlayCount == null ? classified : scoringPlayCount;
  if (finished && classified === plays) {
    for (const row of pending) {
      if (done.has(row.id)) continue;
      patches.push({
        id: row.id,
        patch: buildSopResultPatch(row.payload || {}, 'no-goal', 'No further goal'),
      });
    }
  }
  return patches;
}
