import { useCallback, useMemo, useState } from 'react';

const TIMING_KEY = 'sop2-timing';
const DISABLED_LEAGUES_KEY = 'sop2-disabled-leagues';

function readTiming() {
  try {
    const value = window.localStorage.getItem(TIMING_KEY);
    if (value === 'live' || value === 'future' || value === 'all') return value;
  } catch {
    // ignore
  }
  return 'all';
}

function readDisabledLeagues() {
  try {
    const raw = window.localStorage.getItem(DISABLED_LEAGUES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

export function useSOPBookFilters() {
  const [timing, setTimingState] = useState(readTiming);
  const [disabledKeys, setDisabledKeysState] = useState(readDisabledLeagues);

  const disabledLeagues = useMemo(() => new Set(disabledKeys), [disabledKeys]);

  const setTiming = useCallback((next) => {
    const value = next === 'live' || next === 'future' ? next : 'all';
    setTimingState(value);
    try {
      window.localStorage.setItem(TIMING_KEY, value);
    } catch {
      // ignore
    }
  }, []);

  const toggleLeague = useCallback((key) => {
    setDisabledKeysState((prev) => {
      const next = prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key];
      try {
        window.localStorage.setItem(DISABLED_LEAGUES_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const enableAllLeagues = useCallback(() => {
    setDisabledKeysState([]);
    try {
      window.localStorage.setItem(DISABLED_LEAGUES_KEY, '[]');
    } catch {
      // ignore
    }
  }, []);

  return {
    timing,
    setTiming,
    disabledLeagues,
    toggleLeague,
    enableAllLeagues,
  };
}
