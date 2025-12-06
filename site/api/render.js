// Vercel serverless API route to render the main HTML shell with
// per-route OG meta tags. This replaces placeholders in ssr-index.html
// and supports a dynamic /h2h title of "<Team A> vs <Team B>" based on
// query params a= and b=.

const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const routeMeta = require('../routeMeta.json');
const { CURRENT_YEAR, LEAGUE_ID, PREVIOUS_YEARS } = require('../serverConstants');

let cachedTemplate = null;

function loadTemplate() {
  if (cachedTemplate != null) {
    return cachedTemplate;
  }
  const templatePath = path.join(__dirname, '..', 'ssr-index.html');
  try {
    const html = fs.readFileSync(templatePath, 'utf8');
    cachedTemplate = html;
    return html;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to read ssr-index.html:', e.message);
    cachedTemplate = '';
    return cachedTemplate;
  }
}

function getMetaForPath(urlPath) {
  if (!routeMeta || typeof routeMeta !== 'object') {
    return {
      ogTitle: 'The Hwang Dynasty',
      ogDescription: '',
      ogImage: '/logo.png'
    };
  }

  if (Object.prototype.hasOwnProperty.call(routeMeta, urlPath)) {
    return routeMeta[urlPath];
  }

  const prefixKeys = Object.keys(routeMeta).filter(
    (key) => key !== '*' && key.endsWith('/')
  );
  for (let i = 0; i < prefixKeys.length; i += 1) {
    const key = prefixKeys[i];
    if (urlPath.startsWith(key)) {
      return routeMeta[key];
    }
  }

  if (Object.prototype.hasOwnProperty.call(routeMeta, '*')) {
    return routeMeta['*'];
  }

  return {
    ogTitle: 'The Hwang Dynasty',
    ogDescription: '',
    ogImage: '/logo.png'
  };
}

async function fetchServerTeamData(season) {
  const normalized = String(season || CURRENT_YEAR);
  const isCurrent = normalized === String(CURRENT_YEAR);
  const leagueId = isCurrent ? LEAGUE_ID : PREVIOUS_YEARS[normalized];

  if (!leagueId) {
    throw new Error(`No league id found for season ${normalized}`);
  }

  const [rostersRes, usersRes] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
    fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`)
  ]);

  if (!rostersRes.ok || !usersRes.ok) {
    throw new Error('Failed to fetch team data from Sleeper');
  }

  const rosters = await rostersRes.json();
  const users = await usersRes.json();
  return { rosters, users };
}

function buildRosterIdToTeamNameMap(rosters, users) {
  const map = {};
  if (!Array.isArray(rosters) || !Array.isArray(users)) {
    return map;
  }

  rosters.forEach((roster) => {
    if (!roster || roster.roster_id == null) {
      return;
    }
    const ridNum = Number(roster.roster_id);
    const ridKey = Number.isFinite(ridNum) ? ridNum : roster.roster_id;
    const ownerIdStr = roster.owner_id != null ? String(roster.owner_id) : null;
    const user = users.find((u) => {
      if (!u) {
        return false;
      }
      if (ownerIdStr && String(u.user_id) === ownerIdStr) {
        return true;
      }
      if (u.roster_id != null && Number(u.roster_id) === ridNum) {
        return true;
      }
      return false;
    }) || null;

    const ownerName = user && user.display_name ? user.display_name : null;
    let teamName;
    if (user && user.metadata && user.metadata.team_name) {
      teamName = user.metadata.team_name;
    } else if (ownerName) {
      teamName = `Team ${ownerName}`;
    } else {
      teamName = `Team ${ridKey}`;
    }

    map[String(ridKey)] = teamName;
  });

  return map;
}

const teamNameCache = new Map(); // season -> { [rosterId]: teamName }

async function getTeamNameMap(season) {
  const key = String(season || CURRENT_YEAR);
  if (teamNameCache.has(key)) {
    return teamNameCache.get(key);
  }
  const { rosters, users } = await fetchServerTeamData(key);
  const map = buildRosterIdToTeamNameMap(rosters, users);
  teamNameCache.set(key, map);
  return map;
}

async function getDynamicMetaForRequest(pathname, searchParams) {
  if (pathname !== '/h2h') {
    return {};
  }

  const aParam = searchParams.get('a');
  const bParam = searchParams.get('b');
  if (!aParam || !bParam) {
    return {};
  }

  const a = Number(aParam);
  const b = Number(bParam);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return {};
  }

  const yearParam = searchParams.get('year');
  const season = yearParam || CURRENT_YEAR;

  try {
    const teamMap = await getTeamNameMap(season);
    const teamA = teamMap[String(a)] || `Team ${a}`;
    const teamB = teamMap[String(b)] || `Team ${b}`;
    return {
      ogTitle: `${teamA} vs ${teamB}`
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to compute dynamic /h2h OG title:', e.message);
    return {};
  }
}

async function renderIndexForRequest(req) {
  const template = loadTemplate();
  if (!template) {
    return '';
  }

  const origin = `http://${req.headers.host || 'localhost'}`;
  const url = new URL(req.url, origin);
  const pathname = url.pathname;
  const searchParams = url.searchParams;

  const baseMeta = getMetaForPath(pathname);
  const dynamicMeta = await getDynamicMetaForRequest(pathname, searchParams);
  const finalMeta = { ...baseMeta, ...dynamicMeta };

  const safeTitle = finalMeta.ogTitle != null ? String(finalMeta.ogTitle) : '';
  const safeDescription =
    finalMeta.ogDescription != null ? String(finalMeta.ogDescription) : '';
  const safeImage = finalMeta.ogImage != null ? String(finalMeta.ogImage) : '/logo.png';

  return template
    .replace(/__OG_TITLE__/g, safeTitle)
    .replace(/__OG_DESCRIPTION__/g, safeDescription)
    .replace(/__OG_IMAGE__/g, safeImage);
}

module.exports = async (req, res) => {
  try {
    const html = await renderIndexForRequest(req);
    if (!html) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Server not initialized. Please ensure ssr-index.html is present.');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Error in api/render:', e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Internal server error');
  }
};


