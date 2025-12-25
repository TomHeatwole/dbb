import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
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
      <LoadingState
        label="Loading commissioner note…"
        ariaLabel="Loading commissioner note"
      />
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
        <div className="commissioner-note-wrapper">
          <div
            className={`home-card-body commissioner-note-content ${
              showFull ? 'commissioner-note-content--expanded' : 'commissioner-note-content--clamped'
            }`}
            dangerouslySetInnerHTML={{ __html: noteHtml }}
          />
          {!showFull && (
            <button
              type="button"
              className="commissioner-note-toggle commissioner-note-toggle--overlay"
              onClick={() => {
                setShowFull(true);
              }}
            >
              See More
            </button>
          )}
        </div>
        {showFull && (
          <button
            type="button"
            className="commissioner-note-toggle"
            onClick={() => {
              setShowFull(false);
            }}
          >
            See Less
          </button>
        )}
        <Link to="/Notes" className="commissioner-note-link">
          Commissioner Notes →
        </Link>
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


