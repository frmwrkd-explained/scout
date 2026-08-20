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

// Age → filled segments.
//
// **`staleness` is the API's answer and it always wins.** `backend/decay.mjs` is the ONE staleness
// rule in the app (Law 3), and it honours `sweep_interval_days` — the human's own statement about
// how long a particular object stays trustworthy. The buckets below know nothing about that, so on
// `territory/manila-nurses`, where the interval is set to 365 days, they rendered an empty meter
// (dead) over an object the API calls fresh. A second staleness rule that disagrees with the first
// is worse than no meter, because the meter is what the person believes.
//
// The buckets remain as the FALLBACK for the surfaces that only have a date — a plain `date` field
// with `display: freshness` has no decay window of its own. They are deliberately coarse: the
// question a human asks is "is this live, cooling, or dead", not "how many days exactly".
export function freshnessOf(dateish, staleness = null) {
  if (!dateish && staleness == null) return { filled: 0, days: null, label: 'NEVER' };
  const t = Date.parse(String(dateish));
  const days = Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86400000));

  if (typeof staleness === 'number' && Number.isFinite(staleness)) {
    // 0 = just verified, 1 = past its window. Five segments emptying across that range.
    const filled = Math.max(0, Math.min(SEGMENTS, SEGMENTS - Math.round(Math.max(0, Math.min(1, staleness)) * SEGMENTS)));
    const label = days == null ? (staleness >= 1 ? 'STALE' : 'CHECKED') : days === 0 ? 'TODAY' : days === 1 ? '1D AGO' : days + 'D AGO';
    return { filled, days, label, stale: staleness >= 1 };
  }

  if (days == null) return { filled: 0, days: null, label: 'UNKNOWN' };
  const filled = days <= 1 ? 5 : days <= 3 ? 4 : days <= 7 ? 3 : days <= 14 ? 2 : days <= 30 ? 1 : 0;
  const label = days === 0 ? 'TODAY' : days === 1 ? '1D AGO' : days + 'D AGO';
  return { filled, days, label, stale: filled === 0 };
}

// `staleness` — the number from the API (0..1). Pass it wherever you have it; the meter then agrees
// with what the backend, the hot cache and the agent all believe about this object.
export function Freshness({ value, staleness = null, showLabel = true, width = 36 }) {
  const { filled, label } = freshnessOf(value, staleness);
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
