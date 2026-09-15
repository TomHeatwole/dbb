import { useCallback, useEffect, useRef, useState } from 'react';

const SPLASH_DEBOUNCE_MS = 250;
const SPLASH_FADE_MS = 350;
const SPLASH_MAX_MS = 18000;

function countCardSpinners(root) {
  if (!root) return Infinity;
  return root.querySelectorAll('.loading-center').length;
}

function countHomeCards(root) {
  if (!root) return 0;
  return root.querySelectorAll('.home-card').length;
}

/**
 * Full-page home splash: stays up until the split layout is placed and every
 * mounted home card has finished its LoadingState (no spinners left in the grid).
 */
export function useHomePageSplash({ enabled, resetKey, layoutReady, gridRef }) {
  const [phase, setPhase] = useState(enabled ? 'loading' : 'done');
  const [progress, setProgress] = useState(0);
  const dismissStartedRef = useRef(false);
  const sawSpinnerRef = useRef(false);
  const maxSpinnersRef = useRef(0);
  const debounceRef = useRef(null);
  const fadeRef = useRef(null);
  const maxRef = useRef(null);
  const creepRef = useRef(null);

  const beginDismiss = useCallback(() => {
    if (dismissStartedRef.current) return;
    dismissStartedRef.current = true;
    setProgress(1);
    setPhase('exiting');
    fadeRef.current = setTimeout(() => setPhase('done'), SPLASH_FADE_MS);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setPhase('done');
      return undefined;
    }

    dismissStartedRef.current = false;
    sawSpinnerRef.current = false;
    maxSpinnersRef.current = 0;
    setProgress(0.08);
    setPhase('loading');

    maxRef.current = setTimeout(beginDismiss, SPLASH_MAX_MS);
    creepRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 0.38) return prev;
        return prev + 0.015;
      });
    }, 180);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (fadeRef.current) clearTimeout(fadeRef.current);
      if (maxRef.current) clearTimeout(maxRef.current);
      if (creepRef.current) clearInterval(creepRef.current);
    };
  }, [enabled, resetKey, beginDismiss]);

  useEffect(() => {
    if (!enabled || !layoutReady || phase === 'done' || phase === 'exiting') {
      return undefined;
    }

    const root = gridRef.current;
    if (!root) return undefined;

    const checkReady = () => {
      if (dismissStartedRef.current) return;

      const spinners = countCardSpinners(root);
      const cards = countHomeCards(root);
      if (spinners > 0) {
        sawSpinnerRef.current = true;
        maxSpinnersRef.current = Math.max(maxSpinnersRef.current, spinners);
        const loaded = 1 - spinners / maxSpinnersRef.current;
        setProgress((prev) => Math.max(prev, 0.38 + loaded * 0.54));
        if (debounceRef.current) clearTimeout(debounceRef.current);
        return;
      }

      if (sawSpinnerRef.current) {
        setProgress((prev) => Math.max(prev, 0.96));
      } else if (cards >= 3) {
        setProgress((prev) => Math.max(prev, 0.55));
      }

      // Avoid dismissing while only the pinned footer cards are on screen.
      if (!sawSpinnerRef.current && cards < 3) return;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (dismissStartedRef.current) return;
        if (countCardSpinners(root) > 0) return;
        beginDismiss();
      }, SPLASH_DEBOUNCE_MS);
    };

    checkReady();
    const observer = new MutationObserver(checkReady);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      observer.disconnect();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [enabled, layoutReady, resetKey, phase, gridRef, beginDismiss]);

  return {
    showLoader: phase === 'loading' || phase === 'exiting',
    exiting: phase === 'exiting',
    progress,
  };
}
