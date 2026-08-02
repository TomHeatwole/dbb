import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import TrendingPlayers from '../players/TrendingPlayers';
import HottestFreeAgents from '../players/HottestFreeAgents';
import DynastyRosterView from '../teams/DynastyRosterView';
import PlayerDBPage from '../playerdb/PlayerDBPage';
import RankingsViewer from '../rankingsViewer/RankingsViewer';
import KtcRankCompare from '../ktcRankCompare/KtcRankCompare';
import HistoricalKtcRanks from '../historicalKtcRanks/HistoricalKtcRanks';
import TradeCalculator from '../tradeCalculator/TradeCalculator';

const FEATURES = [
  {
    id: 'KTC_RANK_COMPARE',
    label: 'KTC Rank Compare',
    description: 'Compare current KTC ranks to historical slot values and rank gaps.',
    component: <KtcRankCompare />,
  },
  {
    id: 'HISTORICAL_KTC_RANKS',
    label: 'Historical KTC Ranks',
    description: 'Compare scraped KTC positional ranks to values at Final KTC and Rookie Draft snapshot dates.',
    component: <HistoricalKtcRanks />,
  },
  {
    id: 'RANKINGS_VIEWER',
    label: 'Rankings Viewer',
    description: 'Browse ADP, KTC, FantasyCalc, FFB, and FantasyPros rankings by year or date.',
    component: <RankingsViewer />,
  },
  {
    id: 'TRADE_CALCULATOR',
    label: 'Trade Calculator',
    description: 'Sandbox trade comparer — pick players on each side and total ranking values.',
    component: <TradeCalculator />,
  },
  {
    id: 'TRENDING_PLAYERS',
    label: 'Trending Players',
    description: 'See which players are trending up or down in dynasty value.',
    component: <TrendingPlayers />,
  },
  {
    id: 'HOTTEST_FREE_AGENTS',
    label: 'Hottest Free Agents',
    description: 'Top available free agents ranked by dynasty value.',
    component: <HottestFreeAgents />,
  },
  {
    id: 'DYNASTY_ROSTER',
    label: 'Dynasty Roster View',
    description: 'Full league roster rankings by dynasty value.',
    component: <DynastyRosterView />,
  },
  {
    id: 'ULTIMATE_PLAYER_DB',
    label: 'Player Database',
    description: 'Browse and filter the full player database.',
    component: <PlayerDBPage />,
  },
];

function SandboxPage() {
  const [activeFeatureId, setActiveFeatureId] = useState(null);

  const activeFeature = FEATURES.find(f => f.id === activeFeatureId);

  if (activeFeature) {
    return (
      <InfoPageWrapper
        title={activeFeature.label}
        subtitle="Sandbox"
        leftHeader={
          <button className="sandbox-back-btn" onClick={() => setActiveFeatureId(null)}>
            ← Back
          </button>
        }
      >
        {activeFeature.component}
      </InfoPageWrapper>
    );
  }

  return (
    <InfoPageWrapper title="Sandbox" subtitle="Experimental Features">
      <div className="sandbox-menu">
        <Link to="/valuesandbox" className="sandbox-feature-card">
          <span className="sandbox-feature-label">Value Sandbox</span>
          <span className="sandbox-feature-desc">Positional value research — HVORP, archetype rosters, and cross-position compares.</span>
        </Link>
        {FEATURES.map(feature => (
          <button
            key={feature.id}
            className="sandbox-feature-card"
            onClick={() => setActiveFeatureId(feature.id)}
          >
            <span className="sandbox-feature-label">{feature.label}</span>
            <span className="sandbox-feature-desc">{feature.description}</span>
          </button>
        ))}
      </div>
    </InfoPageWrapper>
  );
}

export default SandboxPage;
