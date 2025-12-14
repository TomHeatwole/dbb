import React from 'react';
import HomeCard from './HomeCard';

function HomeCardExample2() {
  return (
    <HomeCard>
      <div className="home-card-inner">
        <h2 className="home-card-title">Example Card 2</h2>
        <p className="home-card-body">Hello world with more content.</p>
        <ul className="home-card-list">
          <li>Item A</li>
          <li>Item B</li>
          <li>Item C</li>
          <li>Item D</li>
        </ul>
      </div>
    </HomeCard>
  );
}

export default HomeCardExample2;


