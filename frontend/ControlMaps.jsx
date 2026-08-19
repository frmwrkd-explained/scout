// Control Maps — take any character still / approved frame and derive geometry-conditioning
// maps from it (depth, edges, pose skeleton, cutout matte) through the FAL preprocessors.
// Maps are written server-side to library/control/ with a .meta.md sidecar.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { assetUrl } from './Moodboard';
import { MONO } from './tokens';

const AMBER = 'var(--accent)';
const GREEN = 'var(--ok)';
const RED = 'var(--danger)';

const eyebrow = (color = 'var(--fg-muted)') => ({
  ...sx('font-weight:700;text-transform:uppercase'),
  fontFamily: MONO, fontSize: 10, letterSpacing: '.16em', color
});

const GROUP_ORDER = ['Depth', 'Edges', 'Pose', 'Cutout'];

export default class ControlMaps extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      kinds: [], maps: [],
      sel: null, kind: 'depth-balanced',
      busy: false, result: null,
      wipe: 50, drag: false, uploading: false
    };
    this.wipeRef = React.createRef();
  }
  componentDidMount() {
    this._alive = true;
    this.load();
  }
  componentWillUnmount() { this._alive = false; }
  // every setState below can land after an await — leaving the panel mid-derive must not
  // write into an unmounted component.
  set(patch) { if (this._alive) this.setState(patch); }
  async load() {
    try {
      const kinds = await api.controlKinds();
      this.set({ kinds: Array.isArray(kinds) ? kinds : [] });
    } catch { /* catalogue optional */ }
    this.loadMaps();
  }
  async loadMaps() {
    try {
      const maps = await api.controlMaps();
      this.set({ maps: Array.isArray(maps) ? maps : [] });
    } catch { /* none yet */ }
  }

  // ── source ──
  pool() {
    const { app } = this.props;
    const out = [];
    (app.state.library.items || []).forEach(c => { if (c.type === 'image') out.push({ ...c, scope: 'library' }); });
    (app.state.projects || []).forEach(p => ((p.context || {}).items || []).forEach(c => {
      if (c.type === 'image') out.push({ ...c, scope: p.id });
    }));
    return out;
  }
  async onFile(f) {
    const { app } = this.props;
    if (!f || !f.type.startsWith('image/')) return;
    this.setState({ uploading: true });
    try {
      const saved = await api.uploadLibrary(f, 'control-src');
      if (!saved || !saved.name) throw new Error('the server returned no file');
      await app.sync();
      this.set({ sel: { scope: 'library', name: saved.name, folder: saved.folder || 'control-src' }, result: null });
      app.showToast('Uploaded to library/' + (saved.folder || 'control-src'), GREEN);
    } catch (e) {
      app.showToast('Upload failed — ' + (e.message || ''), RED);
    }
    this.set({ uploading: false });
  }

  // ── derive ──
  async derive() {
    const { app } = this.props;
    const S = this.state;
    if (S.busy) return;
    if (!S.sel) return app.showToast('Pick a source frame first', AMBER);
    this.setState({ busy: true, result: null });
    try {
      const rec = await api.deriveControl({ scope: S.sel.scope, name: S.sel.name, folder: S.sel.folder || '', kind: S.kind });
      if (!rec || !rec.url) throw new Error('the server returned no map');
      this.set({ result: rec, wipe: 50 });
      app.showToast('Map derived — library/control/' + rec.name, GREEN);
      this.loadMaps();
    } catch (e) {
      app.showToast('Derive failed — ' + (e.message || ''), RED);
    }
    this.set({ busy: false });
  }
  async remove(name) {
    try { await api.deleteControl(name); } catch { /* already gone */ }
    if (this.state.result && this.state.result.name === name) this.set({ result: null });
    this.loadMaps();
  }
  copy(text, what) {
    if (!text) return this.props.app.showToast('Nothing to copy', RED);
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => { });
    this.props.app.showToast(what + ' copied', AMBER);
  }
  download(rec) {
    const a = document.createElement('a');
    a.href = rec.url;
    a.download = rec.name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }
  // drag-to-wipe. Takes the raw clientX rather than the synthetic event so mousedown and
  // mousemove can share it (a React event object must not be held past the handler).
  setWipeAt(clientX) {
    const el = this.wipeRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    this.setState({ wipe: Math.max(0, Math.min(100, Math.round((clientX - r.left) / r.width * 100))) });
  }

  // ── panels ──
  renderSource() {
    const S = this.state;
    const pool = this.pool();
    return (
      <div style={sx('display:flex;flex-direction:column;gap:12px')}>
        <div style={eyebrow()}>Source frame</div>
        <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:7px;max-height:320px;overflow-y:auto')}>
          {pool.map(c => {
            const on = S.sel && S.sel.scope === c.scope && S.sel.name === c.name && (S.sel.folder || '') === (c.folder || '');
            return (
              <div key={c.scope + '/' + (c.folder || '') + '/' + c.name} title={c.name}
                onClick={() => this.setState({ sel: { scope: c.scope, name: c.name, folder: c.folder || '' }, result: null })}
                className="hBd" style={{ ...sx('aspect-ratio:1;border-radius:8px;overflow:hidden;cursor:pointer;background:var(--surface)'), border: '1.5px solid ' + (on ? AMBER : 'var(--border)') }}>
                <img src={assetUrl(c.scope, c.name, c.folder)} alt="" loading="lazy" style={sx('width:100%;height:100%;object-fit:cover')} />
              </div>
            );
          })}
          {!pool.length && (
            <div style={sx('grid-column:1/-1;font-size:11px;color:var(--fg-faint);padding:12px 0;line-height:1.6')}>
              No stills on any board yet — drop one below and it lands in the library.
            </div>
          )}
        </div>

        <div onDragOver={e => { e.preventDefault(); this.setState({ drag: true }); }}
          onDragLeave={() => this.setState({ drag: false })}
          onDrop={e => { e.preventDefault(); this.setState({ drag: false }); this.onFile(e.dataTransfer.files[0]); }}
          onClick={() => this.fileInput && this.fileInput.click()}
          style={{ ...sx('border-radius:12px;padding:20px 14px;text-align:center;cursor:pointer'), border: '1px dashed ' + (S.drag ? AMBER : 'var(--border-2)'), background: S.drag ? 'var(--accent-05)' : 'var(--surface)' }}>
          <div style={{ fontFamily: MONO, fontSize: 10.5, color: S.uploading ? AMBER : 'var(--fg-muted)', animation: S.uploading ? 'dl-pulse 1.1s infinite' : 'none' }}>
            {S.uploading ? 'Uploading…' : 'Drop a still — or click to browse'}
          </div>
          <div style={{ ...sx('margin-top:5px'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)' }}>uploads to library/control-src</div>
          <input ref={el => this.fileInput = el} type="file" accept="image/*" style={sx('display:none')}
            onChange={e => this.onFile(e.target.files[0])} />
        </div>

        {S.sel && (
          <div style={sx('border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:10px;display:flex;gap:10px;align-items:center')}>
            <img src={assetUrl(S.sel.scope, S.sel.name, S.sel.folder)} alt=""
              style={sx('width:52px;height:52px;object-fit:cover;border-radius:7px;flex:none')} />
            <div style={sx('min-width:0')}>
              <div style={{ ...sx('overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg)'), fontFamily: MONO, fontSize: 10.5 }}>{S.sel.name}</div>
              <div style={{ ...sx('margin-top:3px;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9 }}>
                {S.sel.scope}{S.sel.folder ? ' / ' + S.sel.folder : ''}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  renderKinds() {
    const S = this.state;
    const groups = GROUP_ORDER.filter(g => S.kinds.some(k => k.group === g));
    return (
      <div style={sx('display:flex;flex-direction:column;gap:16px')}>
        <div style={eyebrow()}>Map type</div>
        {!S.kinds.length && <div style={sx('font-size:11px;color:var(--fg-faint)')}>Loading the catalogue…</div>}
        {groups.map(g => (
          <div key={g}>
            <div style={{ ...eyebrow('var(--fg-muted)'), ...sx('margin-bottom:7px') }}>{g}</div>
            <div style={sx('display:flex;flex-direction:column;gap:6px')}>
              {S.kinds.filter(k => k.group === g).map(k => {
                const on = S.kind === k.id;
                return (
                  <div key={k.id} onClick={() => this.setState({ kind: k.id, result: null })} className="hBd"
                    style={{ ...sx('border-radius:8px;padding:9px 11px;cursor:pointer'), background: on ? 'var(--accent-05)' : 'var(--surface)', border: '1px solid ' + (on ? AMBER : 'var(--border)') }}>
                    <div style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 700, color: on ? AMBER : 'var(--fg-soft)' }}>{k.label}</div>
                    <div style={sx('font-size:10.5px;color:var(--fg-faint);line-height:1.55;margin-top:4px')}>{k.blurb}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div onClick={() => this.derive()} className={S.busy ? '' : 'hBtnAccent'}
          style={{ ...sx('text-align:center;padding:10px 0;border-radius:7px;font-weight:700'), fontFamily: MONO, fontSize: 10.5, letterSpacing: '.08em', cursor: S.busy ? 'not-allowed' : 'pointer', background: S.busy ? 'var(--raise)' : AMBER, color: S.busy ? 'var(--fg-faint)' : 'var(--on-accent)' }}>
          {S.busy ? 'DERIVING…' : 'DERIVE MAP'}
        </div>
        <div style={{ ...sx('border-top:1px dashed var(--border);padding-top:10px;line-height:1.6;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>
          the still is pushed to the fal CDN once, then reused for every later derive of the same frame.
        </div>
      </div>
    );
  }

  renderResult() {
    const S = this.state;
    const rec = S.result;
    const kind = S.kinds.find(k => k.id === (rec ? rec.kind : S.kind));
    // the A/B wipe only means anything when the loaded source IS the frame this map came from —
    // clicking an older map off the shelf can leave a different still selected.
    const sameSrc = !!(rec && S.sel && S.sel.name === rec.source && S.sel.scope === rec.sourceScope);
    const isDepth = !!(rec && String(rec.kind).startsWith('depth')) && sameSrc;
    const srcUrl = sameSrc ? assetUrl(S.sel.scope, S.sel.name, S.sel.folder) : '';

    if (S.busy) {
      return (
        <div style={sx('border:1px dashed var(--accent-35);border-radius:12px;padding:60px 20px;text-align:center')}>
          <div style={{ ...sx('font-weight:700;color:var(--accent);letter-spacing:.1em;animation:dl-pulse 1.1s infinite'), fontFamily: MONO, fontSize: 11 }}>◈ READING THE GEOMETRY…</div>
          <div style={sx('font-size:11px;color:var(--fg-faint);margin-top:7px')}>3-20s depending on the model. The frame is uploaded, preprocessed and pulled back into the library.</div>
        </div>
      );
    }
    if (!rec) {
      return (
        <div style={sx('border:1px dashed var(--border-2);border-radius:12px;padding:52px 20px;text-align:center')}>
          <div style={{ ...sx('font-weight:700;color:var(--fg-muted);letter-spacing:.1em'), fontFamily: MONO, fontSize: 11 }}>NO MAP YET — PICK A FRAME, PICK A MAP, DERIVE</div>
          <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-top:6px;line-height:1.6')}>
            A depth or pose map is how you keep the blocking of a shot you already approved while everything else changes.
          </div>
        </div>
      );
    }
    return (
      <div style={sx('display:flex;flex-direction:column;gap:12px')}>
        <div style={sx('display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
          <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 700, color: AMBER }}>{kind ? kind.label : rec.kind}</span>
          <span style={{ ...sx('color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>{rec.endpoint}</span>
          {rec.width > 0 && <span style={{ ...sx('color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>{rec.width}×{rec.height}</span>}
        </div>

        {isDepth && srcUrl ? (
          <div>
            <div ref={this.wipeRef} onMouseDown={e => this.setWipeAt(e.clientX)}
              onMouseMove={e => { if (e.buttons === 1) this.setWipeAt(e.clientX); }}
              style={sx('position:relative;border-radius:12px;overflow:hidden;border:1px solid var(--line);background:var(--void);cursor:ew-resize;user-select:none')}>
              <img src={srcUrl} alt="" style={sx('width:100%;display:block')} />
              <img src={rec.url} alt="" style={{ ...sx('position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block'), clipPath: 'inset(0 0 0 ' + S.wipe + '%)' }} />
              <div style={{ ...sx('position:absolute;top:0;bottom:0;width:1px;background:var(--accent);pointer-events:none'), left: S.wipe + '%' }} />
              <span style={{ ...sx('position:absolute;bottom:8px;left:8px;background:rgba(5,6,8,.75);border-radius:4px;padding:2px 7px'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-soft)' }}>SOURCE</span>
              <span style={{ ...sx('position:absolute;bottom:8px;right:8px;background:rgba(5,6,8,.75);border-radius:4px;padding:2px 7px'), fontFamily: MONO, fontSize: 9, color: AMBER }}>DEPTH</span>
            </div>
            <input type="range" min="0" max="100" value={S.wipe} onChange={e => this.setState({ wipe: +e.target.value })}
              style={sx('width:100%;accent-color:var(--accent);margin-top:9px')} />
          </div>
        ) : (
          <div style={sx('border-radius:12px;overflow:hidden;border:1px solid var(--line);background:var(--void)')}>
            <img src={rec.url} alt="" style={sx('width:100%;display:block')} />
          </div>
        )}

        <div style={sx('display:flex;gap:8px;flex-wrap:wrap;align-items:center')}>
          <span onClick={() => this.download(rec)} className="hBd"
            style={{ ...sx('border:1px solid var(--border-2);border-radius:99px;padding:5px 13px;cursor:pointer;color:var(--fg-soft)'), fontFamily: MONO, fontSize: 10 }}>↓ Download</span>
          <span onClick={() => this.copy(rec.falUrl, 'FAL url')} className="hBd"
            style={{ ...sx('border:1px solid var(--border-2);border-radius:99px;padding:5px 13px;cursor:pointer;color:var(--fg-soft)'), fontFamily: MONO, fontSize: 10 }}>Copy FAL url</span>
          {rec.maskUrl && (
            <span onClick={() => this.copy(rec.maskUrl, 'Mask url')} className="hBd"
              style={{ ...sx('border:1px solid var(--border-2);border-radius:99px;padding:5px 13px;cursor:pointer;color:var(--fg-soft)'), fontFamily: MONO, fontSize: 10 }}>Copy mask url</span>
          )}
          <span onClick={() => this.remove(rec.name)} className="hBgRed"
            style={{ ...sx('border:1px solid var(--border-2);border-radius:99px;padding:5px 13px;cursor:pointer;margin-left:auto'), fontFamily: MONO, fontSize: 10, color: RED }}>Delete</span>
        </div>
        <div style={{ ...sx('color:var(--fg-faint);line-height:1.6'), fontFamily: MONO, fontSize: 9.5 }}>
          library/control/{rec.name} — paste the FAL url into the generate composer as a reference.
        </div>
      </div>
    );
  }

  renderShelf() {
    const S = this.state;
    if (!S.maps.length) return null;
    return (
      <div style={sx('margin-top:22px')}>
        <div style={{ ...eyebrow(), ...sx('margin-bottom:10px') }}>
          Derived maps <span style={{ color: AMBER }}>{S.maps.length}</span>
        </div>
        <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:9px')}>
          {S.maps.map(m => (
            <div key={m.name} className="ctxTile" style={sx('aspect-ratio:1;cursor:pointer')}
              onClick={() => this.setState({
                result: m, kind: m.kind || S.kind, wipe: 50,
                // re-point the source so the A/B wipe compares this map against its own frame
                sel: m.source ? { scope: m.sourceScope || 'library', name: m.source, folder: m.sourceFolder || '' } : S.sel
              })} title={m.source + ' → ' + m.kind}>
              <img src={m.url} alt="" loading="lazy" />
              <span style={{ ...sx('position:absolute;top:6px;left:6px;background:rgba(5,6,8,.78);border-radius:4px;padding:1px 6px'), fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-soft)' }}>{m.kind}</span>
              <span onClick={e => { e.stopPropagation(); this.remove(m.name); }} className="hDel"
                style={{ ...sx('position:absolute;top:6px;right:6px;width:20px;height:20px;border-radius:6px;display:flex;align-items:center;justify-content:center;background:rgba(5,6,8,.75);cursor:pointer;z-index:2'), fontSize: 10, color: RED }}>✕</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  render() {
    return (
      <div style={sx('padding:22px 28px 90px')}>
        <div style={sx('display:flex;align-items:baseline;gap:12px;margin-bottom:4px')}>
          <div style={sx('font-weight:700;font-size:16px')}>Control Maps</div>
          <span style={sx('font-size:12px;color:var(--fg-faint)')}>any still → depth, edges, pose skeleton or cutout matte</span>
        </div>
        <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-bottom:18px;line-height:1.6')}>
          These maps let a model reuse the exact geometry and blocking of a frame you already approved,
          instead of re-rolling the composition and hoping it lands the same way twice.
        </div>

        <div style={sx('display:grid;grid-template-columns:300px 280px minmax(0,1fr);gap:22px;align-items:start')}>
          <div style={sx('position:sticky;top:16px')}>{this.renderSource()}</div>
          <div style={sx('position:sticky;top:16px')}>{this.renderKinds()}</div>
          <div>
            {this.renderResult()}
            {this.renderShelf()}
          </div>
        </div>
      </div>
    );
  }
}
