/**
 * Sticky all-games snapshot: market, offered odds, longest line, edge.
 */

import React from 'react';
import { bookTag, gameAnchorId } from '../sop/gameSnapshot';
import { formatAmericanOdds } from '../sop/sopModel';

function formatEdge(edgePoints) {
  if (!Number.isFinite(edgePoints)) return '—';
  const sign = edgePoints > 0 ? '+' : '';
  return `${sign}${edgePoints.toFixed(1)}%`;
}

function scrollToGame(eventId) {
  const node = document.getElementById(gameAnchorId(eventId));
  if (!node) return;
  node.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function OddsCell({ book, american }) {
  if (!Number.isFinite(american)) return '—';
  return (
    <>
      <span className={`sop-monitor-book sop-monitor-book--${book ?? 'fd'}`}>
        {bookTag(book)}
      </span>
      {' '}
      {formatAmericanOdds(american)}
    </>
  );
}

function GameMonitorTable({
  rows,
  marketHeader = 'SOP',
  caption = 'vs longest line',
  showMarket = false,
}) {
  if (!rows?.length) return null;

  const evCount = rows.filter((row) => row.profitable).length;

  return (
    <section
      className={`sop-monitor${showMarket ? ' sop-monitor--play' : ''}`}
      aria-label="Game snapshot"
    >
      <div className="sop-monitor-head">
        <span className="sop-monitor-kicker">Snapshot</span>
        <span className="sop-monitor-caption">{caption}</span>
        {evCount > 0 && (
          <span className="sop-monitor-ev-count">{evCount} +EV</span>
        )}
      </div>
      <div className="sop-monitor-scroll">
        <div className="sop-monitor-cols" aria-hidden="true">
          <span>Game</span>
          <span className="sop-monitor-quotes">
            {showMarket && <span>{marketHeader}</span>}
            <span>{showMarket ? 'Odds' : marketHeader}</span>
            <span>Line</span>
          </span>
          <span>Edge</span>
        </div>
        <ul className="sop-monitor-list">
          {rows.map((row) => (
            <li
              key={row.eventId}
              className={`sop-monitor-row${row.profitable ? ' sop-monitor-row--ev' : ''}`}
            >
              <button
                type="button"
                className="sop-monitor-game"
                onClick={() => scrollToGame(row.eventId)}
                title={row.fullName}
              >
                <span className="sop-monitor-game-name">{row.name}</span>
                <span className="sop-monitor-game-meta">
                  {row.inPlay && <span className="sop-exp-live">LIVE</span>}
                  <span>{row.score}</span>
                  {row.clock && <span>{row.clock}</span>}
                </span>
              </button>
              <span className="sop-monitor-quotes">
                {showMarket && (
                  <span className="sop-monitor-market">{row.market}</span>
                )}
                <span className="sop-monitor-odds">
                  <OddsCell book={row.oddsBook} american={row.oddsAmerican} />
                </span>
                <span className="sop-monitor-line">{row.lineLabel}</span>
              </span>
              <span
                className={`sop-monitor-edge${row.profitable ? ' sop-monitor-edge--plus' : ' sop-monitor-edge--minus'}`}
              >
                {formatEdge(row.edgePoints)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default GameMonitorTable;
