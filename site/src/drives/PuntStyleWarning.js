import React from 'react';

export default function PuntStyleWarning({ warning }) {
  if (!warning) return null;
  return (
    <span className="drives-punt-warn" title={warning.detail}>
      <span className="drives-punt-warn-mark">warn</span>
      <span className="drives-punt-warn-tip" role="tooltip">
        {warning.detail}
      </span>
    </span>
  );
}
