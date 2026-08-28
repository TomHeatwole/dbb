/**
 * CornersPage — SOP2-style Premier League corner book.
 */

import React, { useCallback, useEffect, useState } from 'react';
import PageMeta from '../PageMeta';
import CornersBookPanel from './CornersBookPanel';

const OG_TITLE = 'PL Corners';
const OG_DESCRIPTION = 'Premier League corner totals, next 5/10 minutes, and expected stoppage';
const OG_IMAGE = `${process.env.PUBLIC_URL || ''}/data/sop.jpeg`;
const SOP_COLLAGE_SRC = '/data/sop.jpeg';
const COLLAGE_TILE_W = 200;
const COLLAGE_TILE_H = Math.round(COLLAGE_TILE_W * (1442 / 1916));
const BOOK_REFRESH_MS = 60_000;

function CornersCollageGrid() {
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

function sportradarNotice(meta) {
  if (!meta) return null;
  if (!meta.configured) {
    return 'Stoppage times unavailable — set SPORTRADAR_API_KEY on the API server.';
  }
  if (!meta.ok && meta.error) {
    return `Sportradar stoppage lookup failed: ${meta.error}`;
  }
  return null;
}

function CornersPage() {
  const [games, setGames] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [bookError, setBookError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [bookLoading, setBookLoading] = useState(true);
  const [bookRefreshing, setBookRefreshing] = useState(false);

  const refreshBook = useCallback(async ({ manual = false } = {}) => {
    if (manual) setBookRefreshing(true);
    else setBookLoading(true);
    try {
      const res = await fetch('/api/pl-corners');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setGames(data.games ?? []);
      setFetchedAt(data.fetchedAt ?? null);
      setNotice(sportradarNotice(data.sportradar));
      setBookError(null);
    } catch (err) {
      setBookError(err.message || 'Failed to load corners');
    } finally {
      setBookLoading(false);
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
        <CornersCollageGrid />

        <div className="sop-page sop-page--book">
          <div className="sop-pitch-lines" aria-hidden="true" />
          <div className="sop-spotlight sop-spotlight--left" aria-hidden="true" />
          <div className="sop-spotlight sop-spotlight--right" aria-hidden="true" />
          <div className="sop-scanlines" aria-hidden="true" />

          <CornersBookPanel
            games={games}
            fetchedAt={fetchedAt}
            error={bookError}
            notice={notice}
            loading={bookLoading}
            refreshing={bookRefreshing}
            onRefresh={() => refreshBook({ manual: true })}
          />
        </div>
      </div>
    </>
  );
}

export default CornersPage;
