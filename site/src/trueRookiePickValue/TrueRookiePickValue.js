import React, { useEffect, useMemo, useState } from 'react';
import LoadingState from '../LoadingState';
import PositionBadge from '../PositionBadge';
import { formatKtcValue } from '../lookups/KtcLookup';
import { formatHwangCoefficient } from '../lookups/hwangPositionCoefficients';
import {
  loadTrueRookiePickValueData,
  TOP_ROOKIES,
  TEAMS_PER_ROUND,
  TRUE_ROOKIE_PICK_YEARS,
  AVERAGE_SEASON_WINDOW,
} from './trueRookiePickValueLoader';

function fmtMult(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(3);
}

function fmtPickMult(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}×`;
}

function pickMultClass(value) {
  if (value == null || !Number.isFinite(value)) return '';
  if (value > 1.02) return 'trpv-pos';
  if (value < 0.98) return 'trpv-neg';
  return '';
}

function fmtSigned(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value).toLocaleString();
  return value > 0 ? `+${abs}` : value < 0 ? `−${abs}` : '0';
}

function deltaClass(value) {
  if (value == null || !Number.isFinite(value) || value === 0) return '';
  return value > 0 ? 'trpv-pos' : 'trpv-neg';
}

function formatDayOffset(offset) {
  if (offset == null || offset === 0) return null;
  const abs = Math.abs(offset);
  return offset > 0 ? `+${abs}d` : `−${abs}d`;
}

function AveragePickChart({ chart }) {
  const slotsByRound = useMemo(() => {
    const byRound = new Map();
    for (const slot of chart?.slots || []) {
      if (!byRound.has(slot.round)) byRound.set(slot.round, []);
      byRound.get(slot.round).push(slot);
    }
    return byRound;
  }, [chart?.slots]);

  if (!chart?.years?.length) return null;

  const yearLabel = chart.years.length === 1
    ? String(chart.years[0])
    : `${chart.years[0]}–${chart.years[chart.years.length - 1]}`;

  const marketYearLabel = chart.marketYears?.length
    ? (chart.marketYears.length === 1
      ? String(chart.marketYears[0])
      : `${chart.marketYears[0]}–${chart.marketYears[chart.marketYears.length - 1]}`)
    : null;

  return (
    <section className="trpv-avg">
      <h3 className="trpv-section-title">True pick chart ({AVERAGE_SEASON_WINDOW}-season avg)</h3>
      <p className="trpv-section-desc">
        Mean Hwang True Value of the player assigned to each pick when every class is ordered
        by True ({yearLabel}; {chart.years.join(', ')}). <strong>× Market</strong> is
        True ÷ average same-year KTC Early/Mid/Late pick price
        {marketYearLabel
          ? ` (market sample ${marketYearLabel}; named pick assets only exist from 2024 on)`
          : ''}
        — apply to today’s KTC pick quote for a True price.
      </p>

      <div className="trpv-avg-grid">
        <div className="trpv-avg-card">
          <h4 className="trpv-avg-card-title">By round</h4>
          <div className="trpv-table-wrap trpv-table-wrap--compact">
            <table className="trpv-table">
              <thead>
                <tr>
                  <th>Round</th>
                  <th className="trpv-th-num">× Market</th>
                  <th className="trpv-th-num">Avg True</th>
                  <th className="trpv-th-num">Avg KTC</th>
                </tr>
              </thead>
              <tbody>
                {chart.rounds.map((row) => (
                  <tr key={row.round}>
                    <td>{row.label}</td>
                    <td className={`trpv-td-num trpv-pick-mult ${pickMultClass(row.multiplier)}`}>
                      {fmtPickMult(row.multiplier)}
                    </td>
                    <td className="trpv-td-num trpv-true">{formatKtcValue(row.avgTrueValue)}</td>
                    <td className="trpv-td-num">{formatKtcValue(row.avgMarketValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="trpv-avg-card">
          <h4 className="trpv-avg-card-title">Early / Mid / Late</h4>
          <div className="trpv-table-wrap trpv-table-wrap--compact">
            <table className="trpv-table">
              <thead>
                <tr>
                  <th>Pick asset</th>
                  <th className="trpv-th-num">× Market</th>
                  <th className="trpv-th-num">Avg True</th>
                  <th className="trpv-th-num">Avg KTC</th>
                </tr>
              </thead>
              <tbody>
                {chart.tiers.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td className={`trpv-td-num trpv-pick-mult ${pickMultClass(row.multiplier)}`}>
                      {fmtPickMult(row.multiplier)}
                    </td>
                    <td className="trpv-td-num trpv-true">{formatKtcValue(row.avgTrueValue)}</td>
                    <td className="trpv-td-num">{formatKtcValue(row.avgMarketValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="trpv-avg-card trpv-avg-card--wide">
          <h4 className="trpv-avg-card-title">By slot</h4>
          <div className="trpv-slot-grid">
            {[1, 2, 3, 4].map((round) => (
              <div key={round} className="trpv-table-wrap trpv-table-wrap--compact">
                <table className="trpv-table">
                  <thead>
                    <tr>
                      <th>Pick</th>
                      <th className="trpv-th-num">×</th>
                      <th className="trpv-th-num">True</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(slotsByRound.get(round) || []).map((row) => (
                      <tr key={row.draftSlot}>
                        <td className="trpv-slot">{row.draftSlot}</td>
                        <td className={`trpv-td-num trpv-pick-mult ${pickMultClass(row.multiplier)}`}>
                          {fmtPickMult(row.multiplier)}
                        </td>
                        <td className="trpv-td-num trpv-true">
                          {formatKtcValue(row.avgTrueValue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function TrueRookiePickValue() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [year, setYear] = useState(2024);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const loaded = await loadTrueRookiePickValueData();
        if (cancelled) return;
        setData(loaded);
        setYear((prevYear) => {
          if (loaded.byYear.has(prevYear) || loaded.years.length === 0) return prevYear;
          return loaded.years.includes(2024) ? 2024 : loaded.years[loaded.years.length - 1];
        });
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load true rookie pick values');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const model = data?.byYear.get(year) || null;

  const coeffSummary = useMemo(() => {
    if (!data?.multipliers) return '';
    return ['QB', 'RB', 'WR', 'TE']
      .map((pos) => `${pos} ${formatHwangCoefficient(data.multipliers.get(pos))}`)
      .join(' · ');
  }, [data]);

  if (loading) {
    return <LoadingState label="Loading true rookie pick values…" className="trpv-loading" />;
  }

  if (error) {
    return <div className="trpv-error">{error}</div>;
  }

  if (!data?.years?.length) {
    return <div className="trpv-error">No rookie class data available.</div>;
  }

  return (
    <div className="trpv-root">
      <p className="trpv-intro">
        Take the May 20 rookie-draft SF TE+ board, score each class player with Hwang True
        Value (KTC × power-law coeffs), keep the top {TOP_ROOKIES}, and assign them to picks
        1.01–4.{String(TEAMS_PER_ROUND).padStart(2, '0')} in that order ({TEAMS_PER_ROUND}-team
        Early 1–4 / Mid 5–8 / Late 9–12). The chart below averages those True assignments
        over the last {AVERAGE_SEASON_WINDOW} seasons into generic pick prices — these
        multipliers power pick values site-wide (trade calculator, rosters, HwangAI).
      </p>

      <AveragePickChart chart={data.averageChart} />

      <section className="trpv-year-section">
        <h3 className="trpv-section-title">Class detail</h3>
        <p className="trpv-section-desc">
          Single-year True draft order vs same-year KTC Early/Mid/Late pick market prices.
        </p>

        <div className="trpv-controls">
          <label className="trpv-field">
            <span className="trpv-label">Draft class</span>
            <select
              className="trpv-select"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {(data?.years?.length ? data.years : TRUE_ROOKIE_PICK_YEARS).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
        </div>

        {!model ? (
          <div className="trpv-error">No data for {year}.</div>
        ) : (
          <>
            <div className="trpv-stats-row">
              <div className="trpv-stat">
                <span className="trpv-stat-label">Snapshot</span>
                <span className="trpv-stat-value">{model.snapshotLabel}</span>
              </div>
              <div className="trpv-stat">
                <span className="trpv-stat-label">Class on board</span>
                <span className="trpv-stat-value">{model.classSize}</span>
              </div>
              <div className="trpv-stat">
                <span className="trpv-stat-label">Pick prices found</span>
                <span className="trpv-stat-value">
                  {model.pickValuesAvailable}/{model.rows.length}
                </span>
              </div>
            </div>

            {model.usedLiveFallback && (
              <p className="trpv-warn">
                No filled May 20 board for this class — using live KTC values filtered by draft year.
              </p>
            )}
            {model.pickValuesMissing > 0 && (
              <p className="trpv-warn">
                Historical same-year pick assets are missing for {model.pickValuesMissing} slots
                (KTC only published named Early/Mid/Late picks from the 2024 vintage onward).
              </p>
            )}
            {coeffSummary && (
              <p className="trpv-meta">True coeffs: {coeffSummary}</p>
            )}

            <div className="trpv-table-wrap">
              <table className="trpv-table">
                <thead>
                  <tr>
                    <th className="trpv-th-num">Should</th>
                    <th>Player</th>
                    <th className="trpv-th-num">True</th>
                    <th className="trpv-th-num">KTC</th>
                    <th className="trpv-th-num">×</th>
                    <th>Pick asset</th>
                    <th className="trpv-th-num">Pick KTC</th>
                    <th className="trpv-th-num">True − Pick</th>
                  </tr>
                </thead>
                <tbody>
                  {model.rows.map((row) => {
                    const offsetLabel = formatDayOffset(row.pickValueDayOffset);
                    return (
                      <tr key={`${row.draftSlot}-${row.name}`}>
                        <td className="trpv-td-num trpv-slot">{row.draftSlot}</td>
                        <td>
                          <span className="trpv-name">{row.name}</span>
                          <PositionBadge position={row.position} />
                        </td>
                        <td className="trpv-td-num trpv-true">{formatKtcValue(row.trueValue)}</td>
                        <td className="trpv-td-num">{formatKtcValue(row.ktcValue)}</td>
                        <td className="trpv-td-num trpv-mult">{fmtMult(row.multiplier)}</td>
                        <td>
                          <span className="trpv-pick">{row.pickName}</span>
                        </td>
                        <td className="trpv-td-num">
                          <span className="trpv-value-wrap">
                            <span>{formatKtcValue(row.pickValue)}</span>
                            {offsetLabel && (
                              <span
                                className="trpv-value-sub"
                                title={`Pick value from ${row.pickValueDate}`}
                              >
                                {offsetLabel}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className={`trpv-td-num ${deltaClass(row.delta)}`}>
                          {fmtSigned(row.delta)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
