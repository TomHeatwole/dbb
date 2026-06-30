/**
 * DKPage — DraftKings World Cup First Goal Method odds (SOP-style scanner).
 */

import React, { useCallback, useEffect, useState } from 'react';
import PageMeta from '../PageMeta';
import DKBookPanel from './DKBookPanel';

const OG_TITLE = 'DK First Goal Method';
const OG_DESCRIPTION = 'DraftKings World Cup First Goal Method odds scanner';
const OG_IMAGE = `${process.env.PUBLIC_URL || ''}/data/sop.jpeg`;
const SOP_COLLAGE_SRC = '/data/sop.jpeg';
const COLLAGE_TILE_W = 200;
const COLLAGE_TILE_H = Math.round(COLLAGE_TILE_W * (1442 / 1916));

const BOOK_REFRESH_MS = 60_000;

function DkCollageGrid() {
  const [tileCount, setTileCount] = useState(48);

  useEffect(() => {
    const update = () => {
      const cols = Math.ceil(window.innerWidth / COLLAGE_TILE_W) + 4;
      const rows = Math.ceil(window.innerHeight / COLLAGE_TILE_H) + 4;
      setTileCount(cols * rows);
    };

    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return (
    <div className="sop-collage-grid" aria-hidden="true">
      {Array.from({ length: tileCount }, (_, i) => (
        <img key={i} src={SOP_COLLAGE_SRC} alt="" draggable={false} loading="lazy" />
      ))}
    </div>
  );
}

function DKPage() {
  const [games, setGames] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [bookError, setBookError] = useState(null);
  const [bookRefreshing, setBookRefreshing] = useState(false);

  const refreshBook = useCallback(async ({ manual = false } = {}) => {
    if (manual) setBookRefreshing(true);
    try {
      const res = await fetch('/api/draftkings-goal-method');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setGames(data.games ?? []);
      setFetchedAt(data.fetchedAt ?? null);
      setBookError(null);
    } catch (err) {
      setBookError(err.message || 'Failed to load odds');
    } finally {
      if (manual) setBookRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refreshBook();
  }, [refreshBook]);

  useEffect(() => {
    const id = window.setInterval(refreshBook, BOOK_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refreshBook]);

  return (
    <>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} image={OG_IMAGE} />

      <div className="sop-collage-frame">
        <DkCollageGrid />

        <div className="sop-page sop-page--book">
          <div className="sop-pitch-lines" aria-hidden="true" />
          <div className="sop-spotlight sop-spotlight--left" aria-hidden="true" />
          <div className="sop-spotlight sop-spotlight--right" aria-hidden="true" />
          <div className="sop-scanlines" aria-hidden="true" />

          <DKBookPanel
            games={games}
            fetchedAt={fetchedAt}
            error={bookError}
            refreshing={bookRefreshing}
            onRefresh={() => refreshBook({ manual: true })}
          />
        </div>
      </div>
    </>
  );
}

export default DKPage;
