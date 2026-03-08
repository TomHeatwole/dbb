/**
 * fpRankingsLoader.js
 *
 * Loads all four FantasyPros ECR CSVs (QB, RB, WR, TE) and merges them into
 * a single lookup map keyed by Sleeper player ID.
 *
 * Returned shape:
 *   { [sleeperId]: { rank: number, position: string } }
 *
 * Only QB, RB, WR, and TE are covered. K and DST are not present in the
 * FantasyPros CSVs and are intentionally omitted (they project to 0 pts).
 */

const FP_CSV_CONFIGS = [
  { path: '/data/fantasypros_qb.csv',     position: 'QB' },
  { path: '/data/fantasypros_rb_std.csv', position: 'RB' },
  { path: '/data/fantasypros_wr_std.csv', position: 'WR' },
  { path: '/data/fantasypros_te_half.csv', position: 'TE' },
];

/**
 * Fetch and parse all FantasyPros CSVs, returning a unified rank map.
 *
 * @returns {Promise<Object>}  { [sleeperId]: { rank: number, position: string } }
 */
export async function loadFpRankings() {
  const responses = await Promise.all(
    FP_CSV_CONFIGS.map((cfg) => fetch(cfg.path).catch(() => null)),
  );
  const texts = await Promise.all(
    responses.map((r) => (r && r.ok ? r.text().catch(() => null) : null)),
  );

  const rankMap = {};

  for (let fi = 0; fi < FP_CSV_CONFIGS.length; fi++) {
    const text = texts[fi];
    if (!text) continue;

    const position = FP_CSV_CONFIGS[fi].position;
    const lines = text.trim().split('\n');
    if (lines.length < 2) continue;

    const headers = lines[0].split(',');
    const rankIdx    = headers.indexOf('rank');
    const sleeperIdx = headers.indexOf('sleeper_id');
    if (rankIdx === -1 || sleeperIdx === -1) continue;

    for (let i = 1; i < lines.length; i++) {
      const parts     = lines[i].split(',');
      const rank      = parseInt(parts[rankIdx], 10);
      const sleeperId = parts[sleeperIdx]?.trim();
      if (!sleeperId || isNaN(rank)) continue;
      rankMap[sleeperId] = { rank, position };
    }
  }

  return rankMap;
}

/**
 * Build a sorted player list from FantasyPros CSV texts for use as the
 * "top players" search pool in the roster editor.
 *
 * Resolves each Sleeper ID to the full player-info shape via getPlayerInfo.
 *
 * @param {string[]}  csvTexts    Array of raw CSV text strings (same order as FP_CSV_CONFIGS).
 * @param {Object}    playersData Sleeper players metadata (players.txt).
 * @param {Object}    playerIdMap Sleeper → ESPN ID map.
 * @param {Function}  getPlayerInfoFn  getPlayerInfo from PlayerLookup.
 * @returns {Array}   Player info objects sorted by FP rank (ascending).
 */
export function buildTopPlayersFromFpCsvs(csvTexts, playersData, playerIdMap, getPlayerInfoFn) {
  if (!playersData || !playerIdMap || !getPlayerInfoFn) return [];

  const entries = [];

  for (let fi = 0; fi < FP_CSV_CONFIGS.length; fi++) {
    const text = csvTexts[fi];
    if (!text) continue;

    const lines = text.trim().split('\n');
    if (lines.length < 2) continue;

    const headers    = lines[0].split(',');
    const rankIdx    = headers.indexOf('rank');
    const sleeperIdx = headers.indexOf('sleeper_id');
    if (rankIdx === -1 || sleeperIdx === -1) continue;

    for (let i = 1; i < lines.length; i++) {
      const parts     = lines[i].split(',');
      const rank      = parseInt(parts[rankIdx], 10);
      const sleeperId = parts[sleeperIdx]?.trim();
      if (!sleeperId || isNaN(rank)) continue;

      const info = getPlayerInfoFn(sleeperId, playersData, playerIdMap);
      if (info) entries.push({ ...info, player_id: sleeperId, fpRank: rank });
    }
  }

  entries.sort((a, b) => a.fpRank - b.fpRank);
  return entries;
}
