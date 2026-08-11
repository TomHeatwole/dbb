import React, { useEffect, useState } from 'react';
import InfoPageWrapper from '../layout/InfoPageWrapper';

// FredDuel — future home of the exchange. For now: a hello-world proof that
// the site can read live data out of the Neon Postgres database.
function FredDuelPage() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/db-hello')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        if (!cancelled) setState({ loading: false, error: null, data });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err.message, data: null });
      });
    return () => { cancelled = true; };
  }, []);

  const { loading, error, data } = state;

  return (
    <InfoPageWrapper title="FredDuel" subtitle="Live database check">
      <div style={{ maxWidth: 560, margin: '2rem auto', textAlign: 'center' }}>
        {loading && <p>Reading from the database…</p>}

        {error && (
          <div>
            <p style={{ fontSize: '1.2rem' }}>Database read failed.</p>
            <p style={{ opacity: 0.7 }}>{error}</p>
          </div>
        )}

        {data && (
          <div>
            <p style={{ fontSize: '1.6rem', fontWeight: 600 }}>{data.message}</p>
            <p style={{ opacity: 0.7, marginTop: '1rem' }}>
              Row written {new Date(data.messageWrittenAt).toLocaleString()}
              <br />
              Database time {new Date(data.dbTime).toLocaleString()}
              <br />
              {String(data.postgres || '').split(' on ')[0]}
            </p>
          </div>
        )}
      </div>
    </InfoPageWrapper>
  );
}

export default FredDuelPage;
