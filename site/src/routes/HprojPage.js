import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageMeta from '../PageMeta';
import LoadingState from '../LoadingState';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import { CURRENT_YEAR, getDefaultDisplayWeek } from '../utils/DateHelper';
import { fetchTeamData, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from '../lookups/PlayerLookup';
import { fetchInjuriesForWeek, getInjuryAbbreviation } from '../lookups/InjuryLookup';
import MidweekSimBanner from '../scores/MidweekSimBanner';
import {
  collectOutPlayerIds,
  scaledLiveOutcome,
} from '../scores/liveOutlook';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import useWeeklyProjectedPoints from '../scores/useWeeklyProjectedPoints';
import { computeOptimalWeekDetail } from '../scenarios/simulatorLineup';
import { hprojPercentile, hprojQuantile } from '../scores/hprojVarianceBuckets';
import {
  HPROJ_SKILL_POS,
  HPROJ_TEAM_PCT_MAX,
  formatTeamPercentile,
  hprojRandomOutcome,
  liveScaleFromInProgressGames,
  lockedPtsFromCompletedGames,
  resolveHprojTeam,
  simulateTeamHproj,
  weekHasStartedGames,
} from '../scores/hprojTeamSim';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchNflScoreboard } from '../lookups/GamesLookup';
import { getWeekScoreBreakdown } from '../scores/ScoresParser';
import { getGameDisplayForTeam, mapPlayersToGames } from '../scores/GamesParser';

function fmt(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(1);
}

function signed(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = n.toFixed(1);
  return n > 0 ? `+${v}` : v;
}

function hprojHeat(pct, max = 99) {
  const t = Math.max(0, Math.min(max, Number(pct) || 0)) / max;
  const red = [252, 165, 165];
  const yellow = [253, 224, 71];
  const green = [134, 239, 172];
  const from = t < 0.5 ? red : yellow;
  const to = t < 0.5 ? yellow : green;
  const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  const rgb = from.map((c, i) => Math.round(c + (to[i] - c) * u));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
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

function playerInjuryStatus(id, info, injuriesMap) {
  const pid = String(id);
  if (injuriesMap && injuriesMap[pid]) return injuriesMap[pid];
  const espn = info && (info.espn_id || info.metadata?.espn_id);
  if (injuriesMap && espn && injuriesMap[String(espn)]) return injuriesMap[String(espn)];
  if (!info) return null;
  return info.injury_status || info.injury_notes || (
    info.status && /out|pup|questionable|doubtful|suspended|ir|injured reserve|na/i.test(info.status)
      ? info.status
      : null
  );
}

function InjuryBadge({ id, info, injuriesMap }) {
  const status = playerInjuryStatus(id, info, injuriesMap);
  const ab = status ? getInjuryAbbreviation(status) : null;
  if (!ab) return null;
  const isRetired = ab === 'NA';
  return (
    <span className={isRetired ? 'injury-badge injury-badge--retired' : 'injury-badge'} title={status}>
      {isRetired ? 'Retired 😂' : ab}
    </span>
  );
}

function formatLiveClock(label, timeFrac) {
  if (label) {
    const period = Number(label.period);
    const clock = label.displayClock || '';
    if (Number.isFinite(period) && period > 0) {
      const q = period > 4 ? 'OT' : `Q${period}`;
      return clock ? `${q} ${clock}` : q;
    }
    const fromText = String(label.text || '').match(/^(OT|Q[1-4])(?:\s+(\d+:\d+(?:\.\d+)?))?/i);
    if (fromText) {
      return fromText[2] ? `${fromText[1].toUpperCase()} ${fromText[2]}` : fromText[1].toUpperCase();
    }
  }
  if (Number.isFinite(Number(timeFrac))) {
    return `${Math.round(Number(timeFrac) * 100)}%`;
  }
  return null;
}

function LiveMark({ actual, clock }) {
  return (
    <span className="hproj-player-live">
      <span className="hproj-hint-live-dot" aria-hidden="true" />
      <span className="hproj-player-live-pts">{fmt(actual)}</span>
      {clock ? (
        <>
          <span className="hproj-player-live-sep" aria-hidden="true">·</span>
          <span className="hproj-player-live-clock">{clock}</span>
        </>
      ) : null}
    </span>
  );
}

function LineupRow({
  p,
  playersData,
  playerIdMap,
  injuriesMap,
  showPos = null,
  liveScale = null,
  gameLabel = null,
}) {
  const live = Boolean(p.live && liveScale);
  const liveClock = live ? formatLiveClock(gameLabel, liveScale.timeFrac) : null;
  return (
    <div className={`hproj-lineup-row${p.slot === 'BENCH' ? ' hproj-lineup-row--bench' : ''}`}>
      <span className={`pos-badge ${slotBadgeClass(p.slot)}`}>{p.slot}</span>
      <div className="hproj-lineup-main">
        <PlayerChip
          id={p.id}
          playersData={playersData}
          playerIdMap={playerIdMap}
          injuriesMap={injuriesMap}
          showPos={showPos}
          live={live}
          liveActual={live ? liveScale.actual : null}
          liveClock={liveClock}
        />
      </div>
      <div className="hproj-lineup-nums">
        <span
          className={`hproj-lineup-pts${p.locked ? ' hproj-lineup-pts--final' : ''}`}
          style={!p.locked && p.playerPct != null ? { color: hprojHeat(p.playerPct) } : undefined}
        >
          {fmt(p.pts)}
        </span>
        {p.locked ? (
          <span className="hproj-lineup-rate hproj-lineup-rate--final">
            FINAL
            {p.playerPct != null ? (
              <>
                {' - '}P{p.playerPct}
                <span className="hproj-lineup-rate-words"> outcome</span>
              </>
            ) : null}
          </span>
        ) : p.playerPct != null ? (
          <span className="hproj-lineup-rate" style={{ color: hprojHeat(p.playerPct) }}>
            P{p.playerPct}
            <span className="hproj-lineup-rate-words"> outcome</span>
          </span>
        ) : (
          <span className="hproj-lineup-rate">no sample</span>
        )}
      </div>
    </div>
  );
}

function PlayerChip({
  id,
  playersData,
  playerIdMap,
  injuriesMap,
  showPos = null,
  live = false,
  liveActual = null,
  liveClock = null,
}) {
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
      <InjuryBadge id={id} info={info} injuriesMap={injuriesMap} />
      {live ? <LiveMark actual={liveActual} clock={liveClock} /> : null}
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

function PercentileSlider({
  value,
  onChange,
  ariaLabel,
  min = 0,
  max = 99,
  step = 1,
}) {
  const heat = hprojHeat(value, max);
  return (
    <div className="hproj-slider">
      <input
        type="range"
        className="hproj-slider-input"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel}
        style={{ accentColor: heat, color: heat }}
      />
      <div className="hproj-slider-ends">
        {[
          { pct: min, label: `P${formatTeamPercentile(min)}` },
          { pct: 50, label: 'P50' },
          { pct: max, label: `P${formatTeamPercentile(max)}` },
        ].map(({ pct, label }) => (
          <button
            key={label}
            type="button"
            className={`hproj-slider-tick${value === pct ? ' is-active' : ''}`}
            style={{ color: hprojHeat(pct, max) }}
            onClick={() => onChange(pct)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function HprojModeToggle({ value, onChange }) {
  return (
    <div className="hproj-mode-toggle" role="group" aria-label="Projection mode">
      <button
        type="button"
        className={`hproj-mode-toggle-btn${value === 'pregame' ? ' is-active' : ''}`}
        aria-pressed={value === 'pregame'}
        onClick={() => onChange('pregame')}
      >
        Pregame
      </button>
      <button
        type="button"
        className={`hproj-mode-toggle-btn hproj-mode-toggle-btn--live${value === 'live' ? ' is-active' : ''}`}
        aria-pressed={value === 'live'}
        onClick={() => onChange('live')}
      >
        <span className="hproj-hint-live-dot" aria-hidden="true" />
        Live
      </button>
    </div>
  );
}

function HprojPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const teamParam = (searchParams.get('team') || '').trim();
  const weekParam = searchParams.get('week');
  const modeParam = searchParams.get('mode') === 'live' ? 'live' : 'pregame';
  const season = CURRENT_YEAR;
  const parsedWeek = Number.parseInt(weekParam, 10);
  const week = Number.isFinite(parsedWeek) && parsedWeek >= 1
    ? parsedWeek
    : getDefaultDisplayWeek(season);
  const missing = !teamParam;

  const [teamMap, setTeamMap] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [injuriesMap, setInjuriesMap] = useState({});
  const [loadError, setLoadError] = useState(null);
  const [percentile, setPercentile] = useState(50);
  const [drawSalt, setDrawSalt] = useState(0);
  const [benchOpen, setBenchOpen] = useState(false);
  const [playerPcts, setPlayerPcts] = useState({});
  const [resultState, setResultState] = useState({ key: null, data: null });
  const [liveResultState, setLiveResultState] = useState({ key: null, data: null });
  const [playerGameLabels, setPlayerGameLabels] = useState({});
  const [weekScoresByRoster, setWeekScoresByRoster] = useState(null);
  const projectedPtsById = useWeeklyProjectedPoints(season, Number.isFinite(week) ? week : 1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [teamData, idMap, injuries] = await Promise.all([
          fetchTeamData(season),
          fetchPlayerIdMap(),
          fetchInjuriesForWeek(season, week),
        ]);
        if (cancelled) return;
        setTeamMap(buildRosterIdToTeamInfoMap(teamData.rosters, teamData.users));
        setPlayerIdMap(idMap);
        setInjuriesMap(injuries || {});
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
    let cancelled = false;
    (async () => {
      try {
        const weeksData = await fetchScoresData(season);
        if (cancelled) return;
        setWeekScoresByRoster(getWeekScoreBreakdown(weeksData, week) || {});
      } catch (_) {
        if (!cancelled) setWeekScoresByRoster({});
      }
    })();
    return () => { cancelled = true; };
  }, [season, week]);

  useEffect(() => {
    setDrawSalt(0);
    setPlayerPcts({});
    setBenchOpen(false);
  }, [teamParam, week, modeParam]);

  const teamInfo = useMemo(
    () => (missing || !teamMap ? null : resolveHprojTeam(teamMap, teamParam)),
    [missing, teamMap, teamParam],
  );

  useEffect(() => {
    if (!playersData || !playerIdMap || !teamInfo) {
      setPlayerGameLabels({});
      return undefined;
    }
    const playerIds = (teamInfo.roster?.players || []).filter((id) => id && String(id) !== '0');
    if (playerIds.length === 0) {
      setPlayerGameLabels({});
      return undefined;
    }
    let cancelled = false;
    fetchNflScoreboard(Number(season), week)
      .then(async (json) => {
        if (cancelled) return;
        const mapping = await mapPlayersToGames(playerIds, playersData, playerIdMap, json, null);
        const labels = {};
        for (const pid of playerIds) {
          const item = mapping[pid];
          const ev = item && item.event;
          const teamForWeek = item && item.team;
          const d = ev ? getGameDisplayForTeam(ev, teamForWeek) : { text: 'BYE', live: false, completed: false };
          labels[pid] = { ...d, team: teamForWeek || null };
        }
        if (!cancelled) setPlayerGameLabels(labels);
      })
      .catch(() => {
        if (!cancelled) setPlayerGameLabels({});
      });
    return () => { cancelled = true; };
  }, [season, week, playersData, playerIdMap, teamInfo]);

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
          href: `/hproj?team=${encodeURIComponent(teamQueryValue(packed, firstNameCounts))}&week=${week}${modeParam === 'live' ? '&mode=live' : ''}`,
        };
      })
      .sort((a, b) => String(a.owner).localeCompare(String(b.owner)));
  }, [teamMap, week, firstNameCounts, modeParam]);

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
    const next = { team: String(opt.query || opt.rid), week: String(week) };
    if (modeParam === 'live') next.mode = 'live';
    setSearchParams(next);
  }

  function setProjMode(nextMode) {
    const next = { team: teamParam, week: String(week) };
    if (nextMode === 'live') next.mode = 'live';
    setSearchParams(next);
  }

  const gamesStarted = weekHasStartedGames(playerGameLabels);
  const projMode = modeParam === 'live' ? 'live' : 'pregame';
  const outPlayerIds = useMemo(
    () => collectOutPlayerIds(teamInfo?.roster?.players, injuriesMap, playersData, playerIdMap),
    [teamInfo, injuriesMap, playersData, playerIdMap],
  );
  const lockedPtsById = useMemo(() => {
    if (!teamInfo || !weekScoresByRoster) return {};
    const rid = teamInfo.rid;
    const score = weekScoresByRoster[rid] || weekScoresByRoster[String(rid)] || weekScoresByRoster[Number(rid)];
    return lockedPtsFromCompletedGames(score, playerGameLabels, {
      projectedPtsById,
      outPlayerIds,
    });
  }, [teamInfo, weekScoresByRoster, playerGameLabels, projectedPtsById, outPlayerIds]);
  const liveScaleById = useMemo(() => {
    if (!teamInfo || !weekScoresByRoster) return {};
    const rid = teamInfo.rid;
    const score = weekScoresByRoster[rid] || weekScoresByRoster[String(rid)] || weekScoresByRoster[Number(rid)];
    return liveScaleFromInProgressGames(score, playerGameLabels, {
      projectedPtsById,
      outPlayerIds,
    });
  }, [teamInfo, weekScoresByRoster, playerGameLabels, projectedPtsById, outPlayerIds]);
  const lockedSig = useMemo(
    () => JSON.stringify({ lockedPtsById, liveScaleById }),
    [lockedPtsById, liveScaleById],
  );

  const canSimulate = Boolean(
    !missing
    && teamInfo
    && playersData
    && projectedPtsById
    && Object.keys(projectedPtsById).length > 0,
  );
  const simKey = canSimulate ? `${teamInfo.rid}-${season}-${week}` : null;
  const liveSimKey = canSimulate && (Object.keys(lockedPtsById).length || Object.keys(liveScaleById).length)
    ? `${simKey}-live-${lockedSig}`
    : null;
  const pregameResult = resultState.key === simKey ? resultState.data : null;
  const liveResult = liveResultState.key === liveSimKey ? liveResultState.data : null;
  const result = projMode === 'live' && liveResult ? liveResult : pregameResult;

  useEffect(() => {
    if (!simKey) return undefined;
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      const playerIds = teamInfo.roster?.players || [];
      const playerPositions = {};
      for (const pid of playerIds) {
        const rec = playersData[pid] || playersData[String(pid)];
        const raw = rec?.position || rec?.fantasy_positions?.[0] || null;
        playerPositions[String(pid)] = skillPosition(raw);
      }
      const next = simulateTeamHproj({
        playerIds,
        projectedPtsById,
        playerPositions,
        seed: simKey,
        keepLineups: true,
      });
      if (!cancelled) setResultState({ key: simKey, data: next });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [simKey, teamInfo, playersData, projectedPtsById]);

  useEffect(() => {
    if (!liveSimKey) {
      setLiveResultState({ key: null, data: null });
      return undefined;
    }
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      const playerIds = teamInfo.roster?.players || [];
      const playerPositions = {};
      for (const pid of playerIds) {
        const rec = playersData[pid] || playersData[String(pid)];
        const raw = rec?.position || rec?.fantasy_positions?.[0] || null;
        playerPositions[String(pid)] = skillPosition(raw);
      }
      const next = simulateTeamHproj({
        playerIds,
        projectedPtsById,
        playerPositions,
        lockedPtsById,
        liveScaleById,
        seed: liveSimKey,
        keepLineups: true,
      });
      if (!cancelled) setLiveResultState({ key: liveSimKey, data: next });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [liveSimKey, teamInfo, playersData, projectedPtsById, lockedPtsById, liveScaleById]);

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
      const lockedPts = Number.isFinite(Number(lockedPtsById[id])) ? Number(lockedPtsById[id]) : null;
      const liveScale = liveScaleById[id] || null;
      const locked = projMode === 'live' && lockedPts != null;
      const live = projMode === 'live' && !locked && liveScale != null;
      rows.push({
        id,
        pos,
        proj: hasProj ? proj : (Number.isFinite(proj) ? proj : null),
        locked,
        lockedPts,
        live,
        liveActual: live ? liveScale.actual : null,
        timeFrac: live ? liveScale.timeFrac : null,
        canSample: skill && hasProj && !locked,
      });
    }
    rows.sort((a, b) => (b.proj || 0) - (a.proj || 0) || String(a.id).localeCompare(String(b.id)));
    return rows;
  }, [teamInfo, playersData, projectedPtsById, lockedPtsById, liveScaleById, projMode]);

  const benchRows = useMemo(() => {
    if (!outcome || !rosterPlayers.length) return [];
    const starterIds = new Set((outcome.starters || []).map((s) => String(s.id)));
    const rows = [];
    for (const row of rosterPlayers) {
      if (starterIds.has(row.id)) continue;
      const sampled = Number(outcome.weekPts?.[row.id]);
      const pct = outcome.playerPctById?.[row.id];
      rows.push({
        slot: 'BENCH',
        id: row.id,
        position: row.pos,
        pts: Number.isFinite(sampled) ? sampled : (row.locked ? row.lockedPts : row.proj),
        playerPct: Number.isFinite(pct) ? pct : null,
        locked: Boolean(row.locked),
        live: Boolean(row.live),
      });
    }
    rows.sort((a, b) => (b.pts || 0) - (a.pts || 0) || String(a.id).localeCompare(String(b.id)));
    return rows;
  }, [outcome, rosterPlayers]);

  const benchTotal = useMemo(
    () => benchRows.reduce((sum, row) => sum + (Number(row.pts) || 0), 0),
    [benchRows],
  );

  const manual = useMemo(() => {
    const outcomes = {};
    const weekPts = {};
    const positions = {};
    const ids = [];
    for (const row of rosterPlayers) {
      const pct = playerPcts[row.id] ?? 50;
      let pts = null;
      if (row.locked) pts = row.lockedPts;
      else if (row.canSample && row.live) {
        const rolled = hprojQuantile(row.pos, row.proj, pct);
        pts = scaledLiveOutcome(row.liveActual, rolled, row.timeFrac);
      } else if (row.canSample) pts = hprojQuantile(row.pos, row.proj, pct);
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

  const waitingLive = projMode === 'live' && liveSimKey && !liveResult;
  const title = teamInfo
    ? `${teamInfo.teamName} · Week ${week} ${projMode === 'live' ? 'Live Proj' : 'HProj'}`
    : 'HProj';

  const scoresHref = `/Scores/Week${week ? `?week=${week}` : ''}`;

  return (
    <InfoPageWrapper
      title={projMode === 'live' ? 'Live Proj' : 'HProj'}
      subtitle={`Week ${week} ${season}`}
      leftHeader={(
        <Link to={scoresHref} className="teams2-back-btn" aria-label="Back to Scores">
          <span className="teams2-back-btn-arrow">←</span>
          <span className="teams2-back-btn-label">Scores</span>
        </Link>
      )}
    >
      <PageMeta title={title} description="Best-ball HProj lineup for a Hwang roster week" />

      {teamOptions.length > 0 && (
        <div className="hproj-page-head">
          <TeamSwitch
            options={teamOptions}
            current={currentOption}
            onSelect={selectTeam}
          />
          {gamesStarted || projMode === 'live' ? (
            <HprojModeToggle value={projMode} onChange={setProjMode} />
          ) : null}
        </div>
      )}
      <MidweekSimBanner season={season} />

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

      {!missing && !loadError && (!result || waitingLive) && (teamInfo || !teamMap) && (
        <LoadingState
          className="hproj-loading"
          label={waitingLive
            ? 'Rolling live outcomes…'
            : (playersData && !canSimulate
              ? 'Waiting for Sleeper weekly projections…'
              : 'Loading roster…')}
          ariaLabel="Loading HProj"
        />
      )}

      {result && result.players === 0 && (
        <p className="hproj-copy">
          No projected skill players on this roster for week {week}.
        </p>
      )}

      {result && result.players > 0 && outcome && !waitingLive && (
        <div className={`hproj-page${projMode === 'live' ? ' hproj-page--live' : ''}`}>
          <div className="hproj-split">
            <section className="hproj-col hproj-col--team">
              <h2 className="hproj-col-title">Team outcome</h2>
              <div className="hproj-hero">
                <div className="hproj-hero-value" style={{ color: hprojHeat(outcome.percentile, HPROJ_TEAM_PCT_MAX) }}>{fmt(outcome.total)}</div>
                <div className="hproj-hero-label" style={{ color: hprojHeat(outcome.percentile, HPROJ_TEAM_PCT_MAX) }}>Random P{formatTeamPercentile(outcome.percentile)} outcome</div>
                <div className="hproj-hero-sub">
                  {signed(outcome.total - result.naiveTotal)} vs {projMode === 'live' ? 'live' : 'starter'} proj {fmt(result.naiveTotal)}
                </div>
              </div>

              <PercentileSlider
                value={percentile}
                onChange={setPercentile}
                ariaLabel="Team outcome percentile"
                min={0}
                max={HPROJ_TEAM_PCT_MAX}
                step={0.1}
              />

              <div className="hproj-regen-row">
                <button
                  type="button"
                  className="hproj-regen"
                  onClick={() => setDrawSalt((n) => n + 1)}
                >
                  Regenerate P{formatTeamPercentile(percentile)} outcome
                </button>
                <button
                  type="button"
                  className="hproj-regen"
                  onClick={() => {
                    setPercentile(Math.round(Math.random() * 999) / 10);
                    setDrawSalt((n) => n + 1);
                  }}
                >
                  Generate Random Outcome
                </button>
              </div>

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
                  <LineupRow
                    key={p.slot}
                    p={p}
                    playersData={playersData}
                    playerIdMap={playerIdMap}
                    injuriesMap={injuriesMap}
                    showPos={/FLEX|SUPER/i.test(p.slot) ? p.position : null}
                    liveScale={liveScaleById[p.id] || liveScaleById[String(p.id)] || null}
                    gameLabel={playerGameLabels[p.id] || playerGameLabels[String(p.id)] || null}
                  />
                ))}
                {benchRows.length > 0 ? (
                  <>
                    <button
                      type="button"
                      className="hproj-bench-toggle"
                      aria-expanded={benchOpen}
                      onClick={() => setBenchOpen((open) => !open)}
                    >
                      <span className="hproj-bench-chevron" aria-hidden="true">{benchOpen ? '▾' : '▸'}</span>
                      <span className="hproj-bench-label">{benchOpen ? 'Hide bench' : 'Show bench'}</span>
                      <span className="hproj-bench-total">{fmt(benchTotal)}</span>
                    </button>
                    {benchOpen ? benchRows.map((p) => (
                      <LineupRow
                        key={p.id}
                        p={p}
                        playersData={playersData}
                        playerIdMap={playerIdMap}
                        injuriesMap={injuriesMap}
                        showPos={p.position}
                        liveScale={liveScaleById[p.id] || liveScaleById[String(p.id)] || null}
                        gameLabel={playerGameLabels[p.id] || playerGameLabels[String(p.id)] || null}
                      />
                    )) : null}
                  </>
                ) : null}
              </div>

              <p className="hproj-footnote">
                One simulated week from the P{formatTeamPercentile(outcome.percentile)} band
                {' '}({outcome.window.toLocaleString()} of {result.iterations.toLocaleString()} draws).
              </p>
            </section>

            <section className="hproj-col hproj-col--players">
              <h2 className="hproj-col-title">Player outcomes</h2>
              <div className="hproj-hero">
                <div className="hproj-hero-value">{fmt(manual.total)}</div>
                <div className="hproj-hero-label">Manual bestball</div>
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
                Not player-specific. Injury tags are current status only.
                {projMode === 'live'
                  ? ' Completed games and Out players lock at their actual score. Live games add that score plus a rolled pregame outcome scaled by time remaining.'
                  : ''}
              </p>

              <div className="hproj-player-list">
                {rosterPlayers.map((row) => {
                  const { pct, pts } = manual.outcomes[row.id] || { pct: 50, pts: row.proj };
                  const lockedPct = row.locked
                    ? hprojPercentile(row.pos, row.proj, row.lockedPts)
                    : null;
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
                        injuriesMap={injuriesMap}
                        showPos={row.pos}
                        live={row.live}
                        liveActual={row.liveActual}
                        liveClock={row.live
                          ? formatLiveClock(
                            playerGameLabels[row.id] || playerGameLabels[String(row.id)],
                            row.timeFrac,
                          )
                          : null}
                      />
                      <div className="hproj-player-row-nums">
                        <span
                          className={`hproj-player-row-pts${row.locked ? ' hproj-player-row-pts--final' : ''}`}
                          style={row.canSample ? { color: hprojHeat(pct) } : undefined}
                        >
                          {fmt(pts)}
                        </span>
                        <span className="hproj-player-row-meta">
                          {row.locked ? (
                            <span className="hproj-lineup-rate--final">
                              FINAL
                              {lockedPct != null ? ` - P${lockedPct} outcome` : ''}
                            </span>
                          ) : row.canSample ? (
                            <span style={{ color: hprojHeat(pct) }}>
                              {row.live
                                ? `P${pct} outcome`
                                : `P${pct} · proj ${fmt(row.proj)} · ${signed((pts ?? 0) - row.proj)}`}
                            </span>
                          ) : (
                            (row.proj != null ? `proj ${fmt(row.proj)}` : 'no projection')
                          )}
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
                          style={{ accentColor: hprojHeat(pct) }}
                        />
                      ) : row.locked ? null : (
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
