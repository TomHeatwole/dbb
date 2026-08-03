import React, { useEffect, useMemo, useRef, useState } from 'react';
import SimulatorProgressBar from '../scenarios/SimulatorProgressBar';
import { TOUCHDOWN_CELEBRATION_MS } from '../scenarios/simulatorProgress';
import {
  DEFAULT_BUILDS_PER_ARCHETYPE,
  DEFAULT_JITTER_PCT,
  loadArchetypeOptions,
  matchupCombos,
  PAIR_TOLERANCE_PCT,
  SIM_YEARS,
  SLOT_COUNTS,
} from './hwangTrueSimulatorEngine';

/**
 * Runs one simulation in a dedicated Web Worker so long runs keep full speed
 * when the tab is backgrounded (main-thread timers get throttled to ≥1s).
 */
function runSimulationInWorker(options, onProgress, workerRef) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./hwangTrueSimWorker.js', import.meta.url));
    workerRef.current = worker;
    const cleanup = () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
    worker.onmessage = (event) => {
      const { type } = event.data || {};
      if (type === 'progress') onProgress(event.data.progress);
      else if (type === 'done') { cleanup(); resolve(event.data.results); }
      else if (type === 'error') { cleanup(); reject(new Error(event.data.message)); }
    };
    worker.onerror = (err) => {
      cleanup();
      reject(new Error(err?.message || 'Simulation worker crashed'));
    };
    worker.postMessage({ type: 'run', options });
  });
}

const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER'];
const MAX_PAIR_ROWS = 400;
const BUILD_OPTIONS = [1, 3, 5, 10, 25, 50, 100, 250, 500, 1000];

const PRESETS = {
  hwang: {
    name: 'Hwang',
    label: 'Hwang (3RB/2FLEX, standard, TE +0.5)',
    slots: { ...SLOT_COUNTS },
    ppr: 0,
    tePremium: 0.5,
  },
  generic: {
    name: 'Generic SF',
    label: 'Generic SF (2RB/1FLEX, full PPR, no TEP)',
    slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SUPER: 1 },
    ppr: 1,
    tePremium: 0,
  },
};

function lineupLabel(slots) {
  return `${slots.QB}QB/${slots.RB}RB/${slots.WR}WR/${slots.TE}TE/${slots.FLEX}FLEX/${slots.SUPER}SF`;
}

function scoringLabel(ppr, tePremium) {
  const base = ppr === 0 ? 'standard' : `${ppr} PPR`;
  return tePremium > 0 ? `${base}, TE +${tePremium}` : base;
}

function sameFormat(format, preset) {
  return SLOT_ORDER.every((s) => format.slots[s] === preset.slots[s])
    && format.ppr === preset.ppr
    && format.tePremium === preset.tePremium;
}

/** Short display name for a format: preset name if it matches one. */
function formatName(format) {
  for (const preset of Object.values(PRESETS)) {
    if (sameFormat(format, preset)) return preset.name;
  }
  return lineupLabel(format.slots);
}

function formatFullLabel(format) {
  return `${lineupLabel(format.slots)} · ${scoringLabel(format.ppr, format.tePremium)}`;
}

function fmtPctSigned(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function fmtNum(value, digits = 0) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function pctClass(value) {
  if (value == null || !Number.isFinite(value)) return '';
  if (value > 0) return 'pvc-pos';
  if (value < 0) return 'pvc-neg';
  return '';
}

function symmetricPct(a, b) {
  const mid = (a + b) / 2;
  if (mid === 0) return null;
  return ((a - b) / Math.abs(mid)) * 100;
}

function matchupInterpretation(m) {
  if (m.count === 0 || m.relDiffPct == null) return 'No matched pairs';
  const winner = m.relDiffPct >= 0 ? m.posA : m.posB;
  const loser = m.relDiffPct >= 0 ? m.posB : m.posA;
  return `${winner} out-produced ${loser} by ${Math.abs(m.relDiffPct).toFixed(1)}% of starter points at the same KTC price`;
}

function MatchupTable({ matchups, title, note, selectedPairKey, onSelectPair, renderExpanded }) {
  const rows = matchupCombos().map((c) => matchups[c.pairKey]).filter(Boolean);
  const clickable = typeof onSelectPair === 'function';
  return (
    <div className="pvc-section">
      {title && <h3 className="pvc-section-title">{title}</h3>}
      {note && <p className="pvc-section-desc">{note}</p>}
      <div className="pvc-table-wrap">
        <table className="pvc-table">
          <thead>
            <tr>
              <th>Matchup</th>
              <th className="pvc-th-num">Total HVORP (left)</th>
              <th className="pvc-th-num">Total HVORP (right)</th>
              <th className="pvc-th-num">Total Δ %</th>
              <th className="pvc-th-num">Pair plugs</th>
              <th className="pvc-th-note">Interpretation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <React.Fragment key={m.pairKey}>
                <tr
                  className={
                    (clickable ? 'hts-row-clickable' : '') +
                    (selectedPairKey === m.pairKey ? ' hts-row-selected' : '')
                  }
                  onClick={clickable ? () => onSelectPair(m.pairKey) : undefined}
                >
                  <td className="pvc-td-label">
                    {clickable && (
                      <span className="hts-row-caret">{selectedPairKey === m.pairKey ? '▾' : '▸'}</span>
                    )}
                    {m.label}
                  </td>
                  <td className="pvc-td-num">{fmtNum(m.totalA)}</td>
                  <td className="pvc-td-num">{fmtNum(m.totalB)}</td>
                  <td className={`pvc-td-num hts-rel ${pctClass(m.relDiffPct)}`}>
                    {fmtPctSigned(m.relDiffPct)}
                  </td>
                  <td className="pvc-td-num">{fmtNum(m.count)}</td>
                  <td className="pvc-td-note">{matchupInterpretation(m)}</td>
                </tr>
                {clickable && selectedPairKey === m.pairKey && renderExpanded && (
                  <tr className="hts-expanded-row">
                    <td colSpan={6}>{renderExpanded(m)}</td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Individual value-matched comparisons for one matchup on one archetype. */
function PairBreakdown({ matchup, yearData, archetype }) {
  const rows = useMemo(() => {
    const candById = new Map(yearData.candidates.map((c) => [c.playerId, c]));
    const hvorp = archetype.hvorpAvgById || {};
    const list = [];
    for (const pair of yearData.pairs) {
      if (pair.pairKey !== matchup.pairKey) continue;
      const a = candById.get(pair.aId);
      const b = candById.get(pair.bId);
      const ha = hvorp[pair.aId];
      const hb = hvorp[pair.bId];
      if (!a || !b || ha == null || hb == null) continue;
      list.push({
        a, b, ha, hb,
        mid: (a.value + b.value) / 2,
        delta: ha - hb,
        pctDelta: symmetricPct(ha, hb),
      });
    }
    list.sort((x, y) => y.mid - x.mid);
    return list;
  }, [matchup.pairKey, yearData, archetype]);

  if (rows.length === 0) {
    return <p className="pvc-empty">No individual comparisons for this matchup.</p>;
  }

  const truncated = rows.length > MAX_PAIR_ROWS;
  const shown = truncated ? rows.slice(0, MAX_PAIR_ROWS) : rows;

  return (
    <div className="hts-pair-breakdown">
      <p className="pvc-section-desc">
        Every {matchup.posA} vs {matchup.posB} pair plugged into this archetype
        {archetype.buildCount > 1 ? ` — HVORP averaged across ${archetype.buildCount} builds` : ''}.
        Sorted by KTC value. Positive Δ = the {matchup.posA} returned more starter points.
        {truncated && ` Showing top ${MAX_PAIR_ROWS} of ${rows.length.toLocaleString()} pairs by value.`}
      </p>
      <div className="pvc-table-wrap pvc-table-wrap--scroll">
        <table className="pvc-table pvc-table--detail">
          <thead>
            <tr>
              <th>{matchup.posA}</th>
              <th className="pvc-th-num">KTC</th>
              <th className="pvc-th-num">HVORP</th>
              <th>{matchup.posB}</th>
              <th className="pvc-th-num">KTC</th>
              <th className="pvc-th-num">HVORP</th>
              <th className="pvc-th-num">Δ</th>
              <th className="pvc-th-num">Δ %</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row, idx) => (
              <tr key={`${row.a.playerId}-${row.b.playerId}-${idx}`}>
                <td>{row.a.name}</td>
                <td className="pvc-td-num">{fmtNum(row.a.value)}</td>
                <td className="pvc-td-num">{fmtNum(row.ha, 1)}</td>
                <td>{row.b.name}</td>
                <td className="pvc-td-num">{fmtNum(row.b.value)}</td>
                <td className="pvc-td-num">{fmtNum(row.hb, 1)}</td>
                <td className={`pvc-td-num ${pctClass(row.delta)}`}>
                  {row.delta >= 0 ? '+' : ''}{fmtNum(row.delta, 1)}
                </td>
                <td className={`pvc-td-num ${pctClass(row.pctDelta)}`}>{fmtPctSigned(row.pctDelta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MultiplierStrip({ multipliers, grounding }) {
  const isQb = grounding === 'qb';
  return (
    <div className="hts-mult-strip">
      {['QB', 'RB', 'WR', 'TE'].map((pos) => (
        <div key={pos} className="hts-mult-card">
          <span className="hts-mult-pos">{pos}</span>
          <span className="hts-mult-value">
            {multipliers[pos] == null ? '—' : `${multipliers[pos].toFixed(3)}×`}
          </span>
        </div>
      ))}
      <p className="hts-mult-note">
        Value multipliers solved across the full comparison network — all six matchups
        (including the direct RB/WR/TE pairs) via weighted least squares in log space.
        Pair contributions are weighted by pair value and by build strength (season points).
        {isQb
          ? ' Grounded on QB = 1.0×: below 1.0× = fewer starter points than QB at the same price.'
          : ' Mean-grounded: 1.0× = the average same-priced player across all four positions.'}
      </p>
    </div>
  );
}

function YearMatrix({ years }) {
  const combos = matchupCombos();
  return (
    <div className="pvc-section">
      <h3 className="pvc-section-title">Total Δ % by season</h3>
      <div className="pvc-table-wrap">
        <table className="pvc-table">
          <thead>
            <tr>
              <th>Matchup</th>
              {years.map((y) => <th key={y.year} className="pvc-th-num">{y.year}</th>)}
            </tr>
          </thead>
          <tbody>
            {combos.map((c) => (
              <tr key={c.pairKey}>
                <td className="pvc-td-label">{c.label}</td>
                {years.map((y) => {
                  const m = y.matchups[c.pairKey];
                  return (
                    <td key={y.year} className={`pvc-td-num ${pctClass(m?.relDiffPct)}`}>
                      {fmtPctSigned(m?.relDiffPct)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ArchetypeCard({ archetype, selected, onClick }) {
  const combos = matchupCombos();
  return (
    <button
      className={`hts-roster-card${selected ? ' hts-roster-card--selected' : ''}`}
      onClick={onClick}
    >
      <span className="hts-roster-label">{archetype.label}</span>
      <span className="hts-roster-sub">
        ~{fmtNum(archetype.avgTotalKtc)} KTC ({archetype.year} board)
        {archetype.buildCount > 1 ? ` · ${archetype.buildCount} builds` : ''}
      </span>
      <span className="hts-roster-chips">
        {combos.map((c) => {
          const m = archetype.matchups[c.pairKey];
          return (
            <span key={c.pairKey} className={`hts-chip ${pctClass(m?.relDiffPct)}`}>
              {c.posA}/{c.posB} {fmtPctSigned(m?.relDiffPct)}
            </span>
          );
        })}
      </span>
    </button>
  );
}

function ArchetypeDetail({ archetype, yearData }) {
  const [selectedPairKey, setSelectedPairKey] = useState(null);
  const [buildIndex, setBuildIndex] = useState(1);

  const build = archetype.builds.find((b) => b.buildIndex === buildIndex) || archetype.builds[0];
  const players = useMemo(() => {
    const order = { QB: 0, RB: 1, WR: 2, TE: 3 };
    return [...build.players].sort((a, b) => {
      const po = (order[a.position] ?? 9) - (order[b.position] ?? 9);
      if (po !== 0) return po;
      return (b.ktcValue || 0) - (a.ktcValue || 0);
    });
  }, [build]);

  return (
    <div className="hts-roster-detail">
      <MatchupTable
        matchups={archetype.matchups}
        title={`${archetype.label} — matchup results (${archetype.year}${archetype.buildCount > 1 ? `, ${archetype.buildCount} builds` : ''})`}
        note="Every value-matched pair plugged into this archetype's builds. Click a matchup to expand the individual comparisons."
        selectedPairKey={selectedPairKey}
        onSelectPair={(key) => setSelectedPairKey(key === selectedPairKey ? null : key)}
        renderExpanded={(m) => (
          <PairBreakdown matchup={m} yearData={yearData} archetype={archetype} />
        )}
      />
      <div className="pvc-section">
        <h3 className="pvc-section-title">Constructed roster</h3>
        {archetype.builds.length > 1 && (
          <div className="hts-tabs">
            {archetype.builds.map((b) => (
              <button
                key={b.buildIndex}
                className={`hts-tab${b.buildIndex === build.buildIndex ? ' hts-tab--active' : ''}`}
                onClick={() => setBuildIndex(b.buildIndex)}
              >
                Build {b.buildIndex}
              </button>
            ))}
          </div>
        )}
        <div className="pvc-table-wrap pvc-table-wrap--scroll">
          <table className="pvc-table pvc-table--detail">
            <thead>
              <tr>
                <th>Pos</th>
                <th>Player ({archetype.year})</th>
                <th>From archetype slot</th>
                <th className="pvc-th-num">Pos rank</th>
                <th className="pvc-th-num">{archetype.year} KTC</th>
                <th className="pvc-th-num">Season pts</th>
                <th className="pvc-th-num">Roster HVORP</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p, idx) => (
                <tr key={`${p.sleeperId}-${idx}`} className={p.dropped ? 'arb-dropped-row' : ''}>
                  <td className="pvc-td-label">{p.position}</td>
                  <td>
                    {p.name}
                    {p.dropped && <span className="arb-drop-tag">DROP</span>}
                  </td>
                  <td className="pvc-td-muted">
                    {p.sourcePlayer}
                    {p.offBoard && <span className="arb-offboard-tag">off board</span>}
                  </td>
                  <td className="pvc-td-num">{p.posRank ?? '—'}</td>
                  <td className="pvc-td-num">{fmtNum(p.ktcValue)}</td>
                  <td className="pvc-td-num">{fmtNum(p.seasonPts, 1)}</td>
                  <td className="pvc-td-num">{p.dropped ? '—' : fmtNum(p.hvorp, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pvc-empty">
          Total base KTC {fmtNum(build.totalKtc)}. The DROP slot is excluded from the 26-man HVORP
          base; candidates plug in as the 27th man. Roster HVORP for base players is leave-one-out
          for this build: starter points lost if they were removed.
          {archetype.buildCount > archetype.builds.length
            && ` Roster detail is stored for the first ${archetype.builds.length} of ${archetype.buildCount} builds — matchup totals and averaged HVORP cover all of them.`}
        </p>
      </div>
    </div>
  );
}

function YearBrowser({ years }) {
  const [activeYear, setActiveYear] = useState(years[0]?.year ?? null);
  const [selectedArchetypeId, setSelectedArchetypeId] = useState(null);

  const yearData = years.find((y) => y.year === activeYear) || null;
  const selectedArchetype =
    yearData?.archetypes.find((a) => a.archetypeId === selectedArchetypeId) || null;

  return (
    <div className="pvc-section">
      <h3 className="pvc-section-title">Season breakdown</h3>
      <div className="hts-tabs">
        {years.map((y) => (
          <button
            key={y.year}
            className={`hts-tab${y.year === activeYear ? ' hts-tab--active' : ''}`}
            onClick={() => { setActiveYear(y.year); setSelectedArchetypeId(null); }}
          >
            {y.year}
          </button>
        ))}
      </div>

      {yearData && (
        <>
          <p className="pvc-section-desc">
            {fmtNum(yearData.candidateCount)} candidates (top {fmtNum(yearData.poolSize)} KTC,
            {' '}{yearData.excludedZeroPoint} zero-point players excluded) ·
            {' '}{fmtNum(yearData.pairCount)} value-matched pairs, each plugged into
            {' '}{yearData.archetypes.length} archetypes
            {yearData.archetypes[0]?.buildCount > 1
              ? ` × ${yearData.archetypes[0].buildCount} builds`
              : ''}.
          </p>
          <MatchupTable
            matchups={yearData.matchups}
            title={`${yearData.year} totals — all archetypes and builds`}
          />
          <h4 className="hts-subheading">Constructed archetypes — click one to inspect</h4>
          <div className="hts-roster-grid">
            {yearData.archetypes.map((a) => (
              <ArchetypeCard
                key={a.archetypeId}
                archetype={a}
                selected={a.archetypeId === selectedArchetypeId}
                onClick={() => setSelectedArchetypeId(
                  a.archetypeId === selectedArchetypeId ? null : a.archetypeId,
                )}
              />
            ))}
          </div>
          {selectedArchetype && (
            <ArchetypeDetail archetype={selectedArchetype} yearData={yearData} />
          )}
        </>
      )}
    </div>
  );
}

/** Full results viewer for one run (one scoring format). */
function SingleRunView({ results }) {
  const cfg = results.config;
  const totalPlugs = Object.values(results.overall.matchups).reduce((s, m) => s + m.count, 0);
  return (
    <>
      <div className="hts-headline">
        <h3 className="pvc-section-title">
          Final numbers — {cfg.years[0]}–{cfg.years[cfg.years.length - 1]}
        </h3>
        <p className="pvc-section-desc">
          Lineup {lineupLabel(cfg.slotCounts)} · {scoringLabel(cfg.ppr, cfg.tePremium)} ·
          {' '}{cfg.valueBasis === 'comp' ? 'competitor-adjusted values' : 'Final KTC values'} ·
          {' '}{cfg.archetypeCount} archetypes × {cfg.buildsPerArchetype} build{cfg.buildsPerArchetype > 1 ? 's' : ''}
          {' '}× {results.years.length} seasons
          {cfg.jitterPct > 0 ? ` · jitter ±${cfg.jitterPct}% (seed ${cfg.seed})` : ' · deterministic'} ·
          {' '}{fmtNum(totalPlugs)} total pair plugs · pairs within ±{cfg.tolerancePct}% KTC value
          (top {cfg.topKtcRank}) · HVORP = true roster-context marginal starter points.
        </p>
      </div>
      <MultiplierStrip multipliers={results.overall.multipliers} grounding={cfg.grounding} />
      <MatchupTable
        matchups={results.overall.matchups}
        title="All seasons, all rosters combined"
        note="Total HVORP each position group produced across every value-matched pair plug. Total Δ % = symmetric difference of the two totals — the headline relative difference."
      />
      <YearMatrix years={results.years} />
      <YearBrowser years={results.years} />
    </>
  );
}

/** Executive summary comparing the two format runs. */
function ComparisonSummary({ runs, formats }) {
  const [runA, runB] = runs;
  const [nameA, nameB] = formats.map(formatName);
  const combos = matchupCombos();
  const isQbGrounded = runA.config.grounding === 'qb';

  const rows = ['QB', 'RB', 'WR', 'TE'].map((pos) => {
    const multA = runA.overall.multipliers[pos];
    const multB = runB.overall.multipliers[pos];
    const factor = multA != null && multB != null && multB !== 0 ? multA / multB : null;
    return { pos, multA, multB, factor };
  });

  const swings = combos.map((c) => {
    const relA = runA.overall.matchups[c.pairKey]?.relDiffPct;
    const relB = runB.overall.matchups[c.pairKey]?.relDiffPct;
    return {
      ...c,
      relA,
      relB,
      swing: relA != null && relB != null ? relA - relB : null,
    };
  }).sort((a, b) => Math.abs(b.swing ?? 0) - Math.abs(a.swing ?? 0));

  const comparable = isQbGrounded ? rows.filter((r) => r.pos !== 'QB') : rows;
  const gains = comparable.filter((r) => r.factor != null && r.factor >= 1.05);
  const losses = comparable.filter((r) => r.factor != null && r.factor <= 0.95);
  const neutral = comparable.filter(
    (r) => r.factor != null && r.factor > 0.95 && r.factor < 1.05,
  );
  const describe = (list) => list
    .map((r) => `${r.pos} ${r.factor >= 1 ? '+' : ''}${((r.factor - 1) * 100).toFixed(0)}%`)
    .join(', ');

  return (
    <div className="pvc-section hts-summary">
      <h3 className="pvc-section-title">Executive summary — {nameA} vs {nameB}</h3>
      <p className="pvc-section-desc">
        Both runs used identical roster builds, seed, and archetypes — only lineup structure and
        reception scoring differ. Each format&apos;s multipliers carry KTC&apos;s dynasty pricing
        (longevity discounts and all); dividing them cancels that shared component, so the format
        factor is the pure effect of playing in {nameA} instead of {nameB}.
      </p>
      <div className="pvc-table-wrap">
        <table className="pvc-table">
          <thead>
            <tr>
              <th>Position</th>
              <th className="pvc-th-num">{nameA} multiplier</th>
              <th className="pvc-th-num">{nameB} multiplier</th>
              <th className="pvc-th-num">Format factor ({nameA} ÷ {nameB})</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pos}>
                <td className="pvc-td-label">{r.pos}</td>
                <td className="pvc-td-num">{r.multA == null ? '—' : `${r.multA.toFixed(3)}×`}</td>
                <td className="pvc-td-num">{r.multB == null ? '—' : `${r.multB.toFixed(3)}×`}</td>
                <td className={`pvc-td-num hts-rel ${r.factor == null ? '' : pctClass(r.factor - 1)}`}>
                  {r.factor == null ? '—' : `${r.factor.toFixed(3)}×`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pvc-table-wrap">
        <table className="pvc-table">
          <thead>
            <tr>
              <th>Matchup</th>
              <th className="pvc-th-num">{nameA} Δ %</th>
              <th className="pvc-th-num">{nameB} Δ %</th>
              <th className="pvc-th-num">Swing (pts)</th>
            </tr>
          </thead>
          <tbody>
            {swings.map((s) => (
              <tr key={s.pairKey}>
                <td className="pvc-td-label">{s.label}</td>
                <td className={`pvc-td-num ${pctClass(s.relA)}`}>{fmtPctSigned(s.relA)}</td>
                <td className={`pvc-td-num ${pctClass(s.relB)}`}>{fmtPctSigned(s.relB)}</td>
                <td className={`pvc-td-num hts-rel ${pctClass(s.swing)}`}>
                  {s.swing == null ? '—' : `${s.swing >= 0 ? '+' : ''}${s.swing.toFixed(1)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pvc-section-desc">
        Relative to {nameB} ({isQbGrounded ? 'grounded on QB' : 'mean-grounded'}):
        {gains.length > 0 && ` ${nameA} boosts ${describe(gains)}.`}
        {losses.length > 0 && ` ${nameA} suppresses ${describe(losses)}.`}
        {neutral.length > 0 && ` ${describe(neutral)} price${neutral.length === 1 ? 's' : ''} roughly the same in both formats.`}
      </p>
    </div>
  );
}

function FormatEditor({ heading, format, onChange }) {
  const setSlot = (slot, raw) => {
    onChange({
      ...format,
      slots: { ...format.slots, [slot]: Math.max(0, Math.min(5, Number(raw) || 0)) },
    });
  };
  return (
    <div className="hts-format-editor">
      <div className="hts-format-heading">
        <span className="pvc-label">{heading}</span>
        <span className="hts-format-summary">{formatFullLabel(format)}</span>
      </div>
      <div className="hts-preset-row">
        {Object.entries(PRESETS).map(([id, preset]) => (
          <button
            key={id}
            className={`hts-preset-btn${sameFormat(format, preset) ? ' hts-preset-btn--active' : ''}`}
            onClick={() => onChange({
              slots: { ...preset.slots },
              ppr: preset.ppr,
              tePremium: preset.tePremium,
            })}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="pvc-controls">
        {SLOT_ORDER.map((slot) => (
          <label key={slot} className="pvc-field">
            <span className="pvc-label">{slot === 'SUPER' ? 'SUPERFLEX' : slot}</span>
            <input
              type="number"
              min="0"
              max="5"
              className="pvc-select hts-slot-input"
              value={format.slots[slot]}
              onChange={(e) => setSlot(slot, e.target.value)}
            />
          </label>
        ))}
        <label className="pvc-field">
          <span className="pvc-label">PPR</span>
          <select
            className="pvc-select arb-select-narrow"
            value={String(format.ppr)}
            onChange={(e) => onChange({ ...format, ppr: Number(e.target.value) })}
          >
            <option value="0">0 (standard)</option>
            <option value="0.5">0.5</option>
            <option value="1">1.0</option>
          </select>
        </label>
        <label className="pvc-field">
          <span className="pvc-label">TE premium (+/rec)</span>
          <select
            className="pvc-select arb-select-narrow"
            value={String(format.tePremium)}
            onChange={(e) => onChange({ ...format, tePremium: Number(e.target.value) })}
          >
            <option value="0">none</option>
            <option value="0.25">+0.25</option>
            <option value="0.5">+0.5</option>
            <option value="1">+1.0</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function HwangTrueSimulator() {
  const [phase, setPhase] = useState('idle'); // idle | running | celebrating | done | error
  const [progress, setProgress] = useState({ fraction: 0, label: '', unitsDone: 0, totalUnits: 1 });
  const [runs, setRuns] = useState(null); // array of engine results (1 or 2)
  const [runFormats, setRunFormats] = useState(null); // formats used for those runs
  const [activeTab, setActiveTab] = useState(0);
  const [error, setError] = useState(null);

  const [compareMode, setCompareMode] = useState(false);
  const [formats, setFormats] = useState([
    { slots: { ...PRESETS.hwang.slots }, ppr: PRESETS.hwang.ppr, tePremium: PRESETS.hwang.tePremium },
    { slots: { ...PRESETS.generic.slots }, ppr: PRESETS.generic.ppr, tePremium: PRESETS.generic.tePremium },
  ]);
  const [buildsPerArchetype, setBuildsPerArchetype] = useState(DEFAULT_BUILDS_PER_ARCHETYPE);
  const [valueBasis, setValueBasis] = useState('ktc');
  const [qbGrounding, setQbGrounding] = useState(false);
  const [jitterPct, setJitterPct] = useState(DEFAULT_JITTER_PCT);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 100000) + 1);
  const [archetypeOptions, setArchetypeOptions] = useState([]);
  const [selectedArchetypes, setSelectedArchetypes] = useState(null); // null until options load
  const cancelledRef = useRef(false);
  const workerRef = useRef(null);

  useEffect(() => () => {
    cancelledRef.current = true;
    if (workerRef.current) workerRef.current.terminate();
  }, []);

  useEffect(() => {
    let stale = false;
    loadArchetypeOptions()
      .then((options) => {
        if (stale) return;
        setArchetypeOptions(options);
        setSelectedArchetypes(new Set(options.map((o) => o.archetypeId)));
      })
      .catch((err) => { if (!stale) setError(err?.message || 'Failed to load archetypes'); });
    return () => { stale = true; };
  }, []);

  const run = async () => {
    cancelledRef.current = false;
    setError(null);
    setRuns(null);
    setActiveTab(0);
    setPhase('running');
    setProgress({ fraction: 0, label: 'Loading archetypes and KTC boards…', unitsDone: 0, totalUnits: 1 });
    const activeFormats = compareMode ? formats : [formats[0]];
    try {
      const allSelected = selectedArchetypes == null
        || selectedArchetypes.size === archetypeOptions.length;
      const results = [];
      for (let i = 0; i < activeFormats.length; i += 1) {
        if (cancelledRef.current) throw new Error('cancelled');
        const prefix = activeFormats.length > 1
          ? `[${i + 1}/${activeFormats.length} ${formatName(activeFormats[i])}] `
          : '';
        // eslint-disable-next-line no-await-in-loop
        const out = await runSimulationInWorker(
          {
            jitterPct,
            seed,
            buildsPerArchetype,
            slotCounts: { ...activeFormats[i].slots },
            ppr: activeFormats[i].ppr,
            tePremium: activeFormats[i].tePremium,
            archetypeIds: allSelected ? null : Array.from(selectedArchetypes),
            valueBasis,
            grounding: qbGrounding ? 'qb' : 'mean',
          },
          (p) => setProgress({
            ...p,
            fraction: (i + p.fraction) / activeFormats.length,
            label: prefix + p.label,
          }),
          workerRef,
        );
        results.push(out);
      }
      setRuns(results);
      setRunFormats(activeFormats);
      setPhase('celebrating');
      setTimeout(() => setPhase('done'), TOUCHDOWN_CELEBRATION_MS + 400);
    } catch (err) {
      if (err?.message === 'cancelled') {
        setPhase('idle');
      } else {
        setError(err?.message || 'Simulation failed');
        setPhase('error');
      }
    }
  };

  if (phase === 'running' || phase === 'celebrating') {
    return (
      <div className="pvc-root">
        <SimulatorProgressBar
          phase={phase === 'celebrating' ? 'celebrating' : 'running'}
          simProgress={progress.fraction}
          iterations={progress.totalUnits}
        />
        <div className="hts-progress-detail">
          {phase === 'celebrating' ? 'Crunching final numbers…' : progress.label}
        </div>
        {phase === 'running' && (
          <button
            className="hts-cancel-btn"
            onClick={() => {
              cancelledRef.current = true;
              if (workerRef.current) {
                workerRef.current.terminate();
                workerRef.current = null;
              }
              setPhase('idle');
            }}
          >
            Cancel
          </button>
        )}
      </div>
    );
  }

  if (phase === 'done' && runs) {
    const tabIndex = Math.min(activeTab, runs.length - 1);
    return (
      <div className="pvc-root">
        {runs.length > 1 && (
          <div className="hts-tabs hts-format-tabs">
            {runs.map((r, i) => (
              <button
                key={i}
                className={`hts-tab${i === tabIndex ? ' hts-tab--active' : ''}`}
                title={formatFullLabel(runFormats[i])}
                onClick={() => setActiveTab(i)}
              >
                {formatName(runFormats[i])}
              </button>
            ))}
          </div>
        )}
        <SingleRunView key={tabIndex} results={runs[tabIndex]} />
        {runs.length > 1 && <ComparisonSummary runs={runs} formats={runFormats} />}
        <div className="hts-rerun-row">
          <button className="hts-run-btn" onClick={() => setPhase('idle')}>⚙ Configure new run</button>
          <button className="hts-run-btn" onClick={run}>↻ Re-run same config</button>
        </div>
      </div>
    );
  }

  const effectiveBuilds = jitterPct > 0 ? buildsPerArchetype : 1;
  const selectedCount = selectedArchetypes ? selectedArchetypes.size : archetypeOptions.length;
  const archetypeShare = archetypeOptions.length > 0
    ? Math.max(selectedCount, 1) / archetypeOptions.length
    : 1;
  const formatCount = compareMode ? 2 : 1;
  const estMinutes = Math.max(
    2,
    Math.round((1.5 + effectiveBuilds * 0.17 * archetypeShare) * formatCount),
  );
  const estLabel = estMinutes > 120
    ? `~${(estMinutes / 60).toFixed(1)} hours`
    : `~${estMinutes} minutes`;

  const toggleArchetype = (id) => {
    const next = new Set(selectedArchetypes || []);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedArchetypes(next);
  };

  const setFormat = (index, next) => {
    setFormats((prev) => prev.map((f, i) => (i === index ? next : f)));
  };

  return (
    <div className="pvc-root">
      {phase === 'error' && <div className="pvc-error">{error}</div>}
      <p className="pvc-intro">
        The Hwang True Simulator instantiates every real Hwang roster archetype into each season
        (2021–2025) — {effectiveBuilds} jittered build{effectiveBuilds > 1 ? 's' : ''} per archetype —
        then runs a full cross-position analysis: every pair of players within
        ±{PAIR_TOLERANCE_PCT}% of each other&apos;s preseason Final KTC value is plugged into each
        constructed roster, and their true roster HVORP — the marginal optimal-lineup starter
        points they add over 17 weeks — is tallied position group vs position group.
        In compare mode the same builds are scored under two formats, and dividing the two sets of
        multipliers isolates the pure format effect.
      </p>
      <p className="pvc-meta">
        Runs fully in the browser: fetches {SIM_YEARS.length * 17} weeks of Sleeper stats and
        evaluates ~300 candidates per build. Expect {estLabel} for {selectedCount} archetype
        {selectedCount === 1 ? '' : 's'} × {effectiveBuilds} build{effectiveBuilds === 1 ? '' : 's'}
        {formatCount > 1 ? ' × 2 formats' : ''}.
      </p>

      <div className="pvc-field hts-arch-section">
        <span className="pvc-label">Mode</span>
        <div className="hts-preset-row">
          <button
            className={`hts-preset-btn${!compareMode ? ' hts-preset-btn--active' : ''}`}
            onClick={() => setCompareMode(false)}
          >
            Single format
          </button>
          <button
            className={`hts-preset-btn${compareMode ? ' hts-preset-btn--active' : ''}`}
            onClick={() => setCompareMode(true)}
          >
            Compare two formats
          </button>
        </div>
      </div>

      <div className={compareMode ? 'hts-format-grid' : ''}>
        <FormatEditor
          heading={compareMode ? 'Left format' : 'Format'}
          format={formats[0]}
          onChange={(next) => setFormat(0, next)}
        />
        {compareMode && (
          <FormatEditor
            heading="Right format"
            format={formats[1]}
            onChange={(next) => setFormat(1, next)}
          />
        )}
      </div>

      <div className="pvc-field hts-arch-section">
        <span className="pvc-label">
          Archetypes ({selectedCount}/{archetypeOptions.length} selected)
        </span>
        <div className="hts-preset-row">
          <button
            className="hts-preset-btn"
            onClick={() => setSelectedArchetypes(new Set(archetypeOptions.map((o) => o.archetypeId)))}
          >
            All
          </button>
          <button className="hts-preset-btn" onClick={() => setSelectedArchetypes(new Set())}>
            None
          </button>
        </div>
        <div className="hts-arch-grid">
          {archetypeOptions.map((option) => (
            <label key={option.archetypeId} className="hts-arch-option">
              <input
                type="checkbox"
                checked={selectedArchetypes ? selectedArchetypes.has(option.archetypeId) : true}
                onChange={() => toggleArchetype(option.archetypeId)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="pvc-controls">
        <label className="pvc-field">
          <span className="pvc-label">Value basis (builds + pairing)</span>
          <select
            className="pvc-select"
            value={valueBasis}
            onChange={(e) => setValueBasis(e.target.value)}
          >
            <option value="ktc">Final KTC</option>
            <option value="comp">Competitor Adjusted</option>
          </select>
        </label>
        <label className="pvc-field">
          <span className="pvc-label">Multiplier grounding</span>
          <select
            className="pvc-select"
            value={qbGrounding ? 'qb' : 'mean'}
            onChange={(e) => setQbGrounding(e.target.value === 'qb')}
          >
            <option value="mean">Mean (avg position = 1.0)</option>
            <option value="qb">QB = 1.0</option>
          </select>
        </label>
        <label className="pvc-field">
          <span className="pvc-label">Builds per archetype</span>
          <select
            className="pvc-select arb-select-narrow"
            value={String(buildsPerArchetype)}
            onChange={(e) => setBuildsPerArchetype(Number(e.target.value))}
            disabled={jitterPct === 0}
          >
            {BUILD_OPTIONS.map((n) => <option key={n} value={String(n)}>{n}</option>)}
          </select>
        </label>
        <label className="pvc-field">
          <span className="pvc-label">
            Jitter: ±{jitterPct}% of rank {jitterPct === 0 ? '(deterministic, 1 build)' : ''}
          </span>
          <input
            type="range"
            min="0"
            max="30"
            step="1"
            value={jitterPct}
            onChange={(e) => setJitterPct(Number(e.target.value))}
            className="arb-slider"
          />
        </label>
        {jitterPct > 0 && (
          <label className="pvc-field">
            <span className="pvc-label">Seed</span>
            <input
              type="number"
              className="pvc-select arb-select-narrow"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 1)}
            />
          </label>
        )}
        <div className="pvc-field">
          <span className="pvc-label">
            {compareMode
              ? `${formatName(formats[0])} vs ${formatName(formats[1])}`
              : formatFullLabel(formats[0])}
          </span>
          <button
            className="hts-run-btn"
            onClick={run}
            disabled={selectedCount === 0}
          >
            ▶ Run Hwang True Simulator
          </button>
        </div>
      </div>
    </div>
  );
}

export default HwangTrueSimulator;
