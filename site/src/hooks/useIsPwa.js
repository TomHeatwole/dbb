import { useEffect, useState } from 'react';

function computeIsPwa() {
  if (typeof window === 'undefined') {
    return false;
  }

  // Spec: display-mode media query
  const displayModeStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;

  // iOS Safari: navigator.standalone is true when launched from A2HS
  const iosStandalone =
    window.navigator &&
    typeof window.navigator === 'object' &&
    window.navigator.standalone === true;

  // Android Trusted Web Activity / similar
  const referrer =
    typeof document !== 'undefined' && document.referrer ? document.referrer : '';
  const androidAppReferrer =
    typeof referrer === 'string' && referrer.startsWith('android-app://');

  return Boolean(displayModeStandalone || iosStandalone || androidAppReferrer);
}

function useIsPwa() {
  const [isPwa, setIsPwa] = useState(computeIsPwa());

  useEffect(() => {
    let mediaQueryList = null;
    let cancelled = false;
    let mediaHandler = null;

    function recompute() {
      if (cancelled) {
        return;
      }
      setIsPwa(computeIsPwa());
    }

    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        mediaQueryList = window.matchMedia('(display-mode: standalone)');

        mediaHandler = () => {
          recompute();
        };

        if (typeof mediaQueryList.addEventListener === 'function') {
          mediaQueryList.addEventListener('change', mediaHandler);
        } else if (typeof mediaQueryList.addListener === 'function') {
          // Safari < 14
          mediaQueryList.addListener(mediaHandler);
        }
      }
    } catch (_) {
      // Ignore - we'll still recompute on focus/visibility.
    }

    window.addEventListener('focus', recompute);
    document.addEventListener('visibilitychange', recompute);

    // Catch iOS: after opening in Safari, "standalone" may only be known after load.
    recompute();

    return () => {
      cancelled = true;
      window.removeEventListener('focus', recompute);
      document.removeEventListener('visibilitychange', recompute);

      if (mediaQueryList && mediaHandler) {
        if (typeof mediaQueryList.removeEventListener === 'function') {
          mediaQueryList.removeEventListener('change', mediaHandler);
        } else if (typeof mediaQueryList.removeListener === 'function') {
          mediaQueryList.removeListener(mediaHandler);
        }
      }
    };
  }, []);

  return isPwa;
}

export default useIsPwa;


