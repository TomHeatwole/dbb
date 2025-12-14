import React from 'react';
import ActivePlayoffsCard from './ActivePlayoffsCard';
import CurrentPlayoffPictureCard from './CurrentPlayoffPictureCard';
import HotTeamCard from './HotTeamCard';
import TankRaceCard from './TankRaceCard';
import TopPFRaceCard from './TopPFRaceCard';
import PodcastCard from './PodcastCard';
import CommissionerNoteCard from './CommissionerNoteCard';
import LastWeeksTopPerformanceCard from './LastWeeksTopPerformanceCard';
import { getCompletedWeeksCount } from '../utils/DateHelper';

// Optional manual override for the "current week" used by home cards.
// - Set this to a positive integer (e.g. 10) to pretend the current week is 10.
// - Leave as null to use the real current week from the underlying helpers.
const ALT_HOME_WEEK_OVERRIDE = null;

function HomePage() {
  const WEEK_14 = 14;

  let showPlayoffMatchupsCard = false;

  if (ALT_HOME_WEEK_OVERRIDE != null) {
    const parsed = Number(ALT_HOME_WEEK_OVERRIDE);
    if (Number.isFinite(parsed) && parsed >= WEEK_14) {
      showPlayoffMatchupsCard = true;
    }
  } else {
    const completedWeeks = getCompletedWeeksCount();
    if (Number.isFinite(completedWeeks) && completedWeeks >= WEEK_14) {
      showPlayoffMatchupsCard = true;
    }
  }

  return (
    <main className="home-main">
      <div className="home-cards-grid">
        {!showPlayoffMatchupsCard && (
          <CurrentPlayoffPictureCard currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
        )}
        {showPlayoffMatchupsCard && (
          <ActivePlayoffsCard currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
        )}
        <TopPFRaceCard currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
        <TankRaceCard currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
        <HotTeamCard currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
        <LastWeeksTopPerformanceCard currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
        <CommissionerNoteCard />
        <PodcastCard />
      </div>
    </main>
  );
}

export default HomePage;


