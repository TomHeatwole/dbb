import React, { useEffect, useState } from 'react';
import HomeCard from './HomeCard';
import { fetchCommissionerNoteHtml } from './CommissionerNoteLookup';

function CommissionerNoteCard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [noteHtml, setNoteHtml] = useState('');
  const [showFull, setShowFull] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const html = await fetchCommissionerNoteHtml();

        if (cancelled) {
          return;
        }

        setNoteHtml(html);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError('Unable to load commissioner note right now.');
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  let body = null;

  if (loading) {
    body = (
      <div className="active-playoffs-status">
        Loading…
      </div>
    );
  } else if (error) {
    body = (
      <div className="active-playoffs-status active-playoffs-status--error">
        {error}
      </div>
    );
  } else if (noteHtml) {
    body = (
      <>
        <div
          className={`home-card-body commissioner-note-content ${
            showFull ? 'commissioner-note-content--expanded' : 'commissioner-note-content--clamped'
          }`}
          dangerouslySetInnerHTML={{ __html: noteHtml }}
        />
        <button
          type="button"
          className="commissioner-note-toggle"
          onClick={() => {
            setShowFull((prev) => !prev);
          }}
        >
          {showFull ? 'See Less' : 'See More'}
        </button>
      </>
    );
  } else {
    body = (
      <div className="active-playoffs-status">
        No commissioner note available yet.
      </div>
    );
  }

  return (
    <HomeCard>
      <div className="home-card-inner">
        <h2 className="home-card-title">📝 Commissioner Note</h2>
        {body}
      </div>
    </HomeCard>
  );
}

export default CommissionerNoteCard;


