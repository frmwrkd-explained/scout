// The activity drawer — the footer's `ACTIVITY ▴`, on every screen (design/EXTRACT.md §2).
//
// This is where Law 4 becomes visible. The gate does not argue with an agent, it refuses it and
// writes the refusal down; if that refusal is not on a surface the human sees, the guarantee is
// unfalsifiable and therefore worthless. So `refused` and `quarantine` events are rendered louder
// than everything else, and they are never collapsed away.
//
// Reads the append-only event log from `backend/log.mjs` via GET /api/activity. It is a read
// surface only: nothing here mutates anything.
//
// Props:
//   open        bool
//   onToggle()  flips it
//   onOpenPath(path)   Law 8 — every event names a file, and the file is reachable
//   running[]   assistants currently working, for the footer's left side

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { api } from './api';
import { Eyebrow, Empty } from './ui';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// One vocabulary for what an event MEANS, used for both the word and its colour. A refusal and a
// quarantine are the two the human is here to see, so they get the warn/danger end.
const TONE = {
  refused: 'var(--danger)',
  quarantine: 'var(--warn)',
  archive: 'var(--warn)',
  store: 'var(--ok)',
  merge: 'var(--ok)',
  update: 'var(--fg-soft)',
  move: 'var(--marked)',
  claim: 'var(--marked)',
  decide: 'var(--accent)',
  propose: 'var(--marked)',
  schema: 'var(--accent)',
  inbox: 'var(--fg-soft)',
  cache: 'var(--fg-faint)',
  skip: 'var(--fg-faint)',
  accept: 'var(--ok)',
};

// "6 minutes ago" beats a timestamp for a person scanning a log, and the exact time is one hover
// away. Same reasoning as Freshness — the form carries the meaning, the figure is the evidence.
function ago(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return Math.floor(s) + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

export function ActivityRow({ ev, onOpenPath }) {
  const tone = TONE[ev.type] || 'var(--fg-muted)';
  const loud = ev.type === 'refused' || ev.type === 'quarantine';
  return (
    <div style={{
      ...sx('display:flex;align-items:baseline;gap:10px;padding:7px 18px;border-bottom:1px solid var(--line)'),
      background: loud ? 'var(--surface-2)' : 'transparent',
    }}>
      <span style={{ ...mono('font-size:9.5px;font-weight:600;letter-spacing:.06em;flex:none;width:34px;text-align:right;font-variant-numeric:tabular-nums'), color: 'var(--fg-faint)' }}>
        {ago(ev.at)}
      </span>
      <span style={{
        ...mono('font-size:8.5px;font-weight:800;letter-spacing:.12em;flex:none;display:inline-flex;align-items:center;height:17px;padding:0 7px;border-radius:9999px'),
        border: '1px solid ' + tone, color: tone,
      }}>{String(ev.type || '').toUpperCase()}</span>
      <span style={{ ...mono('font-size:10px;font-weight:600;flex:none'), color: 'var(--marked)' }}>{ev.actor || '—'}</span>
      {ev.target ? (
        <button type="button" onClick={() => onOpenPath && onOpenPath(ev.target)}
          style={{ ...mono('font-size:10.5px;background:none;border:none;padding:0;cursor:pointer;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), color: 'var(--fg-soft)' }}
          title={ev.target}>
          {ev.target}
        </button>
      ) : null}
      {ev.detail && Object.keys(ev.detail).length ? (
        <span style={{ ...mono('font-size:10px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), color: 'var(--fg-faint)' }}>
          {Object.entries(ev.detail).map(([k, v]) => k + ' ' + (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(' · ')}
        </span>
      ) : null}
    </div>
  );
}

export default function Activity({ open, onToggle, onOpenPath, running = [] }) {
  const [events, setEvents] = React.useState([]);
  const [error, setError] = React.useState(null);

  // Only poll while the drawer is open. A log tail that runs behind a closed drawer is a battery
  // cost with no reader.
  React.useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    const load = () => api.activity(200)
      .then(r => { if (alive) { setEvents(r.events || []); setError(null); } })
      .catch(e => { if (alive) setError(e.message); });
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [open]);

  const first = running[0];

  return (
    <>
      {open ? (
        <div style={sx('flex:none;height:260px;display:flex;flex-direction:column;background:var(--surface);border-top:1px solid var(--border)')}>
          <div style={sx('flex:none;display:flex;align-items:center;justify-content:space-between;padding:9px 18px;border-bottom:1px solid var(--line)')}>
            <Eyebrow style={sx('font-size:8.5px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>ACTIVITY</Eyebrow>
            <span style={{ ...mono('font-size:9px;font-weight:600;letter-spacing:.1em'), color: 'var(--fg-faint)' }}>
              EVERY WRITE, EVERY REFUSAL
            </span>
          </div>
          <div style={sx('flex:1;min-height:0;overflow-y:auto')}>
            {error ? <Empty size="inline" title="THE LOG DID NOT LOAD" body={error} />
              : events.length ? events.map((ev, i) => <ActivityRow key={ev.id || i} ev={ev} onOpenPath={onOpenPath} />)
                : <Empty size="inline" title="NOTHING HAS HAPPENED YET" body="Every write, promotion, refusal and archive lands here the moment it happens." />}
          </div>
        </div>
      ) : null}

      <footer style={sx('flex:none;height:38px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 18px;background:var(--surface);border-top:1px solid var(--border)')}>
        <div style={sx('display:flex;align-items:center;gap:11px;min-width:0')}>
          <span style={{ ...sx('flex:none;width:7px;height:7px;border-radius:9999px'), background: first ? 'var(--marked)' : 'var(--border-3)' }} />
          <span style={{ ...mono('font-size:10.5px;font-weight:500'), color: first ? 'var(--fg-soft)' : 'var(--fg-faint)' }}>
            {first
              ? first.id + ' — ' + (first.doing || 'working') + (running.length > 1 ? '  ·  +' + (running.length - 1) + ' more' : '')
              : 'NO ASSISTANTS RUNNING'}
          </span>
        </div>
        <div style={sx('display:flex;align-items:center;gap:14px')}>
          <button type="button" onClick={onToggle}
            style={{ ...mono('font-size:9.5px;font-weight:700;letter-spacing:.14em;background:none;border:none;cursor:pointer'), color: open ? 'var(--fg-soft)' : 'var(--fg-faint)' }}>
            ACTIVITY {open ? '▾' : '▴'}
          </button>
          <span style={{ ...mono('font-size:10px;font-weight:700;letter-spacing:.1em'), color: 'var(--fg-faint)' }}>SCOUT</span>
        </div>
      </footer>
    </>
  );
}
