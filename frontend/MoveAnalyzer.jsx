// Camera Move analyzer — the read direction of the Camera Moves tool.
//
// The picker goes move → prompt. This goes footage → move: hand it a contact sheet
// (Video → frames, then Open a scene → Build sheet) and it works out which of the twenty
// moves in cameraMovements.js you are looking at, how fast, on what rig, and what changes
// between the first panel and the last.
//
// It renders the SAME Diagram and the SAME assembled prompt the picker does, because the
// backend returns move IDS and re-uses assembleMovePrompt. If this file ever starts writing
// its own move names or its own prompt copy, the tool has two vocabularies and they will drift.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { assetUrl } from './Moodboard';
import { MONO } from './tokens';
import { Btn, Chip } from './ui';
import { CAMERA_MOVEMENTS, MOVE_SPEEDS, MOVE_STABILIZATIONS } from './cameraMovements';
import { AssetPicker } from './ToolsSuite';
import { Diagram } from './moveDiagram';

const eyebrow = (color = 'var(--fg-muted)') => ({
  ...sx('font-weight:700;text-transform:uppercase'), fontFamily: MONO, fontSize: 10, letterSpacing: '.16em', color
});
const moveOf = id => CAMERA_MOVEMENTS.find(m => m.id === id) || null;
const labelOf = (id, list) => (list.find(x => x.id === id) || {}).label || id;
// A sheet is named by the importer; the picker floats those to the front rather than hiding
// everything else, because a single still is still a legal (if blinder) thing to analyze.
const isSheet = c => /-sheet\.(jpe?g|png)$/i.test(c.name || '');

export class MoveAnalyzer extends React.Component {
  constructor(props) {
    super(props);
    this.state = { sel: props.app.state.moveAsset || null, busy: false, result: null, error: null, copied: false };
  }
  async analyze() {
    const { sel } = this.state;
    if (!sel) return;
    this.setState({ busy: true, error: null, result: null });
    try {
      const r = await api.analyzeMove(sel.scope, sel.name, sel.folder);
      this.setState({ result: r, busy: false });
    } catch (e) { this.setState({ busy: false, error: e.error || e.message || 'Could not read that image' }); }
  }
  copy(text) {
    navigator.clipboard.writeText(text).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 1400);
    }).catch(() => {});
  }

  readout() {
    const R = this.state.result;
    const primary = moveOf(R.move);
    const second = moveOf(R.secondary);
    const row = (k, v) => v ? (
      <div style={sx('display:flex;gap:10px;padding:5px 0;border-bottom:1px solid var(--line)')}>
        <span style={{ ...eyebrow('var(--fg-faint)'), minWidth: 92, fontSize: 9 }}>{k}</span>
        <span style={sx('font-size:11.5px;color:var(--fg-soft);flex:1')}>{v}</span>
      </div>
    ) : null;
    const conf = { high: 'var(--ok)', medium: 'var(--warn)', low: 'var(--danger)' }[R.confidence] || 'var(--fg-muted)';
    return (
      <div style={sx('margin-top:18px')}>
        {/* the move, drawn with the picker's own schematic */}
        <div style={sx('display:flex;gap:14px;align-items:stretch')}>
          {[primary, second].filter(Boolean).map((m, i) => (
            <div key={m.id} style={{ ...sx('flex:1;border-radius:12px;padding:12px 14px;background:var(--surface-2)'), border: '1px solid ' + (i ? 'var(--border-2)' : 'var(--accent-35)') }}>
              <div style={sx('display:flex;align-items:baseline;gap:8px;margin-bottom:2px')}>
                <span style={eyebrow(i ? 'var(--fg-faint)' : 'var(--accent)')}>{i ? 'then' : 'dominant'}</span>
                <span style={sx('font-weight:700;font-size:13px')}>{m.name}</span>
                <span style={sx('font-size:10.5px;color:var(--fg-faint)')}>{m.directionLabel}</span>
              </div>
              <Diagram type={m.diagram} />
            </div>
          ))}
          {!primary && (
            <div style={sx('flex:1;border-radius:12px;padding:14px;background:var(--surface-2);border:1px solid var(--border-2);font-size:11.5px;color:var(--warn)')}>
              No move in the library matched this frame confidently — read the beats below and pick one by hand.
            </div>
          )}
        </div>

        <div style={sx('display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:center')}>
          <Chip label={'speed · ' + labelOf(R.speed, MOVE_SPEEDS)} on />
          <Chip label={'rig · ' + labelOf(R.stabilization, MOVE_STABILIZATIONS)} on />
          {R.rig && <Chip label={R.rig} />}
          <span style={{ ...sx('margin-left:auto;font-size:10px'), fontFamily: MONO, color: conf }}>confidence · {R.confidence}</span>
        </div>

        <div style={sx('margin-top:16px')}>
          <span style={eyebrow()}>The read</span>
          <div style={sx('margin-top:6px')}>
            {row('subject', R.subject)}
            {row('subject does', R.subjectMotion)}
            {row('start frame', R.startFrame)}
            {row('end frame', R.endFrame)}
            {row('evidence', R.evidence)}
          </div>
        </div>

        {!!R.beats?.length && (
          <div style={sx('margin-top:16px')}>
            <span style={eyebrow()}>Beats</span>
            <div style={sx('margin-top:6px;display:flex;flex-direction:column;gap:6px')}>
              {R.beats.map((b, i) => (
                <div key={i} style={sx('display:flex;gap:10px;align-items:baseline')}>
                  <span style={{ ...sx('color:var(--accent);min-width:64px'), fontFamily: MONO, fontSize: 10.5, fontVariantNumeric: 'tabular-nums' }}>{b.panels}</span>
                  <span style={sx('font-size:11.5px;color:var(--fg-soft);flex:1')}>{b.what}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!!R.prompt && (
          <div style={sx('margin-top:18px')}>
            <div style={sx('display:flex;align-items:center;gap:10px;margin-bottom:6px')}>
              <span style={eyebrow('var(--ok)')}>Video prompt</span>
              <span style={sx('font-size:10px;color:var(--fg-faint)')}>assembled from the move — same text the picker writes</span>
              <Btn size="sm" variant="ghost" style={{ marginLeft: 'auto' }} onClick={() => this.copy(R.prompt)}>
                {this.state.copied ? 'Copied' : 'Copy'}
              </Btn>
            </div>
            <div style={{ ...sx('border-radius:10px;padding:12px 14px;background:var(--sunk);border:1px solid var(--border);font-size:11.5px;line-height:1.65;color:var(--fg-soft)') }}>
              {R.prompt}
            </div>
          </div>
        )}

        {R.visionModel && <div style={{ ...sx('margin-top:10px;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>read by {R.visionModel} · saved to the asset sidecar</div>}
      </div>
    );
  }

  render() {
    const S = this.state;
    const { app } = this.props;
    return (
      <div>
        <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-bottom:14px')}>
          Point it at a contact sheet — <span style={{ color: 'var(--fg-soft)' }}>References → Video → frames → Open a scene → Build sheet</span> — and it reads the move back out of the panels. A single still works too, but a still cannot show motion.
        </div>

        <div style={sx('display:flex;gap:18px;align-items:flex-start')}>
          <div style={sx('flex:1;min-width:0')}>
            <span style={eyebrow()}>Pick a sheet</span>
            <div style={sx('margin-top:8px')}>
              <AssetPicker app={app} sel={S.sel} rank={isSheet}
                empty="NO IMAGES YET — IMPORT A VIDEO INTO A BOARD FIRST"
                onPick={c => this.setState({ sel: c, result: null, error: null })} />
            </div>
          </div>
          {S.sel && (
            <div style={sx('width:300px;flex-shrink:0')}>
              <span style={eyebrow()}>{isSheet(S.sel) ? 'Contact sheet' : 'Single frame'}</span>
              <img src={assetUrl(S.sel.scope, S.sel.name, S.sel.folder)} alt=""
                style={sx('width:100%;display:block;border-radius:10px;margin-top:8px;border:1px solid var(--border-2)')} />
              <div style={{ ...sx('margin-top:6px;color:var(--fg-faint);word-break:break-all'), fontFamily: MONO, fontSize: 9.5 }}>{S.sel.name}</div>
            </div>
          )}
        </div>

        <div style={sx('display:flex;align-items:center;gap:12px;margin-top:16px')}>
          <Btn variant="primary" busy={S.busy} disabled={!S.sel} onClick={() => this.analyze()}>
            {S.busy ? 'Reading the panels…' : 'Read the camera move'}
          </Btn>
          {!isSheet(S.sel || {}) && S.sel && (
            <span style={sx('font-size:10.5px;color:var(--warn)')}>Not a contact sheet — the read will be a guess from one frame.</span>
          )}
        </div>

        {S.error && <div style={sx('font-size:11.5px;color:var(--danger);margin-top:12px')}>{S.error}</div>}
        {S.result && this.readout()}
      </div>
    );
  }
}
