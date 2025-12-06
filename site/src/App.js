import React from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation
} from 'react-router-dom';

import './App.css';
import TeamPage from './routes/TeamPage';
import HomePage from './routes/HomePage';
import Sidebar from './layout/Sidebar';
import useIsMobile from './hooks/useIsMobile';
import LeagueStandings from './routes/LeagueStandings';
import LeagueScores from './routes/LeagueScores';
import AdminControls from './routes/AdminControls';
import YoffsPage from './routes/YoffsPage';
import H2hPage from './routes/h2h';

function AppInner() {
  const isMobile = useIsMobile();
  const location = useLocation();
  const isHomeRoute = location.pathname === '/home/';
  const mainClassName = `${isMobile ? 'mobile-main-content' : 'main-content'}${isHomeRoute ? ' home-watermark' : ''}`;

  const routes = (
    <Routes>
      <Route path="/team/:id" element={<TeamPage />} />
      <Route path="/home/" element={<HomePage />} />
      <Route path="/standings" element={<LeagueStandings />} />
      <Route path="/Scores/Week" element={<LeagueScores />} />
      <Route path="/admincontrols" element={<AdminControls />} />
      <Route path="/yoffs" element={<YoffsPage />} />
      <Route path="/h2h" element={<H2hPage />} />
      <Route path="*" element={<Navigate to="/home/" replace />} />
    </Routes>
  );

  return (
    <div className="App">
      <div className="background-bg" />
      <div className="content-wrapper">
        <Sidebar />
        <div className={mainClassName}>
          <div className="watermark-bg" />
          {isMobile ? <div className="mobile-scale-container">{routes}</div> : routes}
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
