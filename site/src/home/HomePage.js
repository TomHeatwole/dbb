import React, { useState, useEffect } from 'react';
import ActivePlayoffsCard from './ActivePlayoffsCard';
import ChampionshipCard from './ChampionshipCard';
import CurrentPlayoffPictureCard from './CurrentPlayoffPictureCard';
import BubbleCard from './BubbleCard';
import HotTeamCard from './HotTeamCard';
import TankRaceCard from './TankRaceCard';
import TopPFRaceCard from './TopPFRaceCard';
import PodcastCard from './PodcastCard';
import CommissionerNoteCard from './CommissionerNoteCard';
import LastWeeksTopPerformanceCard from './LastWeeksTopPerformanceCard';
import Week1CountdownCard from './Week1CountdownCard';
import LoadingState from '../LoadingState';
import useIsMobile from '../hooks/useIsMobile';
import { getCurrentNFLWeek, isCurrentWeekCompleted } from '../utils/DateHelper';

// Optional manual override for the "current week" used by home cards.
// - Set this to a positive integer (e.g. 10) to pretend the current week is 10.
// - Leave as null to use the real current week from the underlying helpers.
const ALT_HOME_WEEK_OVERRIDE = null;

// Optional manual override for the off-season state.
// - null: derive automatically (Week 17 completed => off-season)
// - true: force off-season layout
// - false: force normal in-season layout
const ALT_HOME_OFFSEASON_OVERRIDE = false;

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
        // NOTE: We intentionally allow "18" here after Week 17 completes so that
        // "last week" cards can still reference Week 17 (currentWeek - 1).
        // We clamp weeks passed to data-fetching cards separately.
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

  // Show loading state while determining which week to display
  if (homePageCurrentWeek === null) {
    return (
      <main className="home-main">
        <LoadingState label="Loading…" ariaLabel="Loading home page" />
      </main>
    );
  }

  // Determine which week to pass to cards
  const effectiveWeekOverride = ALT_HOME_WEEK_OVERRIDE != null 
    ? ALT_HOME_WEEK_OVERRIDE 
    : homePageCurrentWeek;
  const safeWeekForCards = Math.min(17, Number(effectiveWeekOverride) || 1);
  const autoOffSeason =
    Number.isFinite(Number(effectiveWeekOverride)) &&
    Number(effectiveWeekOverride) > 17;
  const isOffSeasonHome =
    ALT_HOME_OFFSEASON_OVERRIDE == null
      ? autoOffSeason
      : !!ALT_HOME_OFFSEASON_OVERRIDE;
  const showWeek1CountdownCard = isOffSeasonHome;

  // Off-season layout: separate "home cards set" once Week 17 is completed.
  if (isOffSeasonHome) {
    return (
      <main className="home-main">
        <div className="home-cards-grid home-cards-grid--single">
          <Week1CountdownCard />
          <CommissionerNoteCard />
          <PodcastCard />
        </div>
      </main>
    );
  }

  // Determine which playoff card to show
  let showPlayoffMatchupsCard = false;
  let showChampionshipCard = false;

  if (effectiveWeekOverride != null) {
    const parsed = Number(effectiveWeekOverride);
    if (Number.isFinite(parsed)) {
      if (parsed >= 17) {
        showChampionshipCard = true;
      } else if (parsed >= WEEK_14) {
        showPlayoffMatchupsCard = true;
      }
    }
  }

  const playoffCard = showChampionshipCard ? (
    <ChampionshipCard currentWeekOverride={safeWeekForCards} />
  ) : showPlayoffMatchupsCard ? (
    <ActivePlayoffsCard currentWeekOverride={safeWeekForCards} />
  ) : (
    <CurrentPlayoffPictureCard currentWeekOverride={safeWeekForCards} />
  );

  const bubbleCard = !showPlayoffMatchupsCard && !showChampionshipCard ? (
    <BubbleCard currentWeekOverride={safeWeekForCards} />
  ) : null;

  if (isMobile) {
    // Mobile ordering:
    // 1) Playoffs (picture, matchups, or championship)
    // 2) Hot Team Alert
    // 3) On the Bubble (if before week 14)
    // 4) Race for the PF
    // 5) Week 14 Top Scores
    // 6) Race for the 1.01
    // 7) Commissioner Note
    // 8) Podcast
    return (
      <main className="home-main">
        <div className="home-cards-grid home-cards-grid--single">
          {showWeek1CountdownCard ? <Week1CountdownCard /> : null}
          {playoffCard}
          <HotTeamCard currentWeekOverride={safeWeekForCards} />
          {bubbleCard}
          <TopPFRaceCard currentWeekOverride={safeWeekForCards} />
          <LastWeeksTopPerformanceCard currentWeekOverride={effectiveWeekOverride} />
          <TankRaceCard currentWeekOverride={safeWeekForCards} />
          <CommissionerNoteCard />
          <PodcastCard />
        </div>
      </main>
    );
  }

  // Web ordering:
  //
  // Left column:
  //  - Playoffs (picture, matchups, or championship)
  //  - Race for the PF
  //  - Race for the 1.01
  //  - Podcast
  //
  // Right column:
  //  - Hot Team Alert
  //  - On the Bubble (if before week 14)
  //  - Week 14 Top Scores
  //  - Commissioner Note

  return (
    <main className="home-main">
      <div className="home-cards-grid">
        {showWeek1CountdownCard ? <Week1CountdownCard /> : null}
        <div className="home-cards-grid--split">
          <div className="home-cards-column home-cards-column--left">
            {playoffCard}
            <TopPFRaceCard currentWeekOverride={safeWeekForCards} />
            <TankRaceCard currentWeekOverride={safeWeekForCards} />
            <PodcastCard />
          </div>
          <div className="home-cards-column home-cards-column--right">
            <HotTeamCard currentWeekOverride={safeWeekForCards} />
            {bubbleCard}
            <LastWeeksTopPerformanceCard currentWeekOverride={effectiveWeekOverride} />
            <CommissionerNoteCard />
          </div>
        </div>
      </div>
    </main>
  );
}

export default HomePage;


