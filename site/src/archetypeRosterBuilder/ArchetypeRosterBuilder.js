import React, { useEffect, useMemo, useState } from 'react';
import LoadingState from '../LoadingState';
import {
  buildSeasonBoards,
  findDropSlotIndex,
  instantiateArchetype,
  mulberry32,
  parseCsv,
  summarizeConstruction,
} from './archetypeRosterGenerator';

const TARGET_YEARS = [2021, 2022, 2023, 2024, 2025];

function fmtValue(value) {
  if (value == null || !Number.isFinite(value) || value <= 0) return '—';
  return value.toLocaleString();
}

function fmtPct(share) {
  return `${(share * 100).toFixed(1)}%`;
}

function fmtJitter(delta) {
  if (delta == null) return '';
  if (delta === 0) return '±0';
  return delta > 0 ? `+${delta}` : String(delta);
}

function ArchetypeRosterBuilder() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [archetypeRows, setArchetypeRows] = useState(null);
  const [seasonBoards, setSeasonBoards] = useState(null);
  const [meta, setMeta] = useState(null);

  const [archetypeId, setArchetypeId] = useState('');
  const [targetYear, setTargetYear] = useState(String(TARGET_YEARS[TARGET_YEARS.length - 1]));
  const [jitterPct, setJitterPct] = useState(15);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [archRes, ktcRes, metaRes] = await Promise.all([
          fetch('/data/archetype_rosters.csv'),
          fetch('/data/final_ktc_values.csv'),
          fetch('/data/archetype_rosters_meta.json'),
        ]);
        if (!archRes.ok) throw new Error('Failed to fetch archetype_rosters.csv — run build_archetype_rosters.js');
        if (!ktcRes.ok) throw new Error('Failed to fetch final_ktc_values.csv');
        const rows = parseCsv(await archRes.text());
        const boards = buildSeasonBoards(parseCsv(await ktcRes.text()));
        const metaJson = metaRes.ok ? await metaRes.json() : null;
        if (cancelled) return;
        setArchetypeRows(rows);
        setSeasonBoards(boards);
        setMeta(metaJson);
        if (rows.length > 0) setArchetypeId(rows[0].archetype_id);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load archetype data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const archetypes = useMemo(() => {
    if (!archetypeRows) return [];
    const seen = new Map();
    for (const row of archetypeRows) {
      if (!seen.has(row.archetype_id)) {
        const record = row.rank_basis === 'standings' ? ` (${row.wins}-${row.losses})` : '';
        seen.set(row.archetype_id, {
          id: row.archetype_id,
          label: `${row.season} #${row.finish_rank} — ${row.team_name}${record}`,
        });
      }
    }
    return Array.from(seen.values());
  }, [archetypeRows]);

  const slots = useMemo(() => {
    if (!archetypeRows || !archetypeId) return null;
    return archetypeRows
      .filter((row) => row.archetype_id === archetypeId)
      .map((row) => ({
        playerName: row.player_name,
        position: row.position,
        posRank: row.ktc_pos_rank ? Number(row.ktc_pos_rank) : null,
        ktcValue: row.ktc_value ? Number(row.ktc_value) : null,
      }));
  }, [archetypeRows, archetypeId]);

  const generation = useMemo(() => {
    if (!slots || !seasonBoards) return null;
    const board = seasonBoards.get(Number(targetYear));
    if (!board) return null;
    const rng = mulberry32(seed);
    const results = instantiateArchetype({ slots, board, jitterPct, rng });
    return {
      results,
      dropIndex: findDropSlotIndex(slots),
      summary: summarizeConstruction(results),
    };
  }, [slots, seasonBoards, targetYear, jitterPct, seed]);

  if (loading) {
    return <LoadingState label="Loading archetype rosters…" className="pvc-loading" />;
  }
  if (error) {
    return <div className="pvc-error">{error}</div>;
  }
  if (!generation) {
    return <div className="pvc-error">No archetype data available.</div>;
  }

  const { results, dropIndex, summary } = generation;
  const totalOrig = summary.reduce((s, e) => s + e.origTotal, 0);
  const totalGen = summary.reduce((s, e) => s + e.genTotal, 0);
  const offBoardCount = results.filter((r) => r.offBoard).length;

  return (
    <div className="pvc-root">
      <p className="pvc-intro">
        Instantiate a real Hwang roster archetype into a historical season: each player&apos;s
        current KTC positional rank is jittered (±{jitterPct}% of rank, min ±1) and filled with
        the player at that rank on the target season&apos;s preseason Final KTC board. Off-board
        slots (no current KTC value) map to the tail of the target board as roster-filler darts.
        The <span className="arb-drop-tag">DROP</span> slot marks the 26-man HVORP base
        (lowest-value slot of the deepest position group).
        {meta?.ktcAsOf && <span className="pvc-meta"> Archetypes characterized on KTC board as of {meta.ktcAsOf}.</span>}
      </p>

      <div className="pvc-controls">
        <label className="pvc-field">
          <span className="pvc-label">Archetype</span>
          <select
            className="pvc-select"
            value={archetypeId}
            onChange={(e) => setArchetypeId(e.target.value)}
          >
            {archetypes.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </label>

        <label className="pvc-field">
          <span className="pvc-label">Target season</span>
          <select
            className="pvc-select arb-select-narrow"
            value={targetYear}
            onChange={(e) => setTargetYear(e.target.value)}
          >
            {TARGET_YEARS.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
        </label>

        <label className="pvc-field">
          <span className="pvc-label">Jitter: ±{jitterPct}% of rank</span>
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

        <div className="pvc-field">
          <span className="pvc-label">Seed {seed}</span>
          <button
            className="arb-regen-btn"
            onClick={() => setSeed(Math.floor(Math.random() * 1e9))}
          >
            ↻ Regenerate
          </button>
        </div>
      </div>

      <div className="pvc-section">
        <h3 className="pvc-section-title">Construction summary</h3>
        <div className="pvc-table-wrap">
          <table className="pvc-table">
            <thead>
              <tr>
                <th>Position</th>
                <th className="pvc-th-num">Players</th>
                <th className="pvc-th-num">Original KTC</th>
                <th className="pvc-th-num">Orig share</th>
                <th className="pvc-th-num">Generated KTC ({targetYear})</th>
                <th className="pvc-th-num">Gen share</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((e) => (
                <tr key={e.position}>
                  <td className="pvc-td-label">{e.position}</td>
                  <td className="pvc-td-num">{e.count}</td>
                  <td className="pvc-td-num">{fmtValue(e.origTotal)}</td>
                  <td className="pvc-td-num">{fmtPct(e.origShare)}</td>
                  <td className="pvc-td-num">{fmtValue(e.genTotal)}</td>
                  <td className="pvc-td-num">{fmtPct(e.genShare)}</td>
                </tr>
              ))}
              <tr className="arb-total-row">
                <td className="pvc-td-label">Total</td>
                <td className="pvc-td-num">{results.length}</td>
                <td className="pvc-td-num">{fmtValue(totalOrig)}</td>
                <td className="pvc-td-num">100%</td>
                <td className="pvc-td-num">{fmtValue(totalGen)}</td>
                <td className="pvc-td-num">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
        {offBoardCount > 0 && (
          <p className="pvc-empty arb-offboard-note">
            {offBoardCount} slot{offBoardCount > 1 ? 's' : ''} off the current KTC board
            (retired / valueless) — mapped to the target board tail.
          </p>
        )}
      </div>

      <div className="pvc-section">
        <h3 className="pvc-section-title">Generated roster</h3>
        <div className="pvc-table-wrap pvc-table-wrap--scroll">
          <table className="pvc-table pvc-table--detail">
            <thead>
              <tr>
                <th>Pos</th>
                <th>Original player</th>
                <th className="pvc-th-num">Cur KTC</th>
                <th className="pvc-th-num">Pos rank</th>
                <th className="arb-arrow-col" aria-label="maps to" />
                <th>Generated player ({targetYear})</th>
                <th className="pvc-th-num">Pos rank</th>
                <th className="pvc-th-num">Jitter</th>
                <th className="pvc-th-num">{targetYear} KTC</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, idx) => (
                <tr
                  key={`${r.slot.playerName}-${idx}`}
                  className={idx === dropIndex ? 'arb-dropped-row' : ''}
                >
                  <td className="pvc-td-label">{r.slot.position}</td>
                  <td>
                    {r.slot.playerName}
                    {idx === dropIndex && <span className="arb-drop-tag">DROP</span>}
                  </td>
                  <td className="pvc-td-num">{fmtValue(r.slot.ktcValue)}</td>
                  <td className="pvc-td-num">
                    {r.offBoard ? <span className="arb-offboard-tag">off board</span> : r.slot.posRank}
                  </td>
                  <td className="arb-arrow-col">→</td>
                  <td>{r.generated?.name || '—'}</td>
                  <td className="pvc-td-num">{r.targetRank ?? '—'}</td>
                  <td className="pvc-td-num pvc-td-muted">{fmtJitter(r.jitterDelta)}</td>
                  <td className="pvc-td-num">{fmtValue(r.generated?.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default ArchetypeRosterBuilder;
