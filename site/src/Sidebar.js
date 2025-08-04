import React from 'react';
import { Link } from 'react-router-dom';

function Sidebar() {
  return (
    <div className="sidebar">
      <aside className="scroll-sidebar">
        <div className="scroll-top" />
        <div className="scroll-body">
          <nav>
            <ul>
              <li><Link to="/home/">Home</Link></li>
              <li><Link to="/team/1">Team 1</Link></li>
              <li><Link to="/team/2">Team 2</Link></li>
            </ul>
          </nav>
        </div>
        <div className="scroll-bottom" />
      </aside>
    </div>
  );
}

export default Sidebar; 