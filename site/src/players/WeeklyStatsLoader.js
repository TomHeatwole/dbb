// Helper to load season stats from CSV files
// Note: These files contain season aggregates, not week-by-week data

// Parse CSV line handling quoted fields
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}

export async function loadSeasonStatsFromCSV(season, player) {
  try {
    // Use gsis_id to match CSV records (trim leading space)
    const gsis_id = player?.gsis_id?.trim();
    if (!gsis_id) {
      return null;
    }
    
    const csvPath = `/data/stats_player_reg_${season}.csv`;
    const response = await fetch(csvPath);
    
    if (!response.ok) {
      return null;
    }
    
    const csvText = await response.text();
    const lines = csvText.trim().split('\n');
    
    if (lines.length < 2) {
      return null;
    }
    
    // Parse header
    const headers = parseCSVLine(lines[0]);
    const playerIdIdx = headers.indexOf('player_id');
    
    if (playerIdIdx === -1) {
      return null;
    }
    
    // Find the player's row using gsis_id
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      
      if (values[playerIdIdx] === gsis_id) {
        const row = {};
        headers.forEach((header, idx) => {
          row[header] = values[idx];
        });
        return row;
      }
    }
    
    return null;
  } catch (err) {
    console.error(`Error loading season stats for ${season}:`, err);
    return null;
  }
}

// Map CSV column names to Sleeper API format
export function mapCSVStatsToSleeperFormat(csvRow) {
  if (!csvRow) return null;
  
  return {
    // Passing
    pass_yd: parseFloat(csvRow.passing_yards) || 0,
    pass_td: parseInt(csvRow.passing_tds) || 0,
    pass_int: parseInt(csvRow.passing_interceptions) || 0,
    pass_2pt: parseInt(csvRow.passing_2pt_conversions) || 0,
    
    // Rushing
    rush_yd: parseFloat(csvRow.rushing_yards) || 0,
    rush_td: parseInt(csvRow.rushing_tds) || 0,
    rush_2pt: parseInt(csvRow.rushing_2pt_conversions) || 0,
    
    // Receiving
    rec: parseInt(csvRow.receptions) || 0,
    rec_yd: parseFloat(csvRow.receiving_yards) || 0,
    rec_td: parseInt(csvRow.receiving_tds) || 0,
    rec_2pt: parseInt(csvRow.receiving_2pt_conversions) || 0,
    
    // Kicking
    fgm: parseInt(csvRow.fg_made) || 0,
    fga: parseInt(csvRow.fg_att) || 0,
    xpm: parseInt(csvRow.pat_made) || 0,
    xpa: parseInt(csvRow.pat_att) || 0,
    
    // Defense
    def_td: parseInt(csvRow.def_tds) || 0,
    def_int: parseInt(csvRow.def_interceptions) || 0,
    def_sack: parseFloat(csvRow.def_sacks) || 0,
    def_fr: parseInt(csvRow.def_fumbles) || 0,
    
    // Special teams
    st_td: parseInt(csvRow.special_teams_tds) || 0,
    
    // Fumbles
    fum_lost: (parseInt(csvRow.rushing_fumbles_lost) || 0) + 
              (parseInt(csvRow.receiving_fumbles_lost) || 0) + 
              (parseInt(csvRow.sack_fumbles_lost) || 0)
  };
}

// Calculate fantasy points from stats using the scoring format
export function calculateFantasyPointsFromStats(stats, scoringConfig) {
  if (!stats || !scoringConfig) return 0;
  
  let points = 0;
  
  // Passing
  points += (stats.pass_yd || 0) * (scoringConfig.passing_yards || 0);
  points += (stats.pass_td || 0) * (scoringConfig.passing_tds || 0);
  points += (stats.pass_int || 0) * (scoringConfig.passing_interceptions || 0);
  points += (stats.pass_2pt || 0) * (scoringConfig.passing_2pt_conversions || 0);
  
  // Rushing
  points += (stats.rush_yd || 0) * (scoringConfig.rushing_yards || 0);
  points += (stats.rush_td || 0) * (scoringConfig.rushing_tds || 0);
  points += (stats.rush_2pt || 0) * (scoringConfig.rushing_2pt_conversions || 0);
  
  // Receiving
  points += (stats.rec || 0) * (scoringConfig.receptions || 0);
  points += (stats.rec_yd || 0) * (scoringConfig.receiving_yards || 0);
  points += (stats.rec_td || 0) * (scoringConfig.receiving_tds || 0);
  points += (stats.rec_2pt || 0) * (scoringConfig.receiving_2pt_conversions || 0);
  
  // Fumbles
  points += (stats.fum_lost || 0) * (scoringConfig.rushing_fumbles_lost || 0);
  
  // Kicking
  points += (stats.fgm || 0) * (scoringConfig.fg_made || 0);
  points += (stats.fga - stats.fgm || 0) * (scoringConfig.fg_missed || 0);
  points += (stats.xpm || 0) * (scoringConfig.pat_made || 0);
  points += (stats.xpa - stats.xpm || 0) * (scoringConfig.pat_missed || 0);
  
  // Defense
  points += (stats.def_td || 0) * (scoringConfig.def_tds || 0);
  points += (stats.def_int || 0) * (scoringConfig.def_interceptions || 0);
  points += (stats.def_sack || 0) * (scoringConfig.def_sacks || 0);
  points += (stats.def_fr || 0) * (scoringConfig.def_fumbles || 0);
  
  // Special teams
  points += (stats.st_td || 0) * (scoringConfig.special_teams_tds || 0);
  
  return Math.round(points * 10) / 10;
}
