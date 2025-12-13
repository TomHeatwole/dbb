import { LEAGUE_ID, PREVIOUS_YEARS } from './global_constants';
import { CURRENT_YEAR, getCurrentNFLWeek, shouldPollCurrentWeek } from './DateHelper';
import { readApiCacheLatestByKey, readPollingIntervalMs } from './database';
import { fetchNflScoreboard } from '../lookups/GamesLookup';
import { fetchScoresData } from '../lookups/ScoresLookup';

/**
 * Shared live polling helper for Sleeper league matchups.
 *
 * It:
 * - Reads a configurable polling interval from the DB
 * - Gates polling based on ESPN's scoreboard + shouldPollCurrentWeek
 * - Uses a short TTL for the active week when games are live, longer TTL otherwise
 * - Refreshes Sleeper matchups via fetchScoresData(season, { activeWeekTtlMs })
 * - Exposes results via callbacks so callers can update UI / derive diffs
 *
 * Callers are responsible for:
 * - Deciding when to construct/destroy a poller (e.g. only when viewing current week)
 * - Applying newWeeks into component state
 * - Optional diff/highlight logic based on the newWeeks snapshot
 */
export function createLiveScoresPoller({
  season,
  week,
  onData,
  onDelayMinutesChange,
  onLiveWindowChange,
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
            void tick();
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
      void tick();
    }, pollingIntervalMs);
  }

  function stopInterval() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  async function tick() {
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

      if (isActiveWeek) {
        const espnCacheKey = `espn_site_v2_sports_football_nfl_scoreboard_week_${week}_year_${season}_seasontype_2`;
        let scoreboard = null;
        try {
          const latestE = await readApiCacheLatestByKey(espnCacheKey);
          scoreboard = latestE && latestE.data ? latestE.data : null;
        } catch (_) {
          // ignore
        }
        if (!scoreboard) {
          try {
            scoreboard = await fetchNflScoreboard(Number(season), Number(week));
          } catch (_) {
            // ignore
          }
        }
        const shouldPoll = shouldPollCurrentWeek(scoreboard);
        isLivePollingWindow = !!shouldPoll;
        if (typeof onLiveWindowChange === 'function') {
          try {
            onLiveWindowChange(isLivePollingWindow);
          } catch (_) {
            // ignore caller errors
          }
        }
        activeWeekTtlMs = shouldPoll ? 60 * 1000 : 60 * 60 * 1000;
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

      let newWeeks = null;
      let fetchFailed = false;
      try {
        newWeeks = await fetchScoresData(season, { activeWeekTtlMs });
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
            const wasStaleBefore = prevAgeMs != null && prevAgeMs > 60 * 1000;
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

      if (typeof onData === 'function') {
        try {
          await onData({
            newWeeks,
            dbEntryTs,
            prevDbTs,
            isLivePollingWindow,
            activeWeekTtlMs,
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
        void tick();
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
        void tick();
        startIntervalIfVisible();
      }
    };

    blurHandler = () => {
      stopInterval();
    };

    if (typeof document !== 'undefined') {
      if (document.visibilityState === 'visible') {
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


