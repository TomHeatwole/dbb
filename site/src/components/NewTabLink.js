import React from 'react';
import { Link } from 'react-router-dom';
import useDisplayMode from '../hooks/useDisplayMode';

/**
 * Same-origin "open in a new tab" that does not spawn a second OS app window.
 * Tabbed PWAs and regular browsers keep target=_blank. Tabless standalone
 * (Safari Add to Dock, old Chrome app windows) has no tab strip, so we stay
 * in this window instead of opening another "The Hwang Dynasty" application.
 */
function NewTabLink({ to, children, className, onClick, ...rest }) {
  const mode = useDisplayMode();
  const tablessStandalone = mode === 'standalone';

  return (
    <Link
      to={to}
      target={tablessStandalone ? undefined : '_blank'}
      rel={tablessStandalone ? undefined : 'noopener noreferrer'}
      className={className}
      onClick={onClick}
      {...rest}
    >
      {children}
    </Link>
  );
}

export default NewTabLink;
