/**
 * JAML-adjusted ADP for Redraft Dash.
 *
 * YAFSB Sleeper SF ADP understates how QB-hungry JAML is: historically ~5–6
 * QBs go in round 1 and most managers fill both QB slots by round 5 (~24 QB
 * picks in the first 60). We compress every QB's ADP toward the top of the
 * board, pin Allen/Lamar at 1–2, and leave non-QBs on raw ADP so they slide
 * relatively later.
 *
 * Formula (unpinned QBs):
 *   jamlAdp = 1 + (rawAdp − 1) × JAML_QB_FACTOR
 *
 * JAML_QB_FACTOR = 0.42 → ~5 QBs in R1 and ~24 QBs by pick 60 on the 2026 board.
 */

export const JAML_QB_FACTOR = 0.42;

export const ADP_MODES = [
  {
    id: 'jaml',
    label: 'JAML ADP',
    shortLabel: 'JAML',
    description: 'QB-compressed market for JAML (~5–6 QBs in R1; both slots mostly filled by R5).',
  },
  {
    id: 'yafsb',
    label: 'YAFSB SF',
    shortLabel: 'YAFSB',
    description: 'Raw Sleeper superflex ADP from YAFSB (unadjusted).',
  },
];

export const DEFAULT_ADP_MODE = 'jaml';

/** Josh Allen → 1.0, Lamar Jackson → 2.0 (Sleeper IDs + name fallback). */
const JAML_PINNED_QBS = [
  { sleeperId: '4984', nameKey: 'joshallen', jamlAdp: 1.0 },
  { sleeperId: '4881', nameKey: 'lamarjackson', jamlAdp: 2.0 },
];

function nameKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pinnedJamlAdp(player) {
  const sleeperId = player.sleeperId != null ? String(player.sleeperId) : '';
  const key = nameKey(player.name);
  for (const pin of JAML_PINNED_QBS) {
    if ((sleeperId && sleeperId === pin.sleeperId) || (key && key.includes(pin.nameKey))) {
      return pin.jamlAdp;
    }
  }
  return null;
}

/**
 * Compress a raw YAFSB SF ADP into JAML market cost.
 * Non-QBs keep raw ADP; QBs move earlier by JAML_QB_FACTOR (Allen/Lamar pinned).
 */
export function computeJamlAdp(player) {
  const raw = player?.adp;
  if (raw == null || !Number.isFinite(raw)) return null;
  if (String(player.position || '').toUpperCase() !== 'QB') return raw;
  const pinned = pinnedJamlAdp(player);
  if (pinned != null) return pinned;
  return 1 + (raw - 1) * JAML_QB_FACTOR;
}

/** Attach jamlAdp onto each player that already has raw `adp`. */
export function attachJamlAdp(players) {
  if (!players?.length) return players;
  for (const p of players) {
    p.jamlAdp = computeJamlAdp(p);
  }
  return players;
}

/** Resolve the market ADP used for sorting / smash-fade under the active mode. */
export function resolveMarketAdp(player, adpMode = DEFAULT_ADP_MODE) {
  if (!player) return null;
  if (adpMode === 'yafsb') return player.rawAdp ?? player.adp ?? null;
  return player.jamlAdp ?? player.adp ?? null;
}
