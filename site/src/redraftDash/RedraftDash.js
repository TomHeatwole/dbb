import React, { useEffect, useMemo, useState } from 'react';
import LoadingState from '../LoadingState';
import PositionBadge from '../PositionBadge';
import { loadRedraftDashData, loadRedraftDashSnapshot } from './redraftDashLoader';
import RedraftDashTierView from './RedraftDashTierView';

const LOCAL_POSITION_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST', 'P'];
const PUBLIC_POSITION_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'P'];
const SIDE_TABS = new Set(['P', 'DST']);

const DATASETS = [
  { id: 'local', label: 'Local' },
  { id: 'public', label: 'Public' },
];

function positionFilterLabel(pos) {
  if (pos === 'ALL') return 'All';
  if (pos === 'P') return 'Punters';
  if (pos === 'K') return 'Kickers';
  if (pos === 'DST') return 'Defenses';
  return pos;
}

const PUNTER_RANKINGS = [
  { rank: 1, name: 'Corey Bojorquez', team: 'CLE', note: 'P2 historical (4.42 ppg), worst projected offense (5.5 wins), 5.4 punts/gm' },
  { rank: 2, name: 'Logan Cooke', team: 'JAX', note: 'P3 historical (4.32 ppg), 48.6 avg distance, elite in20 rate' },
  { rank: 3, name: 'Tommy Townsend', team: 'HOU', note: 'P4 historical (4.31 ppg), led league in inside-20s in 2024 (39)' },
  { rank: 4, name: 'Ryan Rehkow', team: 'CIN', note: 'P1 in 2025 (4.41 ppg), 49.5 avg distance, strong in20' },
  { rank: 5, name: 'Tory Taylor', team: 'CHI', note: 'Most consistent — lowest std dev (1.30), zero 0-pt weeks in 34 games' },
  { rank: 6, name: 'AJ Cole', team: 'LV', note: 'P8 historical (4.22 ppg), Raiders at 5.5 wins — massive volume ceiling' },
  { rank: 7, name: 'Michael Dickson', team: 'SEA', note: 'P7 historical (4.24 ppg), never scored zero, elite per-punt' },
  { rank: 8, name: 'Jordan Stout', team: 'NYG', note: 'Strong leg from BAL, inherits Giants volume (5.5 wins)' },
  { rank: 9, name: 'Austin McNamara', team: 'NYJ', note: 'Jets at 5.5 wins — terrible offense, tons of punting' },
  { rank: 10, name: 'Bradley Pinion', team: 'MIA', note: 'Led league in inside-20s in 2025 (34), Dolphins at 3.5 wins' },
];

const LOCAL_VIEWS = [
  { id: 'table', label: 'Sources table' },
  { id: 'tiers', label: 'View by tier' },
];

const PUBLIC_VIEWS = [
  { id: 'table', label: 'Rankings' },
  { id: 'tiers', label: 'View by tier' },
];

function formatRank(rank) {
  if (rank == null) return '—';
  return Number.isInteger(rank) ? String(rank) : rank.toFixed(1);
}

function formatAdp(adp) {
  if (adp == null) return '—';
  return adp.toFixed(1);
}

function localBoardReady(localData) {
  return Boolean(localData?.customBoard?.length);
}

function RedraftDash() {
  const [localData, setLocalData] = useState(null);
  const [publicData, setPublicData] = useState(null);
  const [error, setError] = useState(null);
  const [dataset, setDataset] = useState(null);
  const [positionFilter, setPositionFilter] = useState('ALL');
  const [view, setView] = useState('table');
  const [sortKey, setSortKey] = useState('avgRank');
  const [sortDir, setSortDir] = useState('asc');

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
      const useLocal = localBoardReady(nextLocal);
      setDataset(useLocal ? 'local' : 'public');
      if (!useLocal) {
        setView('tiers');
        setSortKey('rank');
      }
    });
    return () => { cancelled = true; };
  }, []);

  const isPublic = dataset === 'public';
  const data = isPublic ? publicData : localData;
  const positionFilters = isPublic ? PUBLIC_POSITION_FILTERS : LOCAL_POSITION_FILTERS;
  const views = isPublic ? PUBLIC_VIEWS : LOCAL_VIEWS;

  const sortedPlayers = useMemo(() => {
    if (!data) return [];
    if (isPublic) {
      const board = data.customBoard || [];
      const filtered = positionFilter === 'ALL'
        ? board
        : board.filter((p) => p.position === positionFilter);
      const getValue = (player) => {
        if (sortKey === 'name') return player.name.toLowerCase();
        if (sortKey === 'adp') return player.adp;
        return player.rank;
      };
      return [...filtered].sort((a, b) => {
        const va = getValue(a);
        const vb = getValue(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (va < vb) return sortDir === 'asc' ? -1 : 1;
        if (va > vb) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }

    const filtered = positionFilter === 'ALL'
      ? data.players
      : data.players.filter((p) => p.position === positionFilter);

    const getValue = (player) => {
      if (sortKey === 'name') return player.name.toLowerCase();
      if (sortKey === 'avgRank' || sortKey === 'spread') return player[sortKey];
      return player.ranks[sortKey] ?? null;
    };

    return [...filtered].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, isPublic, positionFilter, sortKey, sortDir]);

  if (error) {
    return <div className="rv-error">Redraft Dash failed to load: {error}</div>;
  }
  if (!dataset || !data) {
    return <LoadingState label="Loading redraft rankings…" className="rv-loading" />;
  }

  const handleDataset = (id) => {
    setDataset(id);
    if (id === 'public') {
      if (positionFilter === 'DST') setPositionFilter('ALL');
      setSortKey('rank');
      setSortDir('asc');
    } else {
      setSortKey('avgRank');
      setSortDir('asc');
    }
  };

  const handleSort = (key, defaultDir = 'asc') => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(defaultDir);
    }
  };

  const renderSortableTh = (key, label, extraClass = '') => {
    const active = sortKey === key;
    return (
      <th
        key={key}
        className={`rv-th rv-th--sortable${active ? ' rv-th--active' : ''} ${extraClass}`}
      >
        <button type="button" className="rv-sort-btn" onClick={() => handleSort(key)}>
          {label}
          {active && <span className="rv-sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>}
        </button>
      </th>
    );
  };

  const localUnavailable = !isPublic && !data.available;
  const publicUnavailable = isPublic && !data.available;
  const sideTab = SIDE_TABS.has(positionFilter);
  const listCount = positionFilter === 'P'
    ? PUNTER_RANKINGS.length
    : positionFilter === 'DST'
      ? (data.defenses || []).length
      : isPublic
        ? (positionFilter === 'ALL'
          ? (data.customBoard || []).length
          : (data.customBoard || []).filter((p) => p.position === positionFilter).length)
        : sortedPlayers.length;

  return (
    <div className="rv-root rdd-root">
      <div className="rv-controls">
        <div className="rv-field">
          <span className="rv-label">Dataset</span>
          <div className="rdd-view-toggle">
            {DATASETS.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`rdd-view-btn${dataset === d.id ? ' rdd-view-btn--active' : ''}`}
                onClick={() => handleDataset(d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
        {!sideTab && !localUnavailable && !publicUnavailable && (
        <div className="rv-field">
          <span className="rv-label">View</span>
          <div className="rdd-view-toggle">
            {views.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`rdd-view-btn${view === v.id ? ' rdd-view-btn--active' : ''}`}
                onClick={() => setView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
        )}
        <div className="rv-field">
          <span className="rv-label">Position</span>
          <select
            className="rv-select rv-select--narrow"
            value={positionFilters.includes(positionFilter) ? positionFilter : 'ALL'}
            onChange={(e) => setPositionFilter(e.target.value)}
          >
            {positionFilters.map((pos) => (
              <option key={pos} value={pos}>{positionFilterLabel(pos)}</option>
            ))}
          </select>
        </div>
        <p className="rv-meta rdd-source-meta">
          {data.season} redraft · {listCount} {positionFilter === 'DST' ? 'defenses' : 'players'}
          {isPublic ? ' · public snapshot' : null}
          {!isPublic && data.sources && (
            <>
              {' · '}
              {data.sources.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && ' · '}
                  {s.label}
                  <span className={`rdd-trust rdd-trust--${s.trust}`}>
                    {s.trust === 'trusted' ? 'trusted' : 'untrusted'}
                  </span>
                </span>
              ))}
            </>
          )}
        </p>
      </div>

      {isPublic ? (
        <div className="rdd-privacy-note">
          Public snapshot of the DBB custom board — overall rank and Sleeper SF ADP only.
          Per-source ranks from private boards are not included.
        </div>
      ) : data.privateMissing ? (
        <div className="rv-error">
          Private <code>dbbp/</code> sources are unavailable in this deployment — switch to Public for the committed snapshot, or run locally with <code>dbbp/</code> checked out.
        </div>
      ) : (
        <div className="rdd-privacy-note">
          Private sources load from <code>dbbp/</code> at startup — they never ship with the public deploy.
          Public baselines (FP ECR, Gibbs, YAFSB SF ADP) ship with the site.
        </div>
      )}

      {localUnavailable && (
        <div className="rdd-unavailable">
          <h3>Private data sources unavailable</h3>
          <p>
            Local Redraft Dash pulls ranking sources from the private <code>dbbp</code> repo
            at dev/build time. This deployment doesn&apos;t include them — switch to Public
            to use the committed snapshot, or run locally with
            <code> dbbp/</code> checked out alongside <code>dbb/</code>.
          </p>
        </div>
      )}

      {publicUnavailable && (
        <div className="rdd-unavailable">
          <h3>Public snapshot unavailable</h3>
          <p>
            The committed board snapshot is missing. Run
            <code> node scripts/build_redraft_dash_snapshot.js</code> (or a full
            <code> ./scripts/all_updates.sh</code>) and deploy the CSV in
            <code> site/public/data/</code>.
          </p>
        </div>
      )}

      {positionFilter === 'P' && (
        <div className="rdd-punter-list">
          <p className="rdd-punter-note">
            Punter scoring: avg distance &gt;40 = 1pt, &gt;42 = 2pt, &gt;44 = 3pt, + 1pt per punt inside opponent&apos;s 20.
            Based on 2023–2025 play-by-play data and 2026 projected win totals.
            <strong> Draft with your last pick — the P1-to-P10 gap is ~0.5 ppg.</strong>
          </p>
          <table className="rv-table rdd-table rdd-punter-table">
            <thead>
              <tr>
                <th className="rv-th rv-th-rank">#</th>
                <th className="rv-th rv-th-name">Punter</th>
                <th className="rv-th rv-th-team">Team</th>
                <th className="rv-th">Rationale</th>
              </tr>
            </thead>
            <tbody>
              {PUNTER_RANKINGS.map((p) => (
                <tr key={p.rank} className="rv-row">
                  <td className="rv-td rv-td-rank">{p.rank}</td>
                  <td className="rv-td rv-td-name">{p.name}</td>
                  <td className="rv-td rv-td-team">{p.team}</td>
                  <td className="rv-td rdd-punter-note-cell">{p.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isPublic && positionFilter === 'DST' && (
        <div className="rdd-punter-list">
          <p className="rdd-punter-note">
            ETR superflex (2QB half-PPR) defense ranks. Defenses stay off the overall
            board — stream them late like punters; the DST1-to-DST10 gap is not worth
            an early pick.
          </p>
          {(data.defenses || []).length === 0 ? (
            <p className="rdd-punter-note">ETR defense ranks aren&apos;t available in this deployment.</p>
          ) : (
            <table className="rv-table rdd-table rdd-punter-table">
              <thead>
                <tr>
                  <th className="rv-th rv-th-rank">#</th>
                  <th className="rv-th rv-th-name">Defense</th>
                  <th className="rv-th rv-th-team">Team</th>
                  <th className="rv-th rdd-th-rank">ETR SF</th>
                  <th className="rv-th">Tier</th>
                </tr>
              </thead>
              <tbody>
                {(data.defenses || []).map((d) => (
                  <tr key={d.team || d.name} className="rv-row">
                    <td className="rv-td rv-td-rank">{d.posRank}</td>
                    <td className="rv-td rv-td-name">{d.name}</td>
                    <td className="rv-td rv-td-team">{d.team || '—'}</td>
                    <td className="rv-td rdd-td-rank">{d.etrRank}</td>
                    <td className="rv-td">{d.tier != null ? `T${d.tier}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!localUnavailable && !publicUnavailable && positionFilter !== 'P' && positionFilter !== 'DST' && view === 'tiers' && (
        <RedraftDashTierView
          players={data.customBoard || []}
          positionFilter={positionFilter}
          publicMode={isPublic}
        />
      )}

      {!isPublic && !localUnavailable && positionFilter !== 'P' && positionFilter !== 'DST' && view === 'table' && (
      <div className="rv-table-wrap rdd-table-wrap">
        <table className="rv-table rdd-table">
          <thead>
            <tr>
              <th className="rv-th rv-th-rank">#</th>
              {renderSortableTh('name', 'Player', 'rv-th-name')}
              <th className="rv-th rv-th-pos">Pos</th>
              <th className="rv-th rv-th-team">Team</th>
              {data.sources.map((s) =>
                renderSortableTh(
                  s.id,
                  <span className="rdd-th-source">
                    {s.label}
                    <span className={`rdd-trust rdd-trust--${s.trust}`}>
                      {s.trust === 'trusted' ? '✓' : '?'}
                    </span>
                  </span>,
                  'rdd-th-rank',
                )
              )}
              {renderSortableTh('avgRank', 'Avg', 'rdd-th-rank')}
              {renderSortableTh('spread', 'Spread', 'rdd-th-rank')}
            </tr>
          </thead>
          <tbody>
            {sortedPlayers.map((player, idx) => (
              <tr key={player.name} className="rv-row">
                <td className="rv-td rv-td-rank">{idx + 1}</td>
                <td className="rv-td rv-td-name">{player.name}</td>
                <td className="rv-td rv-td-pos"><PositionBadge position={player.position} /></td>
                <td className="rv-td rv-td-team">{player.team || '—'}</td>
                {data.sources.map((s) => (
                  <td key={s.id} className="rv-td rdd-td-rank">
                    {formatRank(player.ranks[s.id])}
                    {player.tiers[s.id] != null && (
                      <span className="rdd-tier">T{player.tiers[s.id]}</span>
                    )}
                  </td>
                ))}
                <td className="rv-td rdd-td-rank rdd-td-avg">{formatRank(player.avgRank)}</td>
                <td className={`rv-td rdd-td-rank${(player.spread ?? 0) >= 5 ? ' rdd-td-spread-hot' : ''}`}>
                  {player.spread == null ? '—' : `±${player.spread}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {isPublic && !publicUnavailable && positionFilter !== 'P' && view === 'table' && (
      <div className="rv-table-wrap rdd-table-wrap">
        <table className="rv-table rdd-table">
          <thead>
            <tr>
              {renderSortableTh('rank', 'Rank', 'rv-th-rank')}
              {renderSortableTh('name', 'Player', 'rv-th-name')}
              <th className="rv-th rv-th-pos">Pos</th>
              <th className="rv-th rv-th-team">Team</th>
              {renderSortableTh('adp', 'ADP', 'rdd-th-rank')}
            </tr>
          </thead>
          <tbody>
            {sortedPlayers.map((player) => (
              <tr key={player.sleeperId || player.name} className="rv-row">
                <td className="rv-td rv-td-rank rdd-td-avg">{player.rank}</td>
                <td className="rv-td rv-td-name">{player.name}</td>
                <td className="rv-td rv-td-pos"><PositionBadge position={player.position} /></td>
                <td className="rv-td rv-td-team">{player.team || '—'}</td>
                <td className="rv-td rdd-td-rank">{formatAdp(player.adp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

export default RedraftDash;
