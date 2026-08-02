/**
 * archetypeRosterGenerator.js
 *
 * Pure logic for instantiating a roster archetype into a historical season.
 *
 * An archetype is a real Hwang roster characterized on the current KTC board:
 * positional counts + the positional rank of each held player. To instantiate
 * it into a target season, each rank slot is jittered and filled with the
 * player at that positional rank on the season's preseason Final KTC board.
 *
 * Kept UI-free so the HVORP batch pipeline can reuse it.
 */

// ── Deterministic RNG (mulberry32) ────────────────────────────────────────────

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── CSV parsing (quote-aware) ─────────────────────────────────────────────────

export function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  fields.push(current.replace(/\r$/, ''));
  return fields;
}

export function parseCsv(text) {
  const lines = text.trim().split('\n');
  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i]) continue;
    const cols = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = cols[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

// ── Season boards from final_ktc_values.csv ───────────────────────────────────

/**
 * @returns Map<year:number, { [position]: Array<{name, value, rank, sleeperId}> }>
 * Players sorted by preseason KTC value desc within each position (rank = idx+1).
 */
export function buildSeasonBoards(finalKtcRows) {
  const byYearPos = new Map();
  for (const row of finalKtcRows) {
    const year = Number(row.year);
    const value = Number(row.ktc_value);
    if (!Number.isFinite(year) || !Number.isFinite(value)) continue;
    if (!byYearPos.has(year)) byYearPos.set(year, {});
    const posMap = byYearPos.get(year);
    (posMap[row.position] = posMap[row.position] || []).push({
      name: row.name,
      value,
      sleeperId: row.sleeper_id || '',
    });
  }
  for (const posMap of byYearPos.values()) {
    for (const pos of Object.keys(posMap)) {
      posMap[pos].sort((a, b) => b.value - a.value);
      posMap[pos].forEach((p, idx) => { p.rank = idx + 1; });
    }
  }
  return byYearPos;
}

// ── Roster instantiation ──────────────────────────────────────────────────────

/**
 * Instantiate an archetype into a target season.
 *
 * @param {Array} slots       archetype players:
 *                            { playerName, position, posRank (number|null), ktcValue (number|null) }
 *                            posRank null = off the current KTC board (roster-filler dart)
 * @param {Object} board      season board: { [position]: [{name, value, rank}] }
 * @param {number} jitterPct  e.g. 15 → jitter window = ±max(1, 15% of rank)
 * @param {Function} rng      () => [0,1)
 *
 * @returns Array of {
 *   slot,                    original archetype slot
 *   targetRank,              jittered rank actually used
 *   jitterDelta,             targetRank − source rank (null for off-board slots)
 *   offBoard,                true when source slot had no current KTC rank
 *   generated: {name, value, rank} | null   (null only if position missing from board)
 * }
 * Slot order of the input is preserved in the output.
 */
export function instantiateArchetype({ slots, board, jitterPct, rng }) {
  const taken = new Set(); // `${pos}:${rank}`

  const randInt = (min, max) => min + Math.floor(rng() * (max - min + 1));

  // Fill studs first so jitter collisions push darts around, not anchors.
  const order = slots
    .map((slot, idx) => ({ slot, idx }))
    .sort((a, b) => (a.slot.posRank ?? Infinity) - (b.slot.posRank ?? Infinity));

  const results = new Array(slots.length);

  for (const { slot, idx } of order) {
    const pool = board[slot.position] || [];
    const depth = pool.length;
    if (depth === 0) {
      results[idx] = { slot, targetRank: null, jitterDelta: null, offBoard: slot.posRank == null, generated: null };
      continue;
    }

    const offBoard = slot.posRank == null;
    // Off-board slots (retired / valueless on the current board) map to the
    // tail of the target season's board: they are roster-filler darts.
    const base = offBoard ? depth : Math.min(slot.posRank, depth);
    const w = Math.max(1, Math.round((jitterPct / 100) * base));
    let target = Math.min(Math.max(base + randInt(-w, w), 1), depth);

    // Dedupe: walk outward (alternating) to the nearest free rank.
    if (taken.has(`${slot.position}:${target}`)) {
      let found = null;
      for (let step = 1; step <= depth; step += 1) {
        for (const cand of [target - step, target + step]) {
          if (cand >= 1 && cand <= depth && !taken.has(`${slot.position}:${cand}`)) {
            found = cand;
            break;
          }
        }
        if (found != null) break;
      }
      target = found; // null only if the whole position board is taken
    }

    if (target == null) {
      results[idx] = { slot, targetRank: null, jitterDelta: null, offBoard, generated: null };
      continue;
    }

    taken.add(`${slot.position}:${target}`);
    results[idx] = {
      slot,
      targetRank: target,
      jitterDelta: offBoard ? null : target - slot.posRank,
      offBoard,
      generated: pool[target - 1],
    };
  }

  return results;
}

/**
 * Identify the slot to drop so the generated roster is a 26-man HVORP base
 * (candidate player added → full 27). Drops the lowest-value slot of the
 * deepest position group (ties → group with the lower total KTC value).
 *
 * @returns index into `slots` of the dropped slot, or -1
 */
export function findDropSlotIndex(slots) {
  const groups = {};
  slots.forEach((slot, idx) => {
    (groups[slot.position] = groups[slot.position] || []).push(idx);
  });
  let dropPos = null;
  let bestCount = -1;
  let bestTotal = Infinity;
  for (const [pos, idxs] of Object.entries(groups)) {
    const total = idxs.reduce((s, i) => s + (slots[i].ktcValue || 0), 0);
    if (idxs.length > bestCount || (idxs.length === bestCount && total < bestTotal)) {
      dropPos = pos;
      bestCount = idxs.length;
      bestTotal = total;
    }
  }
  if (dropPos == null) return -1;
  const idxs = groups[dropPos];
  return idxs.reduce(
    (worst, i) => ((slots[i].ktcValue || 0) < (slots[worst].ktcValue || 0) ? i : worst),
    idxs[0],
  );
}

/**
 * Positional summary of an original archetype vs its generated instantiation.
 *
 * @returns Array<{ position, count, origTotal, origShare, genTotal, genShare }>
 */
export function summarizeConstruction(results) {
  const byPos = {};
  let origSum = 0;
  let genSum = 0;
  for (const r of results) {
    const pos = r.slot.position;
    const entry = (byPos[pos] = byPos[pos] || { position: pos, count: 0, origTotal: 0, genTotal: 0 });
    entry.count += 1;
    entry.origTotal += r.slot.ktcValue || 0;
    entry.genTotal += r.generated?.value || 0;
    origSum += r.slot.ktcValue || 0;
    genSum += r.generated?.value || 0;
  }
  const order = ['QB', 'RB', 'WR', 'TE'];
  return Object.values(byPos)
    .sort((a, b) => {
      const ai = order.indexOf(a.position);
      const bi = order.indexOf(b.position);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .map((e) => ({
      ...e,
      origShare: origSum > 0 ? e.origTotal / origSum : 0,
      genShare: genSum > 0 ? e.genTotal / genSum : 0,
    }));
}
