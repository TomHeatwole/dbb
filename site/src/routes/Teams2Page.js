import React from 'react';
import { useParams } from 'react-router-dom';
import Teams2Hub from '../teams/Teams2Hub';
import Teams2Detail from '../teams/Teams2Detail';

function Teams2Page() {
  const { id } = useParams();

  if (id) {
    return <Teams2Detail />;
  }

  return <Teams2Hub />;
}

export default Teams2Page;
