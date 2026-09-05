/**
 * Live draft tracker built on the Redraft Dash custom board.
 * Tap a player to cross them out as drafted; Undo restores the last pick.
 * Filters: availability, position, name search. State persists per format.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import LoadingState from '../LoadingState';
import PositionBadge from '../PositionBadge';
import {
  DEFAULT_DRAFT_FORMAT,
  DRAFT_FORMATS,
  loadRedraftDashData,
  loadRedraftDashSnapshot,
} from './redraftDashLoader';
import { defaultAdpModeForFormat, resolveMarketAdp } from './redraftDashJamlAdp';

const POSITION_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K'];
const AVAIL_FILTERS = [
  { id: 'available', label: 'Available' },
  { id: 'all', label: 'All' },
  { id: 'drafted', label: 'Drafted' },
];

const STORAGE_PREFIX = 'rdd-livedraft-v1';

function playerKey(player) {
  if (player?.sleeperId) return `id:${player.sleeperId}`;
  return `n:${String(player?.name || '').toLowerCase()}|${player?.position || ''}`;
}

function boardForFormat(data, format) {
  if (!data) return [];
  return data.customBoards?.[format]
    || (format === 'superflex' ? data.customBoard : null)
    || [];
}

function localBoardReady(localData, format = DEFAULT_DRAFT_FORMAT) {
  const boards = localData?.customBoards;
  if (boards?.[format]?.length) return true;
  if (format === 'superflex' && localData?.customBoard?.length) return true;
  return false;
}

function loadDraftState(format) {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}:${format}`);
    if (!raw) return { order: [] };
    const parsed = JSON.parse(raw);
    const order = Array.isArray(parsed?.order)
      ? parsed.order.filter((k) => typeof k === 'string')
      : [];
    return { order };
  } catch {
    return { order: [] };
  }
}

function saveDraftState(format, order) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}:${format}`, JSON.stringify({ order }));
  } catch {
    // ignore quota / private mode
  }
}

function RedraftDashLiveDraft() {
  const [localData, setLocalData] = useState(null);
  const [publicData, setPublicData] = useState(null);
  const [error, setError] = useState(null);
  const [dataset, setDataset] = useState(null);
  const [format, setFormat] = useState(DEFAULT_DRAFT_FORMAT);
  const [positionFilter, setPositionFilter] = useState('ALL');
  const [availFilter, setAvailFilter] = useState('available');
  const [search, setSearch] = useState('');
  const [draftOrder, setDraftOrder] = useState(() => loadDraftState(DEFAULT_DRAFT_FORMAT).order);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadRedraftDashData().then((result) => ({ ok: true, result })).catch((err) => ({ ok: false, err })),
      loadRedraftDashSnapshot().then((result) => ({ ok: true, result })).catch((err) => ({ ok: false, err })),
    ]).then(([localRes, publicRes]) => {
      if (cancelled) return;
      const nextLocal = localRes.ok ? localRes.result : null;
      const nextPublic = publicRes.ok ? publicRes.result : null;
      if (!nextLocal && !nextPublic) {
        setError(localRes.err?.message || publicRes.err?.message || 'Failed to load');
        return;
      }
      setLocalData(nextLocal);
      setPublicData(nextPublic);
      setDataset(localBoardReady(nextLocal, DEFAULT_DRAFT_FORMAT) ? 'local' : 'public');
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    saveDraftState(format, draftOrder);
  }, [format, draftOrder]);

  const handleFormat = (nextFormat) => {
    if (nextFormat === format) return;
    setFormat(nextFormat);
    setDraftOrder(loadDraftState(nextFormat).order);
  };

  const draftedSet = useMemo(() => new Set(draftOrder), [draftOrder]);

  const markDrafted = useCallback((key) => {
    setDraftOrder((prev) => (prev.includes(key) ? prev : [...prev, key]));
  }, []);

  const undraftKey = useCallback((key) => {
    setDraftOrder((prev) => prev.filter((k) => k !== key));
  }, []);

  const undoLast = useCallback(() => {
    setDraftOrder((prev) => (prev.length ? prev.slice(0, -1) : prev));
  }, []);

  const resetDraft = useCallback(() => {
    if (draftOrder.length === 0) return;
    if (!window.confirm('Clear all crossed-out players for this format?')) return;
    setDraftOrder([]);
  }, [draftOrder.length]);

  const isPublic = dataset === 'public';
  const data = isPublic ? publicData : localData;
  const customBoard = boardForFormat(data, format);
  const formatBoardMissing = Boolean(data) && customBoard.length === 0;

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customBoard.filter((p) => {
      if (positionFilter !== 'ALL' && p.position !== positionFilter) return false;
      const key = playerKey(p);
      const drafted = draftedSet.has(key);
      if (availFilter === 'available' && drafted) return false;
      if (availFilter === 'drafted' && !drafted) return false;
      if (q) {
        const hay = `${p.name} ${p.team || ''} ${p.position || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [customBoard, positionFilter, availFilter, search, draftedSet]);

  const availableCount = useMemo(
    () => customBoard.filter((p) => !draftedSet.has(playerKey(p))).length,
    [customBoard, draftedSet],
  );

  if (error) {
    return <div className="rv-error">Live Draft failed to load: {error}</div>;
  }
  if (!dataset || !data) {
    return <LoadingState label="Loading redraft board…" className="rv-loading" />;
  }

  const lastDraftedKey = draftOrder.length ? draftOrder[draftOrder.length - 1] : null;
  const lastDraftedPlayer = lastDraftedKey
    ? customBoard.find((p) => playerKey(p) === lastDraftedKey)
    : null;

  return (
    <div className="rv-root rdd-root rddl-root">
      <div className="rv-controls rddl-controls">
        <div className="rv-field">
          <span className="rv-label">Format</span>
          <div className="rdd-view-toggle">
            {DRAFT_FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`rdd-view-btn${format === f.id ? ' rdd-view-btn--active' : ''}`}
                onClick={() => handleFormat(f.id)}
              >
                {f.shortLabel}
              </button>
            ))}
          </div>
        </div>

        <div className="rv-field">
          <span className="rv-label">Show</span>
          <div className="rdd-view-toggle">
            {AVAIL_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`rdd-view-btn${availFilter === f.id ? ' rdd-view-btn--active' : ''}`}
                onClick={() => setAvailFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rv-field">
          <span className="rv-label">Position</span>
          <select
            className="rv-select rv-select--narrow"
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
          >
            {POSITION_FILTERS.map((pos) => (
              <option key={pos} value={pos}>{pos === 'ALL' ? 'All' : pos}</option>
            ))}
          </select>
        </div>

        <div className="rv-field rddl-search-field">
          <span className="rv-label">Search</span>
          <input
            type="search"
            className="rv-select rddl-search"
            placeholder="Name, team…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="rv-field rddl-actions">
          <span className="rv-label">Draft</span>
          <div className="rdd-view-toggle">
            <button
              type="button"
              className="rdd-view-btn"
              onClick={undoLast}
              disabled={!draftOrder.length}
              title={lastDraftedPlayer ? `Undo ${lastDraftedPlayer.name}` : 'Nothing to undo'}
            >
              Undo
            </button>
            <button
              type="button"
              className="rdd-view-btn"
              onClick={resetDraft}
              disabled={!draftOrder.length}
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <p className="rv-meta rddl-meta">
        {format === '1qb' ? '1QB' : 'Superflex'} board · {availableCount} available · {draftOrder.length} drafted
        {lastDraftedPlayer ? ` · last: ${lastDraftedPlayer.name}` : ''}
        {' · '}
        tap a player to cross out; tap again (in All/Drafted) or Undo to restore
      </p>

      {formatBoardMissing ? (
        <div className="rdd-unavailable">
          No {format === '1qb' ? '1QB' : 'superflex'} custom board loaded.
        </div>
      ) : (
        <div className="rddl-list">
          {filteredPlayers.length === 0 ? (
            <p className="rddl-empty">No players match these filters.</p>
          ) : (
            filteredPlayers.map((p) => {
              const key = playerKey(p);
              const drafted = draftedSet.has(key);
              const adp = resolveMarketAdp(p, defaultAdpModeForFormat(format));
              return (
                <button
                  key={key}
                  type="button"
                  className={`rddl-row${drafted ? ' rddl-row--drafted' : ''}`}
                  onClick={() => (drafted ? undraftKey(key) : markDrafted(key))}
                >
                  <span className="rddl-rank">{p.rank}</span>
                  <span className="rddl-id">
                    <span className={`rddl-name${drafted ? ' rddl-name--drafted' : ''}`}>{p.name}</span>
                    <span className="rddl-sub">
                      {p.team || 'FA'}
                      {p.posRank != null ? ` · ${p.position}${p.posRank}` : ''}
                      {p.tier != null ? ` · T${p.tier}` : ''}
                    </span>
                  </span>
                  <PositionBadge position={p.position} />
                  <span className="rddl-adp" title="Market ADP">
                    {adp != null ? adp.toFixed(1) : '—'}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default RedraftDashLiveDraft;
