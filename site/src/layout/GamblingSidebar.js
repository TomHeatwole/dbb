import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { inkNavClass, navIsAnyActive } from './navActive';
import { GAMBLING_NAV, gamblingNavIsHome } from './gamblingNav';

function GamblingSidebarLink({ to, active, children }) {
  return (
    <Link
      to={to}
      className={inkNavClass(active)}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </Link>
  );
}

function GamblingSidebar() {
  const location = useLocation();
  const isHome = gamblingNavIsHome(location.pathname);

  return (
    <div className="sidebar sidebar--gambling">
      <aside className="scroll-sidebar">
        <div className="scroll-top" />
        <div className="scroll-body">
          <nav aria-label="Gambling">
            <ul>
              <li>
                <GamblingSidebarLink to="/home/" active={isHome}>Home</GamblingSidebarLink>
              </li>
              {GAMBLING_NAV.map((item) => (
                <li key={item.to}>
                  <GamblingSidebarLink
                    to={item.to}
                    active={navIsAnyActive(location.pathname, item.match)}
                  >
                    {item.label}
                  </GamblingSidebarLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="scroll-bottom" />
      </aside>
    </div>
  );
}

export default GamblingSidebar;
