import React, { useMemo } from 'react';
import { HOME_FIELD_DRAGON_MODE } from '../utils/global_constants';
import HomePageLoadingFieldCorners from './HomePageLoadingFieldCorners';
import HomePageLoadingFieldChase from './HomePageLoadingFieldChase';
import HomePageLoadingFieldTd from './HomePageLoadingFieldTd';

const HOME_TD_CHANCE = 0.2;

function pickFieldMode() {
  if (HOME_FIELD_DRAGON_MODE === 'chase') return 'chase';
  if (Math.random() < HOME_TD_CHANCE) return 'td';
  return 'corners';
}

function HomePageLoadingField({ exiting = false, progress = 0 }) {
  const mode = useMemo(() => pickFieldMode(), []);

  if (mode === 'chase') {
    return <HomePageLoadingFieldChase exiting={exiting} />;
  }
  if (mode === 'td') {
    return <HomePageLoadingFieldTd exiting={exiting} progress={progress} />;
  }
  return <HomePageLoadingFieldCorners exiting={exiting} />;
}

export default HomePageLoadingField;
