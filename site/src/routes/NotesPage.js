import React, { useEffect, useState, useRef } from 'react';
import PageMeta from '../PageMeta';
import LoadingState from '../LoadingState';
import { readCommishNotes } from '../utils/database';
import { fetchCommissionerNoteHtmlFromUrl } from '../home/CommissionerNoteLookup';

const OG_TITLE = 'Commissioner Notes';
const OG_DESCRIPTION = 'All commissioner notes for the league';

function CommissionerNoteItem({ url, index }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [noteHtml, setNoteHtml] = useState('');
  const shadowHostRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        // Pass false to disable CSS scoping since Shadow DOM provides isolation
        const html = await fetchCommissionerNoteHtmlFromUrl(url, false);

        if (cancelled) {
          return;
        }

        setNoteHtml(html);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError('Unable to load this note.');
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [url]);

  // Render HTML into Shadow DOM for complete CSS isolation
  useEffect(() => {
    if (noteHtml && shadowHostRef.current) {
      // Attach shadow root if not already present
      if (!shadowHostRef.current.shadowRoot) {
        shadowHostRef.current.attachShadow({ mode: 'open' });
      }

      // Base styles for the shadow DOM to match dark theme
      // Override Google Doc colors but preserve font-weight and font-size
      const baseStyles = `
        <style>
          :host {
            display: block;
            width: 100%;
          }
          * {
            box-sizing: border-box;
          }
          /* Override all Google Doc colors with dark theme colors */
          body, p, span, li, div, h1, h2, h3, h4, h5, h6 {
            color: #e2e8f0 !important;
          }
          /* Preserve link colors */
          a {
            color: #90cdf4 !important;
            text-decoration: none;
          }
          a:hover {
            text-decoration: underline !important;
          }
        </style>
      `;

      // Inject base styles + note HTML (which includes its own inline styles) into shadow root
      shadowHostRef.current.shadowRoot.innerHTML = baseStyles + noteHtml;
    }
  }, [noteHtml]);

  if (loading) {
    return (
      <div className="notes-page-section">
        <LoadingState
          label="Loading note…"
          ariaLabel="Loading commissioner note"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="notes-page-section">
        <div className="active-playoffs-status active-playoffs-status--error">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="notes-page-section">
      <div ref={shadowHostRef} className="commissioner-note-shadow-host" />
    </div>
  );
}

function NotesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [noteUrls, setNoteUrls] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const urls = await readCommishNotes();

        if (cancelled) {
          return;
        }

        if (!urls || urls.length === 0) {
          setError('No commissioner notes configured yet.');
          setLoading(false);
          return;
        }

        setNoteUrls(urls);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError('Unable to load commissioner notes.');
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <>
        <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
        <div className="info-container info-shared info-rel">
          <h1 className="info-title">Commissioner Notes</h1>
          <LoadingState
            label="Loading notes…"
            ariaLabel="Loading commissioner notes"
          />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
        <div className="info-container info-shared info-rel">
          <h1 className="info-title">Commissioner Notes</h1>
          <div className="active-playoffs-status active-playoffs-status--error">
            {error}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
      <div className="info-container info-shared info-rel">
        <h1 className="info-title">Commissioner Notes</h1>
        <div className="notes-page-content">
          {noteUrls.map((url, index) => (
            <CommissionerNoteItem key={url} url={url} index={index} />
          ))}
        </div>
      </div>
    </>
  );
}

export default NotesPage;

