/**
 * Sanity-check RS-conditioned playoff rolls:
 *  - P98 regular season can draw a P40 playoff (different 15–17 than the source)
 *  - Conditional playoff medians rise with regular-season scoring
 *  - Same RS + different playoff percentiles produce different 15–17 totals
 */
import { loadSimulationInputs } from '../lib/mcp/simData.mjs';
import {
  buildPlayoffIndex,
  selectPlayoffOutcome,
  buildOutcomePool,
  materializeOutcomeWeeks,
  percentileToOutcomeIndex,
  buildPoolCumulativeWeights,
} from '../lib/mcp/simEngine.mjs';

const { catalog, basePointsByYear, hwangAdpRankMap, positionMaxRanks } = await loadSimulationInputs();
const playoffIndex = buildPlayoffIndex(catalog, basePointsByYear, 17);

function pctileReg(pos, p) {
  const regs = playoffIndex[pos].regs;
  const idx = Math.min(regs.length - 1, Math.max(0, Math.round((p / 100) * (regs.length - 1))));
  return regs[idx];
}

console.log('Playoff index sizes', Object.fromEntries(
  Object.entries(playoffIndex).map(([pos, v]) => [pos, v.seasons.length]),
));

for (const pos of ['QB', 'RB', 'WR', 'TE']) {
  const low = pctileReg(pos, 20);
  const mid = pctileReg(pos, 50);
  const hi = pctileReg(pos, 98);
  const p50 = (reg) => selectPlayoffOutcome(playoffIndex, pos, reg, 50).outcome.poTotal;
  const p40 = (reg) => selectPlayoffOutcome(playoffIndex, pos, reg, 40).outcome.poTotal;
  const p90 = (reg) => selectPlayoffOutcome(playoffIndex, pos, reg, 90).outcome.poTotal;
  const poolHi = selectPlayoffOutcome(playoffIndex, pos, hi, 50).pool;
  const poMin = Math.min(...poolHi.map((e) => e.poTotal));
  const poMax = Math.max(...poolHi.map((e) => e.poTotal));
  console.log(
    `${pos}  RS P20/P50/P98 = ${low.toFixed(0)}/${mid.toFixed(0)}/${hi.toFixed(0)}` +
    `  playoff P50 given those RS: ${p50(low).toFixed(1)} / ${p50(mid).toFixed(1)} / ${p50(hi).toFixed(1)}` +
    `  P98-RS playoff P40 vs P90: ${p40(hi).toFixed(1)} vs ${p90(hi).toFixed(1)}` +
    `  P98-RS pool range ${poMin.toFixed(1)}–${poMax.toFixed(1)} (n=${poolHi.length})`,
  );
}

// Concrete: pick an elite ADP player's P98 RS outcome, then overlay P40 playoffs
const samplePid = Object.keys(hwangAdpRankMap).find((pid) => {
  const a = hwangAdpRankMap[pid];
  return a.position === 'RB' && a.effRank <= 3;
});
const adp = hwangAdpRankMap[samplePid];
const pool = buildOutcomePool(adp, catalog, positionMaxRanks);
const cum = buildPoolCumulativeWeights(pool);
const rsIdx = percentileToOutcomeIndex(98, pool.length, cum);
const rsOutcome = pool[rsIdx];
const weeks = materializeOutcomeWeeks(rsOutcome, basePointsByYear, 17);
let reg = 0;
for (let i = 0; i < 14; i++) reg += weeks[i];
const nativePo = weeks[14] + weeks[15] + weeks[16];
const p40 = selectPlayoffOutcome(playoffIndex, adp.position, reg, 40);
const p90 = selectPlayoffOutcome(playoffIndex, adp.position, reg, 90);
console.log(`\nSample ${adp.position}${Math.round(adp.effRank)} P98 RS = ${rsOutcome.synthetic ? 'synthetic' : `${rsOutcome.sleeperId} ${rsOutcome.seasonYear}`}  1–14=${reg.toFixed(1)}`);
console.log(`  native W15–17 of that season: ${nativePo.toFixed(1)}`);
console.log(`  independent P40 playoff: ${p40.outcome.poTotal.toFixed(1)}  (${p40.outcome.sleeperId} ${p40.outcome.seasonYear})  weeks ${p40.outcome.po.map((x) => x.toFixed(1)).join(', ')}`);
console.log(`  independent P90 playoff: ${p90.outcome.poTotal.toFixed(1)}  (${p90.outcome.sleeperId} ${p90.outcome.seasonYear})`);
console.log(`  P40 !== native? ${Math.abs(p40.outcome.poTotal - nativePo) > 0.05}`);
console.log(`  P90 > P40? ${p90.outcome.poTotal > p40.outcome.poTotal}`);
