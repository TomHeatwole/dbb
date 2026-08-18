import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getPlayerInfo } from '../lookups/PlayerLookup';
import { getPlayerSeasonTotalsMap } from '../scores/ScoresParser';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import { CURRENT_YEAR, getCompletedWeeksCount, isPreSeason as isPreSeasonYear } from '../utils/DateHelper';
import { computeTeamPlayerHvorpStats, PLAYOFF_START_WEEK } from './computePlayerHvorpStats';
import LoadingState from '../LoadingState';
import PositionBadge from '../PositionBadge';

function fmtNum(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

function hvorpTone(v) {
  if (v > 0) return 'player-analytics-num--pos';
  if (v < 0) return 'player-analytics-num--neg';
  return '';
}

function PlayerAnalytics({
  weeksParsedData,
  roster,
  playersData,
  playerIdMap,
  season,
  updateQueryParams,
}) {
  const [searchParams] = useSearchParams();
  const selectedPlayerId = searchParams.get('player');
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

  const selectedRow = useMemo(
    () => rows.find((r) => String(r.playerId) === String(selectedPlayerId)) || null,
    [rows, selectedPlayerId],
  );

  if (!playersData || !playerIdMap || weeksParsedData == null) {
    return <LoadingState label="Loading player analytics..." />;
  }

  if (selectedPlayerId) {
    return (
      <PlayerAnalyticsDetail
        row={selectedRow}
        playersData={playersData}
        playerIdMap={playerIdMap}
        onBack={() => updateQueryParams({ player: null })}
      />
    );
  }

  return (
    <div className="player-analytics">
      <div className="player-analytics-intro">
        <h2 className="player-analytics-title">Player Analytics</h2>
        <p className="player-analytics-subtitle">
          Roster ordered by HVORP — starter points this lineup would lose if the player were
          removed. HVORP/G divides by games with a score. Playoff HVORP is weeks {PLAYOFF_START_WEEK}–17.
          Click a player for more.
        </p>
      </div>

      {isPreSeason && (
        <div className="player-analytics-banner">
          Season hasn&apos;t started yet. HVORP fills in after each completed NFL week.
        </div>
      )}

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
              return (
                <tr
                  key={row.playerId}
                  className="player-analytics-row player-clickable"
                  onClick={() => updateQueryParams({ player: row.playerId })}
                >
                  <td className="player-analytics-rank">{idx + 1}</td>
                  <td className="player-analytics-player">
                    <div className="player-analytics-player-inner">
                      <img src={getPlayerLogoUrl(info?.espn_photo_url)} alt="" className="player-analytics-avatar" />
                      <span className="player-analytics-name">{name}</span>
                      {pos && <PositionBadge position={pos} />}
                    </div>
                  </td>
                  <td className={`player-analytics-num ${hvorpTone(row.hvorp)}`}>{fmtNum(row.hvorp)}</td>
                  <td className={`player-analytics-num ${hvorpTone(row.hvorpPerGame)}`}>{fmtNum(row.hvorpPerGame, 2)}</td>
                  <td className="player-analytics-num">{fmtNum(row.totalScore)}</td>
                  <td className={`player-analytics-num ${hvorpTone(row.playoffHvorp)}`}>
                    {completedWeeks < PLAYOFF_START_WEEK && String(season) === String(CURRENT_YEAR)
                      ? '—'
                      : fmtNum(row.playoffHvorp)}
                  </td>
                  <td className="player-analytics-num">{row.gamesPlayed}</td>
                  <td className="player-analytics-num">{row.weeksStarted}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlayerAnalyticsDetail({ row, playersData, playerIdMap, onBack }) {
  const info = row ? getPlayerInfo(row.playerId, playersData, playerIdMap) : null;
  const chartData = useMemo(() => {
    if (!row?.weekly?.length) return [];
    return row.weekly.map((w) => ({
      name: `W${w.week}`,
      hvorp: w.hvorp,
      pts: w.pts,
    }));
  }, [row]);

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

  const name = info.name || row.playerId;
  const team = info.team || info.team_abbr || null;

  return (
    <div className="player-analytics player-analytics--detail">
      <button type="button" className="player-analytics-back" onClick={onBack}>
        ← Roster HVORP
      </button>

      <div className="player-analytics-detail-header">
        <img src={getPlayerLogoUrl(info.espn_photo_url)} alt="" className="player-analytics-detail-photo" />
        <div className="player-analytics-detail-id">
          <div className="player-analytics-detail-name-row">
            <h2 className="player-analytics-detail-name">{name}</h2>
            {info.position && <PositionBadge position={info.position} />}
          </div>
          <div className="player-analytics-detail-meta">
            {team && <span>{team}</span>}
            {info.age != null && <span>Age {info.age}</span>}
          </div>
        </div>
      </div>

      <div className="player-analytics-stat-grid">
        <StatCard label="HVORP" value={fmtNum(row.hvorp)} tone={hvorpTone(row.hvorp)} />
        <StatCard label="HVORP/G" value={fmtNum(row.hvorpPerGame, 2)} tone={hvorpTone(row.hvorpPerGame)} />
        <StatCard label="Total Pts" value={fmtNum(row.totalScore)} />
        <StatCard label="PPG" value={fmtNum(row.ppg, 2)} />
        <StatCard label="Yoff HVORP" value={fmtNum(row.playoffHvorp)} tone={hvorpTone(row.playoffHvorp)} />
        <StatCard label="GP" value={String(row.gamesPlayed)} />
        <StatCard label="Starts" value={String(row.weeksStarted)} />
        <StatCard label="Benched" value={String(row.weeksBenched)} />
      </div>

      <div className="player-analytics-chart-card">
        <h3 className="player-analytics-chart-title">Weekly HVORP</h3>
        {chartData.length === 0 ? (
          <div className="player-analytics-chart-empty">No completed weeks yet.</div>
        ) : (
          <div className="player-analytics-chart-inner">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f1430', border: '1px solid #3a4466', color: '#fff' }}
                  labelStyle={{ color: '#fff', fontWeight: 700 }}
                />
                <Line type="monotone" dataKey="hvorp" stroke="#a5b4fc" strokeWidth={2} name="HVORP" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="player-analytics-chart-card player-analytics-chart-card--shell">
        <h3 className="player-analytics-chart-title">More graphs</h3>
        <p className="player-analytics-shell-copy">
          Usage, score vs replacement, and playoff splits will land here. This is the shell —
          we&apos;ll iterate on exactly what to include.
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }) {
  return (
    <div className="player-analytics-stat">
      <span className={`player-analytics-stat-value ${tone || ''}`}>{value}</span>
      <span className="player-analytics-stat-label">{label}</span>
    </div>
  );
}

export default PlayerAnalytics;
