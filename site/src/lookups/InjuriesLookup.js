export async function fetchInjuriesForWeek(season, week) {
  try {
    const yr = String(season);
    const wk = String(week);
    const url = `/data/player_games/injuries_${yr}_week_${wk}.txt`;
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) {
      return {};
    }
    const text = await resp.text();
    try {
      const json = JSON.parse(text);
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        return json;
      }
    } catch (_) {
      return {};
    }
    return {};
  } catch (e) {
    return {};
  }
} 