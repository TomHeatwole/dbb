import React, {
  useCallback, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';

function formatPosSlot(position, rank) {
  if (!position || rank == null || rank === '') return '—';
  return `${position}${rank}`;
}

function formatAdpDelta(delta) {
  if (delta == null || !Number.isFinite(delta)) return null;
  if (Math.abs(delta) < 0.05) return 'no ADP change';
  const abs = Math.abs(delta).toFixed(1);
  return delta > 0 ? `+${abs} ADP downgrade` : `−${abs} ADP upgrade`;
}

/**
 * Build hover tooltip lines for Hwang Adjusted Positional ADP rows.
 */
export function buildHwangAdpTooltipLines(row) {
  if (!row) return null;

  const { position } = row;
  const isAdjusted = position === 'RB' || position === 'WR';

  if (!isAdjusted) {
    return [
      'Hwang scoring adjustment',
      'No change — QB/TE pass through at best-ball ADP.',
    ];
  }

  const halfRank = row.halfStackRank;
  const stdRank = row.stdStackRank;
  const shift = row.scoringRankShift;
  const deltaLabel = formatAdpDelta(row.adpDelta);

  if (halfRank == null || stdRank == null || shift == null || shift === 0) {
    const lines = [
      'Hwang scoring adjustment',
      'Half PPR → Standard: no positional rank change.',
    ];
    if (deltaLabel) {
      lines.push(`Applying ${deltaLabel}.`);
    } else {
      lines.push('No ADP adjustment applied.');
    }
    if (row.bbAvgAdp != null && row.value != null && row.adpDelta != null && Math.abs(row.adpDelta) >= 0.05) {
      lines.push(`Best Ball ADP ${row.bbAvgAdp.toFixed(1)} → ${row.value.toFixed(1)}`);
    }
    return lines;
  }

  const direction = shift > 0 ? 'dropped' : 'rose';
  const rankLine = `Half PPR → Standard: ${direction} from ${formatPosSlot(position, halfRank)} → ${formatPosSlot(position, stdRank)}`;

  const lines = ['Hwang scoring adjustment', rankLine];
  if (deltaLabel) {
    lines.push(`Applying ${deltaLabel}.`);
  }
  if (row.bbAvgAdp != null && row.value != null && row.adpDelta !== 0) {
    lines.push(`Best Ball ADP ${row.bbAvgAdp.toFixed(1)} → ${row.value.toFixed(1)}`);
  }

  return lines;
}

const VIEWPORT_MARGIN = 8;
const TOOLTIP_GAP = 6;

function computeFixedTooltipPosition(anchorRect, tooltipRect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = anchorRect.top - TOOLTIP_GAP - tooltipRect.height;
  if (top < VIEWPORT_MARGIN) {
    top = anchorRect.bottom + TOOLTIP_GAP;
  }
  if (top + tooltipRect.height > vh - VIEWPORT_MARGIN) {
    top = Math.max(
      VIEWPORT_MARGIN,
      Math.min(anchorRect.top - TOOLTIP_GAP - tooltipRect.height, vh - tooltipRect.height - VIEWPORT_MARGIN),
    );
  }

  let left = anchorRect.left + (anchorRect.width / 2) - (tooltipRect.width / 2);
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - tooltipRect.width - VIEWPORT_MARGIN));

  return { top, left };
}

function TooltipContent({ lines }) {
  return (
    <>
      {lines.map((line, idx) => (
        <span
          key={idx}
          className={
            idx === 0
              ? 'redraft-adj-tooltip-line redraft-adj-tooltip-line--title'
              : 'redraft-adj-tooltip-line'
          }
        >
          {line}
        </span>
      ))}
    </>
  );
}

export function HwangAdpTooltip({ row, children, className = '', as = 'span' }) {
  const lines = useMemo(
    () => buildHwangAdpTooltipLines(row),
    [
      row,
      row?.position,
      row?.halfStackRank,
      row?.stdStackRank,
      row?.scoringRankShift,
      row?.adpDelta,
      row?.bbAvgAdp,
      row?.value,
    ],
  );
  const title = lines ? lines.join('\n') : undefined;
  const Tag = as;
  const wrapRef = useRef(null);
  const tooltipRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);

  const updatePosition = useCallback(() => {
    const anchor = wrapRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) return;

    const next = computeFixedTooltipPosition(
      anchor.getBoundingClientRect(),
      tooltip.getBoundingClientRect(),
    );

    setCoords((prev) => {
      if (prev && prev.top === next.top && prev.left === next.left) {
        return prev;
      }
      return next;
    });
  }, []);

  const show = useCallback(() => {
    setOpen(true);
  }, []);

  const hide = useCallback(() => {
    setOpen(false);
    setCoords(null);
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;

    updatePosition();

    function onScrollOrResize() {
      updatePosition();
    }

    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, updatePosition]);

  if (!lines) {
    return children ?? null;
  }

  const tooltipNode = open ? createPortal(
    <span
      ref={tooltipRef}
      className={`redraft-adj-tooltip redraft-adj-tooltip--fixed${coords ? ' redraft-adj-tooltip--visible' : ''}`}
      role="tooltip"
      style={coords ? { top: coords.top, left: coords.left } : { top: -9999, left: -9999, visibility: 'hidden' }}
    >
      <TooltipContent lines={lines} />
    </span>,
    document.body,
  ) : null;

  return (
    <>
      <Tag
        ref={wrapRef}
        className={`redraft-adj-tooltip-wrap redraft-adj-tooltip-wrap--fixed${className ? ` ${className}` : ''}`}
        title={title}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </Tag>
      {tooltipNode}
    </>
  );
}
