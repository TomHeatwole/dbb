import React from 'react';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import PlayerSearch from '../players/PlayerSearch';

const INCLUDE_PLAYER_SEARCH = false;

function ScenariosPage() {
  return (
    <InfoPageWrapper title="Scenarios" subtitle={null}>
      {INCLUDE_PLAYER_SEARCH && <PlayerSearch />}
      
      {!INCLUDE_PLAYER_SEARCH && (
        <div style={{ padding: '20px' }}>
          <p>Scenarios page - coming soon</p>
        </div>
      )}
    </InfoPageWrapper>
  );
}

export default ScenariosPage;
