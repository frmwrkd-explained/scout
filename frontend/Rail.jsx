// The left rail — 210px, per design/EXTRACT.md §3.2/§3.3.
//
// Order is fixed: project switcher → nav → COLLECTIONS → MEMORY → ASSISTANTS → FILES pinned at the
// bottom. `docs/05_UI_SPEC.md` §1 adds the MEMORY group to what the design drew.
//
// Groups render with ZERO items rather than placeholder rows. A fake count is a lie the next
// person has to disprove.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Eyebrow } from './ui';

export const RAIL_W = 210;
const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

function Row({ label, count, countTone, on, mono: isMono, onClick }) {
  return (
    <button onClick={onClick}
      style={{
        ...sx('display:flex;align-items:center;justify-content:space-between;gap:8px;height:' + (isMono ? '29px' : '30px') + ';padding:0 10px;border-radius:6px;width:100%;cursor:pointer;transition:background 130ms ease,color 130ms ease'),
        background: on ? 'var(--raise)' : 'transparent',
        border: '1px solid ' + (on ? 'var(--border-3)' : 'transparent'),
        color: on ? 'var(--fg)' : 'var(--fg-muted)',
      }}>
      <span style={isMono ? mono('font-size:11.5px;font-weight:' + (on ? 600 : 500)) : sx('font-size:12px;font-weight:' + (on ? 600 : 500))}>{label}</span>
      {count != null ? (
        <span style={{
          ...mono('font-size:' + (countTone ? '9.5px' : '10px') + ';font-weight:600;font-variant-numeric:tabular-nums'),
          color: countTone || 'var(--fg-faint)',
          ...(countTone ? sx('display:inline-flex;align-items:center;height:17px;padding:0 6px;border-radius:9999px;border:1px solid ' + countTone) : {}),
        }}>{count}</span>
      ) : null}
    </button>
  );
}

function Group({ label, note, children }) {
  return (
    <div style={sx('padding:6px 12px 10px;display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--line)')}>
      <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 10px 6px')}>
        <Eyebrow style={sx('font-size:8.5px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>{label}</Eyebrow>
        {note ? <span style={{ ...mono('font-size:9px;font-weight:500'), color: 'var(--fg-faint)' }}>{note}</span> : null}
      </div>
      {children}
    </div>
  );
}

function NoneYet({ children }) {
  return (
    <span style={{ ...mono('display:flex;align-items:center;min-height:28px;padding:0 10px;font-size:9.5px;font-weight:500;letter-spacing:.08em'), color: 'var(--fg-faint)' }}>
      {children}
    </span>
  );
}

export default function Rail({ collections, counts, activeCollection, onPickCollection, project }) {
  return (
    <aside style={{ ...sx('flex:none;background:var(--surface);border-right:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden'), width: RAIL_W }}>
      <div style={sx('flex:none;padding:10px 12px;border-bottom:1px solid var(--line)')}>
        <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border-radius:6px;background:var(--raise);border:1px solid var(--border-3)')}>
          <span style={sx('display:flex;flex-direction:column;gap:3px;min-width:0')}>
            <Eyebrow style={sx('font-size:8.5px;font-weight:800;letter-spacing:.16em;color:var(--fg-faint)')}>PROJECT</Eyebrow>
            <span style={sx('font-size:12.5px;font-weight:600;color:' + (project ? 'var(--fg)' : 'var(--fg-muted)') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>
              {project || 'No project yet'}
            </span>
          </span>
          <span style={{ ...mono('font-size:9px'), color: 'var(--fg-muted)' }}>▾</span>
        </div>
      </div>

      <div style={sx('flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column')}>
        <div style={sx('padding:10px 12px;display:flex;flex-direction:column;gap:2px')}>
          <Row label="Needs you" count={0} countTone="var(--border-2)" />
          <Row label="Today" />
          <Row label="Project" />
        </div>

        <Group label="COLLECTIONS" note="SAVED QUERIES">
          {collections.length
            ? collections.map(c => (
                <Row key={c.id} isMono label={'#' + c.id} count={counts[c.id] ?? '·'}
                  on={c.id === activeCollection} onClick={() => onPickCollection(c.id)} />
              ))
            : <NoneYet>NONE YET</NoneYet>}
          <button style={{ ...mono('display:flex;align-items:center;height:29px;padding:0 10px;border-radius:6px;font-size:11.5px;font-weight:600;cursor:pointer'), color: 'var(--accent)', background: 'transparent', border: 'none' }}>
            + new collection
          </button>
        </Group>

        {/* docs/05_UI_SPEC.md §1 — unbuilt until M3, listed so the shape is visible and nobody
            invents a second home for memory. */}
        <Group label="MEMORY">
          <NoneYet>M3</NoneYet>
        </Group>

        <Group label="ASSISTANTS">
          <NoneYet>NONE HIRED</NoneYet>
        </Group>
      </div>

      <div style={sx('flex:none;border-top:1px solid var(--line);padding:8px 12px')}>
        <span style={{ ...mono('display:flex;align-items:center;height:28px;padding:0 10px;font-size:10px;font-weight:600;letter-spacing:.1em'), color: 'var(--fg-faint)' }}>
          FILES ON DISK
        </span>
      </div>
    </aside>
  );
}
