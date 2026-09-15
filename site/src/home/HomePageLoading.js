import React from 'react';
import { HOME_LOADING_VARIANT } from '../utils/global_constants';
import HomePageLoadingField from './HomePageLoadingField';
import HomePageLoadingStadium from './HomePageLoadingStadium';

function HomePageLoading({ exiting = false, progress = 0 }) {
  if (HOME_LOADING_VARIANT === 'field') {
    return <HomePageLoadingField exiting={exiting} progress={progress} />;
  }

  return <HomePageLoadingStadium exiting={exiting} progress={progress} />;
}

export default HomePageLoading;
