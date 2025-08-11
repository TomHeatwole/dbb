import React from 'react';
import { Link } from 'react-router-dom';

function HomePage() {
  return(
    <main className="home-main">
      <div className="home-cta-container">
        <Link className="home-cta-btn" to="/Scores/Week" aria-label="Scores">
          <img className="home-cta-img" src="/scores.png" alt="Scores" />
        </Link>
        <Link className="home-cta-btn" to="/standings" aria-label="Standings">
          <img className="home-cta-img" src="/standings.png" alt="Standings" />
        </Link>
        <button className="home-cta-btn" type="button" aria-label="Teams">
          <img className="home-cta-img" src="/teams.png" alt="Teams" />
        </button>
      </div>
    </main>
  );
}

export default HomePage; 