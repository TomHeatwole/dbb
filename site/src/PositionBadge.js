import React from 'react';

const POS_CLASSES = {
  QB: 'pos-badge--qb',
  RB: 'pos-badge--rb',
  WR: 'pos-badge--wr',
  TE: 'pos-badge--te',
  K: 'pos-badge--k',
  DEF: 'pos-badge--def',
};

export default function PositionBadge({ position }) {
  if (!position) return null;
  const cls = POS_CLASSES[position] || 'pos-badge--other';
  return <span className={`pos-badge ${cls}`}>{position}</span>;
}
