import React from 'react';
import HomeCardExample1 from '../HomeCardExample1';
import HomeCardExample2 from '../HomeCardExample2';

function AlthomePage() {
  return (
    <main className="home-main">
      <div className="home-cards-grid">
        <HomeCardExample1 />
        <HomeCardExample2 />
        <HomeCardExample1 />
        <HomeCardExample2 />
        <HomeCardExample1 />
        <HomeCardExample2 />
      </div>
    </main>
  );
}

export default AlthomePage;


