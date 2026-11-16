import React, { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import useIsMobile from '../hooks/useIsMobile';

export const PLAYOFF_PREDICTIONS_PATH = '/playoff_predictions';

export function fmtHprojOddsPct(n) {
  if (!Number.isFinite(n)) return '—';
  const v = Math.max(0, Math.min(100, Number(n) || 0));
  return `${v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function fmtHprojOddsPctPrecise(n) {
  if (!Number.isFinite(n)) return '—';
  const v = Math.max(0, Math.min(100, Number(n) || 0));
  return `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function hprojOddsRatioDetail({ pct, count, total }) {
  const totalN = Number(total);
  const countN = Number(count);
  if (!Number.isFinite(pct) || !Number.isFinite(totalN) || totalN <= 0 || !Number.isFinite(countN)) {
    return null;
  }
  return {
    brief: fmtHprojOddsPct(pct),
    precise: fmtHprojOddsPctPrecise((countN / totalN) * 100),
    ratio: `${countN.toLocaleString('en-US')}/${totalN.toLocaleString('en-US')}`,
  };
}

function OddsPctDetailBody({ detail }) {
  if (!detail) return null;
  return (
    <>
      <span className="hproj-odds-pct-detail-pct">{detail.precise}</span>
      <span className="hproj-odds-pct-detail-ratio">{detail.ratio}</span>
    </>
  );
}

/**
 * @param {{
 *   pct?: number|null,
 *   count?: number|null,
 *   total?: number|null,
 *   loading?: boolean,
 *   className?: string,
 *   style?: React.CSSProperties,
 *   title?: string,
 * }} props
 */
export function HprojOddsPct({
  pct,
  count,
  total,
  loading = false,
  className = '',
  style,
  title,
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const detail = hprojOddsRatioDetail({ pct, count, total });
  const brief = detail ? detail.brief : fmtHprojOddsPct(pct);
  const canExpand = !!detail;

  useEffect(() => {
    if (!isMobile || !open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isMobile, open]);

  if (loading) {
    return (
      <span className={`hproj-odds-pct hproj-odds-pct--loading ${className}`.trim()} title={title} style={style}>
        <span className="standings-hproj-spinner" aria-hidden="true" />
      </span>
    );
  }

  const mobileSheet = isMobile && open && canExpand && createPortal(
    <div className="hproj-odds-pct-mobile-overlay" onClick={() => setOpen(false)}>
      <div
        className="hproj-odds-pct-mobile-sheet"
        role="dialog"
        aria-labelledby={tooltipId}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="player-card-close hproj-odds-pct-mobile-close"
          aria-label="Close"
          onClick={() => setOpen(false)}
        >
          ×
        </button>
        <p id={tooltipId} className="hproj-odds-pct-mobile-label">
          {title || 'Replay odds'}
        </p>
        <div className="hproj-odds-pct-detail hproj-odds-pct-detail--sheet">
          <OddsPctDetailBody detail={detail} />
        </div>
      </div>
    </div>,
    document.body,
  );

  const openOnMobile = (e) => {
    if (!isMobile || !canExpand) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  };

  return (
    <>
      <span
        className={[
          'hproj-odds-pct',
          canExpand ? 'hproj-odds-pct--has-detail' : '',
          isMobile && canExpand ? 'hproj-odds-pct--tap' : '',
          className,
        ].filter(Boolean).join(' ')}
        style={style}
        title={!canExpand && title ? title : undefined}
      >
        {isMobile && canExpand ? (
          <button
            type="button"
            className="hproj-odds-pct-trigger"
            aria-expanded={open}
            aria-describedby={canExpand ? tooltipId : undefined}
            onClick={openOnMobile}
          >
            {brief}
          </button>
        ) : (
          <span className="hproj-odds-pct-brief">{brief}</span>
        )}
        {!isMobile && canExpand ? (
          <span className="hproj-odds-pct-tooltip" role="tooltip" id={tooltipId}>
            <span className="hproj-odds-pct-detail">
              <OddsPctDetailBody detail={detail} />
            </span>
          </span>
        ) : null}
      </span>
      {mobileSheet}
    </>
  );
}

export function HprojOddsPctLink({
  loading,
  pct,
  count,
  total,
  title,
  className = 'standings-hproj-pct standings-inline-link',
}) {
  if (loading) {
    return (
      <span className={`${className} standings-hproj-pct--loading`} title={title}>
        <span className="standings-hproj-spinner" aria-hidden="true" />
      </span>
    );
  }

  const detail = hprojOddsRatioDetail({ pct, count, total });
  const linkTitle = title || (detail ? `${detail.precise} (${detail.ratio} replays)` : undefined);

  return (
    <Link
      to={PLAYOFF_PREDICTIONS_PATH}
      className={className}
      title={linkTitle}
      onClick={(e) => e.stopPropagation()}
    >
      <HprojOddsPct
        pct={pct}
        count={count}
        total={total}
        title={title}
        className="hproj-odds-pct--in-link"
      />
    </Link>
  );
}