// Handoff dialog — the OUT half of the manual round-trip (backend/manual.mjs).
//
// It looks like "copy some prompts to the clipboard". The clipboard is the smaller half of what it
// does. The larger half is invisible: it persists the ORDER the prompts went out in, as
// projects/<pid>/handoffs/HO-<ts>.md. That record is what lets the inbox match a hundred
// `Flow_20260730_1a2b3c.mp4` downloads back onto their shots for free — no renaming by the user, no
// vision call per file. Copying without creating the record would leave every ingest to the AI tier.
//
// `perShot` is the one number that matters and the one users forget: Flow renders 4 variants per
// prompt, Midjourney 4, most others 1. It is the stride the order matcher counts in, so a wrong
// value misaligns everything after the first shot. Hence: prominent, explained, and remembered in
// settings.manualPerShot rather than re-asked from scratch every time.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { Btn } from './ui';
import { handoffEntries, intendedModel } from './handoffCompose';
import { modelName } from './GenerationControls';
import { MONO } from './tokens';


export default class ManualHandoff extends React.Component {
  constructor(props) {
    super(props);
    const st = props.app.state.settings || {};
    this.state = {
      perShot: Number(st.manualPerShot) || 1,
      busy: false,
      // the composed sheet, computed once on mount — this is what goes on the clipboard, and
      // showing it before the copy is the difference between "trust me" and "here it is"
      built: null, sheet: null
    };
  }
  componentDidMount() { this.build(); }

  build() {
    const { app, pid, shots } = this.props;
    this.setState({ built: handoffEntries(app, pid, shots) });
  }

  // Create the record, then copy. Order matters: if the write fails we must NOT tell the user their
  // prompts are on the clipboard and matchable later — they'd render 100 files against a handoff
  // that doesn't exist and land in the slow path with no warning.
  async create(which) {
    const { app, pid, onDone } = this.props;
    const { built, perShot } = this.state;
    if (!built || !built.entries.length) return;
    this.setState({ busy: true });
    try {
      const h = await api.manualHandoff(pid, { entries: built.entries, perShot, target: '' });
      const text = which === 'plain' ? h.plain : h.sheet;
      if (navigator.clipboard) await navigator.clipboard.writeText(text).catch(() => { });
      // remember the stride — it's a property of the tool the user renders in, not of this batch
      if (Number(perShot) !== Number((app.state.settings || {}).manualPerShot)) {
        api.saveSettings({ manualPerShot: Number(perShot) }).then(() => app.sync()).catch(() => { });
      }
      this.setState({ busy: false, sheet: h });
      app.showToast(
        built.entries.length + ' prompts copied · ' + h.id + ' recorded — drop the downloads in the Inbox and they match by order',
        'var(--ok)'
      );
      onDone && onDone(h);
    } catch (e) {
      this.setState({ busy: false });
      app.showToast('Handoff failed — ' + e.message, 'var(--danger)');
    }
  }

  render() {
    const { app, pid, onClose } = this.props;
    const S = this.state;
    const b = S.built;
    const n = b ? b.entries.length : 0;
    const expect = n * S.perShot;
    return (
      <>
        <div onClick={onClose} style={sx('position:fixed;inset:0;z-index:80;background:color-mix(in srgb, var(--void) 82%, transparent)')} />
        <div className="glass" style={{
          ...sx('position:fixed;left:50%;top:50%;z-index:81;width:620px;max-width:92vw;max-height:84vh;display:flex;flex-direction:column;padding:0;overflow:hidden'),
          transform: 'translate(-50%,-50%)'
        }}>
          <div style={sx('flex:none;display:flex;align-items:center;gap:12px;padding:15px 20px;border-bottom:1px solid var(--line)')}>
            <span style={{ ...sx('font-weight:700;color:var(--accent)'), fontFamily: MONO, fontSize: 11 }}>HAND OFF PROMPTS</span>
            <span style={{ ...sx('color:var(--fg-faint)'), fontFamily: MONO, fontSize: 10 }}>
              render these anywhere · {modelName(intendedModel(app, pid))} is what FrameForge would have used
            </span>
            <span onClick={onClose} className="hFg" style={{ ...sx('margin-left:auto;cursor:pointer'), fontFamily: MONO, fontSize: 10.5, color: 'var(--fg-faint)' }}>✕</span>
          </div>

          <div style={sx('flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:14px')}>
            <div style={sx('display:flex;align-items:center;gap:12px')}>
              <span style={{ ...sx('color:var(--fg-soft)'), fontSize: 12 }}>Renders per prompt</span>
              <div style={sx('display:flex;gap:5px')}>
                {[1, 2, 3, 4, 6, 8].map(v => (
                  <span key={v} onClick={() => this.setState({ perShot: v })} className="hBd"
                    style={{
                      ...sx('padding:4px 11px;border-radius:7px;cursor:pointer;font-size:11px;font-weight:700'),
                      border: '1px solid ' + (S.perShot === v ? 'var(--accent)' : 'var(--border-2)'),
                      color: S.perShot === v ? 'var(--accent)' : 'var(--fg-soft)', fontFamily: MONO
                    }}>{v}</span>
                ))}
              </div>
              <span style={{ ...sx('margin-left:auto;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
                expect {expect} file{expect === 1 ? '' : 's'} back
              </span>
            </div>
            <p style={sx('margin:0;font-size:11.5px;color:var(--fg-faint);line-height:1.6')}>
              Set this to how many images or clips your tool produces per prompt — Google Flow gives 4.
              FrameForge counts your downloads in that stride to put them back on the right shots, so a
              wrong number here misaligns everything after the first shot.
            </p>

            {b && b.skipped.length > 0 && (
              <div style={sx('padding:10px 13px;border-radius:9px;border:1px solid var(--border-2);background:var(--sunk)')}>
                <span style={{ ...sx('color:var(--danger)'), fontFamily: MONO, fontSize: 10 }}>
                  {b.skipped.length} shot{b.skipped.length === 1 ? '' : 's'} left out — no prompt yet: {b.skipped.map(s => s.shot).join(', ')}
                </span>
              </div>
            )}

            <div style={sx('border:1px solid var(--line);border-radius:10px;background:var(--sunk);padding:12px 14px;max-height:230px;overflow-y:auto')}>
              {n === 0
                ? <span style={{ ...sx('color:var(--fg-faint)'), fontFamily: MONO, fontSize: 10.5 }}>No shots with prompts in this selection.</span>
                : b.entries.map((e, i) => (
                  <div key={e.shot} style={sx('padding:6px 0;border-bottom:1px solid var(--line)')}>
                    <span style={{ ...sx('color:var(--accent)'), fontFamily: MONO, fontSize: 10 }}>{i + 1} · {e.shot}</span>
                    <span style={{ ...sx('color:var(--fg-faint);margin-left:8px'), fontFamily: MONO, fontSize: 10 }}>{e.title}</span>
                    {e.refs.length > 0 && (
                      <span style={{ ...sx('color:var(--fg-faint);margin-left:8px'), fontFamily: MONO, fontSize: 9.5 }}>
                        attach: {e.refs.join(', ')}
                      </span>
                    )}
                    <div style={sx('font-size:11px;color:var(--fg-soft);line-height:1.5;margin-top:3px')}>{e.prompt}</div>
                  </div>
                ))}
            </div>
          </div>

          <div style={sx('flex:none;display:flex;align-items:center;gap:9px;padding:13px 20px;border-top:1px solid var(--line)')}>
            <span style={{ ...sx('color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>
              Reference images stay local — attach them by hand in the other tool.
            </span>
            <Btn size="sm" busy={S.busy} disabled={!n} style={{ marginLeft: 'auto' }}
              title="Prompts only, blank-line separated — for a tool with a bulk prompt box"
              onClick={() => this.create('plain')}>Copy prompts only</Btn>
            <Btn size="sm" variant="primary" busy={S.busy} disabled={!n}
              title="Numbered sheet with shot codes — paste one at a time and keep your place"
              onClick={() => this.create('sheet')}>Copy sheet · {n}</Btn>
          </div>
        </div>
      </>
    );
  }
}
