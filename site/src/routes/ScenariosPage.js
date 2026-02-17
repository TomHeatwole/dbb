import React from 'react';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import PlayerSearch from '../players/PlayerSearch';

function ScenariosPage() {
  return (
    <InfoPageWrapper title="Player Search" subtitle="Search for any player or browse trending adds">
      <PlayerSearch />
    </InfoPageWrapper>
  );
}

export default ScenariosPage;
