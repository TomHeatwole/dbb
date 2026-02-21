import React from 'react';
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
import TradesPage from './routes/TradesPage';
import SandboxPage from './routes/SandboxPage';
import HwangAIPage from './routes/HwangAIPage';
import { MAIN_FEATURES, isFeatureEnabled } from './utils/featureToggles';

function MobileTopNav() {
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
          <Link to="/h2h" className="mobile-top-home-card-link">
            Head&nbsp;to&nbsp;Head
          </Link>
          <Link to="/yoffs" className="mobile-top-home-card-link">
            Playoffs
          </Link>
          <Link to="/oldhome/?view=teams" className="mobile-top-home-card-link">
            Teams
          </Link>
        </div>
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
  
  // Determine main content class based on viewport mode
  let mainClassName = 'main-content-shared';
  if (viewportMode === VIEWPORT_MODES.MOBILE) {
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
      {isFeatureEnabled('PLAYOFFS_ENABLED', MAIN_FEATURES) && (
        <Route path="/yoffs" element={<YoffsPage />} />
      )}
      {isFeatureEnabled('HEAD_TO_HEAD_ENABLED', MAIN_FEATURES) && (
        <Route path="/h2h" element={<H2hPage />} />
      )}
      
      {/* Sandbox is always available for development */}
      <Route path="/sandbox" element={<SandboxPage />} />
      <Route path="/hwangai" element={<HwangAIPage />} />
      
      <Route path="*" element={<Navigate to="/home/" replace />} />
    </Routes>
  );

  return (
    <div className="App">
      <div className="background-bg" />
      <div className="content-wrapper">
        {showVerticalSidebar && <Sidebar />}
        <div className={mainClassName}>
          <div className="watermark-bg" />
          {showHorizontalNav && <MobileTopNav />}
          {viewportMode === VIEWPORT_MODES.MOBILE ? (
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
