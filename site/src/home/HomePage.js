import React from 'react';
import ActivePlayoffsCard from './ActivePlayoffsCard';
import CurrentPlayoffPictureCard from './CurrentPlayoffPictureCard';
import HotTeamCard from './HotTeamCard';
import TankRaceCard from './TankRaceCard';
import TopPFRaceCard from './TopPFRaceCard';
import PodcastCard from './PodcastCard';
import CommissionerNoteCard from './CommissionerNoteCard';
import LastWeeksTopPerformanceCard from './LastWeeksTopPerformanceCard';
import useIsMobile from '../hooks/useIsMobile';
import { getCompletedWeeksCount } from '../utils/DateHelper';

// Optional manual override for the "current week" used by home cards.
// - Set this to a positive integer (e.g. 10) to pretend the current week is 10.
// - Leave as null to use the real current week from the underlying helpers.
const ALT_HOME_WEEK_OVERRIDE = null;

function HomePage() {
  const isMobile = useIsMobile();
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

  const playoffCard = showPlayoffMatchupsCard ? (
    <ActivePlayoffsCard currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
  ) : (
    <CurrentPlayoffPictureCard currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
  );

  if (isMobile) {
    // Mobile ordering:
    // 1) Playoffs (picture or matchups)
    // 2) Hot Team Alert
    // 3) Race for the PF
    // 4) Week 14 Top Scores
    // 5) Race for the 1.01
    // 6) Commissioner Note
    // 7) Podcast
    return (
      <main className="home-main">
        <div className="home-cards-grid home-cards-grid--single">
          {playoffCard}
          <HotTeamCard currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
          <TopPFRaceCard currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
          <LastWeeksTopPerformanceCard currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
          <TankRaceCard currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
          <CommissionerNoteCard />
          <PodcastCard />
        </div>
      </main>
    );
  }

  // Web ordering:
  //
  // Left column:
  //  - Playoffs (picture or matchups)
  //  - Race for the PF
  //  - Race for the 1.01
  //  - Podcast
  //
  // Right column:
  //  - Hot Team Alert
  //  - Week 14 Top Scores
  //  - Commissioner Note

  return (
    <main className="home-main">
      <div className="home-cards-grid home-cards-grid--split">
        <div className="home-cards-column home-cards-column--left">
          {playoffCard}
          <TopPFRaceCard currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
          <TankRaceCard currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
          <PodcastCard />
        </div>
        <div className="home-cards-column home-cards-column--right">
          <HotTeamCard currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
          <LastWeeksTopPerformanceCard currentWeekOverride={ALT_HOME_WEEK_OVERRIDE} />
          <CommissionerNoteCard />
        </div>
      </div>
    </main>
  );
}

export default HomePage;


