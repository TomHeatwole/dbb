import { navIsAnyActive, NAV_MATCH } from './navActive';

export const GAMBLING_NAV = [
  { to: '/corners', label: 'Corners', match: ['/corners'] },
  { to: '/drives', label: 'Drives', match: ['/drives'] },
  { to: '/SOP2', label: 'SOP2', match: ['/sop2'] },
  { to: '/rawarb', label: 'Raw Arb', match: ['/rawarb'] },
];

export function isGamblingRoute(pathname) {
  return navIsAnyActive(pathname, [
    ...GAMBLING_NAV.flatMap((item) => item.match),
  ]);
}

export function gamblingNavIsHome(pathname) {
  return navIsAnyActive(pathname, NAV_MATCH.home);
}
