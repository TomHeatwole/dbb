import React from 'react';
import ActivePlayoffsCard from '../ActivePlayoffsCard';
import HotTeamCard from '../HotTeamCard';
import HomeCardExample1 from '../HomeCardExample1';
import HomeCardExample2 from '../HomeCardExample2';

// Optional manual override for the "current week" used by home cards.
// - Set this to a positive integer (e.g. 10) to pretend the current week is 10.
// - Leave as null to use the real current week from the underlying helpers.
const ALT_HOME_WEEK_OVERRIDE = null;

function AlthomePage() {
  return (
    <main className="home-main">
      <div className="home-cards-grid">
        <ActivePlayoffsCard currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
        <HotTeamCard currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
        <HomeCardExample1 currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
        <HomeCardExample2 currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
        <HomeCardExample1 currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
        <HomeCardExample2 currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
        <HomeCardExample1 currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
        <HomeCardExample2 currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
      </div>
    </main>
  );
}

export default AlthomePage;


