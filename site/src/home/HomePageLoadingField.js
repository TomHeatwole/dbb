import React from 'react';
import { HOME_FIELD_DRAGON_MODE } from '../utils/global_constants';
import HomePageLoadingFieldCorners from './HomePageLoadingFieldCorners';
import HomePageLoadingFieldChase from './HomePageLoadingFieldChase';

function HomePageLoadingField(props) {
  if (HOME_FIELD_DRAGON_MODE === 'corners') {
    return <HomePageLoadingFieldCorners {...props} />;
  }
  return <HomePageLoadingFieldChase {...props} />;
}

export default HomePageLoadingField;
