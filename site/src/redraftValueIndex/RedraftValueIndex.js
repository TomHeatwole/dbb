import React from 'react';
import RankingsViewer from '../rankingsViewer/RankingsViewer';
import { REDRAFT_VALUE_INDEX_SOURCE_ID } from '../rankingsViewer/rankingsSources';

function RedraftValueIndex() {
  return <RankingsViewer fixedSourceId={REDRAFT_VALUE_INDEX_SOURCE_ID} />;
}

export default RedraftValueIndex;
