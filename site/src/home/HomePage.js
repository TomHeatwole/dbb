import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import PodcastCard from './PodcastCard';
import CommissionerNoteCard from './CommissionerNoteCard';
import HomeCardsSplit from './HomeCardsSplit';
import HomePageLoading from './HomePageLoading';
import { useHomePageSplash } from './useHomePageSplash';
import Week1CountdownCard from './Week1CountdownCard';
import IosShortcutNoticeCard from './IosShortcutNoticeCard';
import { useHomeCardElements } from './useHomeCardElements';
import useIsMobile from '../hooks/useIsMobile';
import useIsIos from '../hooks/useIsIos';
import useIsPwa from '../hooks/useIsPwa';
import { CURRENT_YEAR, getCurrentNFLWeek, getCompletedWeeksCount, isPreSeason, hasSeasonStarted, getWeek1KickoffMs } from '../utils/DateHelper';
import { HOME_OFFSEASON_OVERRIDE } from '../utils/global_constants';
import { fetchRookieDraftComplete } from '../lookups/TeamLookup';
import { fetchNflScoreboard } from '../lookups/GamesLookup';
import { isScoreboardWeekComplete } from '../scores/GamesParser';
import './Home.css';

function homeSplitKey(split) {
  return `${split.left.map((card) => card.id).join(',')}|${split.right.map((card) => card.id).join(',')}`;
}

function HomePage() {
  const isMobile = useIsMobile();
  const isIos = useIsIos();
  const isPwa = useIsPwa();
  const WEEK_14 = 14;

  // Start with the calendar week so cards mount immediately with their own spinners.
  // Refine asynchronously once scoreboard + draft status are known.
  const [homePageCurrentWeek, setHomePageCurrentWeek] = useState(() => getCurrentNFLWeek());
  const [rookieDraftComplete, setRookieDraftComplete] = useState(false);
  const [kickoffTick, setKickoffTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function computeHomeWeek() {
      try {
        const baseWeek = getCurrentNFLWeek();
        const [scoreboard, draftComplete] = await Promise.all([
          fetchNflScoreboard(CURRENT_YEAR, baseWeek).catch(() => null),
          fetchRookieDraftComplete(),
        ]);
        // Flip to next week only after the last NFL game on this week's board is final.
        const weekCompleted = Boolean(scoreboard && isScoreboardWeekComplete(scoreboard));

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
  const showThisWeekCard = Number.isFinite(weekNum) && weekNum >= 1 && weekNum <= 17;
  const showTrendCards = getCompletedWeeksCount() >= 2;

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

  const cards = useHomeCardElements({
    safeWeekForCards,
    effectiveWeekOverride,
    rookieDraftComplete,
    showThisWeekCard,
    showTrendCards,
    showPlayoffMatchupsCard,
    showChampionshipCard,
  });

  const gridRef = useRef(null);
  const [splitLayoutReady, setSplitLayoutReady] = useState(isMobile);
  const desktopSplit = isOffSeasonHome
    ? cards.offSeasonDesktopSplit
    : cards.inSeasonDesktopSplit;
  const splashResetKey = useMemo(() => homeSplitKey(desktopSplit), [desktopSplit]);
  const onSplitLayoutReady = useCallback(() => setSplitLayoutReady(true), []);

  useEffect(() => {
    if (!isMobile) setSplitLayoutReady(false);
  }, [splashResetKey, isMobile]);

  const { showLoader, exiting, progress } = useHomePageSplash({
    enabled: true,
    resetKey: splashResetKey,
    layoutReady: isMobile || splitLayoutReady,
    gridRef,
  });

  // Off-season layout: separate "home cards set" once Week 17 is completed.
  if (isOffSeasonHome) {
    if (isMobile) {
      return (
        <main className="home-main home-dashboard">
          {showLoader ? <HomePageLoading exiting={exiting} progress={progress} /> : null}
          <div ref={gridRef} className="home-cards-grid home-cards-grid--single">
            {!isPwa && isIos ? <IosShortcutNoticeCard /> : null}
            {showWeek1CountdownCard ? <Week1CountdownCard /> : null}
            {cards.auth}
            {showThisWeekCard ? cards.thisWeek : null}
            {cards.recap}
            {cards.trades}
            {cards.waivers}
            {cards.rookieDraft}
            {cards.leagueHistory}
            {cards.trending}
            {cards.hwangAi}
            <CommissionerNoteCard />
            <PodcastCard />
          </div>
        </main>
      );
    }

    // Desktop: keep the split-column layout. Put the countdown full-width on top,
    // then render the remaining cards side-by-side. Podcast / commissioner note
    // stay pinned at the bottom; taller tails rebalance one card above them.
    return (
      <main className="home-main home-dashboard">
        {showLoader ? <HomePageLoading exiting={exiting} progress={progress} /> : null}
        <div ref={gridRef} className="home-cards-grid">
          {showWeek1CountdownCard ? <Week1CountdownCard /> : null}
          <HomeCardsSplit
            left={cards.offSeasonDesktopSplit.left}
            right={cards.offSeasonDesktopSplit.right}
            pinnedTopLeft={cards.auth}
            onLayoutReady={onSplitLayoutReady}
          />
        </div>
      </main>
    );
  }

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
        {showLoader ? <HomePageLoading exiting={exiting} progress={progress} /> : null}
        <div ref={gridRef} className="home-cards-grid home-cards-grid--single">
          {showWeek1CountdownCard ? <Week1CountdownCard /> : null}
          {cards.auth}
          {!isPwa && isIos ? <IosShortcutNoticeCard /> : null}
          {cards.playoff}
          {cards.hotTeam}
          {showThisWeekCard ? cards.thisWeek : null}
          {showTrendCards && !showPlayoffMatchupsCard && !showChampionshipCard ? cards.bubble : null}
          {showTrendCards ? cards.topPf : null}
          {cards.lastWeek}
          {showTrendCards ? cards.tankRace : null}
          {cards.leagueHistory}
          {cards.hwangAi}
          <CommissionerNoteCard />
          <PodcastCard />
        </div>
      </main>
    );
  }

  // Web ordering starts with this preferred split. Podcast and the
  // commissioner note stay pinned at the bottom; unpinned cards move across
  // columns when that reduces the height gap.

  return (
    <main className="home-main home-dashboard">
      {showLoader ? <HomePageLoading exiting={exiting} progress={progress} /> : null}
      <div ref={gridRef} className="home-cards-grid">
        {showWeek1CountdownCard ? <Week1CountdownCard /> : null}
        <HomeCardsSplit
          left={cards.inSeasonDesktopSplit.left}
          right={cards.inSeasonDesktopSplit.right}
          pinnedTopLeft={cards.auth}
          onLayoutReady={onSplitLayoutReady}
        />
      </div>
    </main>
  );
}

export default HomePage;
