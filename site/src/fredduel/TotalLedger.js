import React from 'react';
import { formatMoney } from './oddsMath';
import { buildTotalLedger } from './settlement';

function deltaClass(value) {
  if (value > 0) return 'fd-pos';
  if (value < 0) return 'fd-neg';
  return '';
}

/**
 * Aggregate P&L across all graded bets on the exchange.
 */
function TotalLedger({ bets }) {
  const rows = buildTotalLedger(bets);
  if (!rows.length) return null;

  const totalNet = rows.reduce((sum, r) => sum + r.net, 0);

  return (
    <section className="fd-ledger">
      <div className="fd-ledger-head">
        <h3 className="fd-ledger-title">Total ledger</h3>
        <span className="fd-muted fd-small">
          Net across the book should be $0 (currently {formatMoney(totalNet)}).
        </span>
      </div>
      <div className="fd-ledger-table-wrap">
        <table className="fd-ledger-table">
          <thead>
            <tr>
              <th>Participant</th>
              <th>Tickets</th>
              <th>Won</th>
              <th>Lost</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.tickets}</td>
                <td className="fd-pos">{row.won > 0 ? formatMoney(row.won) : '—'}</td>
                <td className="fd-neg">{row.lost > 0 ? formatMoney(row.lost) : '—'}</td>
                <td className={deltaClass(row.net)}>
                  {row.net === 0 ? '—' : formatMoney(row.net)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default TotalLedger;
