import React, { useEffect, useState } from 'react';
import PageMeta from '../PageMeta';
import { readCommishNotes } from '../utils/database';
import { fetchCommissionerNoteHtmlFromUrl } from '../home/CommissionerNoteLookup';

const OG_TITLE = 'Commissioner Notes';
const OG_DESCRIPTION = 'All commissioner notes for the league';

function CommissionerNoteItem({ url, index }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [noteHtml, setNoteHtml] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const html = await fetchCommissionerNoteHtmlFromUrl(url);

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

  if (loading) {
    return (
      <div className="notes-page-section">
        <div className="active-playoffs-status">Loading…</div>
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
      <div
        className="commissioner-note-content commissioner-note-content--expanded"
        dangerouslySetInnerHTML={{ __html: noteHtml }}
      />
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
          <div className="active-playoffs-status">Loading…</div>
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

