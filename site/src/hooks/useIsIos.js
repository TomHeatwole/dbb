import { useEffect, useState } from 'react';

function computeIsIos() {
  if (typeof window === 'undefined' || !window.navigator) {
    return false;
  }

  const ua = String(window.navigator.userAgent || '').toLowerCase();

  // iPadOS can present as "Macintosh" but with touch points.
  const isIPadOS =
    ua.includes('macintosh') &&
    typeof window.navigator.maxTouchPoints === 'number' &&
    window.navigator.maxTouchPoints > 1;

  const isClassicIos = /iphone|ipad|ipod/.test(ua);

  return Boolean(isIPadOS || isClassicIos);
}

function useIsIos() {
  const [isIos, setIsIos] = useState(computeIsIos());

  useEffect(() => {
    // UA doesn’t normally change, but this keeps it resilient to oddities and
    // avoids direct window access in render after hydration.
    setIsIos(computeIsIos());
  }, []);

  return isIos;
}

export default useIsIos;


