/**
 * Manual two-way arb checker — paste a price and its inverse.
 */

import React, { useMemo, useState } from 'react';
import {
  evaluateTwoWayArb,
  formatDecimalOdds,
  formatParsedOdds,
  parseOddsInput,
} from '../corners/arbChecker';
import { formatAmericanOdds, formatEdgePct, formatSharePct } from '../corners/cornerModel';

const SIZE_KEY = 'corners-arb-checker-size';
const DEFAULT_SIZE = '100';

function readSize() {
  try {
    const value = window.sessionStorage.getItem(SIZE_KEY);
    if (value != null && String(value).trim() !== '') return value;
  } catch {
    /* ignore */
  }
  return DEFAULT_SIZE;
}

function persistSize(value) {
  try {
    window.sessionStorage.setItem(SIZE_KEY, value);
  } catch {
    /* ignore */
  }
}

function parseStakeInput(value) {
  const parsed = Number(String(value ?? '').replace(/[,$]/g, '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatMoney(amount) {
  if (amount == null || !Number.isFinite(amount)) return '—';
  const cents = Math.round(amount * 100);
  if (cents % 100 === 0) return `$${(cents / 100).toLocaleString('en-US')}`;
  const abs = Math.abs(cents / 100).toFixed(2);
  return `${cents < 0 ? '−' : ''}$${abs}`;
}

function OddsField({ id, label, value, onChange, parsed }) {
  return (
    <label className="corners-arb-check-field" htmlFor={id}>
      <span className="sop-exp-section-label">{label}</span>
      <input
        id={id}
        className="corners-arb-check-input"
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="+150 · 55% · 1.83x"
        autoComplete="off"
        spellCheck={false}
      />
      <span className={`corners-arb-check-parse${value.trim() && !parsed ? ' corners-arb-check-parse--bad' : ''}`}>
        {value.trim()
          ? (parsed ? formatParsedOdds(parsed) : 'Could not read that price')
          : 'American, 55%, or 1.83x'}
      </span>
    </label>
  );
}

function CornersArbCheckerPanel() {
  const [lineInput, setLineInput] = useState('');
  const [inverseInput, setInverseInput] = useState('');
  const [sizeInput, setSizeInput] = useState(readSize);

  const line = useMemo(() => parseOddsInput(lineInput), [lineInput]);
  const inverse = useMemo(() => parseOddsInput(inverseInput), [inverseInput]);
  const stake = parseStakeInput(sizeInput);
  const result = useMemo(
    () => evaluateTwoWayArb(line, inverse, stake ?? 100),
    [line, inverse, stake],
  );

  const setSize = (value) => {
    setSizeInput(value);
    persistSize(value);
  };

  return (
    <div className="sop-exp-page corners-arb-check">
      <header className="sop-exp-header">
        <h1 className="sop-exp-title">Arb checker</h1>
        <p className="sop-exp-subtitle">
          Paste one price and the inverse. American, percent, or 1.83x — mixed formats are fine.
        </p>
      </header>

      <section className="corners-arb-check-card">
        <div className="corners-arb-check-grid">
          <OddsField
            id="arb-check-line"
            label="Line"
            value={lineInput}
            onChange={setLineInput}
            parsed={line}
          />
          <OddsField
            id="arb-check-inverse"
            label="Inverse"
            value={inverseInput}
            onChange={setInverseInput}
            parsed={inverse}
          />
        </div>

        <label className="corners-split-size-field corners-arb-check-size">
          <span className="sop-kelly-budget-label">Size</span>
          <span className="sop-kelly-budget-wrap corners-split-size-wrap">
            <span className="sop-kelly-budget-prefix" aria-hidden="true">$</span>
            <input
              type="text"
              inputMode="decimal"
              className="sop-kelly-budget-input corners-split-size-input"
              value={sizeInput}
              onChange={(e) => setSize(e.target.value)}
              placeholder={DEFAULT_SIZE}
              autoComplete="off"
              aria-label="Total exposure to split across both sides"
            />
          </span>
        </label>
      </section>

      {!result && (
        <p className="corners-empty-hint">Enter both prices to see if they lock.</p>
      )}

      {result && (
        <section className={`corners-arb-check-result${result.hasArb ? ' corners-arb-check-result--ev' : ''}`}>
          <p className={`corners-work-verdict${result.hasArb ? ' corners-work-verdict--ev' : ''}`}>
            {result.hasArb
              ? `Arb · lock ${formatEdgePct(result.roi * 100)}`
              : `No arb · juice ${formatSharePct(result.juice)}`}
            {result.hasArb && result.lockProfit != null
              ? ` · ${formatMoney(result.lockProfit)} on ${formatMoney(result.total)}`
              : ''}
          </p>
          <ul className="corners-work-list">
            <li>
              Line {formatParsedOdds(line)}
              {result.rows ? ` · bet ${formatMoney(result.rows[0].amount)} · pays ${formatMoney(result.rows[0].payout)}` : ''}
            </li>
            <li>
              Inverse {formatParsedOdds(inverse)}
              {result.rows ? ` · bet ${formatMoney(result.rows[1].amount)} · pays ${formatMoney(result.rows[1].payout)}` : ''}
            </li>
            <li>
              Combined implied {formatSharePct(result.pSum)}
              {result.hasArb
                ? ' < 100% · one side wins, same return either way'
                : ' ≥ 100% · the two prices do not cover'}
            </li>
            {!result.hasArb && (
              <li>
                Need the inverse at {formatAmericanOdds(result.needInverse.american)}
                {' / '}{formatDecimalOdds(result.needInverse.decimal)}
                {' / '}{formatSharePct(result.needInverse.implied)}
                {' or better to lock'}
              </li>
            )}
          </ul>
        </section>
      )}
    </div>
  );
}

export default CornersArbCheckerPanel;
