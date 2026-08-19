function normalizeNavPath(pathname) {
  if (!pathname) return '/';
  return String(pathname).replace(/\/+$/, '').toLowerCase() || '/';
}

/**
 * True when the current path is this nav target, or a nested page under it.
 * Team ids use exact: `/team/1` must not match `/team/10`.
 */
export function navIsActive(pathname, target, { exact = false } = {}) {
  const path = normalizeNavPath(pathname);
  const dest = normalizeNavPath(target);
  if (exact) return path === dest;
  return path === dest || path.startsWith(`${dest}/`);
}

export function navIsAnyActive(pathname, targets) {
  return targets.some((target) => {
    if (typeof target === 'string') return navIsActive(pathname, target);
    return navIsActive(pathname, target.to, { exact: Boolean(target.exact) });
  });
}

export const NAV_MATCH = {
  home: ['/home', '/althome', '/oldhome'],
  scores: ['/scores'],
  standings: ['/standings'],
  h2h: ['/h2h'],
  playoffs: ['/yoffs'],
  history: ['/league-history'],
  hwangai: ['/hwangai'],
  teamsHub: [{ to: '/teams', exact: true }],
  teamsAny: ['/teams', '/team'],
};

export function inkNavClass(active, extra = '') {
  return [extra, 'nav-ink', active ? 'is-active' : '']
    .filter(Boolean)
    .join(' ');
}
