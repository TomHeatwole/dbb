import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageMeta from '../PageMeta';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import { CURRENT_YEAR, getDefaultDisplayWeek } from '../utils/DateHelper';
import { fetchTeamData, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from '../lookups/PlayerLookup';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import useWeeklyProjectedPoints from '../scores/useWeeklyProjectedPoints';
import { computeOptimalWeekDetail } from '../scenarios/simulatorLineup';
import { hprojQuantile } from '../scores/hprojVarianceBuckets';
import {
  HPROJ_SKILL_POS,
  hprojRandomOutcome,
  resolveHprojTeam,
  simulateTeamHproj,
} from '../scores/hprojTeamSim';

function fmt(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(1);
}

function signed(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = n.toFixed(1);
  return n > 0 ? `+${v}` : v;
}

function skillPosition(raw) {
  if (raw === 'FB') return 'RB';
  if (HPROJ_SKILL_POS.includes(raw)) return raw;
  return raw || null;
}

function slotBadgeClass(slot) {
  const s = String(slot || '').toUpperCase();
  if (s.startsWith('QB')) return 'pos-badge--qb';
  if (s.startsWith('RB')) return 'pos-badge--rb';
  if (s.startsWith('WR')) return 'pos-badge--wr';
  if (s.startsWith('TE')) return 'pos-badge--te';
  if (s.startsWith('FLEX')) return 'pos-badge--flex';
  if (s.startsWith('SUPER')) return 'pos-badge--super';
  if (s === 'BENCH') return 'pos-badge--bench';
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

function teamAvatarOf(info) {
  const u = info?.user;
  return (u && (u.team_avatar_url || u.user_avatar_url || u.avatar_url)) || null;
}

function ownerAvatarOf(info) {
  const u = info?.user;
  return (u && (u.user_avatar_url || u.avatar_url || u.team_avatar_url)) || null;
}

function teamQueryValue(info, firstNameCounts) {
  const first = String(info?.ownerName || '').trim().split(/\s+/)[0] || '';
  const unique = first && firstNameCounts[first.toLowerCase()] === 1;
  return unique ? first : String(info?.rid ?? '');
}

function TeamIdentity({ teamName, ownerName, teamAvatar, ownerAvatar }) {
  return (
    <span className="hproj-identity">
      {teamAvatar ? <img className="hproj-team-avatar" src={teamAvatar} alt="" /> : null}
      <span className="hproj-identity-text">
        <span className="hproj-identity-team">{teamName}</span>
        <span className="hproj-identity-owner">
          {ownerAvatar && ownerAvatar !== teamAvatar ? (
            <img className="hproj-owner-avatar" src={ownerAvatar} alt="" />
          ) : null}
          {ownerName}
        </span>
      </span>
    </span>
  );
}

function TeamSwitch({ options, current, onSelect }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="hproj-team-switch" ref={wrapRef}>
      <button
        type="button"
        className="hproj-team-switch-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {current ? (
          <TeamIdentity
            teamName={current.team}
            ownerName={current.owner}
            teamAvatar={current.teamAvatar}
            ownerAvatar={current.ownerAvatar}
          />
        ) : (
          <span className="hproj-identity-team">Select a team</span>
        )}
        <span className="hproj-team-switch-caret" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <ul className="hproj-team-switch-list" role="listbox">
          {options.map((opt) => (
            <li key={opt.rid}>
              <button
                type="button"
                className={`hproj-team-switch-option${current && String(current.rid) === String(opt.rid) ? ' is-active' : ''}`}
                onClick={() => {
                  setOpen(false);
                  onSelect(opt);
                }}
              >
                <TeamIdentity
                  teamName={opt.team}
                  ownerName={opt.owner}
                  teamAvatar={opt.teamAvatar}
                  ownerAvatar={opt.ownerAvatar}
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PercentileSlider({ value, onChange, ariaLabel }) {
  return (
    <div className="hproj-slider">
      <input
        type="range"
        className="hproj-slider-input"
        min={0}
        max={99}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel}
      />
      <div className="hproj-slider-ends">
        <span>P0</span>
        <span>P50</span>
        <span>P99</span>
      </div>
    </div>
  );
}

function HprojPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const teamParam = (searchParams.get('team') || '').trim();
  const weekParam = searchParams.get('week');
  const season = CURRENT_YEAR;
  const parsedWeek = Number.parseInt(weekParam, 10);
  const week = Number.isFinite(parsedWeek) && parsedWeek >= 1
    ? parsedWeek
    : getDefaultDisplayWeek(season);
  const missing = !teamParam;

  const [teamMap, setTeamMap] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [percentile, setPercentile] = useState(50);
  const [drawSalt, setDrawSalt] = useState(0);
  const [playerPcts, setPlayerPcts] = useState({});
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

  useEffect(() => {
    setDrawSalt(0);
    setPlayerPcts({});
  }, [teamParam, week]);

  const teamInfo = useMemo(
    () => (missing || !teamMap ? null : resolveHprojTeam(teamMap, teamParam)),
    [missing, teamMap, teamParam],
  );

  const firstNameCounts = useMemo(() => {
    const counts = {};
    if (!teamMap) return counts;
    for (const info of Object.values(teamMap)) {
      const first = String(info?.ownerName || '').trim().split(/\s+/)[0] || '';
      if (!first) continue;
      const key = first.toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [teamMap]);

  const teamOptions = useMemo(() => {
    if (!teamMap) return [];
    return Object.entries(teamMap)
      .map(([rid, info]) => {
        const packed = { rid, ...info };
        return {
          rid,
          owner: info.ownerName,
          team: info.teamName,
          teamAvatar: teamAvatarOf(info),
          ownerAvatar: ownerAvatarOf(info),
          query: teamQueryValue(packed, firstNameCounts),
          href: `/hproj?team=${encodeURIComponent(teamQueryValue(packed, firstNameCounts))}&week=${week}`,
        };
      })
      .sort((a, b) => String(a.owner).localeCompare(String(b.owner)));
  }, [teamMap, week, firstNameCounts]);

  const currentOption = useMemo(() => {
    if (!teamInfo) return null;
    return teamOptions.find((t) => String(t.rid) === String(teamInfo.rid)) || {
      rid: teamInfo.rid,
      owner: teamInfo.ownerName,
      team: teamInfo.teamName,
      teamAvatar: teamAvatarOf(teamInfo),
      ownerAvatar: ownerAvatarOf(teamInfo),
    };
  }, [teamInfo, teamOptions]);

  function selectTeam(opt) {
    setSearchParams({ team: String(opt.query || opt.rid), week: String(week) });
  }

  const result = useMemo(() => {
    if (missing || !teamInfo || !playersData) return null;
    if (!projectedPtsById || Object.keys(projectedPtsById).length === 0) return null;
    const playerIds = teamInfo.roster?.players || [];
    const playerPositions = {};
    for (const pid of playerIds) {
      const rec = playersData[pid] || playersData[String(pid)];
      const raw = rec?.position || rec?.fantasy_positions?.[0] || null;
      playerPositions[String(pid)] = skillPosition(raw);
    }
    return simulateTeamHproj({
      playerIds,
      projectedPtsById,
      playerPositions,
      seed: `${teamInfo.rid}-${season}-${week}`,
      keepLineups: true,
    });
  }, [missing, teamInfo, playersData, projectedPtsById, season, week]);

  const outcome = useMemo(
    () => (result && result.sims ? hprojRandomOutcome(result.sims, percentile, drawSalt) : null),
    [result, percentile, drawSalt],
  );

  const rosterPlayers = useMemo(() => {
    if (!teamInfo || !playersData) return [];
    const ids = teamInfo.roster?.players || [];
    const rows = [];
    for (const rawId of ids) {
      const id = String(rawId);
      if (!id || id === '0') continue;
      const rec = playersData[id] || playersData[rawId];
      const raw = rec?.position || rec?.fantasy_positions?.[0] || null;
      const pos = skillPosition(raw);
      const proj = Number(projectedPtsById?.[id] ?? projectedPtsById?.[rawId]);
      const hasProj = Number.isFinite(proj) && proj > 0;
      const skill = HPROJ_SKILL_POS.includes(pos);
      rows.push({
        id,
        pos,
        proj: hasProj ? proj : (Number.isFinite(proj) ? proj : null),
        canSample: skill && hasProj,
      });
    }
    rows.sort((a, b) => (b.proj || 0) - (a.proj || 0) || String(a.id).localeCompare(String(b.id)));
    return rows;
  }, [teamInfo, playersData, projectedPtsById]);

  const manual = useMemo(() => {
    const outcomes = {};
    const weekPts = {};
    const positions = {};
    const ids = [];
    for (const row of rosterPlayers) {
      const pct = playerPcts[row.id] ?? 50;
      let pts = null;
      if (row.canSample) pts = hprojQuantile(row.pos, row.proj, pct);
      else if (row.proj != null) pts = row.proj;
      outcomes[row.id] = { pct, pts };
      if (HPROJ_SKILL_POS.includes(row.pos) && pts != null) {
        ids.push(row.id);
        weekPts[row.id] = pts;
        positions[row.id] = row.pos;
      }
    }
    const scored = ids.length
      ? computeOptimalWeekDetail(ids, weekPts, positions, null)
      : { total: 0, byPos: { QB: 0, RB: 0, WR: 0, TE: 0 }, starters: [] };
    const slotById = {};
    for (const s of scored.starters || []) slotById[String(s.id)] = s.slot;
    return { total: scored.total, byPos: scored.byPos, slotById, outcomes };
  }, [rosterPlayers, playerPcts]);

  const title = teamInfo
    ? `${teamInfo.teamName} · Week ${week} HProj`
    : 'HProj';

  return (
    <InfoPageWrapper
      title="HProj"
      subtitle={`Week ${week} ${season}`}
    >
      <PageMeta title={title} description="Best-ball HProj lineup for a Hwang roster week" />

      {teamOptions.length > 0 && (
        <div className="hproj-page-head">
          <TeamSwitch
            options={teamOptions}
            current={currentOption}
            onSelect={selectTeam}
          />
        </div>
      )}

      {missing && (
        <div className="hproj-panel">
          <p className="hproj-copy">Pick a team to see their week {week} HProj.</p>
        </div>
      )}

      {!missing && loadError && (
        <p className="hproj-copy hproj-copy--error">{loadError}</p>
      )}

      {!missing && !loadError && teamMap && !teamInfo && (
        <div className="hproj-panel">
          <p className="hproj-copy">No team matched “{teamParam}”.</p>
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

      {result && result.players > 0 && outcome && (
        <div className="hproj-page">
          <div className="hproj-split">
            <section className="hproj-col hproj-col--team">
              <h2 className="hproj-col-title">Team outcome</h2>
              <div className="hproj-hero">
                <div className="hproj-hero-value">{fmt(outcome.total)}</div>
                <div className="hproj-hero-label">Random P{outcome.percentile} outcome</div>
                <div className="hproj-hero-sub">
                  {signed(outcome.total - result.naiveTotal)} vs starter proj {fmt(result.naiveTotal)}
                </div>
              </div>

              <PercentileSlider
                value={percentile}
                onChange={setPercentile}
                ariaLabel="Team outcome percentile"
              />

              <button
                type="button"
                className="hproj-regen"
                onClick={() => setDrawSalt((n) => n + 1)}
              >
                Regenerate outcome
              </button>

              <div className="hproj-pos-strip">
                {HPROJ_SKILL_POS.map((pos) => (
                  <div key={pos} className="hproj-pos-chip">
                    <span className={`pos-badge pos-badge--${pos.toLowerCase()}`}>{pos}</span>
                    <span className="hproj-pos-chip-pts">{fmt(outcome.byPos[pos])}</span>
                  </div>
                ))}
              </div>

              <div className="hproj-lineup">
                <div className="hproj-lineup-kicker">Starters in this draw</div>
                {outcome.starters.map((p) => (
                  <div key={p.slot} className="hproj-lineup-row">
                    <span className={`pos-badge ${slotBadgeClass(p.slot)}`}>{p.slot}</span>
                    <div className="hproj-lineup-main">
                      <PlayerChip
                        id={p.id}
                        playersData={playersData}
                        playerIdMap={playerIdMap}
                        showPos={/FLEX|SUPER/i.test(p.slot) ? p.position : null}
                      />
                    </div>
                    <span className="hproj-lineup-pts">{fmt(p.pts)}</span>
                  </div>
                ))}
              </div>

              <p className="hproj-footnote">
                One simulated week from the P{outcome.percentile} band
                {' '}({outcome.window.toLocaleString()} of {result.iterations.toLocaleString()} draws).
              </p>
            </section>

            <section className="hproj-col hproj-col--players">
              <h2 className="hproj-col-title">Player outcomes</h2>
              <div className="hproj-hero">
                <div className="hproj-hero-value">{fmt(manual.total)}</div>
                <div className="hproj-hero-label">Manual best-ball</div>
                <div className="hproj-hero-sub">
                  {signed(manual.total - result.naiveTotal)} vs starter proj {fmt(result.naiveTotal)}
                </div>
              </div>

              <div className="hproj-pos-strip">
                {HPROJ_SKILL_POS.map((pos) => (
                  <div key={pos} className="hproj-pos-chip">
                    <span className={`pos-badge pos-badge--${pos.toLowerCase()}`}>{pos}</span>
                    <span className="hproj-pos-chip-pts">{fmt(manual.byPos[pos])}</span>
                  </div>
                ))}
              </div>

              <p className="hproj-disclaimer">
                Sliders use historical residuals by <strong>position and projection band</strong> (2021–2025).
                Not player-specific, and no matchup or injury info.
              </p>

              <div className="hproj-player-list">
                {rosterPlayers.map((row) => {
                  const { pct, pts } = manual.outcomes[row.id] || { pct: 50, pts: row.proj };
                  const slot = HPROJ_SKILL_POS.includes(row.pos)
                    ? (manual.slotById[row.id] || 'BENCH')
                    : null;
                  return (
                    <div
                      key={row.id}
                      className={`hproj-player-row${slot === 'BENCH' ? ' hproj-player-row--bench' : ''}`}
                    >
                      <span className={`pos-badge hproj-player-row-slot ${slotBadgeClass(slot || 'OTHER')}`}>
                        {slot || '—'}
                      </span>
                      <PlayerChip
                        id={row.id}
                        playersData={playersData}
                        playerIdMap={playerIdMap}
                        showPos={row.pos}
                      />
                      <div className="hproj-player-row-nums">
                        <span className="hproj-player-row-pts">{fmt(pts)}</span>
                        <span className="hproj-player-row-meta">
                          {row.canSample
                            ? `P${pct} · proj ${fmt(row.proj)} · ${signed((pts ?? 0) - row.proj)}`
                            : (row.proj != null ? `proj ${fmt(row.proj)}` : 'no projection')}
                        </span>
                      </div>
                      {row.canSample ? (
                        <input
                          type="range"
                          className="hproj-slider-input hproj-player-row-slider"
                          min={0}
                          max={99}
                          value={pct}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            setPlayerPcts((prev) => ({ ...prev, [row.id]: next }));
                          }}
                          aria-label={`${(getPlayerInfo(row.id, playersData, playerIdMap) || {}).name || row.id} outcome percentile`}
                        />
                      ) : (
                        <p className="hproj-player-row-skip">No positional sample for this player.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      )}
    </InfoPageWrapper>
  );
}

export default HprojPage;
