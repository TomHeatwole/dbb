/** Raw 5-minute bin counts for each league's concentration curve. */

export const PL_CORNER_BIN_COUNTS = [
  { id: '1-5', start: 0, end: 5, half: 1, kind: 'regular', n: 527 },
  { id: '6-10', start: 5, end: 10, half: 1, kind: 'regular', n: 602 },
  { id: '11-15', start: 10, end: 15, half: 1, kind: 'regular', n: 574 },
  { id: '16-20', start: 15, end: 20, half: 1, kind: 'regular', n: 556 },
  { id: '21-25', start: 20, end: 25, half: 1, kind: 'regular', n: 578 },
  { id: '26-30', start: 25, end: 30, half: 1, kind: 'regular', n: 529 },
  { id: '31-35', start: 30, end: 35, half: 1, kind: 'regular', n: 540 },
  { id: '36-40', start: 35, end: 40, half: 1, kind: 'regular', n: 584 },
  { id: '41-45', start: 40, end: 45, half: 1, kind: 'regular', n: 613 },
  { id: '45+', start: 45, end: 45, half: 1, kind: 'ht+', n: 421 },
  { id: '46-50', start: 45, end: 50, half: 2, kind: 'regular', n: 569 },
  { id: '51-55', start: 50, end: 55, half: 2, kind: 'regular', n: 681 },
  { id: '56-60', start: 55, end: 60, half: 2, kind: 'regular', n: 629 },
  { id: '61-65', start: 60, end: 65, half: 2, kind: 'regular', n: 641 },
  { id: '66-70', start: 65, end: 70, half: 2, kind: 'regular', n: 622 },
  { id: '71-75', start: 70, end: 75, half: 2, kind: 'regular', n: 573 },
  { id: '76-80', start: 75, end: 80, half: 2, kind: 'regular', n: 532 },
  { id: '81-85', start: 80, end: 85, half: 2, kind: 'regular', n: 568 },
  { id: '86-90', start: 85, end: 90, half: 2, kind: 'regular', n: 573 },
  { id: '90+', start: 90, end: 90, half: 2, kind: 'ft+', n: 874 },
];

/** ESPN MLS 2025–26 pooled (912 matches, 8,914 corners). */
export const MLS_CORNER_BIN_COUNTS = [
  { id: '1-5', start: 0, end: 5, half: 1, kind: 'regular', n: 380 },
  { id: '6-10', start: 5, end: 10, half: 1, kind: 'regular', n: 434 },
  { id: '11-15', start: 10, end: 15, half: 1, kind: 'regular', n: 382 },
  { id: '16-20', start: 15, end: 20, half: 1, kind: 'regular', n: 438 },
  { id: '21-25', start: 20, end: 25, half: 1, kind: 'regular', n: 397 },
  { id: '26-30', start: 25, end: 30, half: 1, kind: 'regular', n: 416 },
  { id: '31-35', start: 30, end: 35, half: 1, kind: 'regular', n: 402 },
  { id: '36-40', start: 35, end: 40, half: 1, kind: 'regular', n: 458 },
  { id: '41-45', start: 40, end: 45, half: 1, kind: 'regular', n: 473 },
  { id: '45+', start: 45, end: 45, half: 1, kind: 'ht+', n: 339 },
  { id: '46-50', start: 45, end: 50, half: 2, kind: 'regular', n: 429 },
  { id: '51-55', start: 50, end: 55, half: 2, kind: 'regular', n: 471 },
  { id: '56-60', start: 55, end: 60, half: 2, kind: 'regular', n: 444 },
  { id: '61-65', start: 60, end: 65, half: 2, kind: 'regular', n: 454 },
  { id: '66-70', start: 65, end: 70, half: 2, kind: 'regular', n: 460 },
  { id: '71-75', start: 70, end: 75, half: 2, kind: 'regular', n: 443 },
  { id: '76-80', start: 75, end: 80, half: 2, kind: 'regular', n: 407 },
  { id: '81-85', start: 80, end: 85, half: 2, kind: 'regular', n: 469 },
  { id: '86-90', start: 85, end: 90, half: 2, kind: 'regular', n: 496 },
  { id: '90+', start: 90, end: 90, half: 2, kind: 'ft+', n: 722 },
];

export const CORNER_LEAGUE_SPECS = {
  pl: {
    key: 'pl',
    label: 'Premier League 2023–26',
    meanCornersPerMatch: 11786 / 1139,
    htStoppageMin: 3.3,
    ftStoppageMin: 4.8,
    binCounts: PL_CORNER_BIN_COUNTS,
    bucketLegend: {
      ftPlusShare: 7.42,
      ftPlusUniform: 4.89,
      htPlusShare: 3.57,
      htPlusUniform: 3.36,
    },
  },
  mls: {
    key: 'mls',
    label: 'MLS 2025–26',
    meanCornersPerMatch: 8914 / 912,
    htStoppageMin: 3.4,
    ftStoppageMin: 4.6,
    binCounts: MLS_CORNER_BIN_COUNTS,
    bucketLegend: {
      ftPlusShare: 8.1,
      ftPlusUniform: 4.69,
      htPlusShare: 3.8,
      htPlusUniform: 3.46,
    },
  },
};

export function buildCornerLeagueModel(spec) {
  const totalN = spec.binCounts.reduce((s, b) => s + b.n, 0);
  const bins = spec.binCounts.map((bin) => ({
    ...bin,
    share: bin.n / totalN,
    typicalMinutes: bin.kind === 'ht+'
      ? spec.htStoppageMin
      : bin.kind === 'ft+'
        ? spec.ftStoppageMin
        : bin.end - bin.start,
  }));
  return {
    ...spec,
    bins,
    totalN,
    typicalMatchMinutes: 90 + spec.htStoppageMin + spec.ftStoppageMin,
  };
}

export function cornerLeagueModel(key = 'pl') {
  const spec = CORNER_LEAGUE_SPECS[key] ?? CORNER_LEAGUE_SPECS.pl;
  return buildCornerLeagueModel(spec);
}
