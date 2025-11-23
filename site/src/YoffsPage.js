import React, { useEffect } from 'react';
import InfoPageWrapper from './InfoPageWrapper';
import { trackPageLoad } from './UsageTracker';

function YoffsPage() {
  useEffect(() => {
    trackPageLoad();
  }, []);

  return (
    <InfoPageWrapper title="Yoffs" subtitle={null}>
      <div>HELLO WORLD</div>
    </InfoPageWrapper>
  );
}

export default YoffsPage;


