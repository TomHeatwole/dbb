import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageMeta from '../PageMeta';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import { CURRENT_YEAR } from '../utils/DateHelper';
import { fetchTeamData, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from '../lookups/PlayerLookup';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import useWeeklyProjectedPoints from '../scores/useWeeklyProjectedPoints';
import {
  HPROJ_SKILL_POS,
  hprojAtPercentile,
  resolveHprojTeam,
  simulateTeamHproj,
} from '../scores/hprojTeamSim';

function fmt(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(1);
}

function pctLabel(n) {
  return `${Math.round((Number(n) || 0) * 100)}%`;
}

function slotBadgeClass(slot) {
  const s = String(slot || '').toUpperCase();
  if (s.startsWith('QB')) return 'pos-badge--qb';
  if (s.startsWith('RB')) return 'pos-badge--rb';
  if (s.startsWith('WR')) return 'pos-badge--wr';
  if (s.startsWith('TE')) return 'pos-badge--te';
  if (s.startsWith('FLEX')) return 'pos-badge--flex';
  if (s.startsWith('SUPER')) return 'pos-badge--super';
  return 'pos-badge--other';
}

function PlayerChip({ id, playersData, playerIdMap, showPos = null }) {
  const info = getPlayerInfo(id, playersData, playerIdMap);
  const name = (info && info.name) || id;
  const photo = getPlayerLogoUrl(info && info.espn_photo_url);
  const pos = showPos || null;
  return (
    <span className="hproj-player">
      <img className="hproj-player-avatar" src={photo} alt="" />
      <span className="hproj-player-name">{name}</span>
      {pos ? (
        <span className={`pos-badge pos-badge--${String(pos).toLowerCase()}`}>{pos}</span>
      ) : null}
    </span>
  );
}

function HprojPage() {
  const [searchParams] = useSearchParams();
  const teamParam = (searchParams.get('team') || '').trim();
  const weekParam = searchParams.get('week');
  const week = Number.parseInt(weekParam, 10);
  const season = CURRENT_YEAR;
  const missing = !teamParam || !Number.isFinite(week) || week < 1;

  const [teamMap, setTeamMap] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [percentile, setPercentile] = useState(50);
  const projectedPtsById = useWeeklyProjectedPoints(season, Number.isFinite(week) ? week : 1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [teamData, idMap] = await Promise.all([
          fetchTeamData(season),
          fetchPlayerIdMap(),
        ]);
        if (cancelled) return;
        setTeamMap(buildRosterIdToTeamInfoMap(teamData.rosters, teamData.users));
        setPlayerIdMap(idMap);
        const players = await fetchPlayersData(teamData.rosters, { week });
        if (cancelled) return;
        setPlayersData(players);
      } catch (err) {
        if (!cancelled) setLoadError(err.message || 'Failed to load league data');
      }
    })();
    return () => { cancelled = true; };
  }, [season, week]);

  const teamInfo = useMemo(
    () => (missing || !teamMap ? null : resolveHprojTeam(teamMap, teamParam)),
    [missing, teamMap, teamParam],
  );

  const teamOptions = useMemo(() => {
    if (!teamMap) return [];
    return Object.entries(teamMap)
      .map(([rid, info]) => ({
        rid,
        owner: info.ownerName,
        team: info.teamName,
        href: `/hproj?team=${encodeURIComponent((info.ownerName || '').split(/\s+/)[0] || rid)}&week=${Number.isFinite(week) ? week : 1}`,
      }))
      .sort((a, b) => String(a.owner).localeCompare(String(b.owner)));
  }, [teamMap, week]);

  const result = useMemo(() => {
    if (missing || !teamInfo || !playersData) return null;
    if (!projectedPtsById || Object.keys(projectedPtsById).length === 0) return null;
    const playerIds = teamInfo.roster?.players || [];
    const playerPositions = {};
    for (const pid of playerIds) {
      const rec = playersData[pid] || playersData[String(pid)];
      const raw = rec?.position || rec?.fantasy_positions?.[0] || null;
      playerPositions[String(pid)] = raw === 'FB' ? 'RB' : raw;
    }
    return simulateTeamHproj({
      playerIds,
      projectedPtsById,
      playerPositions,
      seed: `${teamInfo.rid}-${season}-${week}`,
      keepLineups: true,
    });
  }, [missing, teamInfo, playersData, projectedPtsById, season, week]);

  const view = useMemo(
    () => (result && result.sims ? hprojAtPercentile(result.sims, percentile) : null),
    [result, percentile],
  );

  const title = teamInfo
    ? `${teamInfo.teamName} · Week ${week} HProj`
    : 'HProj';

  return (
    <InfoPageWrapper
      title="HProj"
      subtitle={teamInfo ? `${teamInfo.teamName} · ${teamInfo.ownerName} · Week ${week} ${season}` : 'Hwang Projection · best-ball week'}
    >
      <PageMeta title={title} description="Best-ball HProj lineup for a Hwang roster week" />

      {missing && (
        <div className="hproj-panel">
          <p className="hproj-copy">
            <code>/hproj</code> needs <code>team</code> and <code>week</code>.
            Example: <code>/hproj?team=Hwang&week=1</code>
          </p>
          {teamOptions.length > 0 && (
            <ul className="hproj-team-list">
              {teamOptions.map((t) => (
                <li key={t.rid}>
                  <Link to={t.href}>{t.owner}</Link>
                  <span className="hproj-team-list-meta">{t.team}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!missing && loadError && (
        <p className="hproj-copy hproj-copy--error">{loadError}</p>
      )}

      {!missing && !loadError && teamMap && !teamInfo && (
        <div className="hproj-panel">
          <p className="hproj-copy">No team matched “{teamParam}”.</p>
          <ul className="hproj-team-list">
            {teamOptions.map((t) => (
              <li key={t.rid}>
                <Link to={t.href}>{t.owner}</Link>
                <span className="hproj-team-list-meta">{t.team}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!missing && teamInfo && !result && !loadError && (
        <p className="hproj-copy">
          {playersData ? 'Waiting for Sleeper weekly projections…' : 'Loading roster…'}
        </p>
      )}

      {result && result.players === 0 && (
        <p className="hproj-copy">
          No projected skill players on this roster for week {week}.
        </p>
      )}

      {result && result.players > 0 && view && (
        <div className="hproj-body">
          <div className="hproj-hero">
            <div className="hproj-hero-value">{fmt(view.total)}</div>
            <div className="hproj-hero-label">P{view.percentile} HProj</div>
            <div className="hproj-hero-sub">
              {view.total >= result.naiveTotal ? '+' : ''}{fmt(view.total - result.naiveTotal)} vs starter proj {fmt(result.naiveTotal)}
            </div>
          </div>

          <div className="hproj-slider">
            <input
              type="range"
              className="hproj-slider-input"
              min={0}
              max={99}
              value={percentile}
              onChange={(e) => setPercentile(Number(e.target.value))}
              aria-label="HProj percentile"
            />
            <div className="hproj-slider-ends">
              <span>P0</span>
              <span>P50</span>
              <span>P99</span>
            </div>
          </div>

          <div className="hproj-pos-strip">
            {HPROJ_SKILL_POS.map((pos) => (
              <div key={pos} className="hproj-pos-chip">
                <span className={`pos-badge pos-badge--${pos.toLowerCase()}`}>{pos}</span>
                <span className="hproj-pos-chip-pts">{fmt(view.byPos[pos])}</span>
              </div>
            ))}
          </div>

          <div className="hproj-lineup">
            <div className="hproj-lineup-kicker">Starters at P{view.percentile}</div>
            {view.slots.map((row) => {
              const p = row.primary;
              return (
                <div key={row.slot} className="hproj-lineup-row">
                  <span className={`pos-badge hproj-slot-badge ${slotBadgeClass(row.slot)}`}>{row.slot}</span>
                  <div className="hproj-lineup-main">
                    {p ? (
                      <PlayerChip
                        id={p.id}
                        playersData={playersData}
                        playerIdMap={playerIdMap}
                        showPos={/FLEX|SUPER/i.test(row.slot) ? p.position : null}
                      />
                    ) : (
                      <span className="hproj-player-name">—</span>
                    )}
                    {row.alts.length > 0 ? (
                      <div className="hproj-lineup-alts">
                        {row.alts.map((alt) => (
                          <span key={alt.id}>
                            also {(getPlayerInfo(alt.id, playersData, playerIdMap) || {}).name || alt.id}
                            {' '}{fmt(alt.pts)} · starts {pctLabel(alt.startPct)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="hproj-lineup-nums">
                    <span className="hproj-lineup-pts">{p ? fmt(p.pts) : '—'}</span>
                    {p && (p.startPct < 0.9 || /FLEX|SUPER/i.test(row.slot)) ? (
                      <span className="hproj-lineup-rate">starts {pctLabel(p.startPct)}</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hproj-pos-blocks">
            {HPROJ_SKILL_POS.map((pos) => (
              <div key={pos} className="hproj-pos-block">
                <div className="hproj-pos-block-head">
                  <span className={`pos-badge pos-badge--${pos.toLowerCase()}`}>{pos}</span>
                  <span className="hproj-pos-block-pts">{fmt(view.byPos[pos])}</span>
                  <span className="hproj-pos-block-naive">starter {fmt(result.naiveByPos[pos])}</span>
                </div>
                {(view.byPosPlayers[pos] || []).map((p) => (
                  <div key={p.id} className="hproj-pos-player">
                    <PlayerChip id={p.id} playersData={playersData} playerIdMap={playerIdMap} />
                    <span className="hproj-pos-player-meta">
                      {fmt(p.pts)} · starts {pctLabel(p.startPct)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <p className="hproj-footnote">
            Lineup is who actually started in the simulated weeks around P{view.percentile}
            {' '}({view.window.toLocaleString()} of {result.iterations.toLocaleString()} draws).
            Flex / superflex count toward the player&apos;s position totals.
          </p>
        </div>
      )}
    </InfoPageWrapper>
  );
}

export default HprojPage;
