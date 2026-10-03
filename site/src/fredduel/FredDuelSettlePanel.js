import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import BetCard from './BetCard';
import { SETTLED_BY, settlementModeForOffer } from './settlement';

/**
 * Admin queue for custom markets only. Season / weekly tickets auto-settle from scores.
 */
function FredDuelSettlePanel({ client }) {
  const [data, setData] = useState({ offers: [], bets: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [settlingId, setSettlingId] = useState(null);

  const offersById = useMemo(() => {
    const map = {};
    for (const offer of data.offers) map[offer.id] = offer;
    return map;
  }, [data.offers]);

  const liveBets = useMemo(
    () => [...data.bets]
      .filter((b) => b.status === 'live')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [data.bets],
  );

  const manualLiveBets = useMemo(
    () => liveBets.filter((bet) => {
      const offer = offersById[bet.offerId];
      if (!offer) return false;
      return settlementModeForOffer(offer) === SETTLED_BY.MANUAL;
    }),
    [liveBets, offersById],
  );

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      setData(await client.listAll());
    } catch (e) {
      setLoadError(e.message);
    }
    setLoading(false);
  }, [client]);

  useEffect(() => {
    setLoading(true);
    refresh();
    const t = setInterval(refresh, 60 * 1000);
    return () => clearInterval(t);
  }, [refresh]);

  const settleBet = (betId) => async (result) => {
    if (!client.settleBet || settlingId != null) return;
    setSettlingId(betId);
    try {
      await client.settleBet(betId, { result });
      await refresh();
    } finally {
      setSettlingId(null);
    }
  };

  return (
    <div className="fd-settle-page">
      <div className="fd-settle-page-head">
        <div>
          <h2 className="fd-settle-page-title">Settle bets</h2>
          <p className="fd-muted fd-small">
            Custom bets only — season and weekly markets settle automatically from league scores.
          </p>
        </div>
        <div className="fd-settle-page-actions">
          <button type="button" className="fd-btn fd-btn-ghost" onClick={refresh} title="Refresh">
            ↻
          </button>
          <Link to="/FredDuel" className="fd-btn fd-btn-ghost">← Back to exchange</Link>
        </div>
      </div>

      {loadError && <div className="fd-error">Couldn&apos;t load bets: {loadError}</div>}

      {loading && <div className="fd-empty">Loading live tickets…</div>}
      {!loading && manualLiveBets.length === 0 && (
        <div className="fd-empty">
          {liveBets.length > 0
            ? 'No custom bets need grading — structured tickets settle on their own.'
            : 'No live bets waiting to be graded.'}
        </div>
      )}

      {!loading && manualLiveBets.length > 0 && (
        <div className="fd-list">
          {manualLiveBets.map((bet) => {
            const offer = offersById[bet.offerId];
            return (
              <div key={bet.id} className="fd-settle-item">
                {offer?.description && (
                  <div className="fd-muted fd-small fd-settle-offer-note">{offer.description}</div>
                )}
                <BetCard
                  bet={bet}
                  onSettle={client.settleBet ? settleBet(bet.id) : null}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default FredDuelSettlePanel;
