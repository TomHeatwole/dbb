import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import NewTabLink from '../components/NewTabLink';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { getPlayerInfo } from '../lookups/PlayerLookup';
import { getPlayerSeasonTotalsMap } from '../scores/ScoresParser';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import { CURRENT_YEAR, getCompletedWeeksCount, isPreSeason as isPreSeasonYear } from '../utils/DateHelper';
import {
  computeTeamPlayerHvorpStats,
  PLAYOFF_START_WEEK,
  buildRosterIdMap,
  dropPlayerFromRosterMap,
  summarizeWithoutPlayerEval,
} from './computePlayerHvorpStats';
import { computeScenarioEval } from '../scenarios/computeScenarioEval';
import { encodeScenario } from '../scenarios/scenarioEncoding';
import { isFeatureEnabled, MAIN_FEATURES } from '../utils/featureToggles';
import LoadingState from '../LoadingState';
import PositionBadge from '../PositionBadge';
import useIsMobile from '../hooks/useIsMobile';

function fmtNum(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

function hvorpTone(v) {
  if (v > 0) return 'player-analytics-num--pos';
  if (v < 0) return 'player-analytics-num--neg';
  return '';
}

function playoffHvorpDisplay(row, season, completedWeeks) {
  if (completedWeeks < PLAYOFF_START_WEEK && String(season) === String(CURRENT_YEAR)) return null;
  return row?.playoffHvorp;
}

function ordinal(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = n % 100;
  const suffix = (v >= 11 && v <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${suffix}`;
}

function fmtPts(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function fmtSigned(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v).toFixed(1);
  if (v > 0) return `+${abs}`;
  if (v < 0) return `−${abs}`;
  return abs;
}

function playerDisplayName(playerId, playersData, playerIdMap, fallback) {
  if (!playerId) return fallback || '—';
  return getPlayerInfo(playerId, playersData, playerIdMap)?.name || fallback || String(playerId);
}

function hvorpSeasonTipLines(row, playersData, playerIdMap) {
  if (!row) return [];
  const slots = Object.entries(row.slotCounts || {})
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([slot, n]) => `${slot} ×${n}`);
  const lines = [
    `${fmtNum(row.hvorp)} HVORP`,
    `${fmtNum(row.totalScore)} pts · ${row.weeksStarted} start${row.weeksStarted === 1 ? '' : 's'} · ${row.gamesPlayed} GP`,
  ];
  lines.push(slots.length ? slots.join(' · ') : 'Did not start');
  if (row.topReplacementId) {
    const name = playerDisplayName(row.topReplacementId, playersData, playerIdMap);
    lines.push(`Most often the bench-in was ${name}`);
  }
  return lines;
}

function HoverLines({ children, lines, placement = 'below' }) {
  if (!lines?.length) return children;
  return (
    <span className={`player-analytics-hover player-analytics-hover--${placement}`}>
      {children}
      <span className="player-analytics-hover-tip" role="tooltip">
        {lines.map((line, i) => (
          <span
            key={`${i}-${line}`}
            className={`player-analytics-hover-line${i === 0 ? ' player-analytics-hover-line--title' : ''}`}
          >
            {line}
          </span>
        ))}
      </span>
    </span>
  );
}

function WeeklyHvorpTooltip({ active, payload, playerName, playersData, playerIdMap }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const deltaTone = d.hvorp > 0
    ? 'player-analytics-hvorp-tooltip-delta--pos'
    : d.hvorp < 0
      ? 'player-analytics-hvorp-tooltip-delta--neg'
      : '';
  const replacementName = d.replacementId
    ? playerDisplayName(d.replacementId, playersData, playerIdMap)
    : null;

  const startedLabel = d.slot ? `started ${d.slot}` : 'started';
  const benchInLabel = d.replacementSlot
    ? `would start ${d.replacementSlot}`
    : 'would start';

  return (
    <div className="player-analytics-hvorp-tooltip">
      <div className="player-analytics-hvorp-tooltip-week">
        Week {d.week}{d.isPlayoff ? ' · Yoff' : ''}
      </div>
      {d.started ? (
        <>
          <div className="player-analytics-hvorp-tooltip-kicker">Score</div>
          <div className="player-analytics-hvorp-tooltip-row">
            <span className="player-analytics-hvorp-tooltip-who">
              <span className="player-analytics-hvorp-tooltip-name">{playerName || 'Starter'}</span>
              <span className="player-analytics-hvorp-tooltip-role">{startedLabel}</span>
            </span>
            <span className="player-analytics-hvorp-tooltip-pts">{fmtNum(d.pts)} pts</span>
          </div>
          {replacementName ? (
            <>
              <div className="player-analytics-hvorp-tooltip-kicker player-analytics-hvorp-tooltip-kicker--gap">Replacement</div>
              <div className="player-analytics-hvorp-tooltip-row">
                <span className="player-analytics-hvorp-tooltip-who">
                  <span className="player-analytics-hvorp-tooltip-name">{replacementName}</span>
                  <span className="player-analytics-hvorp-tooltip-role">{benchInLabel}</span>
                </span>
                <span className="player-analytics-hvorp-tooltip-pts">{fmtNum(d.replacementPts)} pts</span>
              </div>
            </>
          ) : (
            <div className="player-analytics-hvorp-tooltip-note">No one on the bench could fill a slot</div>
          )}
        </>
      ) : (
        <div className="player-analytics-hvorp-tooltip-note">
          {d.played ? `Benched · ${fmtNum(d.pts)} pts` : 'Did not play'}
        </div>
      )}
      <div className={`player-analytics-hvorp-tooltip-delta ${deltaTone}`}>
        HVORP {fmtSigned(d.hvorp)}
      </div>
    </div>
  );
}

function WeeklyHvorpChart({ weekly, playerName, playersData, playerIdMap }) {
  const chartData = useMemo(() => {
    if (!weekly?.length) return [];
    return weekly.map((w) => ({ name: `W${w.week}`, ...w }));
  }, [weekly]);

  if (chartData.length === 0) {
    return <div className="player-analytics-chart-empty">No completed weeks yet.</div>;
  }

  return (
    <div className="player-analytics-chart-inner player-analytics-chart-inner--thin">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} padding={{ left: 4, right: 10 }} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={48} />
          <Tooltip
            cursor={{ stroke: 'rgba(165, 180, 252, 0.35)', strokeWidth: 1 }}
            allowEscapeViewBox={{ x: false, y: true }}
            wrapperStyle={{ zIndex: 30, outline: 'none', pointerEvents: 'none' }}
            content={(props) => (
              <WeeklyHvorpTooltip
                {...props}
                playerName={playerName}
                playersData={playersData}
                playerIdMap={playerIdMap}
              />
            )}
          />
          <Line
            type="monotone"
            dataKey="hvorp"
            stroke="#a5b4fc"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: '#c7d2fe', strokeWidth: 1, fill: '#a5b4fc' }}
            name="HVORP"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ScenarioWithoutTooltip({ active, payload, playerName }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const orig = payload.find((p) => p.dataKey === 'original');
  const without = payload.find((p) => p.dataKey === 'without');
  const origVal = orig ? Number(orig.value) : 0;
  const withoutVal = without ? Number(without.value) : 0;
  const delta = withoutVal - origVal;
  const deltaTone = delta > 0
    ? 'player-analytics-hvorp-tooltip-delta--pos'
    : delta < 0
      ? 'player-analytics-hvorp-tooltip-delta--neg'
      : '';

  return (
    <div className="player-analytics-hvorp-tooltip">
      <div className="player-analytics-hvorp-tooltip-week">{d.name}{d.week >= PLAYOFF_START_WEEK ? ' · Yoff' : ''}</div>
      <div className="player-analytics-hvorp-tooltip-row">
        <span className="player-analytics-hvorp-tooltip-name">Actual lineup</span>
        <span className="player-analytics-hvorp-tooltip-pts">{fmtNum(origVal)}</span>
      </div>
      <div className="player-analytics-hvorp-tooltip-row">
        <span className="player-analytics-hvorp-tooltip-name">Without {playerName || 'player'}</span>
        <span className="player-analytics-hvorp-tooltip-pts">{fmtNum(withoutVal)}</span>
      </div>
      <div className={`player-analytics-hvorp-tooltip-delta ${deltaTone}`}>
        {fmtSigned(delta)}
      </div>
    </div>
  );
}

function ScenarioWithoutChart({ preview, playerName, completedWeeks }) {
  const chartData = useMemo(() => {
    const n = Number.isFinite(completedWeeks) ? Math.max(0, completedWeeks) : 17;
    return (preview?.weekly || [])
      .filter((w) => w.week <= n)
      .map((w) => ({
        name: `W${w.week}`,
        week: w.week,
        original: w.original,
        without: w.scenario,
      }));
  }, [preview, completedWeeks]);

  const { yMin, yMax } = useMemo(() => {
    const vals = chartData.flatMap((d) => [d.original, d.without]).filter((v) => v > 0);
    if (vals.length === 0) return { yMin: 0, yMax: 150 };
    return {
      yMin: Math.max(0, Math.floor((Math.min(...vals) - 10) / 10) * 10),
      yMax: Math.ceil((Math.max(...vals) + 10) / 10) * 10,
    };
  }, [chartData]);

  if (chartData.length === 0) return null;

  return (
    <div className="player-analytics-chart-inner player-analytics-chart-inner--scenario">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 6, right: 16, left: 8, bottom: 0 }}>
          <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} padding={{ left: 4, right: 10 }} />
          <YAxis domain={[yMin, yMax]} tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={48} />
          {chartData.some((d) => d.week === PLAYOFF_START_WEEK) && (
            <ReferenceLine
              x={`W${PLAYOFF_START_WEEK}`}
              stroke="rgba(180,140,40,0.45)"
              strokeDasharray="4 3"
            />
          )}
          <Tooltip
            cursor={{ stroke: 'rgba(165, 180, 252, 0.35)', strokeWidth: 1 }}
            allowEscapeViewBox={{ x: false, y: true }}
            wrapperStyle={{ zIndex: 30, outline: 'none', pointerEvents: 'none' }}
            content={(props) => <ScenarioWithoutTooltip {...props} playerName={playerName} />}
          />
          <Line
            type="monotone"
            dataKey="original"
            stroke="rgba(140,160,220,0.7)"
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={false}
            activeDot={{ r: 4, fill: 'rgba(140,160,220,0.95)' }}
            name="Actual"
          />
          <Line
            type="monotone"
            dataKey="without"
            stroke="#7c9cff"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4, fill: '#a0b8ff' }}
            name="Without"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function PlayerAnalytics({
  weeksParsedData,
  roster,
  rosters,
  teamName,
  playersData,
  playerIdMap,
  season,
  updateQueryParams,
}) {
  const [searchParams] = useSearchParams();
  const selectedPlayerId = searchParams.get('player');
  const isMobile = useIsMobile();
  const isPreSeason = isPreSeasonYear(season);
  const completedWeeks = getCompletedWeeksCount(season);

  const playerSeasonTotalsMap = useMemo(
    () => getPlayerSeasonTotalsMap(weeksParsedData),
    [weeksParsedData],
  );

  const rows = useMemo(() => {
    if (!playersData || !playerIdMap) return [];
    return computeTeamPlayerHvorpStats({
      rosterPlayerIds: roster?.players || [],
      weeksParsedData,
      playersData,
      playerIdMap,
      playerSeasonTotalsMap,
      weekCount: String(season) === String(CURRENT_YEAR) ? completedWeeks : 17,
    });
  }, [roster, weeksParsedData, playersData, playerIdMap, playerSeasonTotalsMap, season, completedWeeks]);

  const selectedRow = useMemo(() => {
    const fromUrl = rows.find((r) => String(r.playerId) === String(selectedPlayerId));
    if (fromUrl) return fromUrl;
    return isMobile ? null : (rows[0] || null);
  }, [rows, selectedPlayerId, isMobile]);

  const originalRosters = useMemo(() => buildRosterIdMap(rosters), [rosters]);

  const withoutPreview = useMemo(() => {
    if (!selectedRow || !playersData || !playerIdMap || !weeksParsedData) return null;
    if (isPreSeason) return null;
    const rid = Number(roster?.roster_id);
    if (!Number.isFinite(rid)) return null;
    const onRoster = (originalRosters[rid] || []).some((pid) => String(pid) === String(selectedRow.playerId));
    if (!onRoster) return null;
    try {
      const scenarioRosters = dropPlayerFromRosterMap(originalRosters, rid, selectedRow.playerId);
      const evalResult = computeScenarioEval(
        weeksParsedData,
        originalRosters,
        scenarioRosters,
        playersData,
        playerIdMap,
      );
      const summary = summarizeWithoutPlayerEval(evalResult, rid);
      if (!summary) return null;
      const encoded = encodeScenario(String(season), originalRosters, scenarioRosters);
      return {
        ...summary,
        search: `?${new URLSearchParams({ state: 'eval', scenario: encoded }).toString()}`,
      };
    } catch (_) {
      return null;
    }
  }, [selectedRow, playersData, playerIdMap, weeksParsedData, isPreSeason, roster, originalRosters, season]);

  if (!playersData || !playerIdMap || weeksParsedData == null) {
    return <LoadingState label="Loading HVORP analytics..." />;
  }

  if (isMobile && selectedPlayerId) {
    return (
      <PlayerAnalyticsDetail
        row={selectedRow}
        playersData={playersData}
        playerIdMap={playerIdMap}
        season={season}
        completedWeeks={completedWeeks}
        teamName={teamName}
        withoutPreview={withoutPreview}
        onBack={() => updateQueryParams({ player: null })}
      />
    );
  }

  const selectPlayer = (playerId) => updateQueryParams({ player: playerId });

  return (
    <div className={`player-analytics${isMobile ? '' : ' player-analytics--web'}`}>
      {isMobile && (
        <div className="player-analytics-intro">
          <h2 className="player-analytics-title">HVORP Analytics</h2>
          <p className="player-analytics-subtitle">
            Roster ordered by HVORP. Tap a player for more.
          </p>
        </div>
      )}

      {isPreSeason && (
        <div className="player-analytics-banner">
          Season hasn&apos;t started yet. HVORP fills in after each completed NFL week.
        </div>
      )}

      {!isMobile && (
        <PlayerAnalyticsTop
          row={selectedRow}
          playersData={playersData}
          playerIdMap={playerIdMap}
          season={season}
          completedWeeks={completedWeeks}
          teamName={teamName}
          withoutPreview={withoutPreview}
        />
      )}

      {isMobile ? (
        <PlayerAnalyticsTable
          rows={rows}
          playersData={playersData}
          playerIdMap={playerIdMap}
          season={season}
          completedWeeks={completedWeeks}
          onSelect={selectPlayer}
        />
      ) : (
        <PlayerAnalyticsBoard
          rows={rows}
          selectedPlayerId={selectedRow?.playerId}
          playersData={playersData}
          playerIdMap={playerIdMap}
          season={season}
          completedWeeks={completedWeeks}
          onSelect={selectPlayer}
        />
      )}
    </div>
  );
}

function PlayerAnalyticsTop({ row, playersData, playerIdMap, season, completedWeeks, teamName, withoutPreview }) {
  const info = row ? getPlayerInfo(row.playerId, playersData, playerIdMap) : null;
  const playerName = info?.name || row?.playerId;
  const yoff = playoffHvorpDisplay(row, season, completedWeeks);

  return (
    <div className="player-analytics-top">
      <div className="player-analytics-top-head">
        {info ? (
          <div className="player-analytics-top-player">
            <img src={getPlayerLogoUrl(info.espn_photo_url)} alt="" className="player-analytics-top-avatar" />
            <div className="player-analytics-top-id">
              <div className="player-analytics-top-name-row">
                <span className="player-analytics-top-name">{playerName}</span>
                {info.position && <PositionBadge position={info.position} />}
              </div>
            </div>
          </div>
        ) : null}
        {row && (
          <CompactStatBar
            items={[
              {
                label: 'HVORP',
                value: fmtNum(row.hvorp),
                tone: hvorpTone(row.hvorp),
                tip: hvorpSeasonTipLines(row, playersData, playerIdMap),
              },
              { label: 'HVORP/G', value: fmtNum(row.hvorpPerGame, 2), tone: hvorpTone(row.hvorpPerGame) },
              { label: 'Pts', value: fmtNum(row.totalScore) },
              { label: 'PPG', value: fmtNum(row.ppg, 2) },
              { label: 'Yoff', value: fmtNum(yoff), tone: hvorpTone(yoff) },
              { label: 'GP', value: String(row.gamesPlayed) },
              { label: 'Starts', value: String(row.weeksStarted) },
            ]}
          />
        )}
      </div>
      <WithoutPlayerPreview
        teamName={teamName}
        playerName={playerName}
        preview={withoutPreview}
        completedWeeks={completedWeeks}
      />
      <div className="player-analytics-hvorp-block">
        <div className="player-analytics-chart-label">Weekly HVORP</div>
        <WeeklyHvorpChart
          weekly={row?.weekly}
          playerName={playerName}
          playersData={playersData}
          playerIdMap={playerIdMap}
        />
      </div>
    </div>
  );
}

function WithoutPlayerPreview({ teamName, playerName, preview, completedWeeks }) {
  if (!preview || !playerName) return null;

  const placeTone = preview.placeDiff > 0
    ? 'player-analytics-without-move--up'
    : preview.placeDiff < 0
      ? 'player-analytics-without-move--down'
      : '';
  const ptsTone = preview.ptsDelta > 0
    ? 'player-analytics-num--pos'
    : preview.ptsDelta < 0
      ? 'player-analytics-num--neg'
      : '';
  const yoffTone = preview.yoffDelta > 0
    ? 'player-analytics-num--pos'
    : preview.yoffDelta < 0
      ? 'player-analytics-num--neg'
      : '';
  const worstTone = preview.worstWeek?.delta > 0
    ? 'player-analytics-num--pos'
    : preview.worstWeek?.delta < 0
      ? 'player-analytics-num--neg'
      : '';

  let playoffLabel = null;
  if (preview.origPlayoff && !preview.scenPlayoff) {
    playoffLabel = 'Missed playoffs';
  } else if (!preview.origPlayoff && preview.scenPlayoff) {
    playoffLabel = 'Made playoffs';
  } else if (preview.origPlayoff && preview.scenPlayoff) {
    playoffLabel = `Yoff ${fmtPts(preview.yoffFrom)} → ${fmtPts(preview.yoffTo)}`;
  } else if ((preview.yoffFrom || preview.yoffTo) && Math.abs(preview.yoffDelta) >= 0.05) {
    playoffLabel = `W15–17 ${fmtPts(preview.yoffFrom)} → ${fmtPts(preview.yoffTo)}`;
  }

  const ppgFrom = preview.ptsFrom != null ? preview.ptsFrom / 14 : null;
  const ppgTo = preview.ptsTo != null ? preview.ptsTo / 14 : null;
  const showWorst = preview.worstWeek && Math.abs(preview.worstWeek.delta) >= 0.05;
  const showScenariosLink = isFeatureEnabled('SCENARIOS_ENABLED', MAIN_FEATURES) && preview.search;

  return (
    <div className="player-analytics-without">
      <div className="player-analytics-without-head">
        <div className="player-analytics-without-title">
          {teamName || 'This team'}&apos;s season without {playerName}
        </div>
        {showScenariosLink && (
          <NewTabLink
            to={{ pathname: '/scenarios', search: preview.search }}
            className="player-analytics-without-btn"
          >
            See full scenario
          </NewTabLink>
        )}
      </div>
      <div className="player-analytics-without-metrics">
        <span className={`player-analytics-without-place ${placeTone}`}>
          {ordinal(preview.placeFrom)} → {ordinal(preview.placeTo)}
          {preview.placeDiff < 0 ? ` ↓${Math.abs(preview.placeDiff)}` : ''}
          {preview.placeDiff > 0 ? ` ↑${preview.placeDiff}` : ''}
        </span>
        <span className="player-analytics-without-pts">
          14-wk {fmtPts(preview.ptsFrom)} → {fmtPts(preview.ptsTo)}
          <span className={ptsTone}> ({fmtSigned(preview.ptsDelta)})</span>
        </span>
        <span className="player-analytics-without-pts">
          PPG {fmtNum(ppgFrom, 1)} → {fmtNum(ppgTo, 1)}
        </span>
        {playoffLabel && (
          <span className={`player-analytics-without-yoff${preview.origPlayoff && !preview.scenPlayoff ? ' player-analytics-without-yoff--miss' : ''}`}>
            {playoffLabel}
            {((preview.origPlayoff && preview.scenPlayoff) || (!preview.origPlayoff && !preview.scenPlayoff)) && preview.yoffDelta ? (
              <span className={yoffTone}> ({fmtSigned(preview.yoffDelta)})</span>
            ) : null}
          </span>
        )}
        {showWorst && (
          <span className="player-analytics-without-pts">
            Worst W{preview.worstWeek.week}
            <span className={worstTone}> ({fmtSigned(preview.worstWeek.delta)})</span>
          </span>
        )}
      </div>
      <div className="player-analytics-without-legend" aria-hidden="true">
        <span className="player-analytics-without-legend-item">
          <span className="player-analytics-without-legend-line player-analytics-without-legend-line--actual" />
          Actual
        </span>
        <span className="player-analytics-without-legend-item">
          <span className="player-analytics-without-legend-line player-analytics-without-legend-line--without" />
          Without {playerName}
        </span>
      </div>
      <ScenarioWithoutChart
        preview={preview}
        playerName={playerName}
        completedWeeks={completedWeeks}
      />
    </div>
  );
}

function CompactStatBar({ items }) {
  return (
    <div className="player-analytics-stat-bar">
      {items.map((item, i) => (
        <React.Fragment key={item.label}>
          {i > 0 && <span className="player-analytics-stat-bar-div" />}
          <div className="player-analytics-stat-bar-item">
            <HoverLines lines={item.tip} placement="below">
              <span className={`player-analytics-stat-bar-value ${item.tone || ''}`}>{item.value}</span>
            </HoverLines>
            <span className="player-analytics-stat-bar-label">{item.label}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

function PlayerAnalyticsBoard({
  rows,
  selectedPlayerId,
  playersData,
  playerIdMap,
  season,
  completedWeeks,
  onSelect,
}) {
  const split = Math.ceil(rows.length / 2);
  const columns = [rows.slice(0, split), rows.slice(split)];

  return (
    <div className="player-analytics-board">
      {columns.map((colRows, colIdx) => (
        <div key={colIdx} className="player-analytics-board-col">
          <div className="player-analytics-board-legend" aria-hidden="true">
            <span>Player</span>
            <span className="player-analytics-tile-bar">
              <span className="player-analytics-tile-stat">HVORP</span>
              <span className="player-analytics-tile-stat">/G</span>
              <span className="player-analytics-tile-stat">Pts</span>
              <span className="player-analytics-tile-stat">Yoff</span>
            </span>
          </div>
          {colRows.map((row, i) => {
            const idx = (colIdx === 0 ? 0 : split) + i;
            const info = getPlayerInfo(row.playerId, playersData, playerIdMap);
            const name = info?.name || row.playerId;
            const pos = info?.position || '';
            const yoff = playoffHvorpDisplay(row, season, completedWeeks);
            const selected = String(row.playerId) === String(selectedPlayerId);
            return (
              <button
                key={row.playerId}
                type="button"
                className={`player-analytics-tile${selected ? ' player-analytics-tile--selected' : ''}`}
                onClick={() => onSelect(row.playerId)}
              >
                <span className="player-analytics-tile-rank">{idx + 1}</span>
                <img src={getPlayerLogoUrl(info?.espn_photo_url)} alt="" className="player-analytics-tile-avatar" />
                <span className="player-analytics-tile-name">{name}</span>
                {pos && <PositionBadge position={pos} />}
                <span className="player-analytics-tile-bar">
                  <HoverLines lines={hvorpSeasonTipLines(row, playersData, playerIdMap)} placement="above">
                    <span className={`player-analytics-tile-stat ${hvorpTone(row.hvorp)}`}>
                      {fmtNum(row.hvorp)}
                    </span>
                  </HoverLines>
                  <span className={`player-analytics-tile-stat ${hvorpTone(row.hvorpPerGame)}`} title="HVORP/G">
                    {fmtNum(row.hvorpPerGame, 2)}
                  </span>
                  <span className="player-analytics-tile-stat" title="Total points">{fmtNum(row.totalScore)}</span>
                  <span className={`player-analytics-tile-stat ${hvorpTone(yoff)}`} title="Playoff HVORP">
                    {fmtNum(yoff)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function PlayerAnalyticsTable({
  rows,
  playersData,
  playerIdMap,
  season,
  completedWeeks,
  onSelect,
}) {
  return (
    <div className="player-analytics-table-scroll">
      <table className="player-analytics-table">
        <thead>
          <tr>
            <th className="player-analytics-th-rank">#</th>
            <th>Player</th>
            <th className="player-analytics-th-num" title="Hwang value over replacement — starter points lost if this player were off the roster">
              HVORP
            </th>
            <th className="player-analytics-th-num" title="HVORP divided by games with a score">
              HVORP/G
            </th>
            <th className="player-analytics-th-num">Pts</th>
            <th className="player-analytics-th-num" title={`HVORP in weeks ${PLAYOFF_START_WEEK}–17`}>
              Yoff HVORP
            </th>
            <th className="player-analytics-th-num">GP</th>
            <th className="player-analytics-th-num">Starts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const info = getPlayerInfo(row.playerId, playersData, playerIdMap);
            const name = info?.name || row.playerId;
            const pos = info?.position || '';
            const yoff = playoffHvorpDisplay(row, season, completedWeeks);
            return (
              <tr
                key={row.playerId}
                className="player-analytics-row player-clickable"
                onClick={() => onSelect(row.playerId)}
              >
                <td className="player-analytics-rank">{idx + 1}</td>
                <td className="player-analytics-player">
                  <div className="player-analytics-player-inner">
                    <img src={getPlayerLogoUrl(info?.espn_photo_url)} alt="" className="player-analytics-avatar" />
                    <span className="player-analytics-name">{name}</span>
                    {pos && <PositionBadge position={pos} />}
                  </div>
                </td>
                <td className={`player-analytics-num ${hvorpTone(row.hvorp)}`}>
                  <HoverLines lines={hvorpSeasonTipLines(row, playersData, playerIdMap)} placement="below">
                    {fmtNum(row.hvorp)}
                  </HoverLines>
                </td>
                <td className={`player-analytics-num ${hvorpTone(row.hvorpPerGame)}`}>{fmtNum(row.hvorpPerGame, 2)}</td>
                <td className="player-analytics-num">{fmtNum(row.totalScore)}</td>
                <td className={`player-analytics-num ${hvorpTone(yoff)}`}>{fmtNum(yoff)}</td>
                <td className="player-analytics-num">{row.gamesPlayed}</td>
                <td className="player-analytics-num">{row.weeksStarted}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PlayerAnalyticsDetail({ row, playersData, playerIdMap, season, completedWeeks, teamName, withoutPreview, onBack }) {
  const info = row ? getPlayerInfo(row.playerId, playersData, playerIdMap) : null;
  const playerName = info?.name || row?.playerId;

  if (!row || !info) {
    return (
      <div className="player-analytics">
        <button type="button" className="player-analytics-back" onClick={onBack}>
          ← Roster HVORP
        </button>
        <div className="player-analytics-banner">Player not found on this roster.</div>
      </div>
    );
  }

  const yoff = playoffHvorpDisplay(row, season, completedWeeks);

  return (
    <div className="player-analytics player-analytics--detail">
      <button type="button" className="player-analytics-back" onClick={onBack}>
        ← Roster HVORP
      </button>

      <div className="player-analytics-detail-header">
        <img src={getPlayerLogoUrl(info.espn_photo_url)} alt="" className="player-analytics-detail-photo" />
        <div className="player-analytics-detail-id">
          <div className="player-analytics-detail-name-row">
            <h2 className="player-analytics-detail-name">{playerName}</h2>
            {info.position && <PositionBadge position={info.position} />}
          </div>
        </div>
      </div>

      <CompactStatBar
        items={[
          {
            label: 'HVORP',
            value: fmtNum(row.hvorp),
            tone: hvorpTone(row.hvorp),
            tip: hvorpSeasonTipLines(row, playersData, playerIdMap),
          },
          { label: 'HVORP/G', value: fmtNum(row.hvorpPerGame, 2), tone: hvorpTone(row.hvorpPerGame) },
          { label: 'Pts', value: fmtNum(row.totalScore) },
          { label: 'PPG', value: fmtNum(row.ppg, 2) },
          { label: 'Yoff', value: fmtNum(yoff), tone: hvorpTone(yoff) },
          { label: 'GP', value: String(row.gamesPlayed) },
          { label: 'Starts', value: String(row.weeksStarted) },
        ]}
      />

      <WithoutPlayerPreview
        teamName={teamName}
        playerName={playerName}
        preview={withoutPreview}
        completedWeeks={completedWeeks}
      />
      <div className="player-analytics-chart-card">
        <h3 className="player-analytics-chart-title">Weekly HVORP</h3>
        <WeeklyHvorpChart
          weekly={row.weekly}
          playerName={playerName}
          playersData={playersData}
          playerIdMap={playerIdMap}
        />
      </div>
    </div>
  );
}

export default PlayerAnalytics;
