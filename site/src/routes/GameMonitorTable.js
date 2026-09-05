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
    <section className="sop-monitor" aria-label="Game snapshot">
      <div className="sop-monitor-head">
        <span className="sop-monitor-kicker">Snapshot</span>
        <span className="sop-monitor-caption">{caption}</span>
        {evCount > 0 && (
          <span className="sop-monitor-ev-count">{evCount} +EV</span>
        )}
      </div>
      <div className="sop-monitor-scroll">
        <table className="sop-monitor-table">
          <thead>
            <tr>
              <th>Game</th>
              {showMarket && <th>{marketHeader}</th>}
              <th>{showMarket ? 'Odds' : marketHeader}</th>
              <th>Line</th>
              <th>Edge</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.eventId}
                className={row.profitable ? 'sop-monitor-row--ev' : undefined}
              >
                <td>
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
                </td>
                {showMarket && (
                  <td className="sop-monitor-market">{row.market}</td>
                )}
                <td className="sop-monitor-odds">
                  <OddsCell book={row.oddsBook} american={row.oddsAmerican} />
                </td>
                <td className="sop-monitor-line">{row.lineLabel}</td>
                <td
                  className={`sop-monitor-edge${row.profitable ? ' sop-monitor-edge--plus' : ' sop-monitor-edge--minus'}`}
                >
                  {formatEdge(row.edgePoints)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default GameMonitorTable;
