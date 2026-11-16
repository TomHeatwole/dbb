import {
  buildPlayoffHprojCacheKey,
  dummyPlayoffHprojView,
  invalidatePlayoffHprojCache,
  readPlayoffHprojCache,
  writePlayoffHprojCache,
} from './playoffHprojCache.mjs';

function parseSeason(req) {
  const q = req.query || {};
  const raw = q.season ?? q.s;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 2020 && n <= 2100) return Math.round(n);
  return new Date().getFullYear();
}

export async function handlePlayoffHprojGet(req, res) {
  const season = parseSeason(req);
  const wantKey = String(req.query?.cacheKey || req.query?.key || '').trim();

  const row = await readPlayoffHprojCache(season);
  if (!row) {
    return res.status(200).json({
      season,
      cacheValid: false,
      cacheKey: null,
      view: null,
    });
  }

  const keyMatch = !wantKey || row.cacheKey === wantKey;
  const cacheValid = row.cacheValid && keyMatch;

  return res.status(200).json({
    season,
    cacheValid,
    cacheKey: row.cacheKey,
    computedAt: row.computedAt,
    view: cacheValid ? row.view : null,
  });
}

export async function handlePlayoffHprojPost(req, res) {
  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }

  const action = String(body.action || '').toLowerCase();

  if (action === 'invalidate') {
    const season = Number(body.season) || parseSeason(req);
    await invalidatePlayoffHprojCache(season);
    return res.status(200).json({ ok: true, season, cacheValid: false });
  }

  if (action === 'seed_dummy') {
    const season = Number(body.season) || parseSeason(req);
    const bankedThrough = Number(body.bankedThrough) || 9;
    const currentWeek = Number(body.currentWeek) || 10;
    const cacheKey = String(body.cacheKey || buildPlayoffHprojCacheKey(season, bankedThrough, currentWeek));
    const view = dummyPlayoffHprojView(season);
    await writePlayoffHprojCache({
      season,
      cacheKey,
      bankedThrough,
      currentWeek,
      view,
      cacheValid: false,
    });
    return res.status(200).json({ ok: true, season, cacheKey, cacheValid: false });
  }

  if (action === 'save') {
    const season = Number(body.season) || parseSeason(req);
    const cacheKey = String(body.cacheKey || '').trim();
    const view = body.view;
    if (!cacheKey || !view || typeof view !== 'object') {
      return res.status(400).json({ error: 'cacheKey and view are required' });
    }
    const bankedThrough = body.bankedThrough;
    const currentWeek = body.currentWeek;
    await writePlayoffHprojCache({
      season,
      cacheKey,
      bankedThrough,
      currentWeek,
      view,
      cacheValid: true,
    });
    return res.status(200).json({ ok: true, season, cacheKey, cacheValid: true });
  }

  return res.status(400).json({ error: "action must be 'save', 'invalidate', or 'seed_dummy'" });
}