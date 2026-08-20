// The list — one line per row, grouped by day (docs/02_DATA_MODEL.md §3: "date-heavy, log-like").
//
// This is the view a collection gets when it has dates and no status: a run log, an outreach
// history, a stream of findings. The day header is the whole point — a log without days is a wall,
// and "what happened yesterday" is the question this shape exists to answer at a glance.
//
// Typed values still come from ./cells and freshness still comes from ./Freshness. Nothing about a
// field renders differently here than it does in the table; only the arrangement changes.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Cell } from './cells';
import { Empty, OpenRecord } from './ui';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// Which date the days are cut on: the field the view sorts by if it is a date, else the freshness
// date, else any date, else the automatic `updated`. Sorting by a date and then grouping by a
// different one would produce days that interleave, so the sort field wins when there is one.
export function listDateField(collection, view) {
  const fields = collection?.fields || [];
  const sorted = (view?.sort || [])
    .map(s => fields.find(f => f.key === s.field))
    .find(f => f && f.type === 'date');
  if (sorted) return sorted;
  return fields.find(f => f.type === 'date' && f.display === 'freshness')
    || fields.find(f => f.type === 'date')
    || { key: 'updated', type: 'date', display: 'freshness' };
}

// A date-only value ("2026-08-18", or the ISO midnight gray-matter turns it into) must NOT be run
// through a local-time Date, or a workspace west of UTC would file every record on the day before.
// Take the calendar part verbatim when there is one; parse only when there isn't.
export function dayKey(value) {
  if (!value) return null;
  const s = String(value instanceof Date ? value.toISOString() : value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function todayKey(now = new Date()) {
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

export function dayLabel(key, now = new Date()) {
  if (!key) return 'NO DATE';
  const today = todayKey(now);
  const yesterday = todayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  if (key === today) return 'TODAY';
  if (key === yesterday) return 'YESTERDAY';
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);   // local construction — no parse, no shift
  return DAYS[dt.getDay()] + ' ' + String(d).padStart(2, '0') + ' ' + MONTHS[m - 1] + ' ' + y;
}

// → [{ key, label, items }] newest day first. Rows keep the order applyView() gave them inside a
// day, so the view's own sort still decides what leads.
export function listDays(rows, dateKey, now = new Date()) {
  const byDay = new Map();
  for (const r of rows || []) {
    const k = dayKey(r.fields?.[dateKey] ?? r.fields?.updated ?? r.fields?.created);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(r);
  }
  return [...byDay.entries()]
    .sort((a, b) => {
      // Dateless rows sink to the bottom rather than sorting as the year zero.
      if (a[0] === b[0]) return 0;
      if (!a[0]) return 1;
      if (!b[0]) return -1;
      return b[0].localeCompare(a[0]);
    })
    .map(([key, items]) => ({ key, label: dayLabel(key, now), items }));
}

export default function ListView({ collection, view, views, rows, counts, selected, onSelect, onOpen, onFollow, onPickView }) {
  const primary = (collection.fields || []).find(f => f.primary);
  const dateField = listDateField(collection, view);

  // The day header already carries the date, so the trailing columns are everything else the view
  // asked for. Capped: a list line that wraps is not a list line.
  const defs = (view.fields || [])
    .filter(k => k !== primary?.key && k !== dateField.key)
    .slice(0, 4)
    .map(k => (collection.fields || []).find(f => f.key === k) || { key: k, type: 'text' });

  const days = listDays(rows, dateField.key);

  if (!rows.length) {
    return (
      <div style={sx('flex:1;min-height:0;display:flex;align-items:flex-start;justify-content:center;padding:40px 20px')}>
        <Empty
          size="page"
          style={sx('max-width:420px')}
          title="No days to show"
          body="The collection's query and this view's filters together return no records. Nothing is hidden — widen either one."
        />
      </div>
    );
  }

  return (
    <div style={sx('flex:1;min-height:0;overflow:auto')}>
      {days.map(day => (
        <div key={day.key || 'no-date'}>
          <div style={sx('position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:10px;padding:9px 20px 7px;background:var(--ink);border-bottom:1px solid var(--line)')}>
            <span style={{ ...mono('font-size:9.5px;font-weight:800;letter-spacing:.16em;font-variant-numeric:tabular-nums'), color: day.key ? 'var(--fg-muted)' : 'var(--fg-faint)' }}>
              {day.label}
            </span>
            <span style={sx('flex:1;height:1px;background:var(--line)')} />
            <span style={{ ...mono('font-size:10px;font-weight:600;font-variant-numeric:tabular-nums'), color: 'var(--fg-faint)' }}>
              {day.items.length}
            </span>
          </div>

          {day.items.map(r => {
            const on = selected === r.path;
            return (
              // `rvH` arms OpenRecord's reveal-on-hover. The double-click still opens; the chip
              // is what tells a person it does.
              <div key={r.path} className="rvH"
                onClick={() => onSelect(r)}
                onDoubleClick={() => onOpen(r)}
                style={{
                  ...sx('display:flex;align-items:center;gap:14px;padding:8px 20px;cursor:pointer;transition:background 130ms ease'),
                  // Selected is the neutral raised treatment (docs/05_UI_SPEC.md §6) — never accent.
                  background: on ? 'var(--raise)' : 'transparent',
                  borderBottom: '1px solid var(--line)',
                }}>
                <span style={{ ...sx('flex:none;font-size:12.5px;font-weight:600;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), color: on ? 'var(--fg)' : 'var(--fg-soft)' }}>
                  {r.title}
                </span>
                <OpenRecord onOpen={() => onOpen(r)} />
                {r.summary ? (
                  <span style={sx('flex:1;min-width:0;font-size:11.5px;color:var(--fg-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>
                    {r.summary}
                  </span>
                ) : <span style={sx('flex:1;min-width:0')} />}
                {defs.map(f => (
                  <span key={f.key} style={sx('flex:none;display:inline-flex;align-items:center')}>
                    <Cell field={f} value={r.fields[f.key]} onFollow={onFollow} />
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
