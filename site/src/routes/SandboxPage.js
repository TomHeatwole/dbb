import React, { useState } from 'react';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import PlayerSearch from '../players/PlayerSearch';
import TrendingPlayers from '../players/TrendingPlayers';
import HottestFreeAgents from '../players/HottestFreeAgents';
import YoffsPage from './YoffsPage';
import H2hPage from './h2h';
import DynastyRosterView from '../teams/DynastyRosterView';
import PlayerDBPage from '../playerdb/PlayerDBPage';
import RankingsViewer from '../rankingsViewer/RankingsViewer';
import KtcRankCompare from '../ktcRankCompare/KtcRankCompare';
import RedraftValueIndex from '../redraftValueIndex/RedraftValueIndex';

const FEATURES = [
  {
    id: 'KTC_RANK_COMPARE',
    label: 'KTC Rank Compare',
    description: 'Compare current KTC ranks to historical slot values and rank gaps.',
    component: <KtcRankCompare />,
  },
  {
    id: 'REDRAFT_VALUE_INDEX',
    label: 'Redraft Value Index',
    description: 'KTC dynasty values adjusted for best-ball redraft ADP — competitor adjusted value and index multiplier.',
    component: <RedraftValueIndex />,
  },
  {
    id: 'RANKINGS_VIEWER',
    label: 'Rankings Viewer',
    description: 'Browse ADP, KTC, FantasyCalc, FFB, and FantasyPros rankings by year or date.',
    component: <RankingsViewer />,
  },
  {
    id: 'PLAYER_SEARCH',
    label: 'Player Search',
    description: 'Search and explore player stats and dynasty values.',
    component: <PlayerSearch />,
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
    id: 'PLAYOFFS',
    label: 'Playoffs',
    description: 'Playoff bracket and matchup viewer.',
    component: <YoffsPage inSandbox={true} />,
  },
  {
    id: 'HEAD_TO_HEAD',
    label: 'Head to Head',
    description: 'Compare two teams head to head.',
    component: <H2hPage inSandbox={true} />,
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
