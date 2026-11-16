import React, { useEffect, useMemo, useState } from 'react';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import LoadingState from '../LoadingState';
import PageMeta from '../PageMeta';
import { isMyRoster, useMyCurrentRosterId } from '../hooks/useAuthUser';
import PlayoffFourSelector from '../playoffs/PlayoffFourSelector';
import { PLAYOFF_SPOTS, simulatePlayoffField } from '../playoffs/playoffHprojOdds';
import { loadPlayoffHprojField } from '../playoffs/playoffHprojFieldLoader';
import { HprojOddsPct } from '../playoffs/playoffHprojOddsUi';
import { REG_SEASON_WEEKS } from '../scenarios/simulatorLineup';
import { CURRENT_YEAR } from '../utils/DateHelper';
import { trackPageLoad } from '../utils/UsageTracker';
import './PlayoffPredictionsPage.css';

const TITLE = 'Playoff Predictions – The Hwang Dynasty';
const DESCRIPTION = 'HProj playoff odds with live scoring for the current week.';
function fmtPts(n) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function fmtPct(n) {
  if (!Number.isFinite(n)) return '—';
  const v = Math.max(0, Math.min(100, Number(n) || 0));
  return `${v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function playoffColor(pct) {
  const t = Math.max(0, Math.min(100, Number(pct) || 0)) / 100;
  const lo = [248, 113, 113];
  const mid = [250, 204, 21];
  const hi = [52, 211, 153];
  const mix = (a, b, u) => a.map((c, i) => Math.round(c + (b[i] - c) * u));
  const rgb = t < 0.5 ? mix(lo, mid, t * 2) : mix(mid, hi, (t - 0.5) * 2);
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function titleColor(pct) {
  const t = Math.max(0, Math.min(100, Number(pct) || 0)) / 100;
  const lo = [148, 163, 184];
  const hi = [251, 191, 36];
  const rgb = lo.map((c, i) => Math.round(c + ((hi[i] - c) * t)));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/** Weeks 15–17: show banked + live points on the odds columns. */
function isLeaguePlayoffPeriod(field) {
  if (!field) return false;
  const banked = Number(field.bankedThrough) || 0;
  const liveWeek = Number(field.liveWeek) || 0;
  const currentWeek = Number(field.currentWeek) || 0;
  return (
    banked > REG_SEASON_WEEKS
    || liveWeek > REG_SEASON_WEEKS
    || currentWeek > REG_SEASON_WEEKS
  );
}

function pointsLine(row, field) {
  const banked = field.bankedThrough;
  if (field.liveWeek && row.liveWeekPts != null) {
    return (
      <>
        Final 1–{banked} {fmtPts(row.pointsSoFar)}
        <span className="pp-sep">·</span>
        Live wk {field.liveWeek} {fmtPts(row.liveWeekPts)}
      </>
    );
  }
  return (
    <>
      {banked > 0 ? `Through wk ${banked}` : 'So far'}{' '}
      {fmtPts(row.pointsSoFar)}
    </>
  );
}

function teamAvatar(info) {
  const user = info && info.user;
  if (!user) return null;
  return user.team_avatar_url || user.user_avatar_url || user.avatar_url || null;
}

function WeekCell({ summary }) {
  if (!summary) return <td><span className="pp-dash">—</span></td>;
  return (
    <td>
      <span className="pp-table-pts">{fmtPts(summary.p50)}</span>
      <span className="pp-table-range">{fmtPts(summary.p10)}–{fmtPts(summary.p90)}</span>
    </td>
  );
}

function sortPlayoffColumnRows(rows) {
  return [...rows].sort((a, b) => (
    b.playoffPct - a.playoffPct
    || b.p50 - a.p50
    || String(a.rosterId).localeCompare(String(b.rosterId))
  ));
}

function OddsColumn({
  title,
  subtitle,
  rows,
  teamMap,
  myRosterId,
  field,
  metric,
  colorFn,
  valueForRow = null,
  footer = null,
  extraHead = null,
  emptyHint = null,
  preserveOrder = false,
  colClass = '',
  listLead = null,
  hideList = false,
  mobileHidden = false,
  medianForRow = null,
  medianLabel = 'Median',
  oddsDetailForRow = null,
}) {
  const displayRows = useMemo(() => {
    if (preserveOrder) return rows;
    const metricFor = (row) => {
      const raw = valueForRow ? valueForRow(row) : row[metric];
      return raw == null || !Number.isFinite(raw) ? -1 : raw;
    };
    return [...rows].sort((a, b) => (
      metricFor(b) - metricFor(a)
      || b.playoffPct - a.playoffPct
      || b.p50 - a.p50
      || String(a.rosterId).localeCompare(String(b.rosterId))
    ));
  }, [rows, metric, valueForRow, preserveOrder]);

  return (
    <section className={`pp-col ${colClass}${mobileHidden ? ' pp-col--mobile-off' : ''}`.trim()}>
      <header className="pp-col-head">
        <h2 className="pp-col-title">{title}</h2>
        <p className="pp-col-sub">{subtitle}</p>
        {extraHead}
      </header>
      {emptyHint ? (
        <p className="pp-col-empty">{emptyHint}</p>
      ) : null}
      {!hideList ? (
        <>
          {listLead}
          <ol className="pp-col-list">
        {displayRows.map((row, index) => {
          const info = teamMap[row.rosterId] || {};
          const mine = isMyRoster(row.rosterId, myRosterId);
          const rawPct = valueForRow ? valueForRow(row) : row[metric];
          const pct = rawPct == null || !Number.isFinite(rawPct) ? null : rawPct;
          const color = colorFn(pct == null ? 0 : pct);
          const avatar = teamAvatar(info);
          const oddsDetail = oddsDetailForRow ? oddsDetailForRow(row) : null;
          return (
            <li key={row.rosterId} className={`pp-col-item${mine ? ' pp-col-item--me' : ''}`}>
              <span className="pp-col-rank">{index + 1}</span>
              {avatar ? (
                <img className={`pp-col-avatar${mine ? ' me-avatar' : ''}`} src={avatar} alt="" />
              ) : (
                <span className="pp-col-avatar pp-col-avatar--empty" aria-hidden="true" />
              )}
              <div className="pp-col-body">
                <div className={`pp-col-team${mine ? ' pp-col-team--me' : ''}`}>
                  <span className="pp-col-team-name">{info.teamName || `Team ${row.rosterId}`}</span>
                  {mine ? <span className="me-chip">YOU</span> : null}
                </div>
                <div className="pp-col-owner">{info.ownerName || ''}</div>
                <div className="pp-col-meta">
                  {isLeaguePlayoffPeriod(field) ? (
                    <>
                      {pointsLine(row, field)}
                      <span className="pp-sep">·</span>
                    </>
                  ) : null}
                  {medianLabel}{' '}
                  {fmtPts(medianForRow ? medianForRow(row) : row.p50)}
                </div>
                <div className="pp-col-bar" aria-hidden="true">
                  <span style={{
                    width: `${Math.max(0, Math.min(100, pct == null ? 0 : pct))}%`,
                    background: color,
                  }}
                  />
                </div>
              </div>
              <div className="pp-col-pct">
                {pct == null ? (
                  '—'
                ) : (
                  <HprojOddsPct
                    pct={oddsDetail?.pct ?? pct}
                    count={oddsDetail?.count}
                    total={oddsDetail?.total}
                    style={{ color }}
                    title="Monte Carlo replays"
                  />
                )}
              </div>
            </li>
          );
        })}
          </ol>
        </>
      ) : null}
      {footer}
    </section>
  );
}

const WIN_MODES = {
  conditional: 'conditional',
  select: 'select',
};

const DUO_VIEWS = {
  playoffs: 'playoffs',
  win: 'win',
};

function MobileDuoToggle({ view, onChange }) {
  return (
    <div className="pp-duo-mobile-tabs" role="tablist" aria-label="Playoff odds view">
      <button
        type="button"
        role="tab"
        aria-selected={view === DUO_VIEWS.playoffs}
        className={`pp-duo-mobile-tab${view === DUO_VIEWS.playoffs ? ' pp-duo-mobile-tab--active' : ''}`}
        onClick={() => onChange(DUO_VIEWS.playoffs)}
      >
        Make it
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === DUO_VIEWS.win}
        className={`pp-duo-mobile-tab${view === DUO_VIEWS.win ? ' pp-duo-mobile-tab--active' : ''}`}
        onClick={() => onChange(DUO_VIEWS.win)}
      >
        Win it
      </button>
    </div>
  );
}

function WinModeToggle({ mode, onChange }) {
  return (
    <div className="pp-win-toggle" role="tablist" aria-label="Win it calculation">
      <button
        type="button"
        role="tab"
        aria-selected={mode === WIN_MODES.conditional}
        className={`pp-win-toggle-btn${mode === WIN_MODES.conditional ? ' pp-win-toggle-btn--active' : ''}`}
        onClick={() => onChange(WIN_MODES.conditional)}
      >
        Conditional on making it
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === WIN_MODES.select}
        className={`pp-win-toggle-btn${mode === WIN_MODES.select ? ' pp-win-toggle-btn--active' : ''}`}
        onClick={() => onChange(WIN_MODES.select)}
      >
        Select your 4 teams
      </button>
    </div>
  );
}

function PlayoffPredictionsPage() {
  const myRosterId = useMyCurrentRosterId();
  const [label, setLabel] = useState('Loading scores and projections…');
  const [error, setError] = useState(null);
  const [view, setView] = useState(null);

  useEffect(() => {
    trackPageLoad();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const season = CURRENT_YEAR;
        setLabel('Loading scores and projections…');
        const nextView = await loadPlayoffHprojField(season, {
          cancelled: () => cancelled,
          onProgress: (text) => {
            if (!cancelled && text) setLabel(text);
          },
        });
        if (cancelled) return;
        if (!nextView) {
          setError('Could not build playoff odds');
          return;
        }
        setView(nextView);
      } catch (err) {
        if (!cancelled) setError(err && err.message ? err.message : 'Could not build playoff odds');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const field = view && view.field;
  const teamMap = view && view.teamMap;

  return (
    <>
      <PageMeta title={TITLE} description={DESCRIPTION} />
      <InfoPageWrapper
        title="Playoff Predictions"
        subtitle="HProj through the title — live week included"
      >
        <div className="pp-page">
          {error ? (
            <p className="pp-error">{error}</p>
          ) : !field ? (
            <LoadingState label={label} className="pp-loading" />
          ) : (
            <Results field={field} teamMap={teamMap} myRosterId={myRosterId} />
          )}
        </div>
      </InfoPageWrapper>
    </>
  );
}

function Results({ field, teamMap, myRosterId }) {
  const [winMode, setWinMode] = useState(WIN_MODES.conditional);
  const [selectedFour, setSelectedFour] = useState([]);
  const [mobileDuoView, setMobileDuoView] = useState(DUO_VIEWS.playoffs);

  const selectorTeams = useMemo(() => (
    (field.rows || []).map((row) => {
      const info = teamMap[row.rosterId] || {};
      return {
        rosterId: row.rosterId,
        teamName: info.teamName || `Team ${row.rosterId}`,
        avatarUrl: teamAvatar(info),
      };
    })
  ), [field.rows, teamMap]);

  const lockedField = useMemo(() => {
    if (winMode !== WIN_MODES.select || selectedFour.length !== PLAYOFF_SPOTS) return null;
    if (!field.simTeams || !field.replaySeed) return null;
    const ids = selectedFour.map((id) => Number(id)).sort((a, b) => a - b);
    return simulatePlayoffField(field.simTeams, {
      iterations: field.iterations,
      spots: field.spots,
      format: field.playoffFormat,
      seed: `${field.replaySeed}:field:${ids.join(',')}`,
      lockedPlayoffIds: ids,
    });
  }, [winMode, selectedFour, field]);

  const winByRoster = useMemo(() => {
    const map = {};
    if (winMode === WIN_MODES.conditional) {
      for (const row of field.rows) {
        map[row.rosterId] = row.winPctIfMade ?? 0;
      }
      return map;
    }
    if (lockedField && selectedFour.length === PLAYOFF_SPOTS) {
      for (const row of lockedField.rows) {
        map[Number(row.id)] = row.winPctGivenField ?? 0;
      }
    }
    return map;
  }, [winMode, field.rows, lockedField, selectedFour.length]);

  const duelRows = useMemo(() => sortPlayoffColumnRows(field.rows || []), [field.rows]);

  const winRows = useMemo(() => {
    if (winMode === WIN_MODES.select && selectedFour.length === PLAYOFF_SPOTS) {
      return selectedFour
        .map((rid) => field.rows.find((row) => Number(row.rosterId) === Number(rid)))
        .filter(Boolean);
    }
    return field.rows;
  }, [winMode, selectedFour, field.rows]);

  const weeks = Array.isArray(field.weeks) ? field.weeks : [];
  const anyCarried = weeks.some((week) => week.carried);
  const anyLive = weeks.some((week) => week.source === 'live');
  const firstWeek = weeks.length ? weeks[0].week : null;
  const lastWeek = weeks.length ? weeks[weeks.length - 1].week : null;

  const liveBlurb = field.liveWeek
    ? `Weeks 1–${field.bankedThrough} are final; week ${field.liveWeek} uses live scoring (finished games locked, in-progress scaled, unplayed re-rolled). `
    : '';
  let context;
  if (field.weeksLeft === 0 && !weeks.length) {
    context = `The regular season is complete. Title odds use HProj draws for weeks 15–17 under current playoff rules. ${liveBlurb}`.trim();
  } else if (field.bankedThrough === 0) {
    context = `${Number(field.iterations || 0).toLocaleString()} full-season replays from week 1 through the title game. ${liveBlurb}`.trim();
  } else if (field.liveWeek) {
    const tail = firstWeek === lastWeek ? `week ${firstWeek}` : `weeks ${firstWeek}–${lastWeek}`;
    context = (
      `${Number(field.iterations || 0).toLocaleString()} replays of ${tail}, plus weeks 15–17 for the title. `
      + liveBlurb
      + 'Same live-week rules as /hproj.'
    );
  } else {
    const span = firstWeek === lastWeek ? `week ${firstWeek}` : `weeks ${firstWeek}–${lastWeek}`;
    context = `${Number(field.iterations || 0).toLocaleString()} replays of ${span}, plus weeks 15–17 for the title race, on top of ${field.bankedThrough} finalized ${field.bankedThrough === 1 ? 'week' : 'weeks'}.`;
  }

  return (
    <>
      <div className="pp-hero">
        <p className="pp-hero-lead">{context}</p>
        <div className="pp-pills">
          <div className="pp-pill">
            <span className="pp-pill-label">4th-place bar (P50)</span>
            <strong className="pp-pill-value">{fmtPts(field.cutP50)}</strong>
          </div>
          <div className="pp-pill">
            <span className="pp-pill-label">Replays</span>
            <strong className="pp-pill-value">{Number(field.iterations || 0).toLocaleString()}</strong>
          </div>
          <div className="pp-pill">
            <span className="pp-pill-label">Title rules</span>
            <strong className="pp-pill-value">{field.playoffFormatLabel || 'Cumulative'}</strong>
          </div>
        </div>
      </div>

      <div className="pp-duo-wrap">
        <MobileDuoToggle view={mobileDuoView} onChange={setMobileDuoView} />
        <div className="pp-duo">
        <OddsColumn
          title="Make playoffs"
          subtitle={
            field.liveWeek
              ? `Top four through wk 14 · live wk ${field.liveWeek} in every replay`
              : 'Top four through week 14'
          }
          rows={duelRows}
          teamMap={teamMap}
          myRosterId={myRosterId}
          field={field}
          metric="playoffPct"
          colorFn={playoffColor}
          preserveOrder
          colClass="pp-col--playoffs"
          listLead={<div className="pp-col-list-lead" aria-hidden="true" />}
          mobileHidden={mobileDuoView === DUO_VIEWS.win}
          medianForRow={(row) => row.medianPath}
          medianLabel="Median path"
          oddsDetailForRow={(row) => ({
            pct: row.playoffPct,
            count: row.playoffMadeCount,
            total: field.iterations,
          })}
        />
        <OddsColumn
          title="Win it"
          subtitle={
            winMode === WIN_MODES.conditional
              ? `If you make the cut · ${field.playoffFormatLabel || 'cumulative'} · live weeks included`
              : selectedFour.length === PLAYOFF_SPOTS && lockedField
                ? (
                  `Title odds if these four are the playoff field`
                  + (lockedField.fieldMatchPct != null && lockedField.fieldMatchPct < 99.5
                    ? ` · finishes top four in ${fmtPct(lockedField.fieldMatchPct)} of replays`
                    : '')
                )
                : 'Pick four teams — title odds assume that playoff field (live week included)'
          }
          rows={winRows}
          teamMap={teamMap}
          myRosterId={myRosterId}
          field={field}
          metric="winPctIfMade"
          colorFn={titleColor}
          valueForRow={
            winMode === WIN_MODES.select && selectedFour.length === PLAYOFF_SPOTS
              ? (row) => winByRoster[row.rosterId] ?? 0
              : null
          }
          colClass="pp-col--win"
          extraHead={<WinModeToggle mode={winMode} onChange={setWinMode} />}
          emptyHint={
            winMode === WIN_MODES.select && selectedFour.length < PLAYOFF_SPOTS
              ? `Select ${PLAYOFF_SPOTS - selectedFour.length} more team${PLAYOFF_SPOTS - selectedFour.length === 1 ? '' : 's'} below to see title odds for that field.`
              : null
          }
          hideList={winMode === WIN_MODES.select && selectedFour.length < PLAYOFF_SPOTS}
          footer={
            winMode === WIN_MODES.select ? (
              <PlayoffFourSelector
                teams={selectorTeams}
                selectedIds={selectedFour}
                onSelectionChange={setSelectedFour}
                myRosterId={myRosterId}
                maxTeams={PLAYOFF_SPOTS}
              />
            ) : null
          }
          mobileHidden={mobileDuoView === DUO_VIEWS.playoffs}
          medianForRow={(row) => row.playoffMedian15317}
          medianLabel="Median wk 15–17"
          oddsDetailForRow={(row) => {
            if (winMode === WIN_MODES.select && selectedFour.length === PLAYOFF_SPOTS && lockedField) {
              const lockedRow = lockedField.rows.find((r) => Number(r.id) === Number(row.rosterId));
              if (
                !lockedRow
                || !selectedFour.some((id) => Number(id) === Number(row.rosterId))
              ) {
                return null;
              }
              return {
                pct: winByRoster[row.rosterId],
                count: lockedRow.winWhenFieldCount,
                total: lockedField.iterations,
              };
            }
            if (!(Number(row.playoffMadeCount) > 0)) return null;
            return {
              pct: row.winPctIfMade,
              count: row.winCount,
              total: row.playoffMadeCount,
            };
          }}
        />
        </div>
      </div>

      <section className="pp-detail">
        <header className="pp-detail-head">
          <h2 className="pp-detail-title">Projection breakdown</h2>
          <p className="pp-detail-sub">
            Final 1–{field.bankedThrough} is Tuesday-closed scoring only.
            {field.liveWeek
              ? ` Live wk ${field.liveWeek} is your lineup on the scoreboard now. The Wk ${field.liveWeek} roll column is the full-week HProj sim (live locks + re-roll). Odds and remaining weeks all include that live week. `
              : ' '}
            Other week cells are that week’s HProj median with P10–P90 underneath.
            P50 path is finalized points plus each remaining week’s median roll (live week uses the sim median, not the live actual).
          </p>
        </header>
        <div
          className="pp-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Projection breakdown table — scroll horizontally for more weeks"
        >
          <table className="pp-table">
            <thead>
              <tr>
                <th>Team</th>
                <th>{field.bankedThrough > 0 ? `Final 1–${field.bankedThrough}` : 'So far'}</th>
                {field.liveWeek ? (
                  <th className="pp-th-live-col">Live wk {field.liveWeek}</th>
                ) : null}
                {weeks.map((week) => (
                  <th key={week.week} className="pp-th-week">
                    <span className="pp-th-main">Wk {week.week}</span>
                    {week.source === 'live' ? <span className="pp-badge pp-badge--live">Live</span> : null}
                    {week.source === 'carried' ? <span className="pp-badge">Est.</span> : null}
                  </th>
                ))}
                <th title="Banked points plus remaining weekly medians">P50 path</th>
                <th>Regular-season spread</th>
                <th>Make it</th>
                <th>Title</th>
              </tr>
            </thead>
            <tbody>
              {field.rows.map((row) => {
                const info = teamMap[row.rosterId] || {};
                const mine = isMyRoster(row.rosterId, myRosterId);
                return (
                  <tr key={row.rosterId} className={mine ? 'pp-tr--me' : undefined}>
                    <th scope="row" className="pp-th-team">
                      <span className={`pp-table-team${mine ? ' pp-table-team--me' : ''}`}>
                        {info.teamName || `Team ${row.rosterId}`}
                        {mine ? <span className="me-chip">YOU</span> : null}
                      </span>
                      <span className="pp-table-owner">{info.ownerName || ''}</span>
                    </th>
                    <td>{fmtPts(row.pointsSoFar)}</td>
                    {field.liveWeek ? (
                      <td className="pp-table-live-actual">{fmtPts(row.liveWeekPts)}</td>
                    ) : null}
                    {row.weeks.map((summary) => (
                      <WeekCell key={summary.week} summary={summary} />
                    ))}
                    <td className="pp-table-strong">{fmtPts(row.medianPath)}</td>
                    <td>
                      <span className="pp-table-pts">{fmtPts(row.p50)}</span>
                      <span className="pp-table-range">{fmtPts(row.p10)}–{fmtPts(row.p90)}</span>
                    </td>
                    <td className="pp-table-odds">
                      <HprojOddsPct
                        pct={row.playoffPct}
                        count={row.playoffMadeCount}
                        total={field.iterations}
                        style={{ color: playoffColor(row.playoffPct) }}
                        title="Make playoffs"
                      />
                    </td>
                    <td className="pp-table-odds">
                      {winMode === WIN_MODES.select
                      && selectedFour.length === PLAYOFF_SPOTS
                      && !selectedFour.some((id) => Number(id) === Number(row.rosterId)) ? (
                        '—'
                      ) : (() => {
                        const winPct = winByRoster[row.rosterId];
                        let winDetail = null;
                        if (winMode === WIN_MODES.select && lockedField) {
                          const lockedRow = lockedField.rows.find((r) => Number(r.id) === Number(row.rosterId));
                          if (lockedRow) {
                            winDetail = {
                              pct: winPct,
                              count: lockedRow.winWhenFieldCount,
                              total: lockedField.iterations,
                            };
                          }
                        } else if (Number(row.playoffMadeCount) > 0) {
                          winDetail = {
                            pct: row.winPctIfMade,
                            count: row.winCount,
                            total: row.playoffMadeCount,
                          };
                        }
                        return (
                          <HprojOddsPct
                            pct={winDetail?.pct ?? winPct}
                            count={winDetail?.count}
                            total={winDetail?.total}
                            style={{ color: titleColor(winPct ?? 0) }}
                            title={
                              winMode === WIN_MODES.conditional
                                ? 'Title odds if you make the cut'
                                : 'Title odds in this playoff field'
                            }
                          />
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="pp-footnote">
          Every week draws skill players around Sleeper projections and scores the best-ball lineup, same as /hproj.
          {anyLive ? ' The current week uses live scoring in every replay: finals and outs locked, in-progress games scaled.' : ''}
          {anyCarried ? ' Est. weeks reuse the latest player projection with byes removed.' : ''}
          {' '}“Conditional on making it” is win% given you finished top four. “Select your 4” crowns a champion among your picks each replay (not only when they naturally make the cut).
          {' '}Exact ties on the playoff cut split at random; title placement follows /yoffs rules.
        </p>
      </section>
    </>
  );
}

export default PlayoffPredictionsPage;