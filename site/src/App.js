import React, { useState, useEffect } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate
} from 'react-router-dom';

import './App.css';
import TeamPage from './TeamPage';
import HomePage from './HomePage';
import Sidebar from './Sidebar';

function useIsMobile(maxWidth = 800) {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= maxWidth);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= maxWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [maxWidth]);

  return isMobile;
}

function App() {
  const isMobile = useIsMobile({ maxWidth: 800 });
  const routes = (
    <Routes>
      <Route path="/team/:id" element={<TeamPage />} />
      <Route path="/home/" element={<HomePage />} />
      <Route path="*" element={<Navigate to="/home/" replace />} />
    </Routes>
  );

  return (
    <Router>
      <div className="App">
        <div className="background-bg" />
        <div className="content-wrapper">
          <Sidebar />
          <div className="main-content">
            <div className="watermark-bg" />
            {isMobile ? <div className="mobile-scale-container">{routes}</div> : routes}
          </div>
        </div>
      </div>
    </Router>
  );
}

export default App;
