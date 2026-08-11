/**
 * Trade Calculator — sandbox tool to compare player packages by ranking value.
 * Preference meter slides toward the favored side; past Hwang trades load in one click.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from '../lookups/PlayerLookup';
import { fetchTeamData, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import {
  fetchKtcData,
  getKtcEntryByName,
  getPickKtcValue,
  formatKtcValue,
} from '../lookups/KtcLookup';
import { loadTruePickChart } from '../lookups/TruePickValueLookup';
import { fetchFantasyCalcData, getFantasyCalcEntry, formatFcValue } from '../lookups/FantasyCalcLookup';
import { fetchFfbData, getFfbEntry, formatFfbRank } from '../lookups/FfbLookup';
import {
  fetchRedraftValueData,
  getRedraftValueEntryByName,
  formatRedraftAdjustedValue,
} from '../lookups/RedraftValueLookup';
import {
  loadHwangPositionMultipliers,
  buildHwangAdjustedLookup,
  buildHwangAdjustedFromEntries,
  getHwangAdjustedEntryByName,
  HWANG_COMPOSITE_COEFFICIENT_KEY,
} from '../lookups/HwangValueAdjustmentLookup';
import {
  TRADE_VALUE_SOURCES,
  TRADE_VALUE_SOURCE_LABELS,
} from '../lookups/tradeValueSources';
import { fetchTransactions, buildTradeSides } from '../lookups/TransactionLookup';
import {
  filterAndSortTrades,
  formatTradeDate,
  formatPickLabel,
} from '../trades/TradeComponents';
import { evaluateKtcStyleTrade } from './ktcValueAdjustment';
import { CURRENT_YEAR, getFuturePickSeasonRange } from '../utils/DateHelper';
import { LEAGUE_ID, PREVIOUS_YEARS } from '../utils/global_constants';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import PositionBadge from '../PositionBadge';
import LoadingState from '../LoadingState';

const ADDABLE_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);
const EVEN_THRESHOLD = 0.1; // within 10% → even coloring
const ALL_YEARS = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)]
  .sort((a, b) => Number(b) - Number(a));
const ROUND_ORDINAL = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };

function buildPickCatalog(ktcMap) {
  // Offer next 3 draft years × rounds 1–4 (True-adjusted mid-tier pick values).
  const { minSeason, maxSeason } = getFuturePickSeasonRange(false);
  const picks = [];
  for (let season = minSeason; season <= maxSeason; season++) {
    for (let round = 1; round <= 4; round++) {
      const label = `${season} ${ROUND_ORDINAL[round] || `${round}th`}`;
      picks.push({
        type: 'pick',
        season: String(season),
        round,
        label,
        value: getPickKtcValue(season, round, CURRENT_YEAR, { ktcMap, tier: 'Mid' }),
      });
    }
  }
  return picks;
}

let pickKeySeq = 0;
function getLeagueId(year) {
  if (String(year) === String(CURRENT_YEAR)) return LEAGUE_ID;
  return PREVIOUS_YEARS[String(year)] || null;
}

/** Relative imbalance in [0, 1]: |L-R| / max(L,R). */
function getImbalance(left, right) {
  const max = Math.max(left, right, 1);
  return Math.abs(left - right) / max;
}

/** Thumb position 0–100; lower = prefers left, higher = prefers right. */
function getPreferencePosition(left, right) {
  const sum = left + right;
  if (sum <= 0) return 50;
  return (right / sum) * 100;
}

/**
 * Even (cool) within 10%; ramps to red as imbalance grows past that.
 * Returns { fill, glow, label }.
 */
function getPreferencePalette(imbalance, hasValues) {
  if (!hasValues) {
    return {
      fill: 'rgba(140, 150, 200, 0.55)',
      glow: 'rgba(140, 150, 200, 0.15)',
      track: 'rgba(80, 90, 140, 0.35)',
      label: 'even',
    };
  }
  if (imbalance <= EVEN_THRESHOLD) {
    return {
      fill: '#7ec8c8',
      glow: 'rgba(126, 200, 200, 0.35)',
      track: 'rgba(90, 160, 160, 0.28)',
      label: 'even',
    };
  }
  // 10% → ~50%+ maps to soft rose → hot red
  const t = Math.min(1, (imbalance - EVEN_THRESHOLD) / 0.4);
  const r = Math.round(200 + 55 * t);
  const g = Math.round(140 - 100 * t);
  const b = Math.round(140 - 100 * t);
  return {
    fill: `rgb(${r}, ${g}, ${b})`,
    glow: `rgba(${r}, ${g}, ${b}, ${0.25 + 0.35 * t})`,
    track: `rgba(${r}, ${g}, ${b}, ${0.18 + 0.2 * t})`,
    label: t > 0.55 ? 'lopsided' : 'leans',
  };
}

function summarizeAssets(playerIds, picks, playersData, playerIdMap) {
  const names = (playerIds || [])
    .map((pid) => {
      const info = getPlayerInfo(pid, playersData, playerIdMap);
      return info?.full_name || info?.name || null;
    })
    .filter(Boolean);
  const pickLabels = (picks || []).map((p) => formatPickLabel(p));
  const parts = [...names.slice(0, 2), ...pickLabels.slice(0, 2)];
  const extra = names.length + pickLabels.length - parts.length;
  let label = parts.join(', ') || '—';
  if (extra > 0) label += ` +${extra}`;
  return label;
}

function PreferenceMeter({
  leftTotal,
  rightTotal,
  leftLabel,
  rightLabel,
  leftScore,
  rightScore,
}) {
  const hasValues = leftTotal > 0 || rightTotal > 0;
  const imbalance = getImbalance(leftScore, rightScore);
  const position = getPreferencePosition(leftScore, rightScore);
  const palette = getPreferencePalette(imbalance, hasValues);
  const prefersLeft = leftScore > rightScore;
  const pct = hasValues ? Math.round(imbalance * 100) : 0;

  let verdict;
  if (!hasValues) {
    verdict = 'Add players to see preference';
  } else if (imbalance <= EVEN_THRESHOLD) {
    verdict = `Essentially even · ${pct}% gap`;
  } else if (prefersLeft) {
    verdict = `Prefers ${leftLabel} · ${pct}% edge`;
  } else {
    verdict = `Prefers ${rightLabel} · ${pct}% edge`;
  }

  return (
    <div className="trade-calc-meter">
      <div className="trade-calc-meter-labels">
        <span className="trade-calc-meter-side-label">{leftLabel}</span>
        <span
          className="trade-calc-meter-verdict"
          style={{ color: palette.fill }}
        >
          {verdict}
        </span>
        <span className="trade-calc-meter-side-label trade-calc-meter-side-label--right">
          {rightLabel}
        </span>
      </div>
      <div
        className="trade-calc-meter-track"
        style={{
          background: `linear-gradient(90deg, ${palette.track} 0%, rgba(40, 45, 80, 0.5) 50%, ${palette.track} 100%)`,
          boxShadow: `inset 0 0 24px ${palette.glow}`,
        }}
      >
        <div className="trade-calc-meter-center" />
        <div
          className="trade-calc-meter-thumb"
          style={{
            left: `${position}%`,
            background: palette.fill,
            boxShadow: `0 0 18px ${palette.glow}, 0 0 4px ${palette.fill}`,
          }}
          aria-hidden="true"
        />
      </div>
      <div className="trade-calc-meter-delta-row">
        <span className="trade-calc-meter-total">{leftTotal.toLocaleString()}</span>
        <span className="trade-calc-meter-delta" style={{ color: palette.fill }}>
          {hasValues && leftTotal !== rightTotal
            ? `${leftTotal > rightTotal ? '+' : ''}${(leftTotal - rightTotal).toLocaleString()}`
            : '—'}
        </span>
        <span className="trade-calc-meter-total trade-calc-meter-total--right">
          {rightTotal.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

function PlayerSide({
  title,
  players,
  picks,
  valueAdjustment,
  total,
  formatValue,
  locked,
  onRemovePlayer,
  onRemovePick,
  searchQuery,
  onSearchChange,
  showDropdown,
  onShowDropdown,
  dropdownItems,
  onSelectItem,
  searchWrapperRef,
}) {
  const hasAssets = players.length > 0 || picks.length > 0 || (valueAdjustment > 0);

  return (
    <div className={'trade-calc-side' + (locked ? ' trade-calc-side--locked' : '')}>
      <div className="trade-calc-side-header">
        <span className="trade-calc-side-title">{title}</span>
        <span className="trade-calc-side-total">{total.toLocaleString()}</span>
      </div>

      <div className="trade-calc-player-list">
        {!hasAssets && (
          <div className="trade-calc-empty">
            {locked ? 'No assets' : 'Search players or picks'}
          </div>
        )}
        {players.map((p) => (
          <div key={p.pid} className="trade-calc-player-row">
            <img
              src={getPlayerLogoUrl(p.espnPhotoUrl)}
              alt={p.name}
              className="trade-calc-player-avatar"
            />
            <div className="trade-calc-player-info">
              <span className="trade-calc-player-name">{p.name}</span>
              <div className="trade-calc-player-meta">
                {p.position && <PositionBadge position={p.position} />}
                {p.nflTeam && <span className="trade-calc-player-team">{p.nflTeam}</span>}
              </div>
            </div>
            <span className={`trade-calc-player-value${p.value > 0 ? '' : ' trade-calc-player-value--none'}`}>
              {formatValue(p.value, p)}
            </span>
            {!locked && (
              <button
                type="button"
                className="trade-calc-remove-btn"
                onClick={() => onRemovePlayer(p.pid)}
                title={`Remove ${p.name}`}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {picks.map((pick) => (
          <div key={pick.key} className="trade-calc-player-row trade-calc-pick-row">
            <div className="trade-calc-pick-icon">
              <span>{pick.round ?? '?'}</span>
            </div>
            <div className="trade-calc-player-info">
              <span className="trade-calc-player-name">{pick.label}</span>
              <div className="trade-calc-player-meta">
                <span className="trade-calc-player-team">Draft pick</span>
              </div>
            </div>
            <span className={`trade-calc-player-value${pick.value > 0 ? '' : ' trade-calc-player-value--none'}`}>
              {formatKtcValue(pick.value)}
            </span>
            {!locked && (
              <button
                type="button"
                className="trade-calc-remove-btn"
                onClick={() => onRemovePick(pick.key)}
                title={`Remove ${pick.label}`}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {valueAdjustment > 0 && (
          <div className="trade-calc-player-row trade-calc-adj-asset-row">
            <div className="trade-calc-adj-asset-icon">VA</div>
            <div className="trade-calc-player-info">
              <span className="trade-calc-player-name trade-calc-adj-asset-name">
                Value Adjustment
              </span>
              <div className="trade-calc-player-meta">
                <span className="trade-calc-player-team">KTC consolidation</span>
              </div>
            </div>
            <span className="trade-calc-player-value trade-calc-adj-asset-value">
              {valueAdjustment.toLocaleString()}
            </span>
            {!locked && (
              <span className="trade-calc-remove-btn trade-calc-remove-btn--spacer" aria-hidden="true" />
            )}
          </div>
        )}
      </div>

      {!locked && (
        <div className="trade-calc-search-wrapper" ref={searchWrapperRef}>
          <input
            type="text"
            className="trade-calc-search-input"
            placeholder="Search players or picks…"
            value={searchQuery}
            onChange={(e) => {
              onSearchChange(e.target.value);
              onShowDropdown(true);
            }}
            onFocus={() => onShowDropdown(true)}
          />
          {showDropdown && dropdownItems.length > 0 && (
            <div className="trade-calc-dropdown">
              {dropdownItems.map((item) => (
                item.type === 'pick' ? (
                  <button
                    key={`pick-${item.season}-${item.round}`}
                    type="button"
                    className="trade-calc-dropdown-item"
                    onClick={() => onSelectItem(item)}
                  >
                    <div className="trade-calc-pick-icon">
                      <span>{item.round}</span>
                    </div>
                    <div className="trade-calc-player-info">
                      <span className="trade-calc-player-name">{item.label}</span>
                      <div className="trade-calc-player-meta">
                        <span className="trade-calc-player-team">
                          Draft pick · {item.value.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </button>
                ) : (
                  <button
                    key={item.player_id}
                    type="button"
                    className="trade-calc-dropdown-item"
                    onClick={() => onSelectItem(item)}
                  >
                    <img
                      src={getPlayerLogoUrl(item.espn_photo_url)}
                      alt={item.name}
                      className="trade-calc-player-avatar"
                    />
                    <div className="trade-calc-player-info">
                      <span className="trade-calc-player-name">{item.name}</span>
                      <div className="trade-calc-player-meta">
                        {item.position && <PositionBadge position={item.position} />}
                        {(item.team || item.team_abbr) && (
                          <span className="trade-calc-player-team">{item.team || item.team_abbr}</span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TradeCalculator() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [ktcMap, setKtcMap] = useState(null);
  const [fcData, setFcData] = useState(null);
  const [ffbData, setFfbData] = useState(null);
  const [redraftData, setRedraftData] = useState(null);
  const [hwangMultipliers, setHwangMultipliers] = useState({
    market: null,
    true: null,
    composite: null,
  });
  const [pastTrades, setPastTrades] = useState([]);

  const [valueSource, setValueSource] = useState('ktc_sf_tep');
  const [valueAdjustmentEnabled, setValueAdjustmentEnabled] = useState(true);
  const [leftIds, setLeftIds] = useState([]);
  const [rightIds, setRightIds] = useState([]);
  const [leftPicks, setLeftPicks] = useState([]);
  const [rightPicks, setRightPicks] = useState([]);
  const [leftTitle, setLeftTitle] = useState('Side A');
  const [rightTitle, setRightTitle] = useState('Side B');
  const [selectedTradeId, setSelectedTradeId] = useState('');
  const [isLocked, setIsLocked] = useState(false);

  const [leftQuery, setLeftQuery] = useState('');
  const [rightQuery, setRightQuery] = useState('');
  const [leftDropdown, setLeftDropdown] = useState(false);
  const [rightDropdown, setRightDropdown] = useState(false);
  const leftSearchRef = useRef(null);
  const rightSearchRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [
          teamData,
          idMap,
          ktcResult,
          fcResult,
          ffbResult,
          redraftResult,
          marketMult,
          trueMult,
          compositeMult,
          // loadTruePickChart() is awaited for its cache-warming side effect; its result slot is skipped.
          ,
          ...yearTradeResults
        ] = await Promise.all([
          fetchTeamData(CURRENT_YEAR),
          fetchPlayerIdMap(),
          fetchKtcData(),
          fetchFantasyCalcData().catch(() => null),
          fetchFfbData().catch(() => null),
          fetchRedraftValueData().catch(() => null),
          loadHwangPositionMultipliers('market').catch(() => null),
          loadHwangPositionMultipliers('true').catch(() => null),
          loadHwangPositionMultipliers(HWANG_COMPOSITE_COEFFICIENT_KEY).catch(() => null),
          loadTruePickChart().catch(() => null),
          ...ALL_YEARS.map(async (year) => {
            const leagueId = getLeagueId(year);
            if (!leagueId) return { year, trades: [], rosterMap: {} };
            try {
              const [transactions, yearTeams] = await Promise.all([
                fetchTransactions(1, leagueId),
                fetchTeamData(year).catch(() => null),
              ]);
              const rosterMap =
                yearTeams?.rosters && yearTeams?.users
                  ? buildRosterIdToTeamInfoMap(yearTeams.rosters, yearTeams.users)
                  : {};
              return {
                year,
                trades: filterAndSortTrades(transactions),
                rosterMap,
              };
            } catch (_) {
              return { year, trades: [], rosterMap: {} };
            }
          }),
        ]);

        if (cancelled) return;

        const players = await fetchPlayersData(teamData?.rosters || []);
        if (cancelled) return;

        let allPlayers = players;
        try {
          const res = await fetch('/data/players.txt');
          if (res.ok) {
            const full = await res.json();
            allPlayers = { ...full, ...players };
          }
        } catch (_) { /* keep roster-scoped set */ }

        // Build all-league trade history across seasons (newest first)
        const tradeOptions = [];
        for (const { year, trades, rosterMap } of yearTradeResults) {
          for (const trade of trades) {
            const rosterIds = (trade.roster_ids || []).map(Number).filter(Number.isFinite);
            if (rosterIds.length < 2) continue;

            const sides = buildTradeSides(trade);
            // Two-sided view: first two roster participants
            const leftRid = rosterIds[0];
            const rightRid = rosterIds[1];
            const leftSide = sides[leftRid] || { playerIds: [], picks: [] };
            const rightSide = sides[rightRid] || { playerIds: [], picks: [] };
            const leftName = rosterMap[leftRid]?.teamName || `Team ${leftRid}`;
            const rightName = rosterMap[rightRid]?.teamName || `Team ${rightRid}`;

            const dateLabel = formatTradeDate(trade.created);
            const leftSummary = summarizeAssets(
              leftSide.playerIds,
              leftSide.picks,
              allPlayers,
              idMap,
            );
            const rightSummary = summarizeAssets(
              rightSide.playerIds,
              rightSide.picks,
              allPlayers,
              idMap,
            );

            tradeOptions.push({
              id: `${year}-${trade.transaction_id}`,
              year,
              created: trade.created || 0,
              dateLabel,
              leftName,
              rightName,
              leftSummary,
              rightSummary,
              leftPlayerIds: leftSide.playerIds.map(String),
              rightPlayerIds: rightSide.playerIds.map(String),
              leftPicks: (leftSide.picks || []).map((p, i) => ({
                key: `L-${year}-${trade.transaction_id}-pick-${i}`,
                season: p.season,
                round: p.round,
                roster_id: p.roster_id,
                label: formatPickLabel(p),
              })),
              rightPicks: (rightSide.picks || []).map((p, i) => ({
                key: `R-${year}-${trade.transaction_id}-pick-${i}`,
                season: p.season,
                round: p.round,
                roster_id: p.roster_id,
                label: formatPickLabel(p),
              })),
            });
          }
        }

        tradeOptions.sort((a, b) => (b.created || 0) - (a.created || 0));

        setPlayersData(allPlayers);
        setPlayerIdMap(idMap);
        setKtcMap(ktcResult.map);
        setFcData(fcResult || null);
        setFfbData(ffbResult || null);
        setRedraftData(redraftResult || null);
        setHwangMultipliers({
          market: marketMult,
          true: trueMult,
          composite: compositeMult,
        });
        setPastTrades(tradeOptions);
      } catch (e) {
        if (!cancelled) setError('Failed to load trade calculator data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onDown = (e) => {
      if (leftSearchRef.current && !leftSearchRef.current.contains(e.target)) {
        setLeftDropdown(false);
      }
      if (rightSearchRef.current && !rightSearchRef.current.contains(e.target)) {
        setRightDropdown(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const hwangMarketLookup = useMemo(() => (
    ktcMap && hwangMultipliers.market
      ? buildHwangAdjustedLookup(ktcMap, hwangMultipliers.market)
      : null
  ), [ktcMap, hwangMultipliers.market]);

  const hwangTrueLookup = useMemo(() => (
    ktcMap && hwangMultipliers.true
      ? buildHwangAdjustedLookup(ktcMap, hwangMultipliers.true)
      : null
  ), [ktcMap, hwangMultipliers.true]);

  const hwangCompetitorLookup = useMemo(() => (
    redraftData?.byName && hwangMultipliers.composite
      ? buildHwangAdjustedFromEntries(
        Array.from(redraftData.byName.values()),
        hwangMultipliers.composite,
        (entry) => entry.competitorAdjustedValue,
      )
      : null
  ), [redraftData, hwangMultipliers.composite]);

  const hwangRebuilderLookup = useMemo(() => (
    redraftData?.byName && hwangMultipliers.composite
      ? buildHwangAdjustedFromEntries(
        Array.from(redraftData.byName.values()),
        hwangMultipliers.composite,
        (entry) => entry.rebuilderAdjustedValue,
      )
      : null
  ), [redraftData, hwangMultipliers.composite]);

  const getPlayerValue = useCallback((pid, info) => {
    const name = info?.full_name || info?.name || '';
    const hints = {
      position: info?.position,
      team: info?.team || info?.team_abbr,
      age: info?.age,
    };

    if (valueSource === 'ktc_sf' || valueSource === 'ktc_sf_tep') {
      if (!ktcMap) return 0;
      const ktcFmt = valueSource === 'ktc_sf_tep' ? 'sf_tep' : 'sf';
      const entry = getKtcEntryByName(name, ktcMap, ktcFmt, hints);
      return entry?.ktcValue ?? 0;
    }
    if (valueSource === 'fantasycalc') {
      if (!fcData) return 0;
      const entry = getFantasyCalcEntry(pid, name, fcData.bySleeperId, fcData.byName, hints);
      return entry?.value ?? 0;
    }
    if (valueSource === 'ffb') {
      if (!ffbData) return 0;
      const entry = getFfbEntry(pid, name, ffbData.bySleeperId, ffbData.byName);
      return entry ? Math.max(0, 390 - entry.rank) : 0;
    }
    if (valueSource === 'competitor_adjusted' || valueSource === 'rebuilder_adjusted') {
      if (!redraftData?.byName) return 0;
      const entry = getRedraftValueEntryByName(name, redraftData.byName, hints);
      if (!entry) return 0;
      const adjusted = valueSource === 'competitor_adjusted'
        ? entry.competitorAdjustedValue
        : entry.rebuilderAdjustedValue;
      return adjusted != null ? adjusted : 0;
    }
    if (valueSource === 'hwang_market_value' || valueSource === 'hwang_true_value') {
      const lookup = valueSource === 'hwang_market_value' ? hwangMarketLookup : hwangTrueLookup;
      if (!lookup?.byName) return 0;
      const entry = getHwangAdjustedEntryByName(name, lookup.byName, hints);
      return entry?.value ?? 0;
    }
    if (valueSource === 'hwang_competitor_adjusted' || valueSource === 'hwang_rebuilder_adjusted') {
      const lookup = valueSource === 'hwang_competitor_adjusted'
        ? hwangCompetitorLookup
        : hwangRebuilderLookup;
      if (!lookup?.byName) return 0;
      const entry = getHwangAdjustedEntryByName(name, lookup.byName, hints);
      return entry?.value ?? 0;
    }
    return 0;
  }, [
    valueSource,
    ktcMap,
    fcData,
    ffbData,
    redraftData,
    hwangMarketLookup,
    hwangTrueLookup,
    hwangCompetitorLookup,
    hwangRebuilderLookup,
  ]);

  const resolveSide = useCallback((ids) => {
    if (!playersData || !playerIdMap) return [];
    return ids.map((pid) => {
      const info = getPlayerInfo(pid, playersData, playerIdMap);
      const name = info?.full_name || info?.name || pid;
      const value = getPlayerValue(pid, info);
      return {
        pid,
        name,
        position: info?.position || '',
        nflTeam: info?.team || info?.team_abbr || '',
        espnPhotoUrl: info?.espn_photo_url || null,
        value,
        ffbRank: valueSource === 'ffb' && ffbData
          ? getFfbEntry(pid, name, ffbData.bySleeperId, ffbData.byName)?.rank ?? null
          : null,
      };
    });
  }, [playersData, playerIdMap, getPlayerValue, valueSource, ffbData]);

  const pickCatalog = useMemo(() => buildPickCatalog(ktcMap), [ktcMap]);

  const enrichPicks = useCallback((picks) => (
    (picks || []).map((pick) => ({
      ...pick,
      value: getPickKtcValue(pick.season, pick.round, CURRENT_YEAR, {
        ktcMap,
        tier: 'Mid',
        pickInRound: pick.pickInRound ?? pick.pickNum ?? null,
      }),
    }))
  ), [ktcMap]);

  const leftPlayers = useMemo(() => resolveSide(leftIds), [resolveSide, leftIds]);
  const rightPlayers = useMemo(() => resolveSide(rightIds), [resolveSide, rightIds]);
  const leftPicksResolved = useMemo(() => enrichPicks(leftPicks), [enrichPicks, leftPicks]);
  const rightPicksResolved = useMemo(() => enrichPicks(rightPicks), [enrichPicks, rightPicks]);

  const leftTotal = useMemo(
    () => leftPlayers.reduce((sum, p) => sum + (p.value || 0), 0)
      + leftPicksResolved.reduce((sum, p) => sum + (p.value || 0), 0),
    [leftPlayers, leftPicksResolved],
  );
  const rightTotal = useMemo(
    () => rightPlayers.reduce((sum, p) => sum + (p.value || 0), 0)
      + rightPicksResolved.reduce((sum, p) => sum + (p.value || 0), 0),
    [rightPlayers, rightPicksResolved],
  );

  const ktcEval = useMemo(() => {
    const leftValues = [
      ...leftPlayers.map((p) => p.value || 0),
      ...leftPicksResolved.map((p) => p.value || 0),
    ];
    const rightValues = [
      ...rightPlayers.map((p) => p.value || 0),
      ...rightPicksResolved.map((p) => p.value || 0),
    ];
    return evaluateKtcStyleTrade(leftValues, rightValues);
  }, [leftPlayers, rightPlayers, leftPicksResolved, rightPicksResolved]);

  const leftAdj = valueAdjustmentEnabled ? (ktcEval.adjustmentForA || 0) : 0;
  const rightAdj = valueAdjustmentEnabled ? (ktcEval.adjustmentForB || 0) : 0;
  const leftDisplayTotal = leftTotal + leftAdj;
  const rightDisplayTotal = rightTotal + rightAdj;

  // When adjustment is on, preference uses KTC raw scores; otherwise ordinary totals.
  const leftPrefScore = valueAdjustmentEnabled ? (ktcEval.rawA || 0) : leftTotal;
  const rightPrefScore = valueAdjustmentEnabled ? (ktcEval.rawB || 0) : rightTotal;

  const formatDisplayValue = useCallback((value, player) => {
    if (valueSource === 'ffb') {
      return formatFfbRank(player?.ffbRank);
    }
    if (
      valueSource === 'competitor_adjusted'
      || valueSource === 'rebuilder_adjusted'
    ) {
      return formatRedraftAdjustedValue(value);
    }
    if (valueSource === 'fantasycalc') {
      return formatFcValue(value);
    }
    return formatKtcValue(value);
  }, [valueSource]);

  const filterDropdownItems = useCallback((query, excludeIds) => {
    const q = (query || '').toLowerCase().trim();
    const exclude = new Set(excludeIds);
    const items = [];

    const pickQuery = !q
      || q.includes('pick')
      || q.includes('draft')
      || /\d{4}/.test(q)
      || /[1-4](st|nd|rd|th)/.test(q)
      || /^r?[1-4]$/.test(q);

    if (pickQuery) {
      for (const pick of pickCatalog) {
        const label = pick.label.toLowerCase();
        const roundWord = (ROUND_ORDINAL[pick.round] || '').toLowerCase();
        if (
          !q
          || label.includes(q)
          || pick.season.includes(q)
          || q.includes(pick.season)
          || roundWord.includes(q)
          || q === String(pick.round)
          || q === `r${pick.round}`
          || (q.includes('pick') || q.includes('draft'))
        ) {
          items.push(pick);
        }
      }
    }

    if (playersData && q) {
      for (const playerId in playersData) {
        if (exclude.has(playerId)) continue;
        const player = playersData[playerId];
        const pos = (player.position || '').toUpperCase();
        if (pos && !ADDABLE_POSITIONS.has(pos)) continue;

        const firstName = (player.first_name || '').toLowerCase();
        const lastName = (player.last_name || '').toLowerCase();
        const fullName = (player.full_name || '').toLowerCase();
        if (!firstName.includes(q) && !lastName.includes(q) && !fullName.includes(q)) continue;

        const info = getPlayerInfo(playerId, playersData, playerIdMap);
        if (info) items.push({ type: 'player', ...info, player_id: playerId });
        if (items.filter((i) => i.type === 'player').length >= 20) break;
      }
    }

    return items;
  }, [playersData, playerIdMap, pickCatalog]);

  const leftDropdownItems = useMemo(
    () => filterDropdownItems(leftQuery, [...leftIds, ...rightIds]),
    [filterDropdownItems, leftQuery, leftIds, rightIds],
  );
  const rightDropdownItems = useMemo(
    () => filterDropdownItems(rightQuery, [...leftIds, ...rightIds]),
    [filterDropdownItems, rightQuery, leftIds, rightIds],
  );

  const addPickToSide = (side, pick) => {
    const entry = {
      key: `sandbox-pick-${Date.now()}-${++pickKeySeq}`,
      season: pick.season,
      round: pick.round,
      roster_id: null,
      label: pick.label,
    };
    if (side === 'left') {
      setLeftPicks((picks) => [...picks, entry]);
      setLeftQuery('');
      setLeftDropdown(false);
    } else {
      setRightPicks((picks) => [...picks, entry]);
      setRightQuery('');
      setRightDropdown(false);
    }
  };

  const addLeft = (item) => {
    if (item?.type === 'pick') {
      addPickToSide('left', item);
      return;
    }
    const pid = item.player_id;
    if (!pid || leftIds.includes(pid) || rightIds.includes(pid)) return;
    setLeftIds((ids) => [...ids, pid]);
    setLeftQuery('');
    setLeftDropdown(false);
  };

  const addRight = (item) => {
    if (item?.type === 'pick') {
      addPickToSide('right', item);
      return;
    }
    const pid = item.player_id;
    if (!pid || leftIds.includes(pid) || rightIds.includes(pid)) return;
    setRightIds((ids) => [...ids, pid]);
    setRightQuery('');
    setRightDropdown(false);
  };

  const clearAll = () => {
    setLeftIds([]);
    setRightIds([]);
    setLeftPicks([]);
    setRightPicks([]);
    setLeftQuery('');
    setRightQuery('');
    setLeftTitle('Side A');
    setRightTitle('Side B');
    setSelectedTradeId('');
    setIsLocked(false);
  };

  const loadPastTrade = (trade) => {
    if (!trade) return;
    setSelectedTradeId(trade.id);
    setLeftIds(trade.leftPlayerIds);
    setRightIds(trade.rightPlayerIds);
    setLeftPicks(trade.leftPicks);
    setRightPicks(trade.rightPicks);
    setLeftTitle(trade.leftName);
    setRightTitle(trade.rightName);
    setLeftQuery('');
    setRightQuery('');
    setLeftDropdown(false);
    setRightDropdown(false);
    setIsLocked(true);
  };

  const editTrade = () => {
    setIsLocked(false);
    setLeftTitle('Side A');
    setRightTitle('Side B');
    setSelectedTradeId('');
    setLeftQuery('');
    setRightQuery('');
    setLeftDropdown(false);
    setRightDropdown(false);
  };

  if (loading) return <LoadingState label="Loading trade calculator…" />;
  if (error) return <div className="trade-calc-error">{error}</div>;

  return (
    <div className="trade-calc-root">
      <div className="trade-calc-header">
        <div className="trade-calc-header-text">
          <span className="trade-calc-title">Trade Calculator</span>
          <span className="trade-calc-sub">
            {isLocked
              ? 'Viewing a league trade — locked until you edit'
              : 'Compare packages — meter slides toward the preferred side'}
          </span>
        </div>
        <div className="trade-calc-controls">
          <label className="trade-calc-toggle">
            <input
              type="checkbox"
              className="trade-calc-toggle-checkbox"
              checked={valueAdjustmentEnabled}
              onChange={(e) => setValueAdjustmentEnabled(e.target.checked)}
            />
            Value Adjustment
          </label>
          <label className="trade-calc-source-label">
            Ranking
            <select
              className="trade-calc-source-select"
              value={valueSource}
              onChange={(e) => setValueSource(e.target.value)}
            >
              {TRADE_VALUE_SOURCES.map((src) => (
                <option key={src} value={src}>
                  {TRADE_VALUE_SOURCE_LABELS[src]}
                </option>
              ))}
            </select>
          </label>
          {isLocked ? (
            <button type="button" className="trade-calc-edit-btn" onClick={editTrade}>
              Edit Trade
            </button>
          ) : (
            <button type="button" className="trade-calc-clear-btn" onClick={clearAll}>
              Clear
            </button>
          )}
        </div>
      </div>

      <PreferenceMeter
        leftTotal={leftDisplayTotal}
        rightTotal={rightDisplayTotal}
        leftLabel={leftTitle}
        rightLabel={rightTitle}
        leftScore={leftPrefScore}
        rightScore={rightPrefScore}
      />

      <div className={'trade-calc-board trade-calc-board--two' + (isLocked ? ' trade-calc-board--locked' : '')}>
        <PlayerSide
          title={leftTitle}
          players={leftPlayers}
          picks={leftPicksResolved}
          valueAdjustment={leftAdj}
          total={leftDisplayTotal}
          formatValue={formatDisplayValue}
          locked={isLocked}
          onRemovePlayer={(pid) => {
            setLeftIds((ids) => ids.filter((id) => id !== pid));
          }}
          onRemovePick={(key) => {
            setLeftPicks((picks) => picks.filter((p) => p.key !== key));
          }}
          searchQuery={leftQuery}
          onSearchChange={setLeftQuery}
          showDropdown={leftDropdown}
          onShowDropdown={setLeftDropdown}
          dropdownItems={leftDropdownItems}
          onSelectItem={addLeft}
          searchWrapperRef={leftSearchRef}
        />

        <PlayerSide
          title={rightTitle}
          players={rightPlayers}
          picks={rightPicksResolved}
          valueAdjustment={rightAdj}
          total={rightDisplayTotal}
          formatValue={formatDisplayValue}
          locked={isLocked}
          onRemovePlayer={(pid) => {
            setRightIds((ids) => ids.filter((id) => id !== pid));
          }}
          onRemovePick={(key) => {
            setRightPicks((picks) => picks.filter((p) => p.key !== key));
          }}
          searchQuery={rightQuery}
          onSearchChange={setRightQuery}
          showDropdown={rightDropdown}
          onShowDropdown={setRightDropdown}
          dropdownItems={rightDropdownItems}
          onSelectItem={addRight}
          searchWrapperRef={rightSearchRef}
        />
      </div>

      <div className="trade-calc-history">
        <div className="trade-calc-history-header">
          <span className="trade-calc-history-title">League trade history</span>
          <span className="trade-calc-history-sub">
            {pastTrades.length} trade{pastTrades.length === 1 ? '' : 's'} · click to load
          </span>
        </div>
        <div className="trade-calc-history-list">
          {pastTrades.length === 0 && (
            <div className="trade-calc-history-empty">No trades found.</div>
          )}
          {pastTrades.map((trade) => {
            const active = trade.id === selectedTradeId;
            return (
              <button
                key={trade.id}
                type="button"
                className={
                  'trade-calc-history-item'
                  + (active ? ' trade-calc-history-item--active' : '')
                }
                onClick={() => loadPastTrade(trade)}
              >
                <div className="trade-calc-history-item-top">
                  <span className="trade-calc-history-date">{trade.dateLabel}</span>
                  <span className="trade-calc-history-year">{trade.year}</span>
                </div>
                <div className="trade-calc-history-matchup">
                  <div className="trade-calc-history-side">
                    <span className="trade-calc-history-team">{trade.leftName}</span>
                    <span className="trade-calc-history-assets">{trade.leftSummary}</span>
                  </div>
                  <span className="trade-calc-history-vs">↔</span>
                  <div className="trade-calc-history-side trade-calc-history-side--right">
                    <span className="trade-calc-history-team">{trade.rightName}</span>
                    <span className="trade-calc-history-assets">{trade.rightSummary}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default TradeCalculator;
