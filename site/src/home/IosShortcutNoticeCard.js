import React, { useEffect, useState } from 'react';
import HomeCard from './HomeCard';

const IOS_SHORTCUT_NOTICE_DISMISSED_KEY = 'iosShortcutNoticeDismissed';

function computeIsSafari() {
  if (typeof window === 'undefined' || !window.navigator) {
    return false;
  }

  const ua = String(window.navigator.userAgent || '').toLowerCase();

  // Safari on iOS includes "safari" but not the other iOS browsers (which are still WebKit
  // but brand their UA differently).
  const looksLikeSafari = ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium');
  const isOtherIosBrowser =
    ua.includes('crios') || // Chrome iOS
    ua.includes('fxios') || // Firefox iOS
    ua.includes('edgios') || // Edge iOS
    ua.includes('opios') || // Opera iOS
    ua.includes('gsa'); // Google app in-app browser

  return Boolean(looksLikeSafari && !isOtherIosBrowser);
}

function IosShortcutNoticeCard() {
  const [showInstructions, setShowInstructions] = useState(false);
  const [isSafari, setIsSafari] = useState(computeIsSafari());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    if (showInstructions) {
      document.body.classList.add('modal-open');
      return () => {
        document.body.classList.remove('modal-open');
      };
    }

    document.body.classList.remove('modal-open');
    return undefined;
  }, [showInstructions]);

  useEffect(() => {
    setIsSafari(computeIsSafari());
  }, []);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(IOS_SHORTCUT_NOTICE_DISMISSED_KEY);
        setDismissed(stored === '1');
      }
    } catch (_) {
      // If storage is blocked, just default to showing the card.
      setDismissed(false);
    }
  }, []);

  if (dismissed) {
    return null;
  }

  return (
    <HomeCard className="home-card--ios-shortcut-notice">
      <div className="home-card-inner">
        <div className="home-card-title-row">
          <h2 className="home-card-title">Save HwangDynasty to iOS</h2>
          <button
            type="button"
            className="home-card-dismiss"
            aria-label="Dismiss"
            onClick={() => {
              setDismissed(true);
              try {
                if (typeof window !== 'undefined' && window.localStorage) {
                  window.localStorage.setItem(IOS_SHORTCUT_NOTICE_DISMISSED_KEY, '1');
                }
              } catch (_) {
                // Ignore storage failures - the in-memory dismiss still works for this session.
              }
            }}
          >
            ×
          </button>
        </div>
        <div className="home-card-body">
          <img
            className="ios-shortcut-preview-image"
            src="/hwangapp.jpeg"
            alt="Preview of HwangDynasty on the iOS home screen"
            loading="lazy"
          />
        </div>
        <div className="home-card-body">
          <button
            type="button"
            className="home-inline-link-button home-inline-link-button--centered"
            onClick={() => {
              setShowInstructions(true);
            }}
          >
            Save HwangDynasty
            <br />
            as an iOS shortcut
          </button>
        </div>
      </div>

      {showInstructions ? (
        <div
          className="rookie-draft-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="iOS shortcut instructions"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowInstructions(false);
            }
          }}
        >
          <div className="rookie-draft-modal ios-shortcut-modal">
            <button
              type="button"
              className="rookie-draft-modal-close"
              aria-label="Close"
              onClick={() => {
                setShowInstructions(false);
              }}
            >
              ×
            </button>

            <div className="rookie-draft-modal-title">Save HwangDynasty to iOS</div>
            <div className="rookie-draft-modal-sub">
              Add HwangDynasty to your iPhone home screen so it opens like an app.
            </div>

            <ol className="ios-shortcut-modal-steps">
              {!isSafari ? (
                <li>Open this page in Safari.</li>
              ) : null}
              <li>
                <div>Hit the Share button at the bottom of the browser.</div>
                <img
                  className="ios-shortcut-step-image"
                  src="/share_step.jpeg"
                  alt="iOS Safari Share button"
                  loading="lazy"
                />
              </li>
              <li>
                <div>Add to Home Screen.</div>
                <img
                  className="ios-shortcut-step-image"
                  src="/add_home_step.png"
                  alt="iOS Safari Add to Home Screen option"
                  loading="lazy"
                />
              </li>
              <li>Press “Add” and enjoy the shortcut!</li>
            </ol>
          </div>
        </div>
      ) : null}
    </HomeCard>
  );
}

export default IosShortcutNoticeCard;


