/**
 * DrivesPage — SOP-style NCAAF current-drive + next-drive book.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import PageMeta from '../PageMeta';
import DrivesBookPanel from './DrivesBookPanel';
import { applyOddsAheadFlags } from '../drives/driveModel';

const OG_TITLE = 'NCAAF Drives';
const OG_DESCRIPTION = 'College football current-drive and next-drive results vs joint LightGBM';
const OG_IMAGE = `${process.env.PUBLIC_URL || ''}/data/sop.jpeg`;
const SOP_COLLAGE_SRC = '/data/sop.jpeg';
const COLLAGE_TILE_W = 200;
const COLLAGE_TILE_H = Math.round(COLLAGE_TILE_W * (1442 / 1916));
const BOOK_REFRESH_MS = 60_000;
const LIVE_REFRESH_MS = 8_000;

function DrivesCollageGrid() {
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

function DrivesPage() {
  const [games, setGames] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [stats, setStats] = useState(null);
  const [bookError, setBookError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [bookLoading, setBookLoading] = useState(true);
  const [bookRefreshing, setBookRefreshing] = useState(false);
  const espnKickRef = useRef(new Set());

  const refreshBook = useCallback(async ({ manual = false, espnRefresh } = {}) => {
    if (manual) setBookRefreshing(true);

    try {
      const params = new URLSearchParams({ t: String(Date.now()) });
      if (manual) params.set('fresh', '1');
      if (espnRefresh) params.set('espnRefresh', String(espnRefresh));
      const res = await fetch(`/api/ncaaf-drives?${params}`, { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setGames((prev) => applyOddsAheadFlags(prev, data.games ?? []));
      setFetchedAt(data.fetchedAt ?? null);
      setStats(data.stats ?? null);
      const bits = [];
      if (data.espn?.ok === false) bits.push(`ESPN live state: ${data.espn.error || 'unavailable'}`);
      if (data.stats) {
        bits.push(
          `${data.stats.live ?? 0} live · ${data.stats.withDriveLine ?? 0} with drive line (${data.stats.withDbFdDriveLine ?? data.stats.withFdDriveLine ?? 0} FD · ${data.stats.withDkFirstDrive ?? 0} DK) · ${data.stats.espnMatched ?? 0} ESPN matched`,
        );
      }
      setNotice(bits.length ? bits.join(' · ') : null);
      setBookError(null);
    } catch (err) {
      setBookError(err.message || 'Failed to load drives');
    } finally {
      setBookLoading(false);
      if (manual) setBookRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refreshBook();
  }, [refreshBook]);

  const hasLive = games.some((game) => game.inPlay);
  const refreshMs = hasLive ? LIVE_REFRESH_MS : BOOK_REFRESH_MS;

  useEffect(() => {
    const id = window.setInterval(refreshBook, refreshMs);
    return () => window.clearInterval(id);
  }, [refreshBook, refreshMs]);

  useEffect(() => {
    const ahead = games.filter((game) => (
      game?.live?.fdAheadOfEspn && game?.espnId
    ));
    for (const game of ahead) {
      const fd = game.live?.fd || game.fdLive || {};
      const key = [
        game.eventId,
        fd.period,
        fd.clockSeconds,
        fd.down,
        fd.distance,
        game.live?.period,
        game.live?.clockSeconds,
        game.live?.down,
        game.live?.distance,
      ].join('|');
      if (espnKickRef.current.has(key)) continue;
      espnKickRef.current.add(key);
      refreshBook({ espnRefresh: game.espnId });
      break;
    }
  }, [games, refreshBook]);

  return (
    <>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} image={OG_IMAGE} />

      <div className="sop-collage-frame">
        <DrivesCollageGrid />

        <div className="sop-page sop-page--book">
          <div className="sop-pitch-lines" aria-hidden="true" />
          <div className="sop-spotlight sop-spotlight--left" aria-hidden="true" />
          <div className="sop-spotlight sop-spotlight--right" aria-hidden="true" />
          <div className="sop-scanlines" aria-hidden="true" />

          <DrivesBookPanel
            games={games}
            fetchedAt={fetchedAt}
            stats={stats}
            error={bookError}
            notice={notice}
            loading={bookLoading}
            refreshing={bookRefreshing}
            refreshMs={refreshMs}
            onRefresh={() => refreshBook({ manual: true })}
          />
        </div>
      </div>
    </>
  );
}

export default DrivesPage;
