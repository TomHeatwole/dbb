/**
 * Trade Calculator — sandbox tool to compare player packages by ranking value.
 * Left vs right sides; sum raw ranking values (no roster-spot adjustments).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from '../lookups/PlayerLookup';
import { fetchTeamData } from '../lookups/TeamLookup';
import {
  fetchKtcData,
  getKtcEntryByName,
  formatKtcValue,
} from '../lookups/KtcLookup';
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
import { CURRENT_YEAR } from '../utils/DateHelper';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import PositionBadge from '../PositionBadge';
import LoadingState from '../LoadingState';

const ADDABLE_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

function PlayerSide({
  title,
  players,
  total,
  formatValue,
  onRemove,
  searchQuery,
  onSearchChange,
  showDropdown,
  onShowDropdown,
  dropdownPlayers,
  onSelectPlayer,
  searchWrapperRef,
}) {
  return (
    <div className="trade-calc-side">
      <div className="trade-calc-side-header">
        <span className="trade-calc-side-title">{title}</span>
        <span className="trade-calc-side-total">{total.toLocaleString()}</span>
      </div>

      <div className="trade-calc-player-list">
        {players.length === 0 && (
          <div className="trade-calc-empty">Search and add players</div>
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
            <button
              type="button"
              className="trade-calc-remove-btn"
              onClick={() => onRemove(p.pid)}
              title={`Remove ${p.name}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="trade-calc-search-wrapper" ref={searchWrapperRef}>
        <input
          type="text"
          className="trade-calc-search-input"
          placeholder="Search players…"
          value={searchQuery}
          onChange={(e) => {
            onSearchChange(e.target.value);
            onShowDropdown(true);
          }}
          onFocus={() => onShowDropdown(true)}
        />
        {showDropdown && dropdownPlayers.length > 0 && (
          <div className="trade-calc-dropdown">
            {dropdownPlayers.map((p) => (
              <button
                key={p.player_id}
                type="button"
                className="trade-calc-dropdown-item"
                onClick={() => onSelectPlayer(p)}
              >
                <img
                  src={getPlayerLogoUrl(p.espn_photo_url)}
                  alt={p.name}
                  className="trade-calc-player-avatar"
                />
                <div className="trade-calc-player-info">
                  <span className="trade-calc-player-name">{p.name}</span>
                  <div className="trade-calc-player-meta">
                    {p.position && <PositionBadge position={p.position} />}
                    {(p.team || p.team_abbr) && (
                      <span className="trade-calc-player-team">{p.team || p.team_abbr}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
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

  const [valueSource, setValueSource] = useState('ktc_sf_tep');
  const [leftIds, setLeftIds] = useState([]);
  const [rightIds, setRightIds] = useState([]);

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
        ]);

        if (cancelled) return;

        const players = await fetchPlayersData(teamData?.rosters || []);
        if (cancelled) return;

        // Expand search universe with full players.txt when available
        let allPlayers = players;
        try {
          const res = await fetch('/data/players.txt');
          if (res.ok) {
            const full = await res.json();
            allPlayers = { ...full, ...players };
          }
        } catch (_) { /* keep roster-scoped set */ }

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

  const leftPlayers = useMemo(() => resolveSide(leftIds), [resolveSide, leftIds]);
  const rightPlayers = useMemo(() => resolveSide(rightIds), [resolveSide, rightIds]);

  const leftTotal = useMemo(
    () => leftPlayers.reduce((sum, p) => sum + (p.value || 0), 0),
    [leftPlayers],
  );
  const rightTotal = useMemo(
    () => rightPlayers.reduce((sum, p) => sum + (p.value || 0), 0),
    [rightPlayers],
  );
  const delta = leftTotal - rightTotal;

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

  const filterPlayers = useCallback((query, excludeIds) => {
    if (!playersData || !query.trim()) return [];
    const q = query.toLowerCase().trim();
    const exclude = new Set(excludeIds);
    const matches = [];

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
      if (info) matches.push({ ...info, player_id: playerId });
      if (matches.length >= 20) break;
    }
    return matches;
  }, [playersData, playerIdMap]);

  const leftDropdownPlayers = useMemo(
    () => filterPlayers(leftQuery, [...leftIds, ...rightIds]),
    [filterPlayers, leftQuery, leftIds, rightIds],
  );
  const rightDropdownPlayers = useMemo(
    () => filterPlayers(rightQuery, [...leftIds, ...rightIds]),
    [filterPlayers, rightQuery, leftIds, rightIds],
  );

  const addLeft = (player) => {
    const pid = player.player_id;
    if (!pid || leftIds.includes(pid) || rightIds.includes(pid)) return;
    setLeftIds((ids) => [...ids, pid]);
    setLeftQuery('');
    setLeftDropdown(false);
  };

  const addRight = (player) => {
    const pid = player.player_id;
    if (!pid || leftIds.includes(pid) || rightIds.includes(pid)) return;
    setRightIds((ids) => [...ids, pid]);
    setRightQuery('');
    setRightDropdown(false);
  };

  const clearAll = () => {
    setLeftIds([]);
    setRightIds([]);
    setLeftQuery('');
    setRightQuery('');
  };

  if (loading) return <LoadingState label="Loading trade calculator…" />;
  if (error) return <div className="trade-calc-error">{error}</div>;

  const hasPlayers = leftPlayers.length > 0 || rightPlayers.length > 0;
  let verdict = 'Even';
  let verdictClass = 'trade-calc-verdict--even';
  if (hasPlayers && Math.abs(delta) > 0) {
    if (delta > 0) {
      verdict = 'Left side wins';
      verdictClass = 'trade-calc-verdict--left';
    } else {
      verdict = 'Right side wins';
      verdictClass = 'trade-calc-verdict--right';
    }
  }

  return (
    <div className="trade-calc-root">
      <div className="trade-calc-header">
        <div className="trade-calc-header-text">
          <span className="trade-calc-title">Trade Calculator</span>
          <span className="trade-calc-sub">
            Select players on each side and compare totals — no roster-spot adjustments
          </span>
        </div>
        <div className="trade-calc-controls">
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
          <button type="button" className="trade-calc-clear-btn" onClick={clearAll}>
            Clear
          </button>
        </div>
      </div>

      <div className="trade-calc-board">
        <PlayerSide
          title="Side A"
          players={leftPlayers}
          total={leftTotal}
          formatValue={formatDisplayValue}
          onRemove={(pid) => setLeftIds((ids) => ids.filter((id) => id !== pid))}
          searchQuery={leftQuery}
          onSearchChange={setLeftQuery}
          showDropdown={leftDropdown}
          onShowDropdown={setLeftDropdown}
          dropdownPlayers={leftDropdownPlayers}
          onSelectPlayer={addLeft}
          searchWrapperRef={leftSearchRef}
        />

        <div className="trade-calc-vs">
          <div className={`trade-calc-verdict ${verdictClass}`}>{verdict}</div>
          <div className={`trade-calc-delta${delta === 0 ? '' : delta > 0 ? ' trade-calc-delta--left' : ' trade-calc-delta--right'}`}>
            {delta === 0
              ? '—'
              : `${delta > 0 ? '+' : ''}${delta.toLocaleString()}`}
          </div>
          <div className="trade-calc-vs-label">difference</div>
        </div>

        <PlayerSide
          title="Side B"
          players={rightPlayers}
          total={rightTotal}
          formatValue={formatDisplayValue}
          onRemove={(pid) => setRightIds((ids) => ids.filter((id) => id !== pid))}
          searchQuery={rightQuery}
          onSearchChange={setRightQuery}
          showDropdown={rightDropdown}
          onShowDropdown={setRightDropdown}
          dropdownPlayers={rightDropdownPlayers}
          onSelectPlayer={addRight}
          searchWrapperRef={rightSearchRef}
        />
      </div>
    </div>
  );
}

export default TradeCalculator;
