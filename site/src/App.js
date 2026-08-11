import React, { useState } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  Link,
} from 'react-router-dom';

import './App.css';
import TeamPage from './routes/TeamPage';
import HomePage from './routes/HomePage';
import OldHomePage from './routes/OldHomePage';
import Sidebar from './layout/Sidebar';
import useViewportMode, { 
  useShowVerticalSidebar, 
  useShowHorizontalNav,
  VIEWPORT_MODES 
} from './hooks/useViewportMode';
import LeagueStandings from './routes/LeagueStandings';
import LeagueScores from './routes/LeagueScores';
import AdminControls from './routes/AdminControls';
import YoffsPage from './routes/YoffsPage';
import H2hPage from './routes/h2h';
import NotesPage from './routes/NotesPage';
import ScenariosPage from './routes/ScenariosPage';
import FutureScenariosPage from './routes/FutureScenariosPage';
import FutureScenarios2Page from './routes/FutureScenarios2Page';
import SimulatorPage from './routes/SimulatorPage';
import TradesPage from './routes/TradesPage';
import SandboxPage from './routes/SandboxPage';
import ValueSandboxPage from './routes/ValueSandboxPage';
import RedraftDashPage from './routes/RedraftDashPage';
import HwangAIPage from './routes/HwangAIPage';
import Teams2Page from './routes/Teams2Page';
import SOPPage, { SOP2Page } from './routes/SOPPage';
import DKPage from './routes/DKPage';
import FredDuelPage from './routes/FredDuelPage';
import { MAIN_FEATURES, isFeatureEnabled } from './utils/featureToggles';

const PODCAST_LINK = 'https://open.spotify.com/show/0bM4EGBJzZcMTj3VOpNLko';

function MobileTopNav() {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="mobile-top-home-card-wrapper">
      <nav className="mobile-top-home-card" aria-label="Main navigation">
        <div className="mobile-top-home-card-links">
          <Link to="/Scores/Week" className="mobile-top-home-card-link">
            Scores
          </Link>
          <Link to="/standings" className="mobile-top-home-card-link">
            Standings
          </Link>
          <Link to="/yoffs" className="mobile-top-home-card-link">
            Playoffs
          </Link>
          <Link to="/oldhome/?view=teams" className="mobile-top-home-card-link">
            Teams
          </Link>
          <button
            className="mobile-top-home-card-more-toggle mobile-top-home-card-link"
            onClick={() => setMoreOpen(o => !o)}
            aria-expanded={moreOpen}
          >
            More
            <span className="mobile-top-home-card-teams-arrow">{moreOpen ? ' ▼' : ' ▶'}</span>
          </button>
        </div>
        {moreOpen && (
          <div className="mobile-top-home-card-more">
            <Link to="/hwangai" className="mobile-top-home-card-link">HwangAI</Link>
            <a href={PODCAST_LINK} target="_blank" rel="noopener noreferrer" className="mobile-top-home-card-link">Podcast</a>
            <Link to="/h2h" className="mobile-top-home-card-link">Head&nbsp;to&nbsp;Head</Link>
          </div>
        )}
      </nav>
    </div>
  );
}

function AppInner() {
  const viewportMode = useViewportMode();
  const showVerticalSidebar = useShowVerticalSidebar();
  const showHorizontalNav = useShowHorizontalNav();
  const location = useLocation();
  const isHomeRoute = location.pathname === '/oldhome/';
  const pathUpper = location.pathname.toUpperCase();
  const isSopRoute =
    pathUpper === '/SOP' || pathUpper.startsWith('/SOP/')
    || pathUpper === '/SOP2' || pathUpper.startsWith('/SOP2/')
    || pathUpper === '/DK' || pathUpper.startsWith('/DK/');
  
  // Determine main content class based on viewport mode
  let mainClassName = 'main-content-shared';
  if (isSopRoute) {
    mainClassName += ' sop-main-shell';
  } else if (viewportMode === VIEWPORT_MODES.MOBILE) {
    mainClassName += ' mobile-main-content';
  } else if (viewportMode === VIEWPORT_MODES.TABLET) {
    mainClassName += ' tablet-main-content';
  } else {
    mainClassName += ' main-content';
  }
  if (isHomeRoute) {
    mainClassName += ' home-watermark';
  }

  const routes = (
    <Routes>
      <Route path="/team/:id" element={<TeamPage />} />
      <Route path="/home/" element={<HomePage />} />
      <Route path="/oldhome/" element={<OldHomePage />} />
      <Route path="/standings" element={<LeagueStandings />} />
      <Route path="/Scores/Week" element={<LeagueScores />} />
      <Route path="/admincontrols" element={<AdminControls />} />
      <Route path="/notes" element={<NotesPage />} />
      <Route path="/trades" element={<TradesPage />} />

      {/* Conditionally rendered routes based on feature toggles */}
      {isFeatureEnabled('SCENARIOS_ENABLED', MAIN_FEATURES) && (
        <Route path="/scenarios" element={<ScenariosPage />} />
      )}
      {isFeatureEnabled('FUTURE_SCENARIOS_ENABLED', MAIN_FEATURES) && (
        <Route path="/future-scenarios" element={<FutureScenariosPage />} />
      )}
      {isFeatureEnabled('FUTURE_SCENARIOS_2_ENABLED', MAIN_FEATURES) && (
        <Route path="/future-scenarios-2" element={<FutureScenarios2Page />} />
      )}
      {isFeatureEnabled('SIMULATOR_ENABLED', MAIN_FEATURES) && (
        <Route path="/simulator" element={<SimulatorPage />} />
      )}
      {isFeatureEnabled('PLAYOFFS_ENABLED', MAIN_FEATURES) && (
        <Route path="/yoffs" element={<YoffsPage />} />
      )}
      {isFeatureEnabled('HEAD_TO_HEAD_ENABLED', MAIN_FEATURES) && (
        <Route path="/h2h" element={<H2hPage />} />
      )}
      
      {/* Sandbox is always available for development */}
      <Route path="/sandbox" element={<SandboxPage />} />
      <Route path="/valuesandbox" element={<ValueSandboxPage />} />
      <Route path="/redraftdash" element={<RedraftDashPage />} />
      <Route path="/hwangai" element={<HwangAIPage />} />
      <Route path="/teams-2" element={<Teams2Page />} />
      <Route path="/teams-2/:id" element={<Teams2Page />} />
      <Route path="/SOP/*" element={<SOPPage />} />
      <Route path="/SOP2/*" element={<SOP2Page />} />
      <Route path="/SOP-experimental" element={<Navigate to="/SOP" replace />} />
      <Route path="/dk/*" element={<DKPage />} />
      <Route path="/DK/*" element={<DKPage />} />
      <Route path="/FredDuel" element={<FredDuelPage />} />
      <Route path="/fredduel" element={<FredDuelPage />} />
      
      <Route path="*" element={<Navigate to="/home/" replace />} />
    </Routes>
  );

  return (
    <div className={`App${isSopRoute ? ' App--sop' : ''}`}>
      {!isSopRoute && <div className="background-bg" />}
      <div className={`content-wrapper${isSopRoute ? ' content-wrapper--sop' : ''}`}>
        {showVerticalSidebar && !isSopRoute && <Sidebar />}
        <div className={mainClassName}>
          {!isSopRoute && <div className="watermark-bg" />}
          {showHorizontalNav && !isSopRoute && <MobileTopNav />}
          {viewportMode === VIEWPORT_MODES.MOBILE && !isSopRoute ? (
            <div className="mobile-scale-container">{routes}</div>
          ) : (
            routes
          )}
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AppInner />
    </Router>
  );
}

export default App;
