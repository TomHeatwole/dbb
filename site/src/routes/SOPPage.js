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
import { mergeDkIntoFdGames } from '../sop/mergeDkGames';
import { mergeKalshiIntoFdGames } from '../sop/mergeKalshiGames';

/** DK is flaky (Akamai / missing event map). Bail fast and render FanDuel. */
const DK_CLIENT_TIMEOUT_MS = 2000;
const KALSHI_CLIENT_TIMEOUT_MS = 8000;

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

async function fetchKalshiOddsForSop() {
  return fetchJsonWithTimeout('/api/kalshi-sop', KALSHI_CLIENT_TIMEOUT_MS);
}

async function fetchDkOddsForSop() {
  return fetchJsonWithTimeout('/api/draftkings-goal-method', DK_CLIENT_TIMEOUT_MS);
}

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
  'Pulling FanDuel Premier League odds…',
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

function SOPTabBar({ basePath }) {
  return (
    <nav className="sop-tabs" aria-label="SOP mode">
      <NavLink
        to={basePath}
        end
        className={({ isActive }) => `sop-tab${isActive ? ' sop-tab--active' : ''}`}
      >
        Book
      </NavLink>
      <NavLink
        to={`${basePath}/manual`}
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

export function SOPPageShell({ basePath = '/SOP', skipBootLoader = false }) {
  const location = useLocation();
  const manualSuffix = `${basePath}/manual`;
  const isManual = location.pathname.toLowerCase() === manualSuffix.toLowerCase()
    || location.pathname.toLowerCase().endsWith('/manual');

  const [shellReady, setShellReady] = useState(skipBootLoader);
  const [vibesPhase, setVibesPhase] = useState(skipBootLoader ? 'done' : 'loading');
  const [loadingProgress, setLoadingProgress] = useState(skipBootLoader ? 1 : 0);
  const [msgIndex, setMsgIndex] = useState(0);
  const [bookLoaded, setBookLoaded] = useState(false);
  const [games, setGames] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [bookError, setBookError] = useState(null);
  const [dkNotice, setDkNotice] = useState(null);
  const [bookRefreshing, setBookRefreshing] = useState(false);

  const refreshBook = useCallback(async ({ manual = false } = {}) => {
    if (manual) setBookRefreshing(true);

    // FanDuel is fast (~200ms). Show it immediately; merge DK/Kalshi as they finish
    // so a slow DraftKings probe/Akamai block cannot hang the whole page.
    let fdGames = [];
    try {
      const fdRes = await fetch('/api/fanduel-sop');
      if (!fdRes.ok) {
        const body = await fdRes.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${fdRes.status}`);
      }

      const fdData = await fdRes.json();
      fdGames = fdData.games ?? [];
      setGames(fdGames.map((game) => ({ ...game, dk: null, klsh: null })));
      setFetchedAt(fdData.fetchedAt ?? null);
      setBookError(null);
      setBookLoaded(true);
    } catch (err) {
      setBookError(err.message || 'Failed to load odds');
      setBookLoaded(true);
      if (manual) setBookRefreshing(false);
      return;
    }

    let dkData = null;
    let kalshiData = null;

    const applyMerges = () => {
      setGames(
        mergeKalshiIntoFdGames(mergeDkIntoFdGames(fdGames, dkData), kalshiData),
      );
    };

    await Promise.all([
      fetchDkOddsForSop().then((data) => {
        dkData = data;
        applyMerges();
        const hasMergedDk = (data?.games ?? []).some(
          (g) => g.goalTypes || g.noGoalMarkets,
        );
        if (!data || !hasMergedDk) {
          setDkNotice('DraftKings odds unavailable — showing FanDuel only.');
        } else {
          setDkNotice(null);
        }
      }),
      fetchKalshiOddsForSop().then((data) => {
        kalshiData = data;
        applyMerges();
      }),
    ]);

    if (manual) setBookRefreshing(false);
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
    if (skipBootLoader) return undefined;

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
  }, [skipBootLoader]);

  useEffect(() => {
    if (skipBootLoader || vibesPhase !== 'loading') return undefined;

    const id = window.setInterval(() => {
      setMsgIndex((i) => (i + 1) % LOADING_MESSAGES.length);
    }, 1400);

    return () => clearInterval(id);
  }, [vibesPhase, skipBootLoader]);

  useEffect(() => {
    if (skipBootLoader) return;
    if (vibesPhase === 'done' && bookLoaded) {
      setShellReady(true);
    }
  }, [vibesPhase, bookLoaded, skipBootLoader]);

  return (
    <>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} image={OG_IMAGE} />

      <div className="sop-collage-frame">
        <SopCollageGrid />

        {!skipBootLoader && !shellReady && (
          <SOPBootLoader
            phase={vibesPhase}
            loadingProgress={loadingProgress}
            msgIndex={msgIndex}
            bookLoaded={bookLoaded}
          />
        )}

        {(skipBootLoader || shellReady) && (
          <div className={`sop-page${isManual ? '' : ' sop-page--book'}`}>
            <div className="sop-pitch-lines" aria-hidden="true" />
            <div className="sop-spotlight sop-spotlight--left" aria-hidden="true" />
            <div className="sop-spotlight sop-spotlight--right" aria-hidden="true" />
            <div className="sop-scanlines" aria-hidden="true" />

            <SOPTabBar basePath={basePath} />

            <Routes>
              <Route
                index
                element={
                  <SOPBookPanel
                    games={games}
                    fetchedAt={fetchedAt}
                    error={bookError}
                    dkNotice={dkNotice}
                    refreshing={bookRefreshing}
                    loading={skipBootLoader && !bookLoaded}
                    onRefresh={() => refreshBook({ manual: true })}
                  />
                }
              />
              <Route path="manual" element={<SOPManualPanel />} />
              <Route path="*" element={<Navigate to={basePath} replace />} />
            </Routes>
          </div>
        )}
      </div>
    </>
  );
}

function SOPPage() {
  return <SOPPageShell basePath="/SOP" skipBootLoader={false} />;
}

export function SOP2Page() {
  return <SOPPageShell basePath="/SOP2" skipBootLoader />;
}

export default SOPPage;
