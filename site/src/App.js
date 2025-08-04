import React from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useParams,
  Navigate
} from 'react-router-dom';
import './App.css';

function TeamPage() {
  const { id } = useParams();
  return  <h1>Hello, team ID: {id}</h1>;
}

function HomePage() {
  return(
    <header className="App-header">
      <h1>Welcome to the Hwang Dynasty</h1>
    </header>
  );
}

function App() {
  return (
    <Router>
      <div className="App">
        <div className="content-wrapper">
        <div className="watermark-bg" />
          <Routes>
            <Route path="/team/:id" element={<TeamPage />} />
            <Route path="/home/" element={<HomePage />} />
            <Route path="*" element={<Navigate to="/home/" replace />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
