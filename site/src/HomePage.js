import React from 'react';
import { Link } from 'react-router-dom';

function HomePage() {
  return(
    <header className="App-header">
      <h1>Welcome to the Hwang Dynasty</h1>
      <div className="home-cta-container">
        <Link className="home-cta-btn" to="/Scores/Week">Scores</Link>
        <Link className="home-cta-btn" to="/standings">Standings</Link>
        <button className="home-cta-btn" type="button">Teams</button>
      </div>
    </header>
  );
}

export default HomePage; 