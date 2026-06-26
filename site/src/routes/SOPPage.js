/**
 * SOPPage — tabbed shell: Book (FanDuel live) + Manual (calculator).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import PageMeta from '../PageMeta';
import SimulatorProgressBar from '../scenarios/SimulatorProgressBar';
import { TOUCHDOWN_CELEBRATION_MS } from '../scenarios/simulatorProgress';
import SOPBookPanel from './SOPBookPanel';
import SOPManualPanel from './SOPManualPanel';

const OG_TITLE = 'SHOT OPEN PLAY';
const OG_DESCRIPTION = 'SHOT OPEN PLAY';
const OG_IMAGE = `${process.env.PUBLIC_URL || ''}/data/sop.jpeg`;

const SOP_COLLAGE_SRC = '/data/sop.jpeg';
const COLLAGE_TILE_W = 200;
const COLLAGE_TILE_H = Math.round(COLLAGE_TILE_W * (1442 / 1916));
const LOADING_DURATION_MS = 10_000;
const BOOK_REFRESH_MS = 60_000;

const LOADING_MESSAGES = [
  'Initializing pitch sensors…',
  'Calibrating offside trap algorithms…',
  'Syncing with FIFA VAR mainframe…',
  'Pulling FanDuel World Cup odds…',
  'Loading corner kick coefficients…',
  'Warming up the fourth official…',
  'Parsing xG regression tables…',
  'Handshake with the goal-line tech…',
  'Downloading crowd noise samples…',
];

function SopCollageGrid() {
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

function SOPTabBar() {
  return (
    <nav className="sop-tabs" aria-label="SOP mode">
      <NavLink
        to="/SOP"
        end
        className={({ isActive }) => `sop-tab${isActive ? ' sop-tab--active' : ''}`}
      >
        Book
      </NavLink>
      <NavLink
        to="/SOP/manual"
        className={({ isActive }) => `sop-tab${isActive ? ' sop-tab--active' : ''}`}
      >
        Manual
      </NavLink>
    </nav>
  );
}

function SOPBootLoader({ phase, loadingProgress, msgIndex, bookLoaded }) {
  return (
    <div className="sop-boot-overlay" aria-busy="true" aria-label="Loading SOP">
      <div className="sop-loader-card sop-boot-loader-card">
        <div className="sop-loader-kicker">MATCH DAY SIMULATION</div>
        <SimulatorProgressBar
          phase={phase === 'celebrating' ? 'celebrating' : 'loading'}
          loadingProgress={loadingProgress}
          simProgress={bookLoaded ? 1 : 0.35}
          iterations={10000}
        />
        <div className="sop-loader-detail">{LOADING_MESSAGES[msgIndex]}</div>
        <div className="sop-loader-sub">
          {bookLoaded
            ? 'FanDuel odds locked in. Almost kickoff…'
            : 'Warming up Book + Manual…'}
        </div>
      </div>
    </div>
  );
}

function SOPPage() {
  const location = useLocation();
  const isManual = location.pathname.toLowerCase().endsWith('/manual');

  const [shellReady, setShellReady] = useState(false);
  const [vibesPhase, setVibesPhase] = useState('loading');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [msgIndex, setMsgIndex] = useState(0);
  const [bookLoaded, setBookLoaded] = useState(false);
  const [games, setGames] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [bookError, setBookError] = useState(null);
  const [bookRefreshing, setBookRefreshing] = useState(false);

  const refreshBook = useCallback(async ({ manual = false } = {}) => {
    if (manual) setBookRefreshing(true);
    try {
      const res = await fetch('/api/fanduel-sop');
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
      setBookLoaded(true);
      if (manual) setBookRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refreshBook();
  }, [refreshBook]);

  useEffect(() => {
    if (!shellReady) return undefined;
    const id = window.setInterval(refreshBook, BOOK_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [shellReady, refreshBook]);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();

    const tick = (now) => {
      const elapsed = now - start;
      const p = Math.min(1, elapsed / LOADING_DURATION_MS);
      setLoadingProgress(p);

      if (p < 1) {
        raf = requestAnimationFrame(tick);
        return;
      }

      setVibesPhase('celebrating');
      window.setTimeout(() => setVibesPhase('done'), TOUCHDOWN_CELEBRATION_MS);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (vibesPhase !== 'loading') return undefined;

    const id = window.setInterval(() => {
      setMsgIndex((i) => (i + 1) % LOADING_MESSAGES.length);
    }, 1400);

    return () => clearInterval(id);
  }, [vibesPhase]);

  useEffect(() => {
    if (vibesPhase === 'done' && bookLoaded) {
      setShellReady(true);
    }
  }, [vibesPhase, bookLoaded]);

  return (
    <>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} image={OG_IMAGE} />

      <div className="sop-collage-frame">
        <SopCollageGrid />

        {!shellReady && (
          <SOPBootLoader
            phase={vibesPhase}
            loadingProgress={loadingProgress}
            msgIndex={msgIndex}
            bookLoaded={bookLoaded}
          />
        )}

        {shellReady && (
          <div className={`sop-page${isManual ? '' : ' sop-page--book'}`}>
            <div className="sop-pitch-lines" aria-hidden="true" />
            <div className="sop-spotlight sop-spotlight--left" aria-hidden="true" />
            <div className="sop-spotlight sop-spotlight--right" aria-hidden="true" />
            <div className="sop-scanlines" aria-hidden="true" />

            <SOPTabBar />

            <Routes>
              <Route
                index
                element={
                  <SOPBookPanel
                    games={games}
                    fetchedAt={fetchedAt}
                    error={bookError}
                    refreshing={bookRefreshing}
                    onRefresh={() => refreshBook({ manual: true })}
                  />
                }
              />
              <Route path="manual" element={<SOPManualPanel />} />
              <Route path="*" element={<Navigate to="/SOP" replace />} />
            </Routes>
          </div>
        )}
      </div>
    </>
  );
}

export default SOPPage;
