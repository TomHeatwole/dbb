import React, { useState, useEffect } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation
} from 'react-router-dom';

import './App.css';
import TeamPage from './TeamPage';
import HomePage from './HomePage';
import Sidebar from './Sidebar';
import useIsMobile from './useIsMobile';
import LeagueStandings from './LeagueStandings';
import LeagueScores from './LeagueScores';
import AdminControls from './AdminControls';
import YoffsPage from './YoffsPage';

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
