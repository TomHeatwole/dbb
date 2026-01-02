import React from 'react';
import HomeCard from './HomeCard';

function HelloWorldPWACard() {
  return (
    <HomeCard className="home-card--pwa-hello">
      <div className="home-card-inner">
        <h2 className="home-card-title">Hello world PWA</h2>
        <div className="home-card-body">
          Running in home-screen app mode.
        </div>
      </div>
    </HomeCard>
  );
}

export default HelloWorldPWACard;


