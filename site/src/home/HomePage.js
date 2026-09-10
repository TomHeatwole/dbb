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
import AuthHomeCard from './AuthHomeCard';
import PreviousYearRecapCard from './PreviousYearRecapCard';
import RecentTradesCard from './RecentTradesCard';
import RecentWaiversCard from './RecentWaiversCard';
import RookieDraftCard from './RookieDraftCard';
import RookieDraftRecapCard from './RookieDraftRecapCard';
import IosShortcutNoticeCard from './IosShortcutNoticeCard';
import TrendingFreeAgentsCard from './TrendingFreeAgentsCard';
import HwangAICard from './HwangAICard';
import LeagueHistoryCard from './LeagueHistoryCard';
import LoadingState from '../LoadingState';
import useIsMobile from '../hooks/useIsMobile';
import useIsIos from '../hooks/useIsIos';
import useIsPwa from '../hooks/useIsPwa';
import { getCurrentNFLWeek, isCurrentWeekCompleted, isPreSeason, hasSeasonStarted, getWeek1KickoffMs } from '../utils/DateHelper';
import { HOME_OFFSEASON_OVERRIDE } from '../utils/global_constants';
import { fetchRookieDraftComplete } from '../lookups/TeamLookup';
import './Home.css';

function HomePage() {
  const isMobile = useIsMobile();
  const isIos = useIsIos();
  const isPwa = useIsPwa();
  const WEEK_14 = 14;

  // Home page specific logic: as soon as a week is completed, advance to the next week
  const [homePageCurrentWeek, setHomePageCurrentWeek] = useState(null);
  const [rookieDraftComplete, setRookieDraftComplete] = useState(false);
  const [kickoffTick, setKickoffTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function computeHomeWeek() {
      try {
        const [weekCompleted, draftComplete] = await Promise.all([
          isCurrentWeekCompleted(),
          fetchRookieDraftComplete(),
        ]);

        const baseWeek = getCurrentNFLWeek();
        
        // If the current week is completed, advance to the next week for home page display
        // NOTE: We intentionally allow "18" here after Week 17 completes so that
        // "last week" cards can still reference Week 17 (currentWeek - 1).
        // We clamp weeks passed to data-fetching cards separately.
        const effectiveWeek = weekCompleted ? baseWeek + 1 : baseWeek;
        
        if (!cancelled) {
          setHomePageCurrentWeek(effectiveWeek);
          setRookieDraftComplete(draftComplete);
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

  // Drop the countdown at kickoff if this tab stays open. Week 1 still uses
  // the off-season card set until that week is completed.
  useEffect(() => {
    if (hasSeasonStarted()) return undefined;
    const kickoffMs = getWeek1KickoffMs();
    if (!Number.isFinite(kickoffMs)) return undefined;
    const id = setTimeout(() => setKickoffTick((n) => n + 1), Math.max(0, kickoffMs - Date.now()));
    return () => clearTimeout(id);
  }, [kickoffTick]);

  // Show loading state while determining which week to display
  if (homePageCurrentWeek === null) {
    return (
      <main className="home-main home-dashboard">
        <LoadingState label="Loading…" ariaLabel="Loading home page" />
      </main>
    );
  }

  // Week comes from DateHelper (SEASON_START_DAY / CURRENT_WEEK_OVERRIDE in global_constants)
  const effectiveWeekOverride = homePageCurrentWeek;
  const safeWeekForCards = Math.min(17, Number(effectiveWeekOverride) || 1);
  const weekNum = Number(effectiveWeekOverride);
  const week1InProgress =
    hasSeasonStarted() &&
    Number.isFinite(weekNum) &&
    weekNum <= 1;
  // Off-season cards: before kickoff, through Week 1 (no standings data yet),
  // or after Week 17 completes.
  const autoOffSeason =
    isPreSeason() ||
    week1InProgress ||
    (Number.isFinite(weekNum) && weekNum > 17);
  const isOffSeasonHome =
    HOME_OFFSEASON_OVERRIDE == null
      ? autoOffSeason
      : !!HOME_OFFSEASON_OVERRIDE;
  const showWeek1CountdownCard = isOffSeasonHome && !week1InProgress;

  // Off-season layout: separate "home cards set" once Week 17 is completed.
  if (isOffSeasonHome) {
    if (isMobile) {
      return (
        <main className="home-main home-dashboard">
          <div className="home-cards-grid home-cards-grid--single">
            {!isPwa && isIos ? <IosShortcutNoticeCard /> : null}
            {showWeek1CountdownCard ? <Week1CountdownCard /> : null}
            <AuthHomeCard />
            <PreviousYearRecapCard />
            <RecentTradesCard />
            <RecentWaiversCard />
            {rookieDraftComplete ? <RookieDraftRecapCard /> : <RookieDraftCard />}
            <LeagueHistoryCard />
            <TrendingFreeAgentsCard />
            <HwangAICard />
            <CommissionerNoteCard />
            <PodcastCard />
          </div>
        </main>
      );
    }

    // Desktop: keep the split-column layout. Put the countdown full-width on top,
    // then render the remaining cards side-by-side.
    return (
      <main className="home-main home-dashboard">
        <div className="home-cards-grid">
          {showWeek1CountdownCard ? <Week1CountdownCard /> : null}
          <div className="home-cards-grid--split">
            <div className="home-cards-column home-cards-column--left">
              <AuthHomeCard />
              <RecentTradesCard />
              <RecentWaiversCard />
              <TrendingFreeAgentsCard />
              <PodcastCard />
            </div>
            <div className="home-cards-column home-cards-column--right">
              <PreviousYearRecapCard />
              {rookieDraftComplete ? <RookieDraftRecapCard /> : <RookieDraftCard />}
              <LeagueHistoryCard />
              <HwangAICard />
              <CommissionerNoteCard />
            </div>
          </div>
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
      <main className="home-main home-dashboard">
        <div className="home-cards-grid home-cards-grid--single">
          {showWeek1CountdownCard ? <Week1CountdownCard /> : null}
          <AuthHomeCard />
          {!isPwa && isIos ? <IosShortcutNoticeCard /> : null}
          {playoffCard}
          <HotTeamCard currentWeekOverride={safeWeekForCards} />
          {bubbleCard}
          <TopPFRaceCard currentWeekOverride={safeWeekForCards} />
          <LastWeeksTopPerformanceCard currentWeekOverride={effectiveWeekOverride} />
          <TankRaceCard currentWeekOverride={safeWeekForCards} />
          <LeagueHistoryCard />
          <HwangAICard />
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
  //  - HwangAI
  //  - Commissioner Note

  return (
    <main className="home-main home-dashboard">
      <div className="home-cards-grid">
        {showWeek1CountdownCard ? <Week1CountdownCard /> : null}
        <div className="home-cards-grid--split">
          <div className="home-cards-column home-cards-column--left">
            <AuthHomeCard />
            {playoffCard}
            <TopPFRaceCard currentWeekOverride={safeWeekForCards} />
            <TankRaceCard currentWeekOverride={safeWeekForCards} />
            <PodcastCard />
          </div>
          <div className="home-cards-column home-cards-column--right">
            <HotTeamCard currentWeekOverride={safeWeekForCards} />
            {bubbleCard}
            <LastWeeksTopPerformanceCard currentWeekOverride={effectiveWeekOverride} />
            <LeagueHistoryCard />
            <HwangAICard />
            <CommissionerNoteCard />
          </div>
        </div>
      </div>
    </main>
  );
}

export default HomePage;
