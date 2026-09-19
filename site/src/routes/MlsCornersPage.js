/**
 * MLS corner book — FanDuel + DraftKings totals, next 5/10 min, MLS 2025–26 buckets.
 */

import React, { useCallback, useEffect, useState } from 'react';
import PageMeta from '../PageMeta';
import CornersBookPanel from './CornersBookPanel';
import { CORNER_LEAGUE_SPECS } from '../corners/cornerModelLeagues.mjs';
import {
  dkCornerGamesLoaded,
  mergeDkCornersIntoFdGames,
} from '../corners/mergeCornerBooks';

const DK_CLIENT_TIMEOUT_MS = 25000;
const BOOK_REFRESH_MS = 60_000;

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

const OG_TITLE = 'MLS Corners';
const OG_DESCRIPTION = 'MLS corner totals, next 5/10 minutes, and expected stoppage (ESPN 2025–26 buckets)';
const OG_IMAGE = `${process.env.PUBLIC_URL || ''}/data/sop.jpeg`;
const SOP_COLLAGE_SRC = '/data/sop.jpeg';
const COLLAGE_TILE_W = 200;
const COLLAGE_TILE_H = Math.round(COLLAGE_TILE_W * (1442 / 1916));

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
  return 'Stoppage times unavailable — ESPN soccer feed failed.';
}

function MlsCornersPage() {
  const [games, setGames] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [bookError, setBookError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [bookLoading, setBookLoading] = useState(true);
  const [bookRefreshing, setBookRefreshing] = useState(false);
  const dkHold = React.useRef(null);

  const refreshBook = useCallback(async ({ manual = false } = {}) => {
    if (manual) setBookRefreshing(true);

    let fdGames = [];
    let espn = null;
    try {
      const res = await fetch('/api/pl-corners?league=mls');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      fdGames = (data.games ?? []).map((game) => ({ ...game, dk: null }));
      espn = data.espn;
      setFetchedAt(data.fetchedAt ?? null);
      setNotice(stoppageNotice(espn));
      setBookError(null);
      setGames(fdGames);
    } catch (err) {
      setBookError(err.message || 'Failed to load MLS corners');
      setBookLoading(false);
      if (manual) setBookRefreshing(false);
      return;
    } finally {
      setBookLoading(false);
    }

    let dkData = dkHold.current;
    let dkNotice = null;

    const applyMerges = () => {
      setGames(mergeDkCornersIntoFdGames(fdGames, dkData));
    };

    applyMerges();

    await fetchJsonWithTimeout(
      '/api/draftkings-goal-method?book=corners&league=mls',
      DK_CLIENT_TIMEOUT_MS,
    ).then((data) => {
      if (dkCornerGamesLoaded(data)) {
        dkHold.current = data;
        dkData = data;
      } else if (!dkHold.current) {
        dkNotice = 'DraftKings MLS corners unavailable — showing FanDuel only.';
      }
      applyMerges();
    });

    setNotice([stoppageNotice(espn), dkNotice].filter(Boolean).join(' ') || null);
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
            league="mls"
            title="MLS Corners"
            subtitle="Major League Soccer · FanDuel + DraftKings · ESPN 2025–26 buckets"
            emptyMessage="No MLS games with corner lines found."
            bucketLegend={CORNER_LEAGUE_SPECS.mls.bucketLegend}
            bucketedKey="mls-corners-bucketed"
            showWorkKey="mls-corners-show-work"
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

export default MlsCornersPage;
