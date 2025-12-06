import React from 'react';
import {
  Helmet as AsyncHelmet,
  HelmetProvider as AsyncHelmetProvider
} from 'react-helmet-async';

/**
 * HelmetShim
 *
 * Thin adapter around react-helmet-async so the rest of the app can depend
 * only on this module. If we ever swap out the underlying library or add
 * SSR/prerender-specific behavior, it all lives here.
 */
export function HelmetProvider({ children }) {
  return (
    <AsyncHelmetProvider>
      {children}
    </AsyncHelmetProvider>
  );
}

export function Helmet(props) {
  return <AsyncHelmet {...props} />;
}

