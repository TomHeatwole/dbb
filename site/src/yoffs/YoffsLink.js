import React from 'react';
import { Link } from 'react-router-dom';

function YoffsLink() {
  return (
    <div className="yoffs-link-wrapper">
      <Link to="/yoffs" className="yoffs-link-button">
        Go To The Playoffs --
        &gt;
      </Link>
    </div>
  );
}

export default YoffsLink;


