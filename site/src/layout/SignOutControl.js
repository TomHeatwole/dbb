import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuthUser } from '../hooks/useAuthUser';
import { getAuthClient, clearSessionCache } from '../utils/authClient';

function SignOutControl({ className = '', label = 'Sign Out' }) {
  const { user, refresh } = useAuthUser();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!user) return null;

  const confirmSignOut = async () => {
    setBusy(true);
    try {
      await getAuthClient().signOut();
      clearSessionCache();
      await refresh();
      setOpen(false);
    } catch (_) {
      setBusy(false);
    }
  };

  const dialog = open ? (
    <div
      className="signout-confirm-overlay"
      role="presentation"
      onClick={() => { if (!busy) setOpen(false); }}
    >
      <div
        className="signout-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signout-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="signout-confirm-close"
          aria-label="Cancel"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          ×
        </button>
        <div id="signout-confirm-title" className="signout-confirm-title">
          Are you sure?
        </div>
        <button
          type="button"
          className="signout-confirm-btn"
          disabled={busy}
          onClick={confirmSignOut}
        >
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {dialog ? createPortal(dialog, document.body) : null}
    </>
  );
}

export default SignOutControl;
