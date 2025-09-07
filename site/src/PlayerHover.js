import React, { useEffect, useState } from 'react';
import { fetchPlayerHistoryByEspnId } from './PlayerGameHistory';

function getStat(statsObj, keys) {
  if (!statsObj) { return null; }
  for (const k of keys) {
    if (statsObj[k] != null && statsObj[k] !== '-') { return statsObj[k]; }
  }
  return null;
}

function isNonZero(value) {
  if (value == null) { return false; }
  const num = Number(String(value).replace(/[^0-9.-]/g, ''));
  return isFinite(num) && num !== 0;
}

function findWeekStats(history, season, week) {
  if (!history || !season || !week) { return null; }
  const yr = String(season);
  const arr = history && history[yr];
  if (!Array.isArray(arr)) { return null; }
  const match = arr.find((g) => Number(g && g.week) === Number(week));
  return match && match.stats ? match.stats : null;
}

export default function PlayerHover({ children, info, season, week, gameText, position, trigger = null }) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState(null);
  const espnId = info && info.espn_id ? String(info.espn_id) : null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!open || !espnId || !season || !week) { return; }
      try {
        const history = await fetchPlayerHistoryByEspnId(espnId);
        if (cancelled) { return; }
        const s = findWeekStats(history, season, week);
        setStats(s || {});
      } catch (_) {
        if (!cancelled) { setStats({}); }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [open, espnId, season, week]);

  const pos = (info && info.position) || position || '';
  const isQb = /^QB$/i.test(pos);

  const comp = getStat(stats, ['CMP']);
  const att = getStat(stats, ['ATT']);
  const passYds = getStat(stats, ['PASS YDS', 'PYDS', 'P YDS', 'YDS']);
  const passTd = getStat(stats, ['PASS TD', 'PTD', 'P TD', 'TD']);
  const rushYds = getStat(stats, ['RUSH YDS', 'RYDS', 'R YDS']);
  const rushTd = getStat(stats, ['RUSH TD', 'RTD', 'R TD']);
  const ints = getStat(stats, ['INT']);
  const sacks = getStat(stats, ['SACK']);

  const targets = getStat(stats, ['TGT', 'TAR', 'TARGETS', 'TGTS']);
  const receptions = getStat(stats, ['REC', 'RECEPTIONS']);
  const carries = getStat(stats, ['CAR', 'CARRIES']);
  const recTd = getStat(stats, ['REC TD', 'RE TD', 'RETD']);

  const statRows = [];
  if (isQb) {
    if (isNonZero(comp) || isNonZero(att)) {
      statRows.push(['Comp/Att', (comp != null || att != null) ? `${comp || '-'} / ${att || '-'}` : '-']);
    }
    if (isNonZero(passYds)) { statRows.push(['Pass Yds', passYds]); }
    if (isNonZero(passTd)) { statRows.push(['Pass TD', passTd]); }
    if (isNonZero(ints)) { statRows.push(['INT', ints]); }
    if (isNonZero(sacks)) { statRows.push(['SACK', sacks]); }
    if (isNonZero(rushYds)) { statRows.push(['Rush Yds', rushYds]); }
    if (isNonZero(rushTd)) { statRows.push(['Rush TD', rushTd]); }
  } else {
    if (isNonZero(targets)) { statRows.push(['Targets', targets]); }
    if (isNonZero(receptions)) { statRows.push(['Receptions', receptions]); }
    if (isNonZero(carries)) { statRows.push(['Carries', carries]); }
    if (isNonZero(recTd)) { statRows.push(['Rec TD', recTd]); }
    if (isNonZero(rushTd)) { statRows.push(['Rush TD', rushTd]); }
    if (isNonZero(rushYds)) { statRows.push(['Rush Yds', rushYds]); }
  }

  return (
    <span
      className="player-hover-wrapper"
      onMouseEnter={() => { setOpen(true); }}
      onMouseLeave={() => { setOpen(false); }}
    >
      {trigger || children}
      {open ? (
        <div className="player-hover-card">
          <div className="player-hover-header">
            {info && info.espn_photo_url ? (
              <img src={info.espn_photo_url} alt={info && info.name ? info.name : ''} className="player-hover-avatar" />
            ) : null}
            <div className="player-hover-title">
              <div className="player-hover-name">{info && info.name ? info.name : ''}{pos ? ` (${pos})` : ''}</div>
              {gameText ? (<div className="player-hover-gametext">{gameText}</div>) : null}
            </div>
          </div>
          <div className="player-hover-stats">
            {statRows.length === 0 ? (
              <div className="player-hover-stat-row"><span>No recorded stats</span><span></span></div>
            ) : (
              statRows.map(([label, value], idx) => (
                <div className="player-hover-stat-row" key={idx}><span>{label}</span><span>{value}</span></div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </span>
  );
} 