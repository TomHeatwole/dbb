import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
import { CURRENT_YEAR } from '../utils/DateHelper';
import { fetchLeagueDrafts, fetchDraft, fetchDraftPicks, fetchTeamData, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from '../lookups/PlayerLookup';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import { LOGO_LETTER_OVERLAY } from '../utils/global_constants';

const POS_CLASS_MAP = {
  QB: 'draft-recap-pos--qb',
  RB: 'draft-recap-pos--rb',
  WR: 'draft-recap-pos--wr',
  TE: 'draft-recap-pos--te',
};

function RookieDraftRecapCard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rounds, setRounds] = useState(null);
  const [selectedRound, setSelectedRound] = useState(1);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const drafts = await fetchLeagueDrafts();
        const draftSummary = drafts.find((d) => d.status === 'complete');
        if (!draftSummary) throw new Error('No completed draft found');

        // Fetch the full draft object (the list endpoint omits slot_to_roster_id)
        const [fullDraft, rawPicks, teamData, players, idMap] = await Promise.all([
          fetchDraft(draftSummary.draft_id),
          fetchDraftPicks(draftSummary.draft_id),
          fetchTeamData(CURRENT_YEAR),
          fetchPlayersData(),
          fetchPlayerIdMap(),
        ]);

        if (cancelled) return;

        if (!rawPicks.length) throw new Error('No picks found');

        const rosterMap = buildRosterIdToTeamInfoMap(teamData.rosters, teamData.users);

        // slot_to_roster_id maps draft slot string -> original roster_id
        const slotToRoster = fullDraft.slot_to_roster_id || {};

        const picks = rawPicks
          .sort((a, b) => (a.pick_no || 0) - (b.pick_no || 0))
          .map((p) => {
            const round = p.round || 1;
            const draftSlot = p.draft_slot || 0;
            const pickLabel = `${round}.${String(draftSlot).padStart(2, '0')}`;
            const rosterId = p.roster_id != null ? Number(p.roster_id) : (slotToRoster[String(draftSlot)] || null);

            const meta = p.metadata || {};
            const info = p.player_id ? getPlayerInfo(p.player_id, players, idMap) : null;
            const playerName = info?.name || `${meta.first_name || ''} ${meta.last_name || ''}`.trim() || 'Unknown';
            const position = info?.position || meta.position || '';
            const nflTeam = info?.team || info?.team_abbr || meta.team || '';
            // Build photo URL: prefer getPlayerInfo result, then fall back to
            // the ID map directly (covers preseason when player data is sparse)
            let photoUrl = info?.espn_photo_url || null;
            if (!photoUrl && p.player_id && idMap) {
              const espnId = idMap[String(p.player_id)];
              if (espnId) {
                photoUrl = `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${espnId}.png`;
              }
            }

            // Drafting team info
            const teamInfo = rosterId != null ? (rosterMap[rosterId] || rosterMap[String(rosterId)]) : null;
            const teamName = teamInfo?.teamName || `Team ${rosterId}`;
            const user = teamInfo?.user;
            const teamAvatarUrl = user
              ? (user.team_avatar_url || user.user_avatar_url || user.avatar_url || null)
              : null;

            // Detect traded picks: original slot owner vs who actually picked
            const originalRosterId = slotToRoster[String(draftSlot)] != null
              ? Number(slotToRoster[String(draftSlot)])
              : null;
            const isTraded = originalRosterId != null && rosterId != null && originalRosterId !== rosterId;
            let originalTeamName = null;
            if (isTraded) {
              const origInfo = rosterMap[originalRosterId] || rosterMap[String(originalRosterId)];
              originalTeamName = origInfo?.teamName || `Team ${originalRosterId}`;
            }

            return {
              round,
              draftSlot,
              pickLabel,
              playerName,
              position,
              nflTeam,
              photoUrl,
              rosterId,
              teamName,
              teamAvatarUrl,
              isTraded,
              originalTeamName,
            };
          });

        // Group by round
        const roundMap = {};
        for (const pick of picks) {
          if (!roundMap[pick.round]) roundMap[pick.round] = [];
          roundMap[pick.round].push(pick);
        }
        const roundList = Object.keys(roundMap)
          .map(Number)
          .sort((a, b) => a - b)
          .map((r) => ({ round: r, picks: roundMap[r] }));

        if (!cancelled) {
          setRounds(roundList);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'Unable to load draft recap.');
          setRounds(null);
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const title = `🏈 ${CURRENT_YEAR} Rookie Draft Recap`;

  let body = null;
  if (loading) {
    body = <LoadingState label="Loading draft recap…" ariaLabel="Loading draft recap" />;
  } else if (error) {
    body = <div className="rookie-draft-status rookie-draft-status--error">{error}</div>;
  } else if (!rounds || !rounds.length) {
    body = <div className="rookie-draft-status">No draft data found.</div>;
  } else {
    const activeRound = rounds.find((r) => r.round === selectedRound) || rounds[0];
    body = (
      <div className="draft-recap-container">
        <select
          className="draft-recap-round-select"
          value={selectedRound}
          onChange={(e) => setSelectedRound(Number(e.target.value))}
          aria-label="Select round"
        >
          {rounds.map(({ round }) => (
            <option key={round} value={round}>Round {round}</option>
          ))}
        </select>
        <div className="draft-recap-pick-list">
          {activeRound.picks.map((pick) => {
            const posClass = POS_CLASS_MAP[pick.position] || 'draft-recap-pos--other';
            const letterOverlay =
              LOGO_LETTER_OVERLAY &&
              pick.rosterId != null &&
              Object.prototype.hasOwnProperty.call(LOGO_LETTER_OVERLAY, String(pick.rosterId))
                ? String(LOGO_LETTER_OVERLAY[String(pick.rosterId)] || '').trim()
                : '';
            return (
              <div key={pick.pickLabel} className="draft-recap-pick">
                <span className="draft-recap-pick-num">{pick.pickLabel}</span>
                <img
                  className="draft-recap-player-photo"
                  src={getPlayerLogoUrl(pick.photoUrl)}
                  alt=""
                />
                <div className="draft-recap-player-info">
                  <span className="draft-recap-player-name">{pick.playerName}</span>
                  <span className="draft-recap-player-meta">
                    <span className={'draft-recap-pos ' + posClass}>{pick.position}</span>
                    {pick.nflTeam && <span className="draft-recap-nfl-team">{pick.nflTeam}</span>}
                  </span>
                </div>
                <span className="draft-recap-traded-slot">
                  {pick.isTraded ? (
                    <span
                      className="draft-recap-traded-icon"
                      data-tooltip={`Traded from ${pick.originalTeamName}`}
                      aria-label={`Traded from ${pick.originalTeamName}`}
                    >↔</span>
                  ) : null}
                </span>
                <Link
                  className="draft-recap-team-link"
                  to={`/team/${pick.rosterId}`}
                >
                  <span className="draft-recap-team-avatar-wrap">
                    {pick.teamAvatarUrl ? (
                      <img className="draft-recap-team-avatar" src={pick.teamAvatarUrl} alt="" />
                    ) : (
                      <div className="draft-recap-team-avatar draft-recap-team-avatar--placeholder" />
                    )}
                    {letterOverlay && (
                      <span className="draft-recap-team-letter-overlay">{letterOverlay}</span>
                    )}
                  </span>
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <HomeCard>
      <div className="home-card-inner">
        <h2 className="home-card-title">{title}</h2>
        <div className="home-card-body">{body}</div>
      </div>
    </HomeCard>
  );
}

export default RookieDraftRecapCard;
