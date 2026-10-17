export function finiteNum(n) {
  if (n == null || n === '') return null;
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

export function nonzeroAmerican(n) {
  const v = finiteNum(n);
  return v != null && v !== 0 ? v : null;
}

export function impliedProb(american) {
  const a = nonzeroAmerican(american);
  if (a == null) return null;
  if (a > 0) return 100 / (a + 100);
  return Math.abs(a) / (Math.abs(a) + 100);
}

export function clampProb(p) {
  if (!Number.isFinite(p)) return null;
  return Math.min(1 - 1e-12, Math.max(1e-12, p));
}

export function logLoss(p, y) {
  const q = clampProb(p);
  if (q == null || (y !== 0 && y !== 1)) return null;
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
}

export function multiLogLoss(p) {
  const q = clampProb(p);
  return q == null ? null : -Math.log(q);
}

export function destakeFourWay(probs) {
  const keys = ['td', 'fg', 'punt', 'other'];
  const raw = keys.map((k) => finiteNum(probs?.[k]) ?? 0);
  const sum = raw.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return null;
  const out = {};
  keys.forEach((k, i) => {
    out[k] = raw[i] / sum;
  });
  return out;
}

export function scoreKey(home, away) {
  return `${finiteNum(home) ?? 0}-${finiteNum(away) ?? 0}`;
}
