const RED = [255, 32, 55];
const YELLOW = [255, 224, 138];
const GREEN = [34, 211, 122];

function clampPct(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, n));
}

function mix(a, b, t) {
  const u = Math.max(0, Math.min(1, t));
  return a.map((c, i) => Math.round(c + (b[i] - c) * u));
}

/**
 * 0% deep red → 50% gold → 100% deep green.
 * Extremes punch a bit harder so 75/25 already reads green/red.
 */
export function winProbHeat(pct) {
  const p = clampPct(pct);
  const signed = (p - 50) / 50;
  const eased = Math.sign(signed) * (Math.abs(signed) ** 0.72);
  const t = (eased + 1) / 2;
  const rgb = t <= 0.5
    ? mix(RED, YELLOW, t * 2)
    : mix(YELLOW, GREEN, (t - 0.5) * 2);
  return {
    rgb,
    css: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    glow: `0 0 0.55rem rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.62)`,
  };
}

export function winProbMidColor() {
  return winProbHeat(50);
}
