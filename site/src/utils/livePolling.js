import { LEAGUE_ID, PREVIOUS_YEARS } from './global_constants';
import { CURRENT_YEAR, getCurrentNFLWeek, shouldPollCurrentWeek } from './DateHelper';
import { readApiCacheLatestByKey, readPollingIntervalMs } from './database';
import { fetchNflScoreboard } from '../lookups/GamesLookup';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { applyLiveEspnOverlay } from '../lookups/EspnBoxScoreLookup';
import { eventIdsForBoxScores } from '../scores/espnBoxScore';

const SLEEPER_LIVE_TTL_MS = 60 * 1000;
const ESPN_SCOREBOARD_TTL_MS = 20 * 1000;

/**
 * Shared live polling helper for Sleeper league matchups + ESPN box scores.
 *
 * During a live window:
 * - Refreshes ESPN's scoreboard every ~20s (used for the live gate and box scores)
 * - Awaits Sleeper only for the viewed week, and only when that cache is >60s
 *   or the tick is a start/focus force. Other weeks stay cache-only.
 * - Overlays ESPN box-score points / stat lines onto the in-memory week.
 *   ESPN-overlaid rows are never written back to the Sleeper cache key.
 */
export function createLiveScoresPoller({
  season,
  week,
  onData,
  onDelayMinutesChange,
  onLiveWindowChange,
  forceOnStartAndFocus = false,
  forceWeeks = null,
  getOverlayContext = null,
}) {
  let polling = false;
  let pollingIntervalMs = 15000;
  let intervalId = null;
  let started = false;
  let stopped = false;

  let visibilityHandler = null;
  let focusHandler = null;
  let blurHandler = null;

  async function refreshPollingInterval() {
    try {
      const ms = await readPollingIntervalMs();
      if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) {
        pollingIntervalMs = ms;
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = setInterval(() => {
            void tick(false);
          }, pollingIntervalMs);
        }
      }
    } catch (_) {
      // Ignore interval load failures; keep default
    }
  }

  function startIntervalIfVisible() {
    if (intervalId || stopped) {
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return;
    }
    intervalId = setInterval(() => {
      void tick(false);
    }, pollingIntervalMs);
  }

  function stopInterval() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  async function tick(forceUpdate = false) {
    if (stopped) {
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return;
    }
    if (polling) {
      return;
    }
    polling = true;
    try {
      const isCurrentSeason = String(season) === String(CURRENT_YEAR);
      const currentWk = getCurrentNFLWeek();
      const isActiveWeek = isCurrentSeason && Number(week) === currentWk;
      let activeWeekTtlMs = null;
      let isLivePollingWindow = false;
      let scoreboard = null;

      if (isActiveWeek) {
        try {
          scoreboard = await fetchNflScoreboard(Number(season), Number(week), {
            forceUpdate,
            maxAgeMs: ESPN_SCOREBOARD_TTL_MS,
          });
        } catch (_) {
          scoreboard = null;
        }
        if (!scoreboard) {
          try {
            const espnCacheKey = `espn_site_v2_sports_football_nfl_scoreboard_week_${week}_year_${season}_seasontype_2`;
            const latestE = await readApiCacheLatestByKey(espnCacheKey);
            scoreboard = latestE && latestE.data ? latestE.data : null;
          } catch (_) {
            // ignore
          }
        }
        const shouldPoll = shouldPollCurrentWeek(scoreboard);
        const hasRecentBoxes = eventIdsForBoxScores(scoreboard).length > 0;
        isLivePollingWindow = !!shouldPoll || hasRecentBoxes;
        if (typeof onLiveWindowChange === 'function') {
          try {
            onLiveWindowChange(isLivePollingWindow);
          } catch (_) {
            // ignore caller errors
          }
        }
        activeWeekTtlMs = shouldPoll ? SLEEPER_LIVE_TTL_MS : 60 * 60 * 1000;
      } else if (typeof onLiveWindowChange === 'function') {
        try {
          onLiveWindowChange(false);
        } catch (_) {
          // ignore caller errors
        }
      }

      const isCurrentSeasonForLeagueId = String(season) === String(CURRENT_YEAR);
      const leagueId = isCurrentSeasonForLeagueId ? LEAGUE_ID : PREVIOUS_YEARS[season];
      const cacheKey = `sleeper_v1_league_${leagueId}_matchups_${week}`;

      let prevDbTs = null;
      try {
        const prevLatest = await readApiCacheLatestByKey(cacheKey);
        prevDbTs = prevLatest && prevLatest.ts ? prevLatest.ts : null;
      } catch (_) {
        // ignore cache read errors
      }

      const networkWeeks = [Number(week)];
      if (Array.isArray(forceWeeks)) {
        for (const w of forceWeeks) {
          const n = Number(w);
          if (Number.isFinite(n) && !networkWeeks.includes(n)) networkWeeks.push(n);
        }
      }

      const sleeperAgeMs = prevDbTs != null ? Date.now() - prevDbTs : Infinity;
      const sleeperStale = isLivePollingWindow && sleeperAgeMs > SLEEPER_LIVE_TTL_MS;
      const forceSleeper = !!forceUpdate || sleeperStale;

      let newWeeks = null;
      let fetchFailed = false;
      try {
        newWeeks = await fetchScoresData(season, {
          activeWeekTtlMs,
          forceUpdate: forceSleeper,
          staleWhileRevalidate: false,
          networkWeeks,
          forceWeeks: Array.isArray(forceWeeks) ? forceWeeks : undefined,
        });
      } catch (_) {
        fetchFailed = true;
      }

      let dbEntryTs = null;
      try {
        const latestAfter = await readApiCacheLatestByKey(cacheKey);
        dbEntryTs = latestAfter && latestAfter.ts ? latestAfter.ts : null;
      } catch (_) {
        // ignore cache read errors
      }

      if (typeof onDelayMinutesChange === 'function') {
        try {
          if (isLivePollingWindow) {
            const now = Date.now();
            const prevAgeMs = prevDbTs != null ? now - prevDbTs : null;
            const afterAgeMs = dbEntryTs != null ? now - dbEntryTs : null;
            const wasStaleBefore = prevAgeMs != null && prevAgeMs > SLEEPER_LIVE_TTL_MS;
            if (wasStaleBefore && (fetchFailed || dbEntryTs === prevDbTs)) {
              const ageMs = afterAgeMs != null ? afterAgeMs : prevAgeMs;
              if (ageMs != null && ageMs >= 120000) {
                onDelayMinutesChange(Math.floor(ageMs / 60000));
              } else {
                onDelayMinutesChange(null);
              }
            } else {
              onDelayMinutesChange(null);
            }
          } else {
            onDelayMinutesChange(null);
          }
        } catch (_) {
          // ignore caller errors
        }
      }

      if (!Array.isArray(newWeeks)) {
        return;
      }

      let espnStatLines = {};
      if (scoreboard && (isLivePollingWindow || isActiveWeek)) {
        try {
          const ctx = typeof getOverlayContext === 'function' ? (getOverlayContext() || {}) : {};
          const overlaid = await applyLiveEspnOverlay({
            weeks: newWeeks,
            week,
            season,
            scoreboard,
            playerIdMap: ctx.playerIdMap || null,
            playersData: ctx.playersData || null,
          });
          if (overlaid && Array.isArray(overlaid.weeks)) {
            newWeeks = overlaid.weeks;
            espnStatLines = overlaid.statLines || {};
          }
        } catch (_) {
          // keep official Sleeper week if ESPN overlay fails
        }
      }

      if (typeof onData === 'function') {
        try {
          await onData({
            newWeeks,
            dbEntryTs,
            prevDbTs,
            isLivePollingWindow,
            activeWeekTtlMs,
            espnStatLines,
            scoreboard,
          });
        } catch (_) {
          // ignore caller errors
        }
      }
    } finally {
      polling = false;
    }
  }

  function start() {
    if (started) {
      return;
    }
    started = true;
    stopped = false;

    void refreshPollingInterval();

    visibilityHandler = () => {
      if (typeof document === 'undefined') {
        return;
      }
      if (document.visibilityState === 'visible') {
        void tick(forceOnStartAndFocus);
        startIntervalIfVisible();
      } else {
        stopInterval();
      }
    };

    focusHandler = () => {
      if (typeof document === 'undefined') {
        return;
      }
      if (document.visibilityState === 'visible') {
        void tick(forceOnStartAndFocus);
        startIntervalIfVisible();
      }
    };

    blurHandler = () => {
      stopInterval();
    };

    if (typeof document !== 'undefined') {
      if (document.visibilityState === 'visible') {
        void tick(forceOnStartAndFocus);
        startIntervalIfVisible();
      }
      document.addEventListener('visibilitychange', visibilityHandler);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', focusHandler);
      window.addEventListener('blur', blurHandler);
    }
  }

  function stop() {
    if (!started) {
      return;
    }
    started = false;
    stopped = true;
    stopInterval();
    if (typeof document !== 'undefined' && visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler);
    }
    if (typeof window !== 'undefined') {
      if (focusHandler) {
        window.removeEventListener('focus', focusHandler);
      }
      if (blurHandler) {
        window.removeEventListener('blur', blurHandler);
      }
    }
    visibilityHandler = null;
    focusHandler = null;
    blurHandler = null;
  }

  return {
    start,
    stop,
  };
}
