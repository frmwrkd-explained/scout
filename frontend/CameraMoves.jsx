// Camera Moves — cinematography-grade camera motion prompts for AI video generators
// Deterministic assembly: pick a
// movement, tune speed / duration / stabilization, get an unambiguous video prompt.
import React from 'react';
import { sx } from './sx';
import { CAMERA_MOVEMENTS, MOVE_CATEGORIES, MOVE_SPEEDS, MOVE_STABILIZATIONS, assembleMovePrompt } from './cameraMovements';
import { MONO } from './tokens';
import { MoveAnalyzer } from './MoveAnalyzer';
// The per-movement schematic now lives in ./moveDiagram. Imported (this file draws it) AND
// re-exported (StyleLab's CAMERA tab imports it from here) — a bare `export … from` would not
// bind it locally and every card would render undefined. See that file for why it moved.
import { Diagram } from './moveDiagram';
export { Diagram };

const AMBER = 'var(--accent)';

export default class CameraMoves extends React.Component {
  constructor(props) {
    super(props);
    // `mode` is the tool's direction of travel: 'build' picks a move and writes the prompt,
    // 'read' hands a contact sheet to the analyzer and gets a move back. One tool, because
    // both directions speak the same twenty-move vocabulary — splitting them into two tools
    // is how a second vocabulary starts.
    this.state = { mode: 'build', cat: null, moveId: 'push-in', speed: 'normal', duration: 5, stabilization: 'smooth', subject: '' };
  }
  render() {
    const S = this.state;
    const { app } = this.props;
    const move = CAMERA_MOVEMENTS.find(m => m.id === S.moveId);
    const list = S.cat ? CAMERA_MOVEMENTS.filter(m => m.category === S.cat) : CAMERA_MOVEMENTS;
    const out = assembleMovePrompt(move, S);
    const eyebrow = (color = 'var(--fg-muted)') => ({ ...sx('font-weight:700;text-transform:uppercase'), fontFamily: MONO, fontSize: 10, letterSpacing: '.16em', color });
    const modeTab = (id, label) => (
      <span key={id} onClick={() => this.setState({ mode: id })} className={S.mode === id ? '' : 'hFg'}
        style={{ ...sx('font-size:11.5px;font-weight:700;cursor:pointer;padding:0 0 5px;border-bottom:2px solid ' + (S.mode === id ? 'var(--accent)' : 'transparent')), color: S.mode === id ? 'var(--fg)' : 'var(--fg-faint)' }}>{label}</span>
    );
    return (
      <div style={sx('padding:22px 28px 90px')}>
        <div style={sx('display:flex;align-items:baseline;gap:12px;margin-bottom:4px')}>
          <div style={sx('font-weight:700;font-size:16px')}>Camera Moves</div>
          <span style={sx('font-size:12px;color:var(--fg-faint)')}>camera-motion grammar for video generation — deterministic, model-agnostic</span>
        </div>
        <div style={sx('display:flex;gap:18px;align-items:baseline;margin:14px 0 16px;border-bottom:1px solid var(--line)')}>
          {modeTab('build', 'Build a move')}
          {modeTab('read', 'Read a shot')}
        </div>

        {S.mode === 'read' && <MoveAnalyzer app={app} />}
        {S.mode === 'build' && <>
        <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-bottom:16px')}>Pick a movement, tune speed and stabilization — paste the result into Seedance, Kling, Veo or Sora.</div>

        {/* category filter */}
        <div style={sx('display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;align-items:center')}>
          <span style={eyebrow()}>Category</span>
          {[{ id: null, label: 'All ' + CAMERA_MOVEMENTS.length }, ...MOVE_CATEGORIES].map(c => {
            const on = S.cat === c.id;
            return (
              <span key={String(c.id)} onClick={() => this.setState({ cat: c.id })}
                style={{ ...sx('border-radius:99px;padding:4px 13px;cursor:pointer'), fontFamily: MONO, fontSize: 10, color: on ? 'var(--on-accent)' : 'var(--fg-soft)', background: on ? 'var(--fg)' : 'transparent', border: '1px solid ' + (on ? 'var(--fg)' : 'var(--border-2)'), fontWeight: on ? 700 : 400 }}>{c.label}</span>
            );
          })}
        </div>

        <div style={sx('display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:22px;align-items:start')}>
          {/* movement cards */}
          <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px')}>
            {list.map(m => {
              const on = m.id === S.moveId;
              return (
                <div key={m.id} onClick={() => this.setState({ moveId: m.id })} className={on ? '' : 'hCard'}
                  style={{ ...sx('border-radius:10px;background:var(--surface);padding:12px 13px;cursor:pointer'), border: '1px solid ' + (on ? 'var(--accent-60)' : 'var(--line)') }}>
                  <Diagram type={m.diagram} />
                  <div style={{ ...sx('margin-top:8px'), fontFamily: MONO, fontSize: 11, color: on ? AMBER : 'var(--fg)', fontWeight: 600 }}>{m.name}</div>
                  <div style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-faint)', letterSpacing: '.06em', textTransform: 'uppercase', marginTop: 2 }}>{m.directionLabel}</div>
                  <div style={sx('font-size:10.5px;color:var(--fg-muted);line-height:1.5;margin-top:6px')}>{m.description}</div>
                </div>
              );
            })}
          </div>

          {/* output rail */}
          <div style={sx('position:sticky;top:16px;display:flex;flex-direction:column;gap:14px')}>
            <div style={sx('border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:14px 16px;display:flex;flex-direction:column;gap:13px')}>
              <div>
                <div style={{ ...eyebrow('var(--fg-muted)'), ...sx('margin-bottom:7px') }}>Subject · Optional</div>
                <textarea value={S.subject} onChange={e => this.setState({ subject: e.target.value })}
                  onKeyDown={e => e.stopPropagation()} rows={2}
                  placeholder="e.g. a chef plating a dish in a steel kitchen, steam rising"
                  style={sx('width:100%;box-sizing:border-box;resize:vertical;background:var(--ink);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-size:12px;line-height:1.6;padding:9px 11px')} />
              </div>
              <div>
                <div style={{ ...eyebrow('var(--fg-muted)'), ...sx('margin-bottom:7px') }}>Speed</div>
                <div style={sx('display:flex;gap:4px')}>
                  {MOVE_SPEEDS.map(s => {
                    const on = S.speed === s.id;
                    return <span key={s.id} onClick={() => this.setState({ speed: s.id })}
                      style={{ ...sx('flex:1;text-align:center;padding:5px 0;border-radius:6px;cursor:pointer'), fontFamily: MONO, fontSize: 10, color: on ? 'var(--on-accent)' : 'var(--fg-muted)', background: on ? 'var(--fg)' : 'var(--surface-2)', border: '1px solid ' + (on ? 'var(--fg)' : 'var(--border)'), fontWeight: on ? 700 : 400 }}>{s.label}</span>;
                  })}
                </div>
              </div>
              <div>
                <div style={{ ...eyebrow('var(--fg-muted)'), ...sx('margin-bottom:7px') }}>Stabilization</div>
                <div style={sx('display:flex;gap:4px')}>
                  {MOVE_STABILIZATIONS.map(s => {
                    const on = S.stabilization === s.id;
                    return <span key={s.id} onClick={() => this.setState({ stabilization: s.id })}
                      style={{ ...sx('flex:1;text-align:center;padding:5px 0;border-radius:6px;cursor:pointer'), fontFamily: MONO, fontSize: 10, color: on ? 'var(--on-accent)' : 'var(--fg-muted)', background: on ? 'var(--fg)' : 'var(--surface-2)', border: '1px solid ' + (on ? 'var(--fg)' : 'var(--border)'), fontWeight: on ? 700 : 400 }}>{s.label}</span>;
                  })}
                </div>
              </div>
              <div>
                <div style={{ ...eyebrow('var(--fg-muted)'), ...sx('margin-bottom:7px') }}>Duration — {S.duration}s</div>
                <input type="range" min="2" max="12" step="1" value={S.duration}
                  onChange={e => this.setState({ duration: +e.target.value })}
                  style={sx('width:100%;accent-color:var(--accent)')} />
              </div>
            </div>

            <div style={sx('border:1px solid var(--accent-35);border-top:2px solid var(--accent-60);border-radius:8px;background:var(--surface);overflow:hidden')}>
              <div style={sx('display:flex;align-items:center;gap:10px;padding:10px 15px;border-bottom:1px solid var(--line)')}>
                <span style={eyebrow(AMBER)}>Motion Prompt</span>
                <span style={{ ...sx('margin-left:auto'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>{move ? move.name : '—'} · {out.split(/\s+/).filter(Boolean).length} words</span>
              </div>
              <div style={{ ...sx('padding:13px 15px;line-height:1.75;color:var(--fg-soft);min-height:110px'), fontFamily: MONO, fontSize: 11 }}>{out}</div>
              <div style={sx('display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line)')}>
                <div onClick={() => app.go('tools', { toolsSel: 'builder', pbInsert: out })} className="hBdAccent"
                  style={{ ...sx('padding:7px 13px;border-radius:7px;border:1px solid var(--accent-35);color:var(--accent);font-weight:700;cursor:pointer'), fontFamily: MONO, fontSize: 10 }}>→ PROMPT BUILDER</div>
                <div style={sx('flex:1')} />
                <div onClick={() => { navigator.clipboard && navigator.clipboard.writeText(out).catch(() => { }); app.showToast('Motion prompt copied', AMBER); }}
                  className="hBtnAccent" style={{ ...sx('padding:7px 16px;border-radius:7px;background:var(--accent);color:var(--on-accent);font-weight:700;cursor:pointer'), fontFamily: MONO, fontSize: 10 }}>COPY PROMPT</div>
              </div>
            </div>
          </div>
        </div>
        </>}
      </div>
    );
  }
}
