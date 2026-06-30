import { useCallback, useState } from 'react';

const STORAGE_KEY_ENABLED = 'sop-kelly-enabled';
const STORAGE_KEY_BUDGET = 'sop-kelly-budget';
const STORAGE_KEY_FRACTION = 'sop-kelly-fraction';
export const DEFAULT_KELLY_BUDGET = 1000;
export const DEFAULT_KELLY_FRACTION = 1;
export const MIN_KELLY_FRACTION = 0.01;

function readStoredEnabled() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY_ENABLED);
    if (value === '1' || value === 'true') return true;
    if (value === '0' || value === 'false') return false;
  } catch {
    // ignore
  }
  return false;
}

function readStoredBudget() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY_BUDGET);
    const parsed = Number(String(value ?? '').replace(/[,$]/g, ''));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  } catch {
    // ignore
  }
  return DEFAULT_KELLY_BUDGET;
}

function readStoredFraction() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY_FRACTION);
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= MIN_KELLY_FRACTION && parsed <= 1) return parsed;
  } catch {
    // ignore
  }
  return DEFAULT_KELLY_FRACTION;
}

export function useSOPKellySettings() {
  const [enabled, setEnabledState] = useState(readStoredEnabled);
  const [budget, setBudgetState] = useState(readStoredBudget);
  const [budgetInput, setBudgetInput] = useState(() => String(readStoredBudget()));
  const [kellyFraction, setKellyFractionState] = useState(readStoredFraction);

  const setEnabled = useCallback((next) => {
    setEnabledState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY_ENABLED, next ? '1' : '0');
    } catch {
      // ignore
    }
  }, []);

  const commitBudget = useCallback((raw) => {
    const parsed = Number(String(raw ?? '').replace(/[,$]/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setBudgetInput(String(budget));
      return;
    }

    setBudgetState(parsed);
    setBudgetInput(String(parsed));
    try {
      window.localStorage.setItem(STORAGE_KEY_BUDGET, String(parsed));
    } catch {
      // ignore
    }
  }, [budget]);

  const setKellyFraction = useCallback((next) => {
    const clamped = Math.max(MIN_KELLY_FRACTION, Math.min(1, next));
    const rounded = Math.round(clamped * 100) / 100;
    setKellyFractionState(rounded);
    try {
      window.localStorage.setItem(STORAGE_KEY_FRACTION, String(rounded));
    } catch {
      // ignore
    }
  }, []);

  return {
    enabled,
    setEnabled,
    budget,
    budgetInput,
    setBudgetInput,
    commitBudget,
    kellyFraction,
    setKellyFraction,
  };
}
