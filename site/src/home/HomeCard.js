import React from 'react';

function HomeCard(props) {
  const { children, className } = props;

  const rootClassName = ['home-card', className].filter(Boolean).join(' ');

  return (
    <div className={rootClassName}>
      {children}
    </div>
  );
}

export default HomeCard;


