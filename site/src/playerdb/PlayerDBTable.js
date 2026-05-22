import React from 'react';
import { formatKtcValue } from '../lookups/KtcLookup';
import useIsMobile from '../hooks/useIsMobile';
import PositionBadge from '../PositionBadge';

function FcTrend({ value }) {
  if (value === null || value === undefined) {
    return <span className="pdb-trend-neutral">—</span>;
  }
  if (value > 0) {
    return <span className="pdb-trend-up">↑ {value.toLocaleString()}</span>;
  }
  if (value < 0) {
    return <span className="pdb-trend-down">↓ {Math.abs(value).toLocaleString()}</span>;
  }
  return <span className="pdb-trend-neutral">→ 0</span>;
}

function SortArrow({ direction }) {
  return (
    <span className="pdb-sort-arrow">
      {direction === 'asc' ? ' ▲' : ' ▼'}
    </span>
  );
}

function PosRankCell({ rank, position }) {
  if (!rank) return <span className="pdb-pts-none">—</span>;
  const posLabel = position ? `${position}${rank}` : `#${rank}`;
  return <span className="pdb-pos-rank">{posLabel}</span>;
}

/**
 * Renders the content of a single table cell based on column key.
 */
function renderCell(col, player, isMobile) {
  const val = player[col.key];

  switch (col.key) {
    case 'name':
      return (
        <div className="pdb-name-cell">
          <span className="pdb-player-name">{player.name}</span>
          {isMobile && (
            <span className="player-meta-mobile">
              <PositionBadge position={player.position} /> · {player.nflTeam || 'FA'}
            </span>
          )}
        </div>
      );

    case 'position':
      return <PositionBadge position={player.position} />;

    case 'nflTeam':
      return <span className="dynasty-td-team">{player.nflTeam || '—'}</span>;

    case 'age':
      return val != null ? val.toFixed(1) : '—';

    case 'ktcValue':
      return (
        <span className={val ? 'dynasty-ktc-value' : 'dynasty-ktc-none'}>
          {formatKtcValue(val)}
        </span>
      );

    case 'ktcRank':
      return val != null ? `#${val}` : '—';

    case 'ktcPosRank':
      return <PosRankCell rank={val} position={player.position} />;

    case 'fantasyPoints':
      return val > 0 ? (
        <span className="pdb-pts-value">{val.toFixed(1)}</span>
      ) : (
        <span className="pdb-pts-none">—</span>
      );

    case 'fantasyPointsPerGame':
      return val > 0 ? val.toFixed(1) : '—';

    case 'gamesPlayed':
      return val > 0 ? val : '—';

    case 'fcValue':
      return val != null && val > 0 ? (
        <span className="dynasty-ktc-value">{val.toLocaleString()}</span>
      ) : (
        <span className="dynasty-ktc-none">—</span>
      );

    case 'fcRank':
      return val != null ? `#${val}` : '—';

    case 'fcPosRank':
      return <PosRankCell rank={val} position={player.position} />;

    case 'fcTrend30':
      return <FcTrend value={val} />;

    case 'ffbRank':
      return val != null ? `#${val}` : '—';

    case 'ffbPosRank':
      return <PosRankCell rank={val} position={player.position} />;

    case 'fantasyTeamName':
      return val ? (
        <span className="pdb-fantasy-team">{val}</span>
      ) : (
        <span className="status-badge status-free-agent">Free Agent</span>
      );

    default:
      return val != null ? String(val) : '—';
  }
}

/**
 * PlayerDBTable
 *
 * Props:
 *   columns          – from playerDBColumns.js
 *   players          – enriched, filtered, sorted player records
 *   sortKey          – active sort column key
 *   sortDir          – 'asc' | 'desc'
 *   onSort           – (columnKey) => void
 *   onRowClick       – (player) => void
 *   columnVisibility – { [colKey]: boolean }
 */
function PlayerDBTable({ columns, players, sortKey, sortDir, onSort, onRowClick, columnVisibility }) {
  const isMobile = useIsMobile();

  const visibleColumns = columns.filter(col => {
    if (isMobile && !col.mobileVisible) return false;
    if (columnVisibility && columnVisibility[col.key] === false) return false;
    return true;
  });

  if (players.length === 0) {
    return (
      <div className="pdb-empty">
        No players match the current filters.
      </div>
    );
  }

  return (
    <div className="pdb-table-wrap">
      <table className="pdb-table">
        <thead>
          <tr>
            <th className="pdb-th pdb-th-rank">#</th>
            {visibleColumns.map(col => {
              const isActive = sortKey === col.key;
              const thStyle = {};
              if (col.width)    thStyle.width    = col.width;
              if (col.minWidth) thStyle.minWidth = col.minWidth;

              return (
                <th
                  key={col.key}
                  className={[
                    'pdb-th',
                    `pdb-th-${col.align}`,
                    col.sortable ? 'pdb-th-sortable' : '',
                    isActive     ? 'pdb-th-active'   : '',
                  ].join(' ')}
                  style={thStyle}
                  onClick={col.sortable ? () => onSort(col.key) : undefined}
                >
                  {col.label}
                  {isActive && <SortArrow direction={sortDir} />}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {players.map((player, idx) => (
            <tr
              key={player.sleeperId || player.normName}
              className="pdb-row"
              onClick={() => onRowClick(player)}
            >
              <td className="pdb-td pdb-td-rank">{idx + 1}</td>
              {visibleColumns.map(col => (
                <td
                  key={col.key}
                  className={`pdb-td pdb-td-${col.align}`}
                >
                  {renderCell(col, player, isMobile)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default PlayerDBTable;
