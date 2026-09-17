import React, { useMemo } from 'react';
import { HOME_FIELD_DRAGON_MODE } from '../utils/global_constants';
import HomePageLoadingFieldCorners from './HomePageLoadingFieldCorners';
import HomePageLoadingFieldChase from './HomePageLoadingFieldChase';
import HomePageLoadingFieldTd from './HomePageLoadingFieldTd';
import HomePageLoadingFieldDynasty from './HomePageLoadingFieldDynasty';
import HomePageLoadingFieldFootball from './HomePageLoadingFieldFootball';

const HOME_DYNASTY_CHANCE = 0.1;
const HOME_TD_CHANCE = 0.2;
const HOME_FOOTBALL_CHANCE = 0.2;

function pickFieldMode() {
  if (HOME_FIELD_DRAGON_MODE === 'chase') return 'chase';
  const r = Math.random();
  if (r < HOME_DYNASTY_CHANCE) return 'dynasty';
  if (r < HOME_DYNASTY_CHANCE + HOME_TD_CHANCE) return 'td';
  if (r < HOME_DYNASTY_CHANCE + HOME_TD_CHANCE + HOME_FOOTBALL_CHANCE) return 'football';
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
  if (mode === 'dynasty') {
    return <HomePageLoadingFieldDynasty exiting={exiting} progress={progress} />;
  }
  if (mode === 'football') {
    return <HomePageLoadingFieldFootball exiting={exiting} />;
  }
  return <HomePageLoadingFieldCorners exiting={exiting} />;
}

export default HomePageLoadingField;
