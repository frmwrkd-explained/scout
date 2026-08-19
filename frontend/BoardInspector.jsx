// The Board's shot inspector — the side card that opens when you press OPEN on a shot card.
//
// It exists because the board is where a project gets decided, and every decision it invites used
// to require leaving it: to read the prompt, to fire another take, to change a duration, to see
// what the last note said. Bouncing to the Story tab and back loses your place on the canvas, which
// is the one thing a board is for.
//
// ── WHAT IT IS ALLOWED TO OWN ──────────────────────────────────────────────────────────────────
// Nothing. Every write goes through the routes that already own it — `api.patchShot` for the
// record. There is deliberately no board-specific shot mutation: a shot edited here and a shot
// edited in Story must be the same edit, or the board becomes a second opinion about the project.
//
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { MONO } from './tokens';
import { Btn } from './ui';
import { ComposerDock } from './Composer';

// The panel is a BOTTOM DOCK, not a side rail. Two reasons, both learned the hard way:
//   · Composer is a horizontal bar and `ComposerDock` already declares where it belongs — floating
//     near the bottom, centred, DOCK_WIDTH max. CLAUDE.md: "never hand-roll a wrapper around
//     <Composer> — placement is part of zero variants." A 380px rail wrapped a 60-word prompt into
//     a forty-line column and made the model/format chips wrap under the send button.
//   · A canvas is read horizontally. A right rail eats the width you were panning across; a bottom
//     dock eats height you were not using, and leaves the selected card visible above it.
export const INSPECTOR_H = 340;

const STATUSES = ['todo', 'generating', 'review', 'done'];

// The shot log is the comment thread. It is append-only markdown on the shot record and it is
// already where every automated event lands ("generation … queued", "selected … from the board"),
// so a human note goes in the same stream rather than into a parallel comments field that would
// have to be merged with it to read the history.
function parseLog(log) {
  return String(log || '').split('\n').map(l => l.trim())
    .filter(l => l.startsWith('- '))
    .map(l => {
      const body = l.slice(2);
      const m = body.match(/^(.+?)\s+—\s+([\s\S]*)$/);
      return m ? { when: m[1], text: m[2] } : { when: '', text: body };
    })
    .reverse();                                   // newest first — a log you scroll to read is not read
}

export default class BoardInspector extends React.Component {
  constructor(props) {
    super(props);
    // `tab` is null by default: the dock opens as one compact row — title and setup. Notes
    // EXPANDS it, rather than being a pane you must navigate to.
    this.state = { note: '', busy: '', err: '', tab: null };
  }
  componentDidUpdate(prev) {
    // A different shot means the draft belongs to the previous one — drop it rather than carrying
    // a half-typed note onto someone else's shot.
    if (prev.shot && this.props.shot && prev.shot.id !== this.props.shot.id) {
      this.setState({ note: '', err: '', tab: null });
    }
  }

  patch(patch, log) {
    const { app, pid, shot } = this.props;
    return api.patchShot(pid, shot.id, patch, log)
      .then(() => app.sync && app.sync())
      .catch(e => this.setState({ err: e.message }));
  }

  async addNote() {
    const text = this.state.note.trim();
    if (!text) return;
    this.setState({ note: '', busy: 'note' });
    await this.patch({}, text);                   // an empty patch with a log line IS a comment
    this.setState({ busy: '' });
  }

  field(label, children, w) {
    return (
      <div style={{ ...sx('display:flex;flex-direction:column;gap:4px'), width: w || 'auto' }}>
        <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.1em', color: 'var(--fg-faint)' }}>{label.toUpperCase()}</span>
        {children}
      </div>
    );
  }

  render() {
    const { shot, onClose } = this.props;
    if (!shot) return null;
    const { busy, err, tab } = this.state;
    const log = parseLog(shot.log);

    const input = extra => ({
      ...sx('box-sizing:border-box;border-radius:6px;padding:5px 8px;outline:none;font-size:11.5px'),
      background: 'var(--sunk)', border: '1px solid var(--border-2)', color: 'var(--fg)', ...extra
    });

    return (
      <ComposerDock position="absolute" bottom={16} maxWidth={1180}>
        <div onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}
          style={{
            ...sx('display:flex;flex-direction:column;border-radius:14px;overflow:hidden'),
            maxHeight: INSPECTOR_H,
            background: 'color-mix(in srgb, var(--surface) 94%, transparent)',
            backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
            border: '1px solid var(--border-2)', boxShadow: '0 22px 60px rgba(0,0,0,.55)',
            animation: 'dl-in .16s ease-out'
          }}>

          {/* ── one horizontal header: who it is, the setup, the tabs ── */}
          <div style={sx('flex:none;display:flex;align-items:stretch;gap:14px;padding:10px 12px;border-bottom:1px solid var(--border)')}>
            <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:7px')}>
              <div style={sx('display:flex;align-items:center;gap:10px')}>
                <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.1em', color: 'var(--fg-faint)', flex: 'none' }}>
                  {shot.id} {shot.scene ? '· SCENE ' + shot.scene : '· UNASSIGNED'}
                </span>
                <input defaultValue={shot.title || ''} key={shot.id} placeholder="Untitled shot"
                  onBlur={e => { if (e.target.value !== (shot.title || '')) this.patch({ title: e.target.value }, 'renamed from the board'); }}
                  onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); }}
                  style={{ ...sx('flex:1;min-width:0;background:transparent;border:none;outline:none;padding:1px 0'), fontSize: 13.5, fontWeight: 700, color: 'var(--fg)' }} />
              </div>

              {/* the setup lives in the header as a row — three short fields, always visible, never
                  a tab you have to go and find */}
              <div style={sx('display:flex;align-items:flex-end;gap:9px;flex-wrap:wrap')}>
                {this.field('status', (
                  <select defaultValue={shot.status || 'todo'} key={shot.id + 'st'}
                    onChange={e => this.patch({ status: e.target.value }, 'status → ' + e.target.value)} style={input({ width: 108 })}>
                    {STATUSES.map(x => <option key={x} value={x}>{x}</option>)}
                  </select>
                ))}
                {this.field('dur (s)', (
                  <input type="number" min="0" step="0.5" defaultValue={shot.dur ?? 4} key={shot.id + 'dur'}
                    onKeyDown={e => e.stopPropagation()}
                    onBlur={e => { const v = Number(e.target.value); if (v !== Number(shot.dur)) this.patch({ dur: v }, 'duration → ' + v + 's'); }}
                    style={input({ width: 64 })} />
                ))}
                {this.field('scene', (
                  <input type="number" min="0" step="1" defaultValue={shot.scene ?? ''} key={shot.id + 'sc'} placeholder="—"
                    onKeyDown={e => e.stopPropagation()}
                    onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (shot.scene ?? null)) this.patch({ scene: v }, 'scene → ' + (v ?? 'unassigned')); }}
                    style={input({ width: 64 })} />
                ))}
                <div style={sx('flex:1')} />
                <div style={sx('display:flex;gap:2px;align-items:center')}>
                  {[['log', 'Notes' + (log.length ? ' ' + log.length : '')]].map(([id, label]) => (
                    <span key={id} onClick={() => this.setState({ tab: tab === id ? null : id })} className={tab === id ? '' : 'hFg'}
                      style={{ ...sx('padding:4px 10px;border-radius:6px;cursor:pointer;font-size:10.5px;font-weight:600'), color: tab === id ? 'var(--fg)' : 'var(--fg-faint)', background: tab === id ? 'var(--raise)' : 'transparent', border: '1px solid ' + (tab === id ? 'var(--border-2)' : 'transparent') }}>{label}</span>
                  ))}
                </div>
              </div>
            </div>

            <span onClick={onClose} className="hFg" title="Esc"
              style={sx('flex:none;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--fg-faint);font-size:13px')}>✕</span>
          </div>

          {err && <div style={{ ...sx('flex:none;padding:7px 12px;font-size:11px'), color: 'var(--danger)', background: 'rgba(240,91,84,.08)' }}>{err}</div>}

          {tab === 'log' && (
            <div style={sx('flex:1;min-height:0;overflow-y:auto;padding:10px 12px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:8px')}>
              <div style={sx('display:flex;gap:6px')}>
                <input value={this.state.note} placeholder="Add a note…"
                  onChange={e => this.setState({ note: e.target.value })}
                  onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') this.addNote(); }}
                  style={input({ flex: 1 })} />
                <Btn variant="secondary" size="sm" busy={busy === 'note'} onClick={() => this.addNote()}>Add</Btn>
              </div>
              {log.length
                ? log.map((e, i) => (
                  <div key={i} style={sx('display:flex;gap:10px;align-items:baseline;padding-bottom:6px;border-bottom:1px solid var(--line)')}>
                    <span style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-faint)', flex: 'none', width: 84 }}>{e.when}</span>
                    <span style={sx('flex:1;font-size:11.5px;color:var(--fg-soft);line-height:1.5;word-break:break-word')}>{e.text}</span>
                  </div>
                ))
                : <div style={sx('font-size:11px;color:var(--fg-faint)')}>Nothing logged yet.</div>}
            </div>
          )}
        </div>
      </ComposerDock>
    );
  }
}
