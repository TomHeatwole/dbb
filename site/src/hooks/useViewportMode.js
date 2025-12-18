import { useState, useEffect } from 'react';

// Define standard breakpoints
export const BREAKPOINTS = {
  MOBILE: 800,    // < 800px: true mobile (phones)
  TABLET: 1200,   // < 1200px: tablet/medium (show horizontal nav)
  DESKTOP: 1200   // >= 1200px: desktop (show vertical sidebar)
};

export const VIEWPORT_MODES = {
  MOBILE: 'mobile',
  TABLET: 'tablet',
  DESKTOP: 'desktop'
};

function useViewportMode() {
  const getMode = (width) => {
    if (width < BREAKPOINTS.MOBILE) {
      return VIEWPORT_MODES.MOBILE;
    }
    if (width < BREAKPOINTS.TABLET) {
      return VIEWPORT_MODES.TABLET;
    }
    return VIEWPORT_MODES.DESKTOP;
  };

  const [viewportMode, setViewportMode] = useState(getMode(window.innerWidth));

  useEffect(() => {
    const handleResize = () => setViewportMode(getMode(window.innerWidth));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return viewportMode;
}

// Convenience hooks for specific checks
export function useIsMobile() {
  const mode = useViewportMode();
  return mode === VIEWPORT_MODES.MOBILE;
}

export function useIsTablet() {
  const mode = useViewportMode();
  return mode === VIEWPORT_MODES.TABLET;
}

export function useIsDesktop() {
  const mode = useViewportMode();
  return mode === VIEWPORT_MODES.DESKTOP;
}

// For components that need sidebar visibility
export function useShowVerticalSidebar() {
  const mode = useViewportMode();
  return mode === VIEWPORT_MODES.DESKTOP;
}

// For components that need horizontal nav
export function useShowHorizontalNav() {
  const mode = useViewportMode();
  return mode !== VIEWPORT_MODES.DESKTOP;
}

export default useViewportMode;

