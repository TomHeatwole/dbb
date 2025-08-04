import React from 'react';
import { useParams } from 'react-router-dom';

function TeamPage() {
  const { id } = useParams();
  return <h1>Hello, team ID: {id}</h1>;
}

export default TeamPage; 