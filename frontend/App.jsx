// Scout's application shell.
//
// M0 renders the chrome and nothing else: there is no datastore surface yet, so every group is
// empty and says so. The measurements below come from design/Scout.dc.html and are recorded in
// design/EXTRACT.md §3.2 — 210px rail, 302px inspector, 38px status footer. Do not re-derive
// them from a screenshot.
//
// Deliberately NOT here yet, and the milestone that brings each:
//   collections + the table         T02 / T03
//   the document surface            T04
//   the inspector's five sections   T05
//   MEMORY group (goals, territory, playbook, what they know)   M3
//   ASSISTANTS with real state      M4
//   FILES browser, light mode       M5
//
// The rail groups render with zero items rather than with placeholder rows. A fake count is a
// lie the next person has to disprove.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Eyebrow, Empty } from './ui';

const RAIL_W = 210;
const INSPECTOR_W = 302;

// Group heading: 8.5px/800 at .18em, --fg-muted, with an optional mono note on the right.
function Group({ label, note, children }) {
  return (
    <div style={sx('padding:6px 12px 10px;display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--line)')}>
      <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 10px 6px')}>
        <Eyebrow style={sx('font-size:8.5px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>{label}</Eyebrow>
        {note ? (
          <span style={{ ...sx('font-size:9px;font-weight:500;color:var(--fg-faint)'), fontFamily: MONO }}>{note}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

// The zero-item state inside a rail group. Mono uppercase, per DESIGN.md.
function RailEmpty({ children }) {
  return (
    <span style={{ ...sx('display:flex;align-items:center;min-height:28px;padding:0 10px;font-size:9.5px;font-weight:500;letter-spacing:.08em;color:var(--fg-faint)'), fontFamily: MONO }}>
      {children}
    </span>
  );
}

export default class App extends React.Component {
  render() {
    return (
      <div style={sx('width:100%;height:100vh;display:flex;flex-direction:column;background:var(--ink);overflow:hidden')}>
        <div style={sx('flex:1;min-height:0;display:flex')}>

          <aside style={{ ...sx('flex:none;background:var(--surface);border-right:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden'), width: RAIL_W }}>
            <div style={sx('flex:none;padding:10px 12px;border-bottom:1px solid var(--line)')}>
              <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border-radius:6px;background:var(--raise);border:1px solid var(--border-3)')}>
                <span style={sx('display:flex;flex-direction:column;gap:3px;min-width:0')}>
                  <Eyebrow style={sx('font-size:8.5px;font-weight:800;letter-spacing:.16em;color:var(--fg-faint)')}>PROJECT</Eyebrow>
                  <span style={sx('font-size:12.5px;font-weight:600;color:var(--fg-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>No project yet</span>
                </span>
              </div>
            </div>

            <div style={sx('flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column')}>
              <Group label="COLLECTIONS" note="SAVED QUERIES">
                <RailEmpty>NONE YET</RailEmpty>
              </Group>
              <Group label="ASSISTANTS">
                <RailEmpty>NONE HIRED</RailEmpty>
              </Group>
            </div>

            <div style={sx('flex:none;border-top:1px solid var(--line);padding:8px 12px')}>
              <span style={{ ...sx('display:flex;align-items:center;height:28px;padding:0 10px;color:var(--fg-faint);font-size:10px;font-weight:600;letter-spacing:.1em'), fontFamily: MONO }}>
                FILES ON DISK
              </span>
            </div>
          </aside>

          <main style={sx('flex:1;min-width:0;display:flex;align-items:center;justify-content:center;padding:40px;overflow:hidden')}>
            <Empty
              size="page"
              style={sx('max-width:420px')}
              title="Nothing here yet"
              body="Scout stores everything as plain markdown on disk. There is no workspace open, so there is nothing to show."
            />
          </main>

          <aside style={{ ...sx('flex:none;background:var(--surface);border-left:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden'), width: INSPECTOR_W }}>
            <div style={sx('flex:none;height:40px;display:flex;align-items:center;padding:0 16px;border-bottom:1px solid var(--line)')}>
              <Eyebrow style={sx('font-size:9px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>INSPECTOR</Eyebrow>
            </div>
            <div style={sx('flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:16px')}>
              <span style={{ ...sx('font-size:9.5px;font-weight:500;letter-spacing:.1em;color:var(--fg-faint);text-align:center'), fontFamily: MONO }}>
                NOTHING SELECTED
              </span>
            </div>
          </aside>
        </div>

        <footer style={sx('flex:none;height:38px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 18px;background:var(--surface);border-top:1px solid var(--border)')}>
          <div style={sx('display:flex;align-items:center;gap:11px;min-width:0')}>
            <span style={sx('flex:none;width:7px;height:7px;border-radius:9999px;background:var(--border-3)')} />
            <span style={{ ...sx('font-size:10.5px;font-weight:500;color:var(--fg-faint)'), fontFamily: MONO }}>
              NO ASSISTANTS RUNNING
            </span>
          </div>
          <span style={{ ...sx('font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--fg-faint)'), fontFamily: MONO }}>
            SCOUT
          </span>
        </footer>
      </div>
    );
  }
}
