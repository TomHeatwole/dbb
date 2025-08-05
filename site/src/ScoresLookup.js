import { LEAGUE_ID, PREVIOUS_YEARS } from './global_constants';

export async function fetchScoresData(season) {
  // Determine leagueId based on season
  const leagueId = season === undefined || season === null || season === '' || season === new Date().getFullYear().toString()
    ? LEAGUE_ID
    : PREVIOUS_YEARS[season];

  let weeksData = null;
  let weeksParsedData = null;
  // If previous season, load all week1.txt through week17.txt from public/data/{season}/
  if (PREVIOUS_YEARS[season]) {
    const weekFiles = Array.from({ length: 17 }, (_, i) => `/data/${season}/week${i + 1}.txt`);
    weeksData = await Promise.all(
      weekFiles.map(async (url) => {
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error('Not found');
          return await resp.text();
        } catch (e) {
          return null; // Could not load this week
        }
      })
    );
    // Parse each week's data as JSON, ignore matchup_id
    weeksParsedData = weeksData.map(weekText => {
      if (!weekText) return null;
      try {
        const weekArr = JSON.parse(weekText);
        // Each weekArr is an array of score breakdowns for each roster
        // Remove matchup_id from each object (optional, but per instructions)
        return weekArr.map(({ matchup_id, ...rest }) => rest);
      } catch (e) {
        return null;
      }
    });
  }

  return weeksParsedData;
} 