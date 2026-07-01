import { useCallback, useState } from 'react';

const STORAGE_KEY = 'sop-longest-no-goal';

function readStored() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === '1' || value === 'true') return true;
    if (value === '0' || value === 'false') return false;
  } catch {
    // ignore
  }
  return false;
}

export function useSOPLongestNoGoal() {
  const [enabled, setEnabledState] = useState(readStored);

  const setEnabled = useCallback((next) => {
    setEnabledState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // ignore
    }
  }, []);

  return { enabled, setEnabled };
}
