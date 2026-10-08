import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { inkNavClass, navIsAnyActive } from './navActive';
import { GAMBLING_NAV, gamblingNavIsHome } from './gamblingNav';

function GamblingMobileNavLink({ to, active, children }) {
  return (
    <Link
      to={to}
      className={inkNavClass(active, 'mobile-top-home-card-link')}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </Link>
  );
}

function GamblingMobileNav() {
  const { pathname } = useLocation();

  return (
    <div className="mobile-top-home-card-wrapper">
      <nav className="mobile-top-home-card" aria-label="Gambling navigation">
        <div className="mobile-top-home-card-links">
          <GamblingMobileNavLink to="/home/" active={gamblingNavIsHome(pathname)}>
            Home
          </GamblingMobileNavLink>
          {GAMBLING_NAV.map((item) => (
            <GamblingMobileNavLink
              key={item.to}
              to={item.to}
              active={navIsAnyActive(pathname, item.match)}
            >
              {item.label}
            </GamblingMobileNavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

export default GamblingMobileNav;
