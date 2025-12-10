import React, { useEffect, useState } from 'react';
import ScoresView from '../scores/ScoresView';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { getStandings, getWeekScoreBreakdown, getPlayerSeasonTotalsMap } from '../scores/ScoresParser';
import { StartSitSort } from '../players/StartSitDecider';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';

/**
 * Thin wrapper around ScoresView for yoffs pages.
 *
 * It applies:
 * - Gold playoff styling for rows
 * - Week bounds based on supplied start/end
 * - Seed labels using regular-season seeds (top 4 through first 14 weeks)
 * - Playoff-only Place/PF based on cumulative playoff totals across the playoff weeks
 *
 * Props:
 * - season: Sleeper season
 * - rows: optional array of playoff rows from Yoffs2024Format
 *   (each row should at least have { rosterId, place, pointsScored })
 * - startWeek / endWeek: inclusive playoff week range
 */
function YoffsScoresView({ season, rows, startWeek, endWeek }) {
  const [effectiveRows, setEffectiveRows] = useState(
    Array.isArray(rows) ? rows.slice(0, 4) : null
  );

  useEffect(() => {
    if (Array.isArray(rows) && rows.length) {
      setEffectiveRows(rows.slice(0, 4));
      return;
    }

    let cancelled = false;

    async function loadPlayoffRows() {
      try {
        const [weeksData, players, idMap] = await Promise.all([
          fetchScoresData(season),
          fetchPlayersData(season),
          fetchPlayerIdMap()
        ]);

        if (cancelled || !weeksData || !Array.isArray(weeksData)) {
          if (!cancelled) {
            setEffectiveRows([]);
          }
          return;
        }

        const regularSliceFull = weeksData.slice(0, 14);
        const weeksRegular = regularSliceFull.filter(Boolean);
        if (!weeksRegular.length) {
          if (!cancelled) {
            setEffectiveRows([]);
          }
          return;
        }

        const standingsRegular = getStandings(weeksRegular) || [];
        const top4Regular = standingsRegular
          .slice()
          .sort((a, b) => a.place - b.place)
          .slice(0, 4);
        const seedIds = top4Regular.map((r) => Number(r.roster_id));
        const seedSet = new Set(seedIds);
        const seedPlaceById = {};
        top4Regular.forEach((r) => {
          seedPlaceById[Number(r.roster_id)] = r.place;
        });

        const seasonTotalsMap = getPlayerSeasonTotalsMap(weeksData);
        const statsByRoster = {};
        for (let wk = startWeek; wk <= endWeek; wk += 1) {
          const breakdown = getWeekScoreBreakdown(weeksData, wk) || {};
          const weekEntries = Array.isArray(weeksData[wk - 1]) ? weeksData[wk - 1] : [];
          const basePointsByRoster = {};
          weekEntries.forEach((entry) => {
            if (!entry || entry.roster_id == null) {
              return;
            }
            const rid = Number(entry.roster_id);
            if (!basePointsByRoster[rid]) {
              basePointsByRoster[rid] = 0;
            }
            if (typeof entry.points === 'number' && isFinite(entry.points)) {
              basePointsByRoster[rid] += Math.round(entry.points * 10) / 10;
            }
          });

          Object.keys(breakdown).forEach((ridKey) => {
            const rid = Number(ridKey);
            if (!seedSet.has(rid)) {
              return;
            }
            if (!statsByRoster[rid]) {
              statsByRoster[rid] = {
                weekPoints: {}
              };
            }
            let weekTotal = basePointsByRoster[rid] || 0;
            try {
              if (players && idMap) {
                const teamScore = breakdown[ridKey];
                if (teamScore) {
                  const computed = StartSitSort(teamScore, players, idMap, null, null, seasonTotalsMap);
                  if (computed && typeof computed.starterTotal === 'number') {
                    weekTotal = Math.round(computed.starterTotal * 10) / 10;
                  }
                }
              }
            } catch (_) {
              // fallback to base API points
            }
            if (typeof weekTotal === 'number' && isFinite(weekTotal)) {
              const s = statsByRoster[rid];
              if (!s.weekPoints[wk]) {
                s.weekPoints[wk] = 0;
              }
              s.weekPoints[wk] += weekTotal;
            }
          });
        }

        const mergedRows = top4Regular.map((seedRow) => {
          const rid = Number(seedRow.roster_id);
          const stats = statsByRoster[rid] || { weekPoints: {} };
          const weekPoints = stats.weekPoints || {};
          let total = 0;
          for (let wk = startWeek; wk <= endWeek; wk += 1) {
            const val = weekPoints[wk];
            if (typeof val === 'number' && isFinite(val)) {
              total += val;
            }
          }
          const displayPlace =
            seedPlaceById[rid] != null ? seedPlaceById[rid] : seedRow.place;
          return {
            rosterId: rid,
            place: displayPlace,
            pointsScored: total
          };
        });

        if (!cancelled) {
          setEffectiveRows(mergedRows.slice(0, 4));
        }
      } catch (_) {
        if (!cancelled) {
          setEffectiveRows([]);
        }
      }
    }

    loadPlayoffRows();

    return () => {
      cancelled = true;
    };
  }, [season, startWeek, endWeek, rows]);

  if (effectiveRows === null) {
    return (
      <div className="loading-center">
        <div className="spinner" aria-label="Loading" />
        <div className="loading-text">Loading scores…</div>
        <img src="/logo.png" alt="Site logo" className="loading-logo" />
      </div>
    );
  }

  const cleanRows = Array.isArray(effectiveRows) ? effectiveRows.slice(0, 4) : [];
  const includedRosterIds = cleanRows.length ? cleanRows.map((r) => r.rosterId) : null;

  let rosterIdToSeed = null;
  let rosterIdToPlayoffMeta = null;

  if (cleanRows.length) {
    const seedMap = {};
    cleanRows.forEach((r) => {
      seedMap[String(r.rosterId)] = r.place;
    });

    const playoffOrderMap = (() => {
      const sorted = cleanRows
        .slice()
        .sort((a, b) => {
          const ap = typeof a.pointsScored === 'number' ? a.pointsScored : 0;
          const bp = typeof b.pointsScored === 'number' ? b.pointsScored : 0;
          if (bp !== ap) {
            return bp - ap;
          }
          const aSeed = a.place != null ? a.place : 999;
          const bSeed = b.place != null ? b.place : 999;
          return aSeed - bSeed;
        });
      const map = new Map();
      let place = 1;
      let i = 0;
      while (i < sorted.length) {
        const score =
          typeof sorted[i].pointsScored === 'number' ? sorted[i].pointsScored : 0;
        let j = i + 1;
        while (
          j < sorted.length &&
          (typeof sorted[j].pointsScored === 'number' ? sorted[j].pointsScored : 0) === score
        ) {
          j += 1;
        }
        for (let k = i; k < j; k += 1) {
          map.set(sorted[k].rosterId, place);
        }
        place += j - i;
        i = j;
      }
      return map;
    })();

    const metaMap = {};
    cleanRows.forEach((r) => {
      const rid = r.rosterId;
      const total = typeof r.pointsScored === 'number' ? r.pointsScored : 0;
      const place = playoffOrderMap.get(rid) || null;
      metaMap[String(rid)] = { place, total };
    });

    rosterIdToSeed = seedMap;
    rosterIdToPlayoffMeta = metaMap;
  }

  return (
    <ScoresView
      season={season}
      includedRosterIds={includedRosterIds}
      minWeek={startWeek}
      maxWeek={endWeek}
      usePlayoffTheme
      rosterIdToSeed={rosterIdToSeed}
      rosterIdToPlayoffMeta={rosterIdToPlayoffMeta}
    />
  );
}

export default YoffsScoresView;


