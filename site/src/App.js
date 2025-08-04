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
import Sidebar from './Sidebar';

function App() {
  return (
    <Router>
      <div className="App">
        <div className="background-bg" />
        <div className="content-wrapper">
          <Sidebar />
          <div className="main-content">
            <div className="watermark-bg" />
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
