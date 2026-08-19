// Freshness — Law 3 rendered as a FORM, not only a colour.
//
// Five segments, filled from the left, emptying as a thing ages. One component, no variants: the
// same meter appears on a date field with `display: freshness`, on a territory tile, on a decision
// card and on a memory claim. `design/EXTRACT.md` §4.2 records the measurements (3px tall, 2px gap,
// ~36px wide, unfilled segments `--border`).
//
// Deliberately NOT the same shape as a score or yield bar — those are continuous. Staleness and
// productivity must not read alike.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';

const SEGMENTS = 5;

// Age → filled segments. The scale is deliberately coarse: the question a human asks is "is this
// live, cooling, or dead", not "how many days exactly".
export function freshnessOf(dateish) {
  if (!dateish) return { filled: 0, days: null, label: 'NEVER' };
  const t = Date.parse(String(dateish));
  if (Number.isNaN(t)) return { filled: 0, days: null, label: 'UNKNOWN' };
  const days = Math.max(0, Math.floor((Date.now() - t) / 86400000));
  const filled = days <= 1 ? 5 : days <= 3 ? 4 : days <= 7 ? 3 : days <= 14 ? 2 : days <= 30 ? 1 : 0;
  const label = days === 0 ? 'TODAY' : days === 1 ? '1D AGO' : days + 'D AGO';
  return { filled, days, label };
}

export function Freshness({ value, showLabel = true, width = 36 }) {
  const { filled, label } = freshnessOf(value);
  // A cold thing recedes: the fill itself dims once it is down to its last segment.
  const fill = filled <= 1 ? 'var(--fg-faint)' : 'var(--fg-muted)';
  return (
    <span style={sx('display:inline-flex;align-items:center;gap:8px')}>
      <span style={{ ...sx('display:flex;gap:2px;height:3px;flex:none'), width }}>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span key={i} style={{ ...sx('flex:1;border-radius:1px'), background: i < filled ? fill : 'var(--border)' }} />
        ))}
      </span>
      {showLabel ? (
        <span style={{ ...sx('font-size:9.5px;font-weight:500;letter-spacing:.06em;color:var(--fg-faint);white-space:nowrap'), fontFamily: MONO }}>
          {label}
        </span>
      ) : null}
    </span>
  );
}

export default Freshness;
