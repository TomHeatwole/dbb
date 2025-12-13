import React from 'react';

function HomeCard(props) {
  const { children } = props;

  return (
    <div className="home-card">
      {children}
    </div>
  );
}

export default HomeCard;


