import React, { useCallback, useEffect, useMemo, useState } from 'react';
import LoadingState from '../LoadingState';
import PositionBadge from '../PositionBadge';
import {
  formatKtcValue,
  getRankPairDelta,
  getRankSlotStats,
  loadKtcRankCompareData,
  TABS,
} from './ktcRankCompareLoader';

function fmtSigned(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const n = Math.round(value);
  return `${n >= 0 ? '+' : ''}${n.toLocaleString()}`;
}

function StatBlock({ label, value, sub }) {
  return (
    <div className="ktc-rc-stat">
      <span className="ktc-rc-stat-label">{label}</span>
      <span className="ktc-rc-stat-value">{value}</span>
      {sub && <span className="ktc-rc-stat-sub">{sub}</span>}
    </div>
  );
}

function KtcRankCompare() {
  const [position, setPosition] = useState('Overall');
  const [selected, setSelected] = useState([]);
  const [players, setPlayers] = useState([]);
  const [asOf, setAsOf] = useState(null);
  const [currentByPosition, setCurrentByPosition] = useState(null);
  const [rankValues, setRankValues] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await loadKtcRankCompareData();
        if (cancelled) return;
        setCurrentByPosition(data.currentByPosition);
        setRankValues(data.rankValues);
        setAsOf(data.currentByPosition.asOf);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load KTC data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!currentByPosition) return;
    setPlayers(currentByPosition.byPosition[position] || []);
    setSelected([]);
  }, [position, currentByPosition]);

  const togglePlayer = useCallback((player) => {
    setSelected((prev) => {
      const hit = prev.findIndex((p) => p.name === player.name);
      if (hit >= 0) {
        return prev.filter((_, i) => i !== hit);
      }
      if (prev.length >= 2) {
        return [prev[1], player];
      }
      return [...prev, player];
    });
  }, []);

  const singleStats = useMemo(() => {
    if (selected.length !== 1 || !rankValues) return null;
    const p = selected[0];
    const hist = getRankSlotStats(rankValues, position, p.posRank);
    const vsHist = hist ? p.value - hist.average_value : null;
    return { player: p, hist, vsHist };
  }, [selected, rankValues, position]);

  const pairStats = useMemo(() => {
    if (selected.length !== 2 || !rankValues) return null;
    const [a, b] = [...selected].sort((x, y) => x.posRank - y.posRank);
    const histGap = getRankPairDelta(rankValues, position, a.posRank, b.posRank);
    const currentGap = a.value - b.value;
    const histA = getRankSlotStats(rankValues, position, a.posRank);
    const histB = getRankSlotStats(rankValues, position, b.posRank);
    return {
      higher: a,
      lower: b,
      currentGap,
      histGap,
      histA,
      histB,
    };
  }, [selected, rankValues, position]);

  if (loading) {
    return <LoadingState label="Loading KTC rank data…" className="ktc-rc-loading" />;
  }

  if (error) {
    return <div className="ktc-rc-error">{error}</div>;
  }

  return (
    <div className="ktc-rc-root">
      <div className="ktc-rc-controls">
        <label className="ktc-rc-field">
          <span className="ktc-rc-label">View</span>
          <select
            className="ktc-rc-select"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
          >
            {TABS.map((tab) => (
              <option key={tab} value={tab}>{tab}</option>
            ))}
          </select>
        </label>
        {asOf && <span className="ktc-rc-meta">KTC SF values as of {asOf}</span>}
      </div>

      <p className="ktc-rc-hint">
        Click one player to see what that rank slot has historically been worth.
        Click two to compare the current value gap to the historical average gap between those ranks.
      </p>

      <div className="ktc-rc-layout">
        <div className="ktc-rc-table-wrap">
          <table className="ktc-rc-table">
            <thead>
              <tr>
                <th className="ktc-rc-th-rank">#</th>
                <th className="ktc-rc-th">Player</th>
                <th className="ktc-rc-th-team">Team</th>
                <th className="ktc-rc-th-value">Value</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => {
                const selIdx = selected.findIndex((p) => p.name === player.name);
                const isSelected = selIdx >= 0;
                return (
                  <tr
                    key={player.name}
                    className={`ktc-rc-row ${isSelected ? 'ktc-rc-row--selected' : ''}`}
                    onClick={() => togglePlayer(player)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        togglePlayer(player);
                      }
                    }}
                  >
                    <td className="ktc-rc-td-rank">
                      {isSelected && (
                        <span className="ktc-rc-sel-badge">{selIdx + 1}</span>
                      )}
                      {player.rankLabel}
                    </td>
                    <td className="ktc-rc-td-name">{player.name}</td>
                    <td className="ktc-rc-td-team">{player.team || '—'}</td>
                    <td className="ktc-rc-td-value">{formatKtcValue(player.value)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <aside className="ktc-rc-panel">
          <h3 className="ktc-rc-panel-title">Historical placement</h3>

          {selected.length === 0 && (
            <p className="ktc-rc-panel-empty">Select a player from the list.</p>
          )}

          {singleStats && (
            <div className="ktc-rc-panel-body">
              <div className="ktc-rc-player-head">
                <span className="ktc-rc-player-name">{singleStats.player.name}</span>
                <PositionBadge position={singleStats.player.position} />
                <span className="ktc-rc-rank-tag">{singleStats.player.rankLabel}</span>
              </div>
              <StatBlock
                label="Current KTC value"
                value={formatKtcValue(singleStats.player.value)}
              />
              {singleStats.hist && (
                <StatBlock
                  label={`Historical avg at ${singleStats.player.rankLabel}`}
                  value={formatKtcValue(singleStats.hist.average_value)}
                  sub={`${singleStats.hist.day_count.toLocaleString()} days`}
                />
              )}
              {singleStats.vsHist != null && (
                <StatBlock
                  label="vs historical avg"
                  value={fmtSigned(singleStats.vsHist)}
                />
              )}
            </div>
          )}

          {pairStats && (
            <div className="ktc-rc-panel-body">
              <div className="ktc-rc-compare-head">
                <div>
                  <span className="ktc-rc-player-name">{pairStats.higher.name}</span>
                  <span className="ktc-rc-rank-tag">{pairStats.higher.rankLabel}</span>
                  <span className="ktc-rc-val">{formatKtcValue(pairStats.higher.value)}</span>
                </div>
                <span className="ktc-rc-vs">vs</span>
                <div>
                  <span className="ktc-rc-player-name">{pairStats.lower.name}</span>
                  <span className="ktc-rc-rank-tag">{pairStats.lower.rankLabel}</span>
                  <span className="ktc-rc-val">{formatKtcValue(pairStats.lower.value)}</span>
                </div>
              </div>

              <StatBlock
                label="Current value gap"
                value={formatKtcValue(pairStats.currentGap)}
                sub={`${pairStats.higher.rankLabel} minus ${pairStats.lower.rankLabel}`}
              />

              {pairStats.histGap && (
                <StatBlock
                  label="Historical avg gap (same ranks)"
                  value={formatKtcValue(pairStats.histGap.average_delta)}
                  sub={`${pairStats.histGap.label} · ${pairStats.histGap.day_count.toLocaleString()} days`}
                />
              )}

              {pairStats.histA && pairStats.histB && (
                <StatBlock
                  label="Historical avg values"
                  value={`${formatKtcValue(pairStats.histA.average_value)} → ${formatKtcValue(pairStats.histB.average_value)}`}
                />
              )}

              {pairStats.histGap && pairStats.currentGap != null && (
                <StatBlock
                  label="Current gap vs historical avg gap"
                  value={fmtSigned(pairStats.currentGap - pairStats.histGap.average_delta)}
                />
              )}
            </div>
          )}

          {selected.length === 1 && (
            <p className="ktc-rc-panel-tip">Select a second player to compare rank gaps.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

export default KtcRankCompare;
