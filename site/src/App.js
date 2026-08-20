import React, { useEffect, useState } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  Link,
} from 'react-router-dom';

import './App.css';
import HomePage from './routes/HomePage';
import OldHomePage from './routes/OldHomePage';
import Sidebar from './layout/Sidebar';
import SignOutControl from './layout/SignOutControl';
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
import LeagueHistoryPage from './routes/LeagueHistoryPage';
import SandboxPage from './routes/SandboxPage';
import ValueSandboxPage from './routes/ValueSandboxPage';
import RedraftDashPage from './routes/RedraftDashPage';
import HwangAIPage from './routes/HwangAIPage';
import Teams2Page from './routes/Teams2Page';
import SOPPage, { SOP2Page } from './routes/SOPPage';
import DKPage from './routes/DKPage';
import PreflopPage from './routes/PreflopPage';
import FredDuelPage from './routes/FredDuelPage';
import FredDuelSetupPage from './routes/FredDuelSetupPage';
import AccountSetupPage from './routes/AccountSetupPage';
import AuthCallbackPage from './routes/AuthCallbackPage';
import { AuthUserProvider } from './hooks/useAuthUser';
import RequireAdmin from './layout/RequireAdmin';
import { MAIN_FEATURES, isFeatureEnabled } from './utils/featureToggles';
import { inkNavClass, navIsAnyActive, NAV_MATCH } from './layout/navActive';

const PODCAST_LINK = 'https://open.spotify.com/show/0bM4EGBJzZcMTj3VOpNLko';

function MobileNavLink({ to, match, children, className = 'mobile-top-home-card-link' }) {
  const { pathname } = useLocation();
  const active = navIsAnyActive(pathname, match);
  return (
    <Link
      to={to}
      className={inkNavClass(active, className)}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </Link>
  );
}

function MobileTopNav() {
  const { pathname } = useLocation();
  const moreActive = navIsAnyActive(pathname, [
    ...NAV_MATCH.history,
    ...NAV_MATCH.hwangai,
    ...NAV_MATCH.h2h,
  ]);
  const [moreOpen, setMoreOpen] = useState(moreActive);

  useEffect(() => {
    if (moreActive) setMoreOpen(true);
  }, [moreActive]);

  return (
    <div className="mobile-top-home-card-wrapper">
      <nav className="mobile-top-home-card" aria-label="Main navigation">
        <div className="mobile-top-home-card-links">
          <MobileNavLink to="/Scores/Week" match={NAV_MATCH.scores}>
            Scores
          </MobileNavLink>
          <MobileNavLink to="/standings" match={NAV_MATCH.standings}>
            Standings
          </MobileNavLink>
          <MobileNavLink to="/yoffs" match={NAV_MATCH.playoffs}>
            Playoffs
          </MobileNavLink>
          <MobileNavLink to="/teams" match={NAV_MATCH.teamsAny}>
            Teams
          </MobileNavLink>
          <button
            className={inkNavClass(moreActive && !moreOpen, 'mobile-top-home-card-more-toggle mobile-top-home-card-link')}
            onClick={() => setMoreOpen(o => !o)}
            aria-expanded={moreOpen}
          >
            More
            <span className="mobile-top-home-card-teams-arrow">{moreOpen ? ' ▼' : ' ▶'}</span>
          </button>
        </div>
        {moreOpen && (
          <div className="mobile-top-home-card-more">
            <a href={PODCAST_LINK} target="_blank" rel="noopener noreferrer" className="mobile-top-home-card-link">Podcast</a>
            <MobileNavLink to="/league-history" match={NAV_MATCH.history}>History</MobileNavLink>
            <MobileNavLink to="/hwangai" match={NAV_MATCH.hwangai}>HwangAI</MobileNavLink>
            <MobileNavLink to="/h2h" match={NAV_MATCH.h2h}>Head&nbsp;to&nbsp;Head</MobileNavLink>
            <SignOutControl className="mobile-top-home-card-link mobile-top-home-card-signout" />
          </div>
        )}
      </nav>
    </div>
  );
}

// `/` is not a real route. Keep the query string so an OAuth return to
// `/?neon_auth_session_verifier=…` does not throw away the session.
function UnknownRoute() {
  const location = useLocation();
  return <Navigate to={{ pathname: '/home/', search: location.search }} replace />;
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
      <Route path="/team/:id" element={<Teams2Page />} />
      <Route path="/teams" element={<Teams2Page />} />
      <Route path="/home/" element={<HomePage />} />
      <Route path="/althome/" element={<Navigate to="/home/" replace />} />
      <Route path="/oldhome/" element={<OldHomePage />} />
      <Route path="/standings" element={<LeagueStandings />} />
      <Route path="/Scores/Week" element={<LeagueScores />} />
      <Route path="/admincontrols" element={<RequireAdmin><AdminControls /></RequireAdmin>} />
      <Route path="/notes" element={<NotesPage />} />
      <Route path="/trades" element={<TradesPage />} />
      <Route path="/league-history" element={<LeagueHistoryPage />} />

      {/* Conditionally rendered routes based on feature toggles */}
      {isFeatureEnabled('SCENARIOS_ENABLED', MAIN_FEATURES) && (
        <Route path="/scenarios" element={<ScenariosPage />} />
      )}
      {isFeatureEnabled('FUTURE_SCENARIOS_ENABLED', MAIN_FEATURES) && (
        <Route path="/future-scenarios" element={<RequireAdmin><FutureScenariosPage /></RequireAdmin>} />
      )}
      {isFeatureEnabled('FUTURE_SCENARIOS_2_ENABLED', MAIN_FEATURES) && (
        <Route path="/future-scenarios-2" element={<RequireAdmin><FutureScenarios2Page /></RequireAdmin>} />
      )}
      {isFeatureEnabled('SIMULATOR_ENABLED', MAIN_FEATURES) && (
        <Route path="/simulator" element={<RequireAdmin><SimulatorPage /></RequireAdmin>} />
      )}
      {isFeatureEnabled('PLAYOFFS_ENABLED', MAIN_FEATURES) && (
        <Route path="/yoffs" element={<YoffsPage />} />
      )}
      {isFeatureEnabled('HEAD_TO_HEAD_ENABLED', MAIN_FEATURES) && (
        <Route path="/h2h" element={<H2hPage />} />
      )}

      <Route path="/sandbox" element={<RequireAdmin><SandboxPage /></RequireAdmin>} />
      <Route path="/valuesandbox" element={<RequireAdmin><ValueSandboxPage /></RequireAdmin>} />
      <Route path="/redraftdash" element={<RequireAdmin><RedraftDashPage /></RequireAdmin>} />
      <Route path="/hwangai" element={<HwangAIPage />} />
      <Route path="/teams-2" element={<Navigate to="/teams" replace />} />
      <Route path="/SOP/*" element={<SOPPage />} />
      <Route path="/SOP2/*" element={<SOP2Page />} />
      <Route path="/SOP-experimental" element={<Navigate to="/SOP" replace />} />
      <Route path="/dk/*" element={<DKPage />} />
      <Route path="/DK/*" element={<DKPage />} />
      <Route path="/preflop" element={<PreflopPage />} />
      <Route path="/FredDuel" element={<FredDuelPage />} />
      <Route path="/fredduel" element={<FredDuelPage />} />
      <Route path="/FredDuel/setup" element={<FredDuelSetupPage />} />
      <Route path="/account/setup" element={<AccountSetupPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      
      <Route path="*" element={<UnknownRoute />} />
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
      <AuthUserProvider>
        <AppInner />
      </AuthUserProvider>
    </Router>
  );
}

export default App;
