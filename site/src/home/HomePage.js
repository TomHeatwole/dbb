import React, { useState, useEffect } from 'react';
import ActivePlayoffsCard from './ActivePlayoffsCard';
import CurrentPlayoffPictureCard from './CurrentPlayoffPictureCard';
import HotTeamCard from './HotTeamCard';
import TankRaceCard from './TankRaceCard';
import TopPFRaceCard from './TopPFRaceCard';
import PodcastCard from './PodcastCard';
import CommissionerNoteCard from './CommissionerNoteCard';
import LastWeeksTopPerformanceCard from './LastWeeksTopPerformanceCard';
import useIsMobile from '../hooks/useIsMobile';
import { getCurrentNFLWeek, isCurrentWeekCompleted } from '../utils/DateHelper';

// Optional manual override for the "current week" used by home cards.
// - Set this to a positive integer (e.g. 10) to pretend the current week is 10.
// - Leave as null to use the real current week from the underlying helpers.
const ALT_HOME_WEEK_OVERRIDE = null;

function HomePage() {
  const isMobile = useIsMobile();
  const WEEK_14 = 14;

  // Home page specific logic: as soon as a week is completed, advance to the next week
  const [homePageCurrentWeek, setHomePageCurrentWeek] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function computeHomeWeek() {
      try {
        const baseWeek = getCurrentNFLWeek();
        const weekCompleted = await isCurrentWeekCompleted();
        
        // If the current week is completed, advance to the next week for home page display
        const effectiveWeek = weekCompleted ? baseWeek + 1 : baseWeek;
        
        if (!cancelled) {
          setHomePageCurrentWeek(effectiveWeek);
        }
      } catch (_) {
        // Fallback to base week on error
        if (!cancelled) {
          setHomePageCurrentWeek(getCurrentNFLWeek());
        }
      }
    }

    computeHomeWeek();

    return () => {
      cancelled = true;
    };
  }, []);

  // Determine which week to pass to cards
  const effectiveWeekOverride = ALT_HOME_WEEK_OVERRIDE != null 
    ? ALT_HOME_WEEK_OVERRIDE 
    : homePageCurrentWeek;

  // Determine if we should show playoff matchups card
  let showPlayoffMatchupsCard = false;

  if (effectiveWeekOverride != null) {
    const parsed = Number(effectiveWeekOverride);
    if (Number.isFinite(parsed) && parsed >= WEEK_14) {
      showPlayoffMatchupsCard = true;
    }
  }

  const playoffCard = showPlayoffMatchupsCard ? (
    <ActivePlayoffsCard currentWeekOverride={effectiveWeekOverride} />
  ) : (
    <CurrentPlayoffPictureCard currentWeekOverride={effectiveWeekOverride} />
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
          <HotTeamCard currentWeekOverride={effectiveWeekOverride} />
          <TopPFRaceCard currentWeekOverride={effectiveWeekOverride} />
          <LastWeeksTopPerformanceCard currentWeekOverride={effectiveWeekOverride} />
          <TankRaceCard currentWeekOverride={effectiveWeekOverride} />
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
          <TopPFRaceCard currentWeekOverride={effectiveWeekOverride} />
          <TankRaceCard currentWeekOverride={effectiveWeekOverride} />
          <PodcastCard />
        </div>
        <div className="home-cards-column home-cards-column--right">
          <HotTeamCard currentWeekOverride={effectiveWeekOverride} />
          <LastWeeksTopPerformanceCard currentWeekOverride={effectiveWeekOverride} />
          <CommissionerNoteCard />
        </div>
      </div>
    </main>
  );
}

export default HomePage;


