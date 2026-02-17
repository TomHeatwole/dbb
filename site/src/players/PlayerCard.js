import React from 'react';
import { getPlayerLogoUrl } from '../utils/playerLogo';

function PlayerCard({ player, onClose }) {
  const name = player && player.name ? player.name : '';
  const position = player && player.position ? player.position : '';

  const team = player && (player.team || player.team_abbr) ? (player.team || player.team_abbr) : null;
  const age = player && player.age ? player.age : null;
  const birthday = player && player.birth_date ? player.birth_date : null;
  const injury = player && player.injury_status ? player.injury_status : null;
  const yearsExp = player && player.years_exp ? player.years_exp : null;
  const rookieYear = player && player.metadata && player.metadata.rookie_year ? player.metadata.rookie_year : null;
  const college = player && player.college ? player.college : null;
  const highSchool = player && player.high_school ? player.high_school : null;

  return (
    <div className="player-card">
      {typeof onClose === 'function' && (
        <button
          className="player-card-close"
          type="button"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
      )}
      <div className="player-card-content">
        <img src={getPlayerLogoUrl(player && player.espn_photo_url)} alt={name} className="player-card-photo" />
        <div className="player-card-text">
          <div className="player-card-name">{name}</div>
          <div className="player-card-position">{position}</div>
        </div>
      </div>

      <div className="player-card-details">
        {team && (
          <div className="player-card-detail">
            <span className="player-card-detail-label">Team</span>
            <span className="player-card-detail-value">{team}</span>
          </div>
        )}
        {age && (
          <div className="player-card-detail">
            <span className="player-card-detail-label">Age</span>
            <span className="player-card-detail-value">{age}</span>
          </div>
        )}
        {birthday && (
          <div className="player-card-detail">
            <span className="player-card-detail-label">Birthday</span>
            <span className="player-card-detail-value">{birthday}</span>
          </div>
        )}
        {injury && (
          <div className="player-card-detail">
            <span className="player-card-detail-label">Injury</span>
            <span className="player-card-detail-value">{injury}</span>
          </div>
        )}
        {yearsExp && (
          <div className="player-card-detail">
            <span className="player-card-detail-label">Years Exp</span>
            <span className="player-card-detail-value">{yearsExp}</span>
          </div>
        )}
        {rookieYear && (
          <div className="player-card-detail">
            <span className="player-card-detail-label">Rookie Year</span>
            <span className="player-card-detail-value">{rookieYear}</span>
          </div>
        )}
        {college && (
          <div className="player-card-detail">
            <span className="player-card-detail-label">College</span>
            <span className="player-card-detail-value">{college}</span>
          </div>
        )}
        {highSchool && (
          <div className="player-card-detail">
            <span className="player-card-detail-label">High School</span>
            <span className="player-card-detail-value">{highSchool}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default PlayerCard; 