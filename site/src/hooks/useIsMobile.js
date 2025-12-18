// Backwards compatibility layer - redirects to new viewport system
// For new code, prefer using useViewportMode from './useViewportMode'
import { useState, useEffect } from 'react';
import useViewportMode, { VIEWPORT_MODES } from './useViewportMode';

function useIsMobile(maxWidth = 1000) {
  const viewportMode = useViewportMode();
  
  // If a custom maxWidth was passed (rare), fall back to simple check
  // Otherwise use the new viewport mode system
  if (maxWidth !== 1000) {
    // Legacy behavior for custom breakpoints
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [isMobile, setIsMobile] = useState(window.innerWidth <= maxWidth);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      const handleResize = () => setIsMobile(window.innerWidth <= maxWidth);
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, [maxWidth]);
    return isMobile;
  }
  
  // New behavior: mobile = phone screens only (< 800px)
  // This matches the memory preference for player name abbreviation
  return viewportMode === VIEWPORT_MODES.MOBILE;
}

export default useIsMobile; 