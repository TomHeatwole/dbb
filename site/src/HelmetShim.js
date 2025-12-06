import React from 'react';

/**
 * HelmetShim
 *
 * Previously this wrapped `react-helmet-async`, but that package's peer
 * dependencies do not yet declare support for React 19, which caused
 * `npm ERR! ERESOLVE` failures during installs/builds.
 *
 * To avoid that dependency conflict while still letting the rest of the app
 * use the same API, this shim now provides a very thin `HelmetProvider`
 * that simply renders its children. Per-page meta handling is done inside
 * `PageMeta` without any external library.
 */
export function HelmetProvider({ children }) {
  return (
    <>
      {children}
    </>
  );
}

