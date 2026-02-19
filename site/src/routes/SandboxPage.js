import React from 'react';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import PlayerSearch from '../players/PlayerSearch';
import TrendingPlayers from '../players/TrendingPlayers';
import HottestFreeAgents from '../players/HottestFreeAgents';
import YoffsPage from './YoffsPage';
import H2hPage from './h2h';
import DynastyRosterView from '../teams/DynastyRosterView';
import { SANDBOX_FEATURES, isFeatureEnabled, hasAnyFeaturesEnabled } from '../utils/featureToggles';

function SandboxPage() {
  return (
    <InfoPageWrapper title="Sandbox" subtitle="Experimental Features">
      <div style={{ padding: '20px' }}>
        {isFeatureEnabled('PLAYER_SEARCH', SANDBOX_FEATURES) && (
          <div style={{ marginBottom: '2rem' }}>
            <PlayerSearch />
          </div>
        )}
        
        {isFeatureEnabled('TRENDING_PLAYERS', SANDBOX_FEATURES) && (
          <div style={{ marginBottom: '2rem' }}>
            <TrendingPlayers />
          </div>
        )}
        
        {isFeatureEnabled('HOTTEST_FREE_AGENTS', SANDBOX_FEATURES) && (
          <div style={{ marginBottom: '2rem' }}>
            <HottestFreeAgents />
          </div>
        )}
        
        {isFeatureEnabled('PLAYOFFS', SANDBOX_FEATURES) && (
          <div style={{ marginBottom: '2rem' }}>
            <YoffsPage inSandbox={true} />
          </div>
        )}
        
        {isFeatureEnabled('HEAD_TO_HEAD', SANDBOX_FEATURES) && (
          <div style={{ marginBottom: '2rem' }}>
            <H2hPage inSandbox={true} />
          </div>
        )}

        {isFeatureEnabled('DYNASTY_ROSTER', SANDBOX_FEATURES) && (
          <div style={{ marginBottom: '2rem' }}>
            <DynastyRosterView />
          </div>
        )}

        {!hasAnyFeaturesEnabled(SANDBOX_FEATURES) && (
          <p style={{ textAlign: 'center', color: '#999' }}>
            No features enabled. Update SANDBOX_FEATURES in utils/featureToggles.js to show content.
          </p>
        )}
      </div>
    </InfoPageWrapper>
  );
}

export default SandboxPage;
