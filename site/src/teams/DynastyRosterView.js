/**
 * DynastyRosterView
 *
 * Shows all league teams ordered by total dynasty value (players + picks).
 * Format selector: SF | SF TE+
 *
 * Selecting a team reveals:
 *  – Players sorted by KTC value descending, with overall rank and positional
 *    rank (e.g. #5 · RB2)
 *  – Draft picks below players, formatted as "2026 1.02" when draft order is
 *    known, with tier-based KTC values (early / mid / late)
 *
 * Self-contained: owns all data loading.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { fetchTeamData, fetchTradedPicks, fetchRookieDraftComplete, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from '../lookups/PlayerLookup';
import PositionBadge from '../PositionBadge';
import {
  fetchKtcData,
  getKtcEntryByName,
  getPickKtcValue,
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
  lookupKtcMapEntry,
  getStitchedKtcTepSfValue,
  formatMultiplierSummary,
  HWANG_COMPOSITE_COEFFICIENT_KEY,
} from '../lookups/HwangValueAdjustmentLookup';
import { RedraftAdjTooltip } from '../redraftValueIndex/redraftValueTooltip';
import { redraftUsesHwangAdp } from '../rankingsViewer/rankingsSources';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { CURRENT_YEAR, getCompletedWeeksCount, getFuturePickSeasonRange, getNextDraftYear, isPostSeasonPreDraft } from '../utils/DateHelper';
import { calculateDraftOrder, convertPlacementToPickNumbers } from '../utils/DraftOrderHelper';
import PlayerWeeklyScores from '../players/PlayerWeeklyScores';
import LoadingState from '../LoadingState';

const PICKS_ENABLED = true;

const PICKS_VALUE_SOURCES = [
  'ktc_sf',
  'ktc_sf_tep',
  'hwang_market_value',
  'hwang_true_value',
  'competitor_adjusted',
  'rebuilder_adjusted',
  'hwang_competitor_adjusted',
  'hwang_rebuilder_adjusted',
];

const RANKED_POSITIONS  = ['QB', 'RB', 'WR', 'TE'];

// Value source options: KTC SF, KTC SF TE+, Hwang-adjusted KTC, FantasyCalc, FFB, redraft-adjusted
const VALUE_SOURCES = [
  'ktc_sf',
  'ktc_sf_tep',
  'hwang_market_value',
  'hwang_true_value',
  'competitor_adjusted',
  'rebuilder_adjusted',
  'hwang_competitor_adjusted',
  'hwang_rebuilder_adjusted',
  'fantasycalc',
  'ffb',
];
const VALUE_SOURCE_LABELS = {
  ktc_sf:                     'KTC SF',
  ktc_sf_tep:                 'KTC SF TE+',
  hwang_market_value:         'Hwang Market',
  hwang_true_value:           'Hwang True',
  competitor_adjusted:        'Competitor Adj',
  rebuilder_adjusted:         'Rebuild Adj',
  hwang_competitor_adjusted:  'Hwang Comp',
  hwang_rebuilder_adjusted:   'Hwang Rebuild',
  fantasycalc:                'FantasyCalc',
  ffb:                        'FFB',
};
const VALUE_SOURCE_COL_HEADER = {
  ktc_sf:                     'KTC',
  ktc_sf_tep:                 'KTC',
  hwang_market_value:         'Market Adj',
  hwang_true_value:           'True Adj',
  competitor_adjusted:        'Comp Adj',
  rebuilder_adjusted:         'Rebuild',
  hwang_competitor_adjusted:  'Hwang Comp',
  hwang_rebuilder_adjusted:   'Hwang Rebuild',
  fantasycalc:                'FC',
  ffb:                        'FFB Rank',
};
const VALUE_SOURCE_TOTAL_LABEL = {
  ktc_sf:                     'Total KTC',
  ktc_sf_tep:                 'Total KTC',
  hwang_market_value:         'Total Market Adj',
  hwang_true_value:           'Total True Adj',
  competitor_adjusted:        'Total Comp Adj',
  rebuilder_adjusted:         'Total Rebuild',
  hwang_competitor_adjusted:  'Total Hwang Comp',
  hwang_rebuilder_adjusted:   'Total Hwang Rebuild',
  fantasycalc:                'Total FC',
  ffb:                        'FFB Score',
};

const REDRAFT_VALUE_SOURCES = new Set(['competitor_adjusted', 'rebuilder_adjusted']);
const HWANG_COMPOSITE_VALUE_SOURCES = new Set([
  'hwang_competitor_adjusted',
  'hwang_rebuilder_adjusted',
]);

function formatRedraftIndex(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}×`;
}

function formatIndexDeltaPct(index) {
  if (index == null || !Number.isFinite(index)) return null;
  const pct = (index - 1) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function indexClassName(value) {
  if (value == null || !Number.isFinite(value)) return 'dynasty-index';
  if (value > 1.005) return 'dynasty-index dynasty-index--up';
  if (value < 0.995) return 'dynasty-index dynasty-index--down';
  return 'dynasty-index dynasty-index--flat';
}

function computePlayerIndex(adjustedValue, dynastyKtcValue, csvIndex) {
  if (csvIndex != null && Number.isFinite(csvIndex)) return csvIndex;
  if (
    adjustedValue == null
    || !Number.isFinite(adjustedValue)
    || !dynastyKtcValue
    || dynastyKtcValue <= 0
  ) {
    return null;
  }
  return Math.round((adjustedValue / dynastyKtcValue) * 10000) / 10000;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toOrdinal(n) {
  if (!Number.isFinite(n)) return '';
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/**
 * Build per-team pick lists from the Sleeper traded-picks API response.
 * Covers the next 3 drafts after the upcoming one (e.g. 2027–2029 once the 2026 draft is done).
 */
function buildPicksByRoster(teamData, allTradedPicks, { rookieDraftComplete = false } = {}) {
  const { minSeason, maxSeason } = getFuturePickSeasonRange(rookieDraftComplete);
  const currentYearNum = Number(CURRENT_YEAR);

  const futurePicks = (allTradedPicks || []).filter((p) => {
    const s = p.season != null ? Number(p.season) : currentYearNum;
    return Number.isFinite(s) && s >= minSeason && s <= maxSeason;
  });

  const result = {};

  for (const roster of (teamData.rosters || [])) {
    const rosterId = Number(roster.roster_id);

    const tradedAway = new Set();
    for (const p of futurePicks) {
      if (Number(p.roster_id) === rosterId && Number(p.owner_id) !== rosterId) {
        tradedAway.add(`${p.season}-${p.round}`);
      }
    }

    const picks = [];
    for (let yr = minSeason; yr <= maxSeason; yr++) {
      for (let round = 1; round <= 4; round++) {
        if (!tradedAway.has(`${yr}-${round}`)) {
          picks.push({ season: String(yr), round, roster_id: rosterId, isOwn: true });
        }
      }
    }
    for (const p of futurePicks) {
      if (Number(p.owner_id) === rosterId && Number(p.roster_id) !== rosterId) {
        picks.push({ ...p, isOwn: false });
      }
    }
    picks.sort((a, b) => {
      const sy = Number(a.season) - Number(b.season);
      if (sy !== 0) return sy;
      return Number(a.round) - Number(b.round);
    });
    result[rosterId] = picks;
  }

  return result;
}

/**
 * Format a pick for display.
 * Uses "2026 1.02 (via Team Name)" format when draft order is known for the
 * next draft; falls back to "2026 1st" otherwise.
 */
function formatPickLabel(pick, draftOrderMap, nextDraftYear, rosterInfoMap) {
  const season        = pick.season || '';
  const round         = Number(pick.round);
  const origRosterId  = pick.roster_id != null ? String(pick.roster_id) : null;

  let label;
  if (String(season) === String(nextDraftYear) && origRosterId && draftOrderMap[origRosterId]) {
    const pickNum = draftOrderMap[origRosterId];
    label = `${season} ${round}.${String(pickNum).padStart(2, '0')}`;
  } else {
    label = `${season} ${toOrdinal(round)}`;
  }

  if (!pick.isOwn) {
    const origInfo = origRosterId ? rosterInfoMap[Number(origRosterId)] : null;
    const via = origInfo?.teamName || (origRosterId ? `Team ${origRosterId}` : '');
    if (via) label += ` (via ${via})`;
  }

  return label;
}

// ── Component ─────────────────────────────────────────────────────────────────

function DynastyRosterView() {
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [teams, setTeams]                 = useState([]);
  const [rosters, setRosters]             = useState({});
  const [rawRosters, setRawRosters]       = useState(null);
  const [rawUsers, setRawUsers]           = useState(null);
  const [picksByRoster, setPicksByRoster] = useState({});
  const [rosterInfoMap, setRosterInfoMap] = useState({});
  const [draftOrderMap, setDraftOrderMap] = useState({});   // rosterId → pick# (1-10)
  const [nextDraftYear, setNextDraftYear] = useState(null);
  const [playersData, setPlayersData]     = useState(null);
  const [playerIdMap, setPlayerIdMap]     = useState(null);
  const [ktcMap, setKtcMap]               = useState(null);
  const [ktcAsOf, setKtcAsOf]             = useState(null);
  const [fcData, setFcData]               = useState(null); // { bySleeperId, byName }
  const [ffbData, setFfbData]             = useState(null); // { bySleeperId, byName }
  const [redraftData, setRedraftData]     = useState(null); // { byName, asOf, adpSource }
  const [hwangMultipliers, setHwangMultipliers] = useState({
    market: null,
    true: null,
    composite: null,
  });
  const [selectedId, setSelectedId]       = useState(null);
  const [valueSource, setValueSource]     = useState('ktc_sf_tep');
  const [includePicksInTotal, setIncludePicksInTotal] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  // ── Data loading ────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const completedWeeks = getCompletedWeeksCount(CURRENT_YEAR);
        const isPreSeason    = completedWeeks === 0;
        const prevYearStr    = String(Number(CURRENT_YEAR) - 1);
        const [teamData, weeksData, idMap, ktcResult, fcResult, ffbResult, redraftResult, marketMult, trueMult, compositeMult, allTradedPicks, prevWeeksData, rookieDraftComplete] =
          await Promise.all([
            fetchTeamData(CURRENT_YEAR),
            fetchScoresData(CURRENT_YEAR),
            fetchPlayerIdMap(),
            fetchKtcData(),
            fetchFantasyCalcData().catch(() => null),
            fetchFfbData().catch(() => null),
            fetchRedraftValueData().catch(() => null),
            loadHwangPositionMultipliers('market').catch(() => null),
            loadHwangPositionMultipliers('true').catch(() => null),
            loadHwangPositionMultipliers(HWANG_COMPOSITE_COEFFICIENT_KEY).catch(() => null),
            PICKS_ENABLED ? fetchTradedPicks(CURRENT_YEAR).catch(() => []) : Promise.resolve([]),
            PICKS_ENABLED && isPreSeason
              ? fetchScoresData(prevYearStr).catch(() => null)
              : Promise.resolve(null),
            PICKS_ENABLED ? fetchRookieDraftComplete().catch(() => false) : Promise.resolve(false),
          ]);

        const nextDraft = getNextDraftYear(rookieDraftComplete);
        const { currentYearDraftDone } = getFuturePickSeasonRange(rookieDraftComplete);

        if (!teamData || !Array.isArray(teamData.rosters)) throw new Error('No team data');
        if (cancelled) return;

        const players = await fetchPlayersData(teamData.rosters);
        if (cancelled) return;

        // Draft order: maps rosterId → pick slot (1-10) for the upcoming draft
        let orderMap = {};
        const needsDraftOrder = isPostSeasonPreDraft(CURRENT_YEAR)
          || (isPreSeason && !currentYearDraftDone);
        if (PICKS_ENABLED && needsDraftOrder) {
          try {
            const scoresForOrder = isPreSeason ? prevWeeksData : weeksData;
            const scoresYear     = isPreSeason ? prevYearStr   : String(CURRENT_YEAR);
            if (scoresForOrder && Array.isArray(scoresForOrder)) {
              const placeToRid = calculateDraftOrder(scoresYear, scoresForOrder, teamData, null, null);
              orderMap = convertPlacementToPickNumbers(placeToRid);
            }
          } catch (_) { /* keep orderMap empty */ }
        }

        const infoMap  = buildRosterIdToTeamInfoMap(teamData.rosters, teamData.users);
        const picksMap = PICKS_ENABLED
          ? buildPicksByRoster(teamData, allTradedPicks, { rookieDraftComplete })
          : {};
        const ktcM      = ktcResult.map;

        // Roster map
        const rosterMap = {};
        for (const roster of teamData.rosters) {
          const rid = Number(roster.roster_id);
          rosterMap[rid] = Array.isArray(roster.players) ? roster.players : [];
        }

        // Build team list with totals per format (we compute totals reactively via useMemo,
        // but we store enough here to do initial sort with the default format)
        const teamList = (teamData.rosters || []).map((roster) => {
          const rid = Number(roster.roster_id);
          if (!Number.isFinite(rid)) return null;
          const user = (teamData.users || []).find(
            (u) => String(u.user_id) === String(roster.owner_id)
          );
          let teamName = `Team ${rid}`;
          if (user?.metadata?.team_name) teamName = user.metadata.team_name;
          else if (user?.display_name)   teamName = `Team ${user.display_name}`;
          const avatarUrl =
            (user && (user.team_avatar_url || user.user_avatar_url || user.avatar_url)) || null;
          return { rosterId: rid, teamName, avatarUrl };
        }).filter(Boolean);

        setTeams(teamList);
        setRosters(rosterMap);
        setRawRosters(teamData.rosters);
        setRawUsers(teamData.users);
        setPicksByRoster(picksMap);
        setRosterInfoMap(infoMap);
        setDraftOrderMap(orderMap);
        setNextDraftYear(nextDraft);
        setPlayersData(players);
        setPlayerIdMap(idMap);
        setKtcMap(ktcM);
        setKtcAsOf(ktcResult.asOf);
        setFcData(fcResult || null);
        setFfbData(ffbResult || null);
        setRedraftData(redraftResult || null);
        setHwangMultipliers({ market: marketMult, true: trueMult, composite: compositeMult });
      } catch (e) {
        if (!cancelled) setError('Failed to load dynasty roster data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // ── KTC lookups: SF = redraft pipeline dynasty base; SF TE+ = display reference ──

  const getPlayerKtcTepValue = React.useCallback((pid, info) => {
    if (!ktcMap || !info) return 0;
    const name = info.full_name || info.name || '';
    const hints = { position: info.position, team: info.team || info.team_abbr, age: info.age };
    const mapEntry = lookupKtcMapEntry(name, ktcMap, hints);
    return getStitchedKtcTepSfValue(mapEntry) ?? 0;
  }, [ktcMap]);

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

  // ── Helper: get a numeric "sort value" for a player given the current source ──

  const getPlayerSortValue = React.useCallback((pid, info) => {
    const name  = info?.full_name || info?.name || '';
    const hints = { position: info?.position, team: info?.team || info?.team_abbr, age: info?.age };

    if (valueSource === 'ktc_sf' || valueSource === 'ktc_sf_tep') {
      if (!ktcMap) return 0;
      const ktcFmt = valueSource === 'ktc_sf_tep' ? 'sf_tep' : 'sf';
      const entry  = getKtcEntryByName(name, ktcMap, ktcFmt, hints);
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
      // Synthetic score: higher = better (top-ranked player scores ~389)
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

  // ── Per-team value totals (recomputes when source changes) ───────────────────

  const teamKtcTotals = useMemo(() => {
    if (!playersData || !playerIdMap) return {};
    const totals = {};
    for (const team of teams) {
      let total = 0;
      for (const pid of (rosters[team.rosterId] || [])) {
        const info = getPlayerInfo(pid, playersData, playerIdMap);
        if (!info) continue;
        total += getPlayerSortValue(pid, info);
      }
      // Picks use KTC values; included in total when toggled on
      if (
        includePicksInTotal
        && PICKS_ENABLED
        && PICKS_VALUE_SOURCES.includes(valueSource)
      ) {
        for (const pick of (picksByRoster[team.rosterId] || [])) {
          total += getPickKtcValue(pick.season, pick.round, CURRENT_YEAR);
        }
      }
      totals[team.rosterId] = total;
    }
    return totals;
  }, [playersData, playerIdMap, teams, rosters, picksByRoster, getPlayerSortValue, valueSource, includePicksInTotal]);

  const teamKtcTepBaselines = useMemo(() => {
    if (!playersData || !playerIdMap) return {};
    const baselines = {};
    for (const team of teams) {
      let total = 0;
      for (const pid of (rosters[team.rosterId] || [])) {
        const info = getPlayerInfo(pid, playersData, playerIdMap);
        if (!info) continue;
        total += getPlayerKtcTepValue(pid, info);
      }
      baselines[team.rosterId] = total;
    }
    return baselines;
  }, [playersData, playerIdMap, teams, rosters, getPlayerKtcTepValue]);

  const teamPlayerAdjustedTotals = useMemo(() => {
    if (!REDRAFT_VALUE_SOURCES.has(valueSource) || !playersData || !playerIdMap) return {};
    const totals = {};
    for (const team of teams) {
      let total = 0;
      for (const pid of (rosters[team.rosterId] || [])) {
        const info = getPlayerInfo(pid, playersData, playerIdMap);
        if (!info) continue;
        total += getPlayerSortValue(pid, info);
      }
      totals[team.rosterId] = total;
    }
    return totals;
  }, [playersData, playerIdMap, teams, rosters, getPlayerSortValue, valueSource]);

  const teamRedraftIndices = useMemo(() => {
    if (!REDRAFT_VALUE_SOURCES.has(valueSource)) return {};
    const indices = {};
    for (const team of teams) {
      const baseline = teamKtcTepBaselines[team.rosterId] ?? 0;
      const adjusted = teamPlayerAdjustedTotals[team.rosterId] ?? 0;
      indices[team.rosterId] = baseline > 0
        ? Math.round((adjusted / baseline) * 10000) / 10000
        : null;
    }
    return indices;
  }, [teams, teamKtcTepBaselines, teamPlayerAdjustedTotals, valueSource]);

  const isRedraftValueSource = REDRAFT_VALUE_SOURCES.has(valueSource);

  // Teams sorted by total KTC descending
  const sortedTeams = useMemo(() => {
    return teams.slice().sort((a, b) => {
      const ta = teamKtcTotals[a.rosterId] ?? 0;
      const tb = teamKtcTotals[b.rosterId] ?? 0;
      return tb !== ta ? tb - ta : Number(a.rosterId) - Number(b.rosterId);
    });
  }, [teams, teamKtcTotals]);

  // ── Selected team detail ─────────────────────────────────────────────────────

  const selectedPlayers = useMemo(() => {
    if (!selectedId || !playersData || !playerIdMap) return [];

    const ktcFmt = valueSource === 'ktc_sf' ? 'sf' : 'sf_tep';

    return (rosters[selectedId] || []).map((pid) => {
      const info  = getPlayerInfo(pid, playersData, playerIdMap);
      const name  = info?.full_name || info?.name || pid;
      const hints = { position: info?.position, team: info?.team || info?.team_abbr, age: info?.age };

      // KTC (active format for rank display; SF TE+ always for redraft baseline)
      const ktcEntry = ktcMap
        ? getKtcEntryByName(name, ktcMap, ktcFmt, hints)
        : null;
      const ktcTepEntry = ktcMap
        ? getKtcEntryByName(name, ktcMap, 'sf_tep', hints)
        : null;
      const ktcTepValue = ktcTepEntry?.ktcValue ?? 0;

      // Redraft-adjusted
      const redraftEntry = redraftData?.byName
        ? getRedraftValueEntryByName(name, redraftData.byName, hints)
        : null;
      const dynastyKtcValue = redraftEntry?.ktcValue ?? getPlayerKtcTepValue(pid, info);

      // FantasyCalc
      const fcEntry = fcData
        ? getFantasyCalcEntry(pid, name, fcData.bySleeperId, fcData.byName, hints)
        : null;

      // FFB
      const ffbEntry = ffbData
        ? getFfbEntry(pid, name, ffbData.bySleeperId, ffbData.byName)
        : null;

      // Active source fields for display
      let displayValue, overallRank, posRank, sortValue;
      let adjustedValue = null;
      let valueIndex = null;
      if (valueSource === 'ktc_sf' || valueSource === 'ktc_sf_tep') {
        displayValue = formatKtcValue(ktcEntry?.ktcValue);
        overallRank  = ktcEntry?.overallRank ?? null;
        posRank      = ktcEntry?.posRank     ?? null;
        sortValue    = ktcEntry?.ktcValue    ?? 0;
      } else if (valueSource === 'competitor_adjusted') {
        adjustedValue = redraftEntry?.competitorAdjustedValue ?? 0;
        sortValue = adjustedValue;
        displayValue = formatRedraftAdjustedValue(sortValue);
        valueIndex = computePlayerIndex(
          adjustedValue,
          dynastyKtcValue,
          redraftEntry?.redraftValueIndex,
        );
        overallRank = redraftEntry?.competitorAdjustedOverallRank ?? null;
        posRank = redraftEntry?.competitorAdjustedRank ?? null;
      } else if (valueSource === 'rebuilder_adjusted') {
        adjustedValue = redraftEntry?.rebuilderAdjustedValue ?? 0;
        sortValue = adjustedValue;
        displayValue = formatRedraftAdjustedValue(sortValue);
        valueIndex = computePlayerIndex(
          adjustedValue,
          dynastyKtcValue,
          redraftEntry?.rebuildValueIndex,
        );
        overallRank = redraftEntry?.rebuilderAdjustedOverallRank ?? null;
        posRank = redraftEntry?.rebuilderAdjustedRank ?? null;
      } else if (valueSource === 'hwang_market_value' || valueSource === 'hwang_true_value') {
        const lookup = valueSource === 'hwang_market_value' ? hwangMarketLookup : hwangTrueLookup;
        const hwangEntry = lookup?.byName
          ? getHwangAdjustedEntryByName(name, lookup.byName, hints)
          : null;
        sortValue = hwangEntry?.value ?? 0;
        displayValue = formatKtcValue(sortValue);
        overallRank = hwangEntry?.overallRank ?? null;
        posRank = hwangEntry?.posRank ?? null;
      } else if (valueSource === 'hwang_competitor_adjusted' || valueSource === 'hwang_rebuilder_adjusted') {
        const lookup = valueSource === 'hwang_competitor_adjusted'
          ? hwangCompetitorLookup
          : hwangRebuilderLookup;
        const hwangEntry = lookup?.byName
          ? getHwangAdjustedEntryByName(name, lookup.byName, hints)
          : null;
        sortValue = hwangEntry?.value ?? 0;
        displayValue = formatKtcValue(sortValue);
        overallRank = hwangEntry?.overallRank ?? null;
        posRank = hwangEntry?.posRank ?? null;
      } else if (valueSource === 'fantasycalc') {
        displayValue = formatFcValue(fcEntry?.value);
        overallRank  = fcEntry?.overallRank ?? null;
        posRank      = fcEntry?.posRank     ?? null;
        sortValue    = fcEntry?.value       ?? 0;
      } else {
        // ffb
        displayValue = formatFfbRank(ffbEntry?.rank);
        overallRank  = null; // rank IS the display value
        posRank      = null;
        sortValue    = ffbEntry ? Math.max(0, 390 - ffbEntry.rank) : 0;
      }

      return {
        pid,
        name,
        position:     info?.position || '',
        nflTeam:      info?.team || info?.team_abbr || '',
        espnPhotoUrl: info?.espn_photo_url || null,
        displayValue,
        overallRank,
        posRank,
        sortValue,
        ktcTepValue,
        dynastyKtcValue,
        adjustedValue,
        valueIndex,
        redraftTooltipEntry: redraftEntry
          ? { ...redraftEntry, position: info?.position || redraftEntry.position }
          : null,
        hasValue: sortValue > 0,
      };
    }).sort((a, b) => b.sortValue - a.sortValue);
  }, [
    selectedId,
    playersData,
    playerIdMap,
    ktcMap,
    fcData,
    ffbData,
    redraftData,
    rosters,
    valueSource,
    getPlayerKtcTepValue,
    hwangMarketLookup,
    hwangTrueLookup,
    hwangCompetitorLookup,
    hwangRebuilderLookup,
  ]);

  const selectedTeamIndex = selectedId != null ? teamRedraftIndices[selectedId] : null;
  const redraftHwangAdp = redraftUsesHwangAdp(redraftData?.adpSource);
  const selectedIndexLabel = valueSource === 'competitor_adjusted'
    ? 'Comp Index'
    : valueSource === 'rebuilder_adjusted'
      ? 'Rebuild Index'
      : null;

  const selectedPicks = useMemo(() => {
    if (!selectedId) return [];
    return (picksByRoster[selectedId] || []).map((pick) => {
      const origRid = pick.roster_id != null ? String(pick.roster_id) : null;
      const pickNum = origRid ? draftOrderMap[origRid] : null;
      return {
        ...pick,
        pickNum,
        ktcValue: getPickKtcValue(pick.season, pick.round, CURRENT_YEAR),
        label:    formatPickLabel(pick, draftOrderMap, nextDraftYear, rosterInfoMap),
      };
    });
  }, [selectedId, picksByRoster, draftOrderMap, nextDraftYear, rosterInfoMap]);

  const selectedTeam  = useMemo(() => sortedTeams.find((t) => t.rosterId === selectedId) || null, [sortedTeams, selectedId]);
  const selectedTotal = selectedId != null ? (teamKtcTotals[selectedId] ?? 0) : 0;

  // ── Player modal ────────────────────────────────────────────────────────────

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') setSelectedPlayer(null);
    }
    if (selectedPlayer) {
      document.addEventListener('keydown', onKeyDown);
    }
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedPlayer]);

  useEffect(() => {
    if (selectedPlayer) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => document.body.classList.remove('modal-open');
  }, [selectedPlayer]);

  const playerModal = selectedPlayer ? (
    <div className="player-modal-overlay" onClick={() => setSelectedPlayer(null)}>
      <div
        className="player-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <PlayerWeeklyScores
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
          rosters={rawRosters}
          users={rawUsers}
        />
      </div>
    </div>
  ) : null;

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) return <LoadingState label="Loading dynasty values…" />;
  if (error)   return <div className="dynasty-error">{error}</div>;

  return (
    <div className="dynasty-root">

      {/* ── Header + value source selector ── */}
      <div className="dynasty-section-header">
        <div className="dynasty-header-row">
          <div>
            <span className="dynasty-section-title">Dynasty Roster Values</span>
            <span className="dynasty-section-sub">sorted by total value</span>
          </div>
          <div className="dynasty-format-toggle">
            {VALUE_SOURCES.map((src) => (
              <button
                key={src}
                type="button"
                className={'dynasty-format-btn' + (valueSource === src ? ' dynasty-format-btn--active' : '')}
                onClick={() => setValueSource(src)}
              >
                {VALUE_SOURCE_LABELS[src]}
              </button>
            ))}
          </div>
        </div>
        {(valueSource === 'ktc_sf' || valueSource === 'ktc_sf_tep') && ktcAsOf && (
          <span className="dynasty-as-of">as of {ktcAsOf}</span>
        )}
        {(valueSource === 'competitor_adjusted' || valueSource === 'rebuilder_adjusted') && redraftData?.asOf && (
          <span className="dynasty-as-of">
            as of {redraftData.asOf} · KTC SF TE+ baseline
          </span>
        )}
        {(valueSource === 'hwang_market_value' || valueSource === 'hwang_true_value') && ktcAsOf && (
          <span className="dynasty-as-of">
            as of {ktcAsOf} · KTC SF TE+ baseline
            {hwangMultipliers[valueSource === 'hwang_market_value' ? 'market' : 'true']
              ? ` · ${formatMultiplierSummary(hwangMultipliers[valueSource === 'hwang_market_value' ? 'market' : 'true'])}`
              : ''}
          </span>
        )}
        {HWANG_COMPOSITE_VALUE_SOURCES.has(valueSource) && redraftData?.asOf && (
          <span className="dynasty-as-of">
            as of {redraftData.asOf} · {valueSource === 'hwang_competitor_adjusted' ? 'Competitor' : 'Rebuild'} × Hwang coeffs
            {hwangMultipliers.composite
              ? ` · ${formatMultiplierSummary(hwangMultipliers.composite)}`
              : ''}
          </span>
        )}
        {PICKS_ENABLED && PICKS_VALUE_SOURCES.includes(valueSource) && (
          <label className="dynasty-picks-total-toggle">
            <input
              type="checkbox"
              className="dynasty-picks-total-checkbox"
              checked={includePicksInTotal}
              onChange={(e) => setIncludePicksInTotal(e.target.checked)}
            />
            Include Draft Picks in Value Total
          </label>
        )}
      </div>

      {/* ── Team selector ── */}
      <div className="h2h-web-instruction">Select a team to view its roster values</div>
      <div className="h2h-web-list-anim-shell">
        <div className="h2h-web-list dynasty-team-list">
          {sortedTeams.map((team, idx) => {
            const isSelected = team.rosterId === selectedId;
            const total      = teamKtcTotals[team.rosterId];
            return (
              <button
                key={team.rosterId}
                type="button"
                className={
                  'h2h-web-card dynasty-team-card' +
                  (isSelected ? ' h2h-web-card--selected-primary' : '')
                }
                onClick={() => setSelectedId(isSelected ? null : team.rosterId)}
              >
                <span className="dynasty-card-rank">#{idx + 1}</span>
                {team.avatarUrl && (
                  <img
                    className="standings-avatar h2h-web-avatar"
                    src={team.avatarUrl}
                    alt={`${team.teamName} avatar`}
                  />
                )}
                <span className="yoffs-bracket-name h2h-web-name dynasty-card-name">
                  {team.teamName}
                </span>
                {total != null && total > 0 && (
                  <div className="dynasty-card-values">
                    <span className="dynasty-card-total">{total.toLocaleString()}</span>
                    {isRedraftValueSource && teamRedraftIndices[team.rosterId] != null && (
                      <span className={indexClassName(teamRedraftIndices[team.rosterId])}>
                        {formatIndexDeltaPct(teamRedraftIndices[team.rosterId])}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Roster panel ── */}
      {selectedTeam && (
        <div className="dynasty-roster-panel">
          <div className="dynasty-roster-header">
            {selectedTeam.avatarUrl && (
              <img
                className="standings-avatar dynasty-roster-avatar"
                src={selectedTeam.avatarUrl}
                alt={selectedTeam.teamName}
              />
            )}
            <span className="dynasty-roster-team-name">{selectedTeam.teamName}</span>
            <span className="dynasty-roster-total-label">{VALUE_SOURCE_TOTAL_LABEL[valueSource]}</span>
            <span className="dynasty-roster-total-value">{selectedTotal.toLocaleString()}</span>
            {isRedraftValueSource && selectedTeamIndex != null && selectedIndexLabel && (
              <>
                <span className="dynasty-roster-total-label">{selectedIndexLabel}</span>
                <span className={indexClassName(selectedTeamIndex)}>
                  {formatIndexDeltaPct(selectedTeamIndex)}
                  <span className="dynasty-index-mult"> ({formatRedraftIndex(selectedTeamIndex)})</span>
                </span>
              </>
            )}
          </div>

          <table className="dynasty-table">
            <thead>
              <tr>
                <th className="dynasty-th dynasty-th-player">Player</th>
                <th className="dynasty-th dynasty-th-ranks">Rank</th>
                <th className="dynasty-th dynasty-th-team">NFL</th>
                <th className="dynasty-th dynasty-th-ktc">
                  {isRedraftValueSource
                    ? `KTC TE+ · ${VALUE_SOURCE_COL_HEADER[valueSource]} · Index`
                    : VALUE_SOURCE_COL_HEADER[valueSource]}
                </th>
              </tr>
            </thead>
            <tbody>
              {/* ── Players ── */}
              {selectedPlayers.map(({
                pid,
                name,
                position,
                nflTeam,
                espnPhotoUrl,
                displayValue,
                overallRank,
                posRank,
                hasValue,
                dynastyKtcValue,
                valueIndex,
                redraftTooltipEntry,
              }) => {
                const pRankLabel = RANKED_POSITIONS.includes(position) && posRank
                  ? `${position}${posRank}`
                  : null;
                const playerInfo = playersData ? getPlayerInfo(pid, playersData, playerIdMap) : null;
                return (
                  <tr
                    key={pid}
                    className="dynasty-player-row player-clickable"
                    onClick={() => playerInfo && setSelectedPlayer(playerInfo)}
                  >
                    <td className="dynasty-td dynasty-td-player">
                      <img
                        src={getPlayerLogoUrl(espnPhotoUrl)}
                        alt={name}
                        className="dynasty-player-avatar"
                      />
                      <div className="dynasty-player-info">
                        <span className="dynasty-player-name">{name}</span>
                        {position && <PositionBadge position={position} />}
                      </div>
                    </td>
                    <td className="dynasty-td dynasty-td-ranks">
                      {(overallRank != null || pRankLabel) ? (
                        isRedraftValueSource ? (
                          <RedraftAdjTooltip
                            kind={valueSource === 'competitor_adjusted' ? 'comp' : 'rebuild'}
                            entry={redraftTooltipEntry}
                            className="redraft-adj-tooltip-wrap--block"
                            as="div"
                            usesHwangAdp={redraftHwangAdp}
                          >
                            <div className="dynasty-rank-stack">
                              {overallRank != null && (
                                <span className="dynasty-rank-overall">#{overallRank}</span>
                              )}
                              {pRankLabel && (
                                <span className="dynasty-rank-pos">{pRankLabel}</span>
                              )}
                            </div>
                          </RedraftAdjTooltip>
                        ) : (
                          <div className="dynasty-rank-stack">
                            {overallRank != null && (
                              <span className="dynasty-rank-overall">#{overallRank}</span>
                            )}
                            {pRankLabel && (
                              <span className="dynasty-rank-pos">{pRankLabel}</span>
                            )}
                          </div>
                        )
                      ) : null}
                    </td>
                    <td className="dynasty-td dynasty-td-team">{nflTeam}</td>
                    <td className="dynasty-td dynasty-td-ktc">
                      {isRedraftValueSource ? (
                        <RedraftAdjTooltip
                          kind={valueSource === 'competitor_adjusted' ? 'comp' : 'rebuild'}
                          entry={redraftTooltipEntry}
                          className="redraft-adj-tooltip-wrap--block"
                          as="div"
                          usesHwangAdp={redraftHwangAdp}
                        >
                          <div className="dynasty-value-comparison">
                            <div className="dynasty-value-comparison-row">
                              <span className={dynastyKtcValue > 0 ? 'dynasty-ktc-baseline' : 'dynasty-ktc-none'}>
                                {formatKtcValue(dynastyKtcValue)}
                              </span>
                              <span className="dynasty-value-arrow">→</span>
                              <span className={hasValue ? 'dynasty-ktc-value' : 'dynasty-ktc-none'}>
                                {displayValue}
                              </span>
                            </div>
                            <span className={indexClassName(valueIndex)}>
                              {formatRedraftIndex(valueIndex)}
                            </span>
                          </div>
                        </RedraftAdjTooltip>
                      ) : (
                        <span className={hasValue ? 'dynasty-ktc-value' : 'dynasty-ktc-none'}>
                          {displayValue}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {/* ── Picks divider ── */}
              {PICKS_ENABLED && PICKS_VALUE_SOURCES.includes(valueSource) && selectedPicks.length > 0 && (
                <tr className="dynasty-picks-divider-row">
                  <td colSpan={4} className="dynasty-picks-divider-cell">Draft Picks</td>
                </tr>
              )}

              {/* ── Picks ── */}
              {PICKS_ENABLED && PICKS_VALUE_SOURCES.includes(valueSource) && selectedPicks.map((pick, i) => (
                <tr key={`pick-${i}`} className="dynasty-player-row dynasty-pick-row">
                  <td className="dynasty-td dynasty-td-player">
                    <div className="dynasty-pick-icon">
                      <span className="dynasty-pick-icon-inner">{pick.round}</span>
                    </div>
                    <div className="dynasty-player-info">
                      <span className="dynasty-player-name dynasty-pick-label">{pick.label}</span>
                    </div>
                  </td>
                  <td className="dynasty-td dynasty-td-ranks">
                    {pick.pickNum != null && (
                      <span className="dynasty-rank-overall dynasty-rank-approx">
                        #{pick.pickNum}
                      </span>
                    )}
                  </td>
                  <td className="dynasty-td dynasty-td-team" />
                  <td className="dynasty-td dynasty-td-ktc">
                    <span className={pick.ktcValue > 0 ? 'dynasty-ktc-value dynasty-ktc-approx' : 'dynasty-ktc-none'}>
                      {formatKtcValue(pick.ktcValue)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {playerModal && createPortal(playerModal, document.body)}
    </div>
  );
}

export default DynastyRosterView;
