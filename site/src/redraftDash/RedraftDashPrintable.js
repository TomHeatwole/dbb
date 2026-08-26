import React, { useMemo } from 'react';
import { DEFAULT_ADP_MODE, resolveMarketAdp } from './redraftDashJamlAdp';
import { deltaClass, formatEqRank } from './redraftDashValueSignals';
import { PUNTER_RANKINGS } from './redraftDashMockDraftLogic';
import watermarkUrl from '../assets/watermark.png';

/** Obfuscated letter codes for print — never expand to real source names on paper. */
const PRINT_SOURCE_CODES = [
  { id: 'etr', code: 'C' },
  { id: 'lrdg', code: 'Z' },
  { id: 'gibbs', code: 'G' },
  { id: 'ecr', code: 'E' },
  { id: 'ffb', code: 'F' },
];

const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE'];

/**
 * Calibrated to Chrome letter print from an exported PDF: ~47 overall rows
 * fit one page before the browser sliced mid-chunk. Stay a hair under that.
 */
const PLAYERS_PER_PAGE = 44;

/** Overall + skill sheets only cover this deep — late specialists stay on their own page. */
const PRINT_DEPTH = 220;

/** Raw ADP scratch lists at the end of the guide (crossing off during draft). */
const ADP_SCRATCH_SKILL_COUNT = 100;
const ADP_SCRATCH_COLS = 4;

function shortName(name) {
  if (!name) return '';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0].charAt(0)}. ${parts[parts.length - 1]}`;
}

function formatAdpCompact(adp) {
  if (adp == null || !Number.isFinite(adp)) return '—';
  return adp.toFixed(1);
}

function formatAdpDelta(player, adpMode) {
  const market = resolveMarketAdp(player, adpMode);
  if (market == null || player.rank == null) return '';
  const delta = Math.round(market - player.rank);
  if (delta === 0) return '±0';
  return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}

function chunkPlayers(players, size = PLAYERS_PER_PAGE) {
  const pages = [];
  for (let i = 0; i < players.length; i += size) {
    pages.push(players.slice(i, i + size));
  }
  return pages;
}

/** Consecutive same-tier runs for column rendering. */
function tierRuns(players, tierKey) {
  const runs = [];
  for (const p of players) {
    const tier = p[tierKey];
    const last = runs[runs.length - 1];
    if (!last || last.tier !== tier) {
      runs.push({ tier, players: [p] });
    } else {
      last.players.push(p);
    }
  }
  return runs;
}

function splitColumns(players) {
  const mid = Math.ceil(players.length / 2);
  return [players.slice(0, mid), players.slice(mid)];
}

function SourceLetters({ player }) {
  const chips = PRINT_SOURCE_CODES.map(({ id, code }) => {
    const srcRank = player.sourceRanks?.[id];
    const delta = srcRank == null || player.rank == null ? null : player.rank - srcRank;
    return { id, code, srcRank, delta };
  });

  const present = chips.filter((c) => c.delta != null);
  let bullish = null;
  let bearish = null;
  if (present.length >= 2) {
    const sorted = [...present].sort((a, b) => b.delta - a.delta);
    if (deltaClass(sorted[0].delta, player.rank) !== 'neutral') bullish = sorted[0].id;
    const last = sorted[sorted.length - 1];
    if (deltaClass(last.delta, player.rank) !== 'neutral') bearish = last.id;
  }

  const any = chips.some((c) => c.srcRank != null);
  if (!any) return <span className="rddp-src rddp-src--empty">—</span>;

  return (
    <span className="rddp-src">
      {chips.map(({ id, code, srcRank }) => {
        if (srcRank == null) {
          return (
            <span key={id} className="rddp-src-item rddp-src-item--miss">
              {code}–
            </span>
          );
        }
        let mark = '';
        if (id === bullish) mark = '▲';
        else if (id === bearish) mark = '▼';
        return (
          <span key={id} className="rddp-src-item">
            {mark}{code}{formatEqRank(srcRank)}
          </span>
        );
      })}
    </span>
  );
}

function PlayerLine({ player, adpMode, rankField = 'rank', showPos = true }) {
  const rank = player[rankField] ?? player.rank;
  const market = resolveMarketAdp(player, adpMode);
  const delta = formatAdpDelta(player, adpMode);
  return (
    <div className="rddp-line">
      <span className="rddp-rank">{rank ?? '—'}</span>
      <span className="rddp-name" title={player.name}>{shortName(player.name)}</span>
      {showPos && (
        <span className="rddp-pos">
          {player.position}
          {player.team ? ` ${player.team}` : ''}
        </span>
      )}
      {!showPos && (
        <span className="rddp-pos">{player.team || ''}</span>
      )}
      <span className="rddp-adp" title="Market ADP vs our rank">
        {formatAdpCompact(market)}
        {delta && <span className="rddp-adp-d">{delta}</span>}
      </span>
      {player.value != null && (
        <span className="rddp-val">{Number(player.value).toFixed(0)}</span>
      )}
      <SourceLetters player={player} />
    </div>
  );
}

function TierColumn({
  players,
  adpMode,
  tierKey,
  titlePrefix = 'T',
  rankField,
  showPos,
}) {
  const runs = tierRuns(players, tierKey);
  return (
    <div className="rddp-col">
      {runs.map((run) => (
        <section key={`${run.tier}-${run.players[0]?.rank ?? run.players[0]?.name}`} className="rddp-tier">
          <header className="rddp-tier-h">
            {run.tier == null ? '—' : `${titlePrefix}${run.tier}`}
          </header>
          <div className="rddp-tier-body">
            {run.players.map((p) => (
              <PlayerLine
                key={p.sleeperId || p.id || `${p.position}:${p.name}:${p.rank}`}
                player={p}
                adpMode={adpMode}
                rankField={rankField}
                showPos={showPos}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TwoColPlayers({
  players,
  adpMode,
  tierKey,
  titlePrefix,
  rankField,
  showPos,
}) {
  const [left, right] = splitColumns(players);
  return (
    <div className="rddp-cols">
      <TierColumn
        players={left}
        adpMode={adpMode}
        tierKey={tierKey}
        titlePrefix={titlePrefix}
        rankField={rankField}
        showPos={showPos}
      />
      <TierColumn
        players={right}
        adpMode={adpMode}
        tierKey={tierKey}
        titlePrefix={titlePrefix}
        rankField={rankField}
        showPos={showPos}
      />
    </div>
  );
}

function SimpleTop10({ title, rows }) {
  if (!rows.length) return null;
  return (
    <section className="rddp-tier">
      <header className="rddp-tier-h">{title}</header>
      <div className="rddp-tier-body">
        {rows.map((row) => (
          <div key={row.key} className="rddp-line rddp-line--simple">
            <span className="rddp-rank">{row.rank}</span>
            <span className="rddp-name" title={row.name}>{shortName(row.name)}</span>
            <span className="rddp-pos">{row.team || ''}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function PrintPage({ title, pageLabel, children }) {
  return (
    <section className="rddp-page">
      <img
        src={watermarkUrl}
        alt=""
        className="rddp-watermark"
        aria-hidden="true"
      />
      <header className="rddp-page-head">
        <h2 className="rddp-section-title">{title}</h2>
        {pageLabel && <span className="rddp-page-label">{pageLabel}</span>}
      </header>
      <div className="rddp-page-body">
        {children}
      </div>
    </section>
  );
}

/** Split into N columns top-to-bottom (column-major) for dense scratch lists. */
function splitNColumns(items, cols) {
  if (!items.length) return [];
  const perCol = Math.ceil(items.length / cols);
  const columns = [];
  for (let c = 0; c < cols; c += 1) {
    columns.push(items.slice(c * perCol, (c + 1) * perCol));
  }
  return columns.filter((col) => col.length > 0);
}

function AdpScratchLine({ player, adp, showPos }) {
  return (
    <div className={`rddp-adp-line${showPos ? ' rddp-adp-line--pos' : ''}`}>
      <span className="rddp-adp-box" aria-hidden="true" />
      <span className="rddp-adp-num">{formatAdpCompact(adp)}</span>
      <span className="rddp-adp-name" title={player.name}>{shortName(player.name)}</span>
      {showPos ? <span className="rddp-adp-pos">{player.position}</span> : null}
    </div>
  );
}

function AdpScratchGrid({ rows, cols = ADP_SCRATCH_COLS, showPos = false }) {
  const columns = splitNColumns(rows, cols);
  return (
    <div
      className="rddp-adp-grid"
      style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
    >
      {columns.map((col, i) => (
        <div key={i} className="rddp-adp-col">
          {col.map(({ player, adp }) => (
            <AdpScratchLine
              key={player.sleeperId || `${player.position}:${player.name}`}
              player={player}
              adp={adp}
              showPos={showPos}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function pageRangeLabel(players, rankField, pageIndex, pageCount) {
  if (!players.length) return null;
  const first = players[0][rankField] ?? players[0].rank;
  const last = players[players.length - 1][rankField] ?? players[players.length - 1].rank;
  const range = first != null && last != null ? `${first}–${last}` : null;
  if (pageCount <= 1) return range;
  return range ? `${pageIndex + 1}/${pageCount} · ${range}` : `${pageIndex + 1}/${pageCount}`;
}

function RedraftDashPrintable({
  players = [],
  defenses = [],
  publicMode = false,
  adpMode = DEFAULT_ADP_MODE,
  format = 'superflex',
}) {
  const printPool = useMemo(() => {
    return [...players]
      .filter((p) => p.rank != null && p.rank <= PRINT_DEPTH)
      .sort((a, b) => a.rank - b.rank);
  }, [players]);

  const hasSources = useMemo(
    () => printPool.some((p) => p.sourceRanks && Object.keys(p.sourceRanks).length > 0),
    [printPool],
  );

  const overallPages = useMemo(
    () => chunkPlayers(printPool),
    [printPool],
  );

  const positionalPages = useMemo(() => {
    const pages = [];
    for (const pos of SKILL_POSITIONS) {
      const subset = printPool
        .filter((p) => p.position === pos)
        .sort((a, b) => (a.posRank ?? 999) - (b.posRank ?? 999));
      const chunks = chunkPlayers(subset);
      chunks.forEach((chunk, i) => {
        pages.push({
          pos,
          players: chunk,
          pageLabel: pageRangeLabel(chunk, 'posRank', i, chunks.length),
        });
      });
    }
    return pages;
  }, [printPool]);

  const topKickers = useMemo(() => {
    return [...players]
      .filter((p) => p.position === 'K')
      .sort((a, b) => (a.posRank ?? a.rank ?? 999) - (b.posRank ?? b.rank ?? 999))
      .slice(0, 10);
  }, [players]);

  const topPunters = useMemo(() => (
    PUNTER_RANKINGS.slice(0, 10).map((p) => ({
      key: `P:${p.name}`,
      rank: p.rank,
      name: p.name,
      team: p.team,
    }))
  ), []);

  const topDst = useMemo(() => (
    [...(defenses || [])]
      .sort((a, b) => (a.posRank ?? 999) - (b.posRank ?? 999))
      .slice(0, 10)
      .map((d) => ({
        key: `DST:${d.team || d.name}`,
        rank: d.posRank,
        name: d.name,
        team: d.team,
      }))
  ), [defenses]);

  /** QB ADP list + top-100 skill ADP — separate so QB run rate is obvious mid-draft. */
  const adpScratch = useMemo(() => {
    const withAdp = [];
    for (const p of players) {
      const pos = String(p.position || '').toUpperCase();
      if (pos !== 'QB' && pos !== 'RB' && pos !== 'WR' && pos !== 'TE') continue;
      const adp = resolveMarketAdp(p, adpMode);
      if (adp == null || !Number.isFinite(adp)) continue;
      withAdp.push({ player: p, adp });
    }
    withAdp.sort((a, b) => a.adp - b.adp || (a.player.rank ?? 999) - (b.player.rank ?? 999));
    const qbs = withAdp.filter((r) => String(r.player.position).toUpperCase() === 'QB');
    const skill = withAdp
      .filter((r) => String(r.player.position).toUpperCase() !== 'QB')
      .slice(0, ADP_SCRATCH_SKILL_COUNT);
    return { qbs, skill };
  }, [players, adpMode]);

  const handlePrint = () => {
    window.print();
  };

  const adpScratchPages = (adpScratch.qbs.length ? 1 : 0) + (adpScratch.skill.length ? 1 : 0);
  const totalPages = overallPages.length + positionalPages.length + 1 + adpScratchPages;

  if (!players.length) {
    return (
      <div className="rv-error">
        No board to print
        {publicMode
          ? ' — public snapshot missing.'
          : ' — load the custom board (Local) first.'}
      </div>
    );
  }

  return (
    <div className="rddp-root">
      <div className="rddp-toolbar rddp-no-print">
        <button type="button" className="rddp-print-btn" onClick={handlePrint}>
          Print / Save PDF
        </button>
        <p className="rddp-toolbar-copy">
          {format === '1qb' ? '1QB' : 'Superflex'} · Top {PRINT_DEPTH} · {totalPages} letter pages · {PLAYERS_PER_PAGE}/page · 2-column.
          {hasSources
            ? ' Letters: C / Z / G / E / F (not expanded on paper).'
            : ' Switch to Local for per-source letter codes — this board has none.'}
          {' '}Ends with raw {adpMode === 'jaml' ? 'JAML' : adpMode === 'fp' ? 'FP' : 'YAFSB'} ADP scratch sheets
          (QBs separate, top {ADP_SCRATCH_SKILL_COUNT} RB/WR/TE).
          {' '}In the print dialog, turn off “Headers and footers” and turn on “Background graphics” for the watermark.
        </p>
      </div>

      <div className="rddp-sheet">
        {overallPages.map((pagePlayers, i) => (
          <PrintPage
            key={`ovr-${i}`}
            title="Overall"
            pageLabel={pageRangeLabel(pagePlayers, 'rank', i, overallPages.length)}
          >
            <TwoColPlayers
              players={pagePlayers}
              adpMode={adpMode}
              tierKey="tier"
              titlePrefix="T"
              rankField="rank"
              showPos
            />
          </PrintPage>
        ))}

        {positionalPages.map(({ pos, players: pagePlayers, pageLabel }) => (
          <PrintPage
            key={`${pos}-${pageLabel}`}
            title={pos}
            pageLabel={pageLabel}
          >
            <TwoColPlayers
              players={pagePlayers}
              adpMode={adpMode}
              tierKey="posTier"
              titlePrefix={`${pos} T`}
              rankField="posRank"
              showPos={false}
            />
          </PrintPage>
        ))}

        <PrintPage title="K / P / DST (top 10)">
          <div className="rddp-special-grid">
            <section className="rddp-tier">
              <header className="rddp-tier-h">K</header>
              <div className="rddp-tier-body">
                {topKickers.map((p) => (
                  <PlayerLine
                    key={p.sleeperId || p.name}
                    player={p}
                    adpMode={adpMode}
                    rankField="posRank"
                    showPos={false}
                  />
                ))}
              </div>
            </section>
            <SimpleTop10 title="P" rows={topPunters} />
            <SimpleTop10 title="DST" rows={topDst} />
          </div>
        </PrintPage>

        {adpScratch.qbs.length > 0 && (
          <PrintPage
            title="ADP · QB"
            pageLabel={`${adpScratch.qbs.length} · cross off`}
          >
            <AdpScratchGrid rows={adpScratch.qbs} cols={ADP_SCRATCH_COLS} showPos={false} />
          </PrintPage>
        )}

        {adpScratch.skill.length > 0 && (
          <PrintPage
            title="ADP · RB / WR / TE"
            pageLabel={`top ${adpScratch.skill.length} · cross off`}
          >
            <AdpScratchGrid rows={adpScratch.skill} cols={ADP_SCRATCH_COLS} showPos />
          </PrintPage>
        )}
      </div>
    </div>
  );
}

export default RedraftDashPrintable;
