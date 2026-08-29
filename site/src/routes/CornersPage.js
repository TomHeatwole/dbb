/**
 * CornersPage — SOP2-style Premier League corner book.
 */

import React, { useCallback, useEffect, useState } from 'react';
import PageMeta from '../PageMeta';
import CornersBookPanel from './CornersBookPanel';
import {
  dkCornerGamesLoaded,
  mergeDkCornersIntoFdGames,
  mergeKalshiCornersIntoFdGames,
} from '../corners/mergeCornerBooks';

const DK_CLIENT_TIMEOUT_MS = 20000;
const KALSHI_CLIENT_TIMEOUT_MS = 28000;

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

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

function stoppageNotice(espn) {
  if (!espn) return null;
  if (espn.ok) return null;
  if (espn.error) return `ESPN stoppage: ${espn.error}`;
  return 'Stoppage times unavailable — ESPN Premier League feed failed.';
}

function joinNotices(...parts) {
  return parts.filter(Boolean).join(' ');
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

    let fdGames = [];
    let espn = null;
    try {
      const res = await fetch('/api/pl-corners');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      fdGames = (data.games ?? []).map((game) => ({ ...game, dk: null, klsh: null }));
      espn = data.espn;
      setGames(fdGames);
      setFetchedAt(data.fetchedAt ?? null);
      setNotice(stoppageNotice(espn));
      setBookError(null);
    } catch (err) {
      setBookError(err.message || 'Failed to load corners');
      setBookLoading(false);
      if (manual) setBookRefreshing(false);
      return;
    } finally {
      setBookLoading(false);
    }

    let dkData = null;
    let kalshiData = null;
    let dkNotice = null;

    const applyMerges = () => {
      setGames(
        mergeKalshiCornersIntoFdGames(mergeDkCornersIntoFdGames(fdGames, dkData), kalshiData),
      );
    };

    await Promise.all([
      fetchJsonWithTimeout('/api/dk-corners', DK_CLIENT_TIMEOUT_MS).then((data) => {
        dkData = data;
        applyMerges();
        if (!dkCornerGamesLoaded(data)) {
          dkNotice = 'DraftKings corners unavailable — showing FanDuel only.';
          setNotice(joinNotices(stoppageNotice(espn), dkNotice));
        } else {
          setNotice(stoppageNotice(espn));
        }
      }),
      fetchJsonWithTimeout('/api/kalshi-corners', KALSHI_CLIENT_TIMEOUT_MS).then((data) => {
        kalshiData = data;
        applyMerges();
      }),
    ]);

    if (dkNotice) setNotice(joinNotices(stoppageNotice(espn), dkNotice));
    if (manual) setBookRefreshing(false);
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
