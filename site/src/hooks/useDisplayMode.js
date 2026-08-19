import { useEffect, useState } from 'react';

function readDisplayMode() {
  if (typeof window === 'undefined') {
    return 'browser';
  }

  const matches = (query) => (
    typeof window.matchMedia === 'function'
    && window.matchMedia(query).matches
  );

  if (matches('(display-mode: tabbed)')) {
    return 'tabbed';
  }
  if (matches('(display-mode: standalone)') || matches('(display-mode: minimal-ui)')) {
    return 'standalone';
  }
  if (window.navigator && window.navigator.standalone === true) {
    return 'standalone';
  }
  return 'browser';
}

function useDisplayMode() {
  const [mode, setMode] = useState(readDisplayMode);

  useEffect(() => {
    const queries = typeof window.matchMedia === 'function'
      ? [
        window.matchMedia('(display-mode: tabbed)'),
        window.matchMedia('(display-mode: standalone)'),
        window.matchMedia('(display-mode: minimal-ui)'),
      ]
      : [];

    const onChange = () => setMode(readDisplayMode());
    queries.forEach((mq) => {
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', onChange);
      } else if (typeof mq.addListener === 'function') {
        mq.addListener(onChange);
      }
    });
    window.addEventListener('focus', onChange);
    onChange();

    return () => {
      queries.forEach((mq) => {
        if (typeof mq.removeEventListener === 'function') {
          mq.removeEventListener('change', onChange);
        } else if (typeof mq.removeListener === 'function') {
          mq.removeListener(onChange);
        }
      });
      window.removeEventListener('focus', onChange);
    };
  }, []);

  return mode;
}

export default useDisplayMode;
