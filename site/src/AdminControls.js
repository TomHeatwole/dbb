import React, { useState } from 'react';
import { deleteAllPlayerData, deletePlayerWeek, readAdminBlob, writeAdminBlob } from './database';

function AdminControls() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [authed, setAuthed] = useState(false);
  const [adminJson, setAdminJson] = useState('');
  const [adminStatus, setAdminStatus] = useState(null);

  async function hashSha256Hex(str) {
    const enc = new TextEncoder();
    const data = enc.encode(str);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      const h = bytes[i].toString(16).padStart(2, '0');
      hex += h;
    }
    return hex;
  }

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const admin = await readAdminBlob();
      const storedHash = admin && admin.password ? String(admin.password) : '';
      if (!storedHash) {
        setError('Admin password not set.');
        return;
      }
      const inputHash = await hashSha256Hex(password || '');
      if (inputHash === storedHash) {
        setAuthed(true);
      } else {
        setError('Invalid password.');
      }
    } catch (_) {
      setError('Authentication error.');
    }
  };

  if (!authed) {
    return (
      <div className="info-container info-shared info-rel">
        <h1 className="info-title">Admin Controls</h1>
        <form onSubmit={submit} className="admin-controls-form">
          <label htmlFor="admin-pass">Password</label>
          <input
            id="admin-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="admin-input"
            autoComplete="current-password"
          />
          <button type="submit" className="admin-button">Submit</button>
          {error ? <div className="admin-error">{error}</div> : null}
        </form>
      </div>
    );
  }

  return (
    <div className="info-container info-shared info-rel">
      <h1 className="info-title">Admin Controls</h1>
      <div className="admin-tools">
        <div className="admin-tool-block">
          <h2>Admin JSON</h2>
          <div className="admin-inline-form">
            <button
              type="button"
              className="admin-button"
              onClick={async () => {
                try {
                  const val = await readAdminBlob();
                  setAdminJson(val ? JSON.stringify(val, null, 2) : '');
                  setAdminStatus('Loaded');
                } catch (e) {
                  setAdminStatus('Load failed');
                }
              }}
            >
              Load
            </button>
          </div>
          <textarea
            className="admin-textarea"
            rows={10}
            value={adminJson}
            onChange={(e) => setAdminJson(e.target.value)}
            placeholder="{ }"
          />
          <div className="admin-inline-form">
            <button
              type="button"
              className="admin-button"
              onClick={async () => {
                try {
                  const parsed = adminJson ? JSON.parse(adminJson) : {};
                  await writeAdminBlob(parsed);
                  setAdminStatus('Updated');
                } catch (e) {
                  setAdminStatus('Update failed: invalid JSON or write error');
                }
              }}
            >
              Update
            </button>
            {adminStatus ? <span className="admin-status">{adminStatus}</span> : null}
          </div>
        </div>
        <div className="admin-tool-block">
          <h2>Player Data</h2>
          <button
            type="button"
            className="admin-button"
            onClick={async () => { try { await deleteAllPlayerData(); alert('Deleted all player snapshots'); } catch (_) { alert('Delete failed'); } }}
          >
            Delete ALL Player Data
          </button>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const season = (e.currentTarget.elements.season.value || '').trim();
              const weekStr = (e.currentTarget.elements.week.value || '').trim();
              const week = Number(weekStr);
              if (!season) { alert('Enter season'); return; }
              if (!Number.isFinite(week) || week <= 0) { alert('Enter valid week'); return; }
              try {
                await deletePlayerWeek(season, week);
                alert(`Deleted players_${season}_week_${week}`);
                e.currentTarget.reset();
              } catch (err) {
                alert(`Delete failed: ${String(err && err.message ? err.message : err)}`);
              }
            }}
            className="admin-inline-form"
          >
            <label htmlFor="season">Season</label>
            <input id="season" name="season" type="text" placeholder="2025" />
            <label htmlFor="week">Week</label>
            <input id="week" name="week" type="number" min="1" max="17" placeholder="1" />
            <button type="submit" className="admin-button">Delete Specific Week</button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default AdminControls;


