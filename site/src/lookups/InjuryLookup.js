const _injuriesCache = new Map();

function cacheKey(season, week) {
  return `${String(season)}:${String(week)}`;
}

function parseInjuries(text) {
  try {
    const data = JSON.parse(text);
    if (!data) { return {}; }
    if (typeof data === 'object' && !Array.isArray(data)) {
      if (data.players && typeof data.players === 'object') {
        return data.players;
      }
      return data;
    }
    if (Array.isArray(data)) {
      const out = {};
      for (const item of data) {
        if (Array.isArray(item) && item.length >= 2) {
          const [id, status] = item;
          if (id != null && status) { out[String(id)] = String(status); }
        } else if (item && typeof item === 'object') {
          const id = item.id || item.espn_id || item.athleteId;
          const status = item.status || item.injury || item.value;
          if (id != null && status) { out[String(id)] = String(status); }
        }
      }
      return out;
    }
  } catch (e) {
    return {};
  }
  return {};
}

export async function fetchInjuriesForWeek(season, week) {
  const key = cacheKey(season, week);
  if (_injuriesCache.has(key)) {
    return _injuriesCache.get(key);
  }
  const yr = String(season);
  const wk = String(week);
  const url = `/data/player_games/injuries_${yr}_week_${wk}.txt`;
  try {
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) {
      _injuriesCache.set(key, {});
      return {};
    }
    const text = await resp.text();
    const parsed = parseInjuries(text);
    const keys = Object.keys(parsed || {});
    if (parsed && typeof parsed === 'object' && keys.length) {
      _injuriesCache.set(key, parsed);
      return parsed;
    }
  } catch (e) {
    // ignore
  }
  _injuriesCache.set(key, {});
  return {};
}

export function maybeRemapInjuriesKeysUsingPlayerIdMap(injuriesMap, playerIdMap) {
  if (!injuriesMap || typeof injuriesMap !== 'object' || !playerIdMap || typeof playerIdMap !== 'object') {
    return injuriesMap || {};
  }
  const out = {};
  for (const [key, status] of Object.entries(injuriesMap)) {
    const mapping = playerIdMap[key];
    if (mapping && (mapping.espn_id || (mapping.metadata && mapping.metadata.espn_id))) {
      const espnId = String(mapping.espn_id || mapping.metadata.espn_id);
      out[espnId] = status;
    } else {
      out[key] = status;
    }
  }
  return out;
}

export function getInjuryAbbreviation(status) {
  if (!status || typeof status !== 'string') { return null; }
  const s = status.toLowerCase();
  if (s.includes('injured reserve') || s === 'ir') { return 'IR'; }
  if (s.includes('out')) { return 'O'; }
  if (s.includes('questionable')) { return 'Q'; }
  if (s.includes('doubtful')) { return 'D'; }
  if (s.includes('suspended')) { return 'SUS'; }
  if (s.includes('non-football') || s.includes('nfi')) { return 'NFI'; }
  if (s.includes('pup')) { return 'PUP'; }
  return s.slice(0, 3).toUpperCase();
} 