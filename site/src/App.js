import React from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate
} from 'react-router-dom';
import './App.css';
import TeamPage from './TeamPage';
import HomePage from './HomePage';

function App() {
  return (
    <Router>
      <div className="App">
        <div className="content-wrapper">
          <div className="watermark-bg" />
          <div className="sidebar">
            TODO: Add sidebar
          </div>
          <div className="main-content">
            <Routes>
              <Route path="/team/:id" element={<TeamPage />} />
              <Route path="/home/" element={<HomePage />} />
              <Route path="*" element={<Navigate to="/home/" replace />} />
            </Routes>
          </div>
        </div>
      </div>
    </Router>
  );
}

export default App;
