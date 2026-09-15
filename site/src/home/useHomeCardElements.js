import React, { useMemo } from 'react';
import ActivePlayoffsCard from './ActivePlayoffsCard';
import ChampionshipCard from './ChampionshipCard';
import CurrentPlayoffPictureCard from './CurrentPlayoffPictureCard';
import BubbleCard from './BubbleCard';
import HotTeamCard from './HotTeamCard';
import TankRaceCard from './TankRaceCard';
import TopPFRaceCard from './TopPFRaceCard';
import LastWeeksTopPerformanceCard from './LastWeeksTopPerformanceCard';
import ThisWeeksProjectionsCard from './ThisWeeksProjectionsCard';
import AuthHomeCard from './AuthHomeCard';
import PreviousYearRecapCard from './PreviousYearRecapCard';
import RecentTradesCard from './RecentTradesCard';
import RecentWaiversCard from './RecentWaiversCard';
import RookieDraftCard from './RookieDraftCard';
import RookieDraftRecapCard from './RookieDraftRecapCard';
import TrendingFreeAgentsCard from './TrendingFreeAgentsCard';
import HwangAICard from './HwangAICard';
import LeagueHistoryCard from './LeagueHistoryCard';

/**
 * Memoized home card elements so HomePage re-renders (week refine, draft flag, etc.)
 * don't recreate JSX for every card and force full subtree reconciliation.
 */
export function useHomeCardElements({
  safeWeekForCards,
  effectiveWeekOverride,
  rookieDraftComplete,
  showThisWeekCard,
  showTrendCards,
  showPlayoffMatchupsCard,
  showChampionshipCard,
}) {
  const auth = useMemo(() => <AuthHomeCard />, []);
  const thisWeek = useMemo(
    () => <ThisWeeksProjectionsCard currentWeekOverride={safeWeekForCards} />,
    [safeWeekForCards]
  );
  const trades = useMemo(() => <RecentTradesCard />, []);
  const waivers = useMemo(() => <RecentWaiversCard />, []);
  const trending = useMemo(() => <TrendingFreeAgentsCard />, []);
  const recap = useMemo(() => <PreviousYearRecapCard />, []);
  const rookieDraft = useMemo(
    () => (rookieDraftComplete ? <RookieDraftRecapCard /> : <RookieDraftCard />),
    [rookieDraftComplete]
  );
  const leagueHistory = useMemo(() => <LeagueHistoryCard />, []);
  const hwangAi = useMemo(() => <HwangAICard />, []);
  const hotTeam = useMemo(
    () => <HotTeamCard currentWeekOverride={safeWeekForCards} />,
    [safeWeekForCards]
  );
  const lastWeek = useMemo(
    () => <LastWeeksTopPerformanceCard currentWeekOverride={effectiveWeekOverride} />,
    [effectiveWeekOverride]
  );
  const topPf = useMemo(
    () => <TopPFRaceCard currentWeekOverride={safeWeekForCards} />,
    [safeWeekForCards]
  );
  const tankRace = useMemo(
    () => <TankRaceCard currentWeekOverride={safeWeekForCards} />,
    [safeWeekForCards]
  );
  const bubble = useMemo(
    () => <BubbleCard currentWeekOverride={safeWeekForCards} />,
    [safeWeekForCards]
  );

  const playoff = useMemo(() => {
    if (showChampionshipCard) {
      return <ChampionshipCard currentWeekOverride={safeWeekForCards} />;
    }
    if (showPlayoffMatchupsCard) {
      return <ActivePlayoffsCard currentWeekOverride={safeWeekForCards} />;
    }
    return <CurrentPlayoffPictureCard currentWeekOverride={safeWeekForCards} />;
  }, [showChampionshipCard, showPlayoffMatchupsCard, safeWeekForCards]);

  const offSeasonDesktopSplit = useMemo(() => ({
    left: [
      { id: 'auth', node: auth },
      ...(showThisWeekCard ? [{ id: 'this-week', node: thisWeek }] : []),
      { id: 'trades', node: trades },
      { id: 'waivers', node: waivers },
      { id: 'trending', node: trending },
    ],
    right: [
      { id: 'recap', node: recap },
      { id: 'rookie-draft', node: rookieDraft },
      { id: 'league-history', node: leagueHistory },
      { id: 'hwang-ai', node: hwangAi },
    ],
  }), [
    auth, thisWeek, trades, waivers, trending, recap, rookieDraft, leagueHistory, hwangAi,
    showThisWeekCard,
  ]);

  const inSeasonDesktopSplit = useMemo(() => ({
    left: [
      { id: 'auth', node: auth },
      { id: 'playoffs', node: playoff },
      ...(showTrendCards ? [{ id: 'top-pf', node: topPf }] : []),
      ...(showTrendCards ? [{ id: 'tank', node: tankRace }] : []),
    ],
    right: [
      { id: 'hot-team', node: hotTeam },
      ...(showThisWeekCard ? [{ id: 'this-week', node: thisWeek }] : []),
      ...(showTrendCards && !showPlayoffMatchupsCard && !showChampionshipCard
        ? [{ id: 'bubble', node: bubble }]
        : []),
      { id: 'last-week', node: lastWeek },
      { id: 'league-history', node: leagueHistory },
      { id: 'hwang-ai', node: hwangAi },
    ],
  }), [
    auth, playoff, topPf, tankRace, hotTeam, thisWeek, bubble, lastWeek, leagueHistory, hwangAi,
    showThisWeekCard, showTrendCards, showPlayoffMatchupsCard, showChampionshipCard,
  ]);

  return {
    auth,
    thisWeek,
    trades,
    waivers,
    trending,
    recap,
    rookieDraft,
    leagueHistory,
    hwangAi,
    hotTeam,
    lastWeek,
    topPf,
    tankRace,
    bubble,
    playoff,
    offSeasonDesktopSplit,
    inSeasonDesktopSplit,
  };
}
