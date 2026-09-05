import React from 'react';
import ScoresLineup from './ScoresLineup';

export default function LeagueScoresTeamBreakdown({
  weekBreakdown,
  playersData,
  playerIdMap,
  playerGameLabels,
  isActiveWeek = false,
  injuriesMap = {},
  showCurrentInjury = false,
  playerHighlightMap = {},
  playersTeamMap = {},
  benchOpen,
  onToggleBench,
  ownerName,
  ownerAvatar,
  teamLink,
  place,
  pfTotal,
  hprojHref = null,
  hprojValue = null,
}) {
  return (
    <ScoresLineup
      weekBreakdown={weekBreakdown}
      playersData={playersData}
      playerIdMap={playerIdMap}
      playerGameLabels={playerGameLabels}
      isActiveWeek={isActiveWeek}
      injuriesMap={injuriesMap}
      showCurrentInjury={showCurrentInjury}
      playerHighlightMap={playerHighlightMap}
      playersTeamMap={playersTeamMap}
      benchOpen={benchOpen}
      onToggleBench={onToggleBench}
      ownerName={ownerName}
      ownerAvatar={ownerAvatar}
      teamLink={teamLink}
      place={place}
      pfTotal={pfTotal}
      hprojHref={hprojHref}
      hprojValue={hprojValue}
    />
  );
}
