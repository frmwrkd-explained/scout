// Grid split without leaving the chat (ticket 16).
//
// Two entry points, ONE flow:
//   · a finished generation card offers "Split" when the grid-splitter chat tool is enabled
//     (generationCards.jsx renders <SplitFlow> inline);
//   · the agent proposes a split via a `proposal.split` (or `grid`/`show.grid`) directive — SplitCard
//     resolves the referenced grid generation and mounts the SAME <SplitFlow>, pre-filled from the
//     directive's rows/cols/gutter and its per-cell shot mapping.
//
// The card is registered through registerToolCard('grid-splitter', …), so the enable-notice gate from
// ticket 15 applies automatically: with the grid-splitter tool disabled a split directive shows the
// "enable this tool" card and never this flow. Enablement is read the same way toolRegistry does.
//
// PREVIEW without a dry-run. The split route (POST /api/generations/:pid/:id/split-grid, ticket 06)
// commits on call — there is no dry-run — so the preview is computed CLIENT-SIDE: the uncut sheet is
// shown with a computed overlay grid, using the SAME shared/gridsplit.mjs detector the backend runs
// (detectGrid over a ~600px canvas downscale, mirroring backend detectFromBuffer). The user keeps/skips
// cells and assigns shots on that overlay; Confirm performs the real split once with the chosen
// { rows, cols, gutter, skip, shots }. The route writes the child generations + shot candidates.
import React from 'react';
import { sx } from '../sx';
import { api } from '../api';
import { RenderTile } from '../RenderMedia';
import { registerToolCard, isToolEnabled } from './toolRegistry';
import { CardShell } from './directives';
import { detectGrid, cellRects, cellKey } from '../../shared/gridsplit.mjs';
import { MONO } from '../tokens';

const aspectCss = a => String(a || '16:9').replace(':', '/');

// Read a project's generation records live out of app state (the ProjectGenerate source of truth) —
// same passive-refresh path the generation cards use, so a just-written child appears after app.sync().
function projGens(ctx, pid) {
  try {
    const p = (ctx?.app?.state?.projects || []).find(x => x.id === pid);
    return (p && Array.isArray(p.gens)) ? p.gens : [];
  } catch { return []; }
}

// Client-side detection mirroring backend detectFromBuffer: downscale to ~600px on the long edge and
// score candidate grids with the shared detector. Returns { rows, cols, … } or null.
function detectFromImage(img) {
  try {
    const w = img.naturalWidth || 0, h = img.naturalHeight || 0;
    if (!w || !h) return null;
    const scale = Math.min(1, 600 / Math.max(w, h));
    const sw = Math.max(1, Math.floor(w * scale));
    const sh = Math.max(1, Math.floor(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = sw; canvas.height = sh;
    const cx = canvas.getContext('2d');
    if (!cx) return null;
    cx.drawImage(img, 0, 0, sw, sh);
    const { data } = cx.getImageData(0, 0, sw, sh);
    return detectGrid({ data, width: sw, height: sh });
  } catch { return null; }   // tainted canvas / no 2d ctx → fall back to a plain 3×3 the user can adjust
}

function Chip({ label, onClick, disabled, primary }) {
  return (
    <span onClick={() => !disabled && onClick()} className={primary ? 'hBtnAccent' : 'hBd'}
      style={{ ...sx('font-size:10.5px;font-weight:700;border-radius:7px;padding:5px 12px;cursor:pointer'),
        ...(primary ? { background: 'var(--accent)', color: 'var(--on-accent)' } : { border: '1px solid var(--border-2)', color: 'var(--fg-soft)' }),
        pointerEvents: disabled ? 'none' : 'auto', opacity: disabled ? 0.5 : 1 }}>
      {label}
    </span>
  );
}

const numInput = (value, onChange, min, max) => (
  <input type="number" min={min} max={max} value={value}
    onChange={e => onChange(Math.max(min, Math.min(max, Math.floor(Number(e.target.value) || min))))}
    style={{ ...sx('width:46px;border-radius:6px;border:1px solid var(--border-2);background:var(--void);color:var(--fg);padding:3px 6px;font-size:11px'), fontFamily: MONO }} />
);

// Pull the { 'r-c': shotId } mapping the agent supplied off the directive (several aliases accepted).
function directiveShots(d) {
  const m = (d && (d.shots || d.mapping || d.shotMapping)) || {};
  const out = {};
  if (m && typeof m === 'object') for (const k of Object.keys(m)) if (m[k]) out[String(k)] = String(m[k]);
  return out;
}
function directiveSkip(d) {
  const s = d && (d.skip || d.skipped);
  return Array.isArray(s) ? s.map(String) : [];
}

// The shared split flow. Given a finished grid generation, preview a computed grid, keep/skip cells,
// assign shots, and confirm the server-side split. Used both inline (from a generation card) and by
// the directive-mounted SplitCard below.
export class SplitFlow extends React.Component {
  constructor(props) {
    super(props);
    const pf = props.prefill || {};
    this.state = {
      rows: pf.rows ? Math.max(1, Math.floor(pf.rows)) : 3,
      cols: pf.cols ? Math.max(1, Math.floor(pf.cols)) : 3,
      gutter: pf.gutter != null ? Math.max(0, Math.floor(pf.gutter)) : 0,
      detected: null,
      autoSized: !(pf.rows && pf.cols),      // if the agent fixed rows/cols, don't overwrite from detection
      skipped: new Set((pf.skip || []).map(String)),
      shots: { ...(pf.shots || {}) },
      shotList: [],
      busy: false, result: null, error: null
    };
  }
  componentDidMount() {
    const { pid } = this.props;
    // shots for the compact per-cell selector (pre-fill already applied from the directive mapping)
    if (pid) api.story(pid).then(s => this.setState({ shotList: (s && Array.isArray(s.shots)) ? s.shots : [] })).catch(() => {});
    // client-side detection to seed rows/cols (unless the agent fixed them)
    const gen = this.gen();
    if (gen && gen.file) {
      const img = new Image();
      img.onload = () => {
        const det = detectFromImage(img);
        this.setState(st => (det && st.autoSized) ? { detected: det, rows: det.rows, cols: det.cols } : { detected: det });
      };
      img.src = api.renderUrl(pid, gen.file);
    }
  }
  gen() {
    const { pid, genId } = this.props;
    return projGens(this.props.ctx, pid).find(g => String(g.id) === String(genId)) || null;
  }
  cells() { return cellRects({ width: this.state.cols, height: this.state.rows, rows: this.state.rows, cols: this.state.cols, gutter: 0 }); }
  toggleSkip(key) {
    this.setState(st => { const s = new Set(st.skipped); s.has(key) ? s.delete(key) : s.add(key); return { skipped: s }; });
  }
  setShot(key, shotId) {
    this.setState(st => { const m = { ...st.shots }; if (shotId) m[key] = shotId; else delete m[key]; return { shots: m }; });
  }
  // Only in-range, non-skipped cells contribute a shot mapping; skip is the in-range skipped set.
  confirm() {
    const { pid, genId } = this.props;
    if (!pid || !genId) return;
    const rows = this.state.rows, cols = this.state.cols;
    const inRange = new Set(this.cells().map(c => cellKey(c.r, c.c)));
    const skip = [...this.state.skipped].filter(k => inRange.has(k));
    const shots = {};
    for (const k of Object.keys(this.state.shots)) if (inRange.has(k) && !this.state.skipped.has(k)) shots[k] = this.state.shots[k];
    const app = this.props.ctx?.app;
    this.setState({ busy: true, error: null });
    api.splitGrid(pid, genId, { rows, cols, gutter: this.state.gutter, skip, shots })
      .then(res => {
        this.setState({ busy: false, result: res });
        app?.sync?.();
        app?.showToast?.((res?.count ?? 0) + ' cells split off', 'var(--ok)');
      })
      .catch(e => { this.setState({ busy: false, error: (e && e.message) || 'Split failed' }); app?.showToast?.('Split failed — ' + ((e && e.message) || ''), 'var(--danger)'); });
  }
  openReview() {
    const app = this.props.ctx?.app, pid = this.props.pid;
    if (!app || !pid) return;
    app.openProj?.(pid, 'generate');
    app.setState?.({ genView: 'review' });
  }
  shotLabel(id) {
    const s = this.state.shotList.find(x => String(x.id) === String(id));
    if (!s) return id;
    return (s.no != null ? 'Shot ' + s.no : s.id) + (s.title ? ' · ' + String(s.title).slice(0, 24) : '');
  }
  renderResult() {
    const { result } = this.state;
    const pid = this.props.pid;
    const cells = Array.isArray(result.cells) ? result.cells : [];
    const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(cells.length || 1))));
    return (
      <div>
        <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ok)', marginBottom: 8 }}>
          {result.rows}×{result.cols} → {result.count} candidate{result.count === 1 ? '' : 's'} attached for review
        </div>
        {cells.length ? (
          <div style={{ ...sx('display:grid;gap:6px'), gridTemplateColumns: 'repeat(' + cols + ',1fr)' }}>
            {cells.map(c => (
              <RenderTile key={c.id} aspect={aspectCss(this.gen()?.aspect)} src={api.renderUrl(pid, c.file)} kind="image"
                title={'r' + (c.r + 1) + 'c' + (c.c + 1)}
                footer={c.shot ? (
                  <div style={sx('display:flex;align-items:center;justify-content:center;padding:4px;background:var(--ink);border-top:1px solid var(--surface-2)')}>
                    <span style={{ fontFamily: MONO, fontSize: 9, color: 'var(--ok)' }}>→ {c.shot}</span>
                  </div>
                ) : null} />
            ))}
          </div>
        ) : null}
        <div style={sx('display:flex;align-items:center;gap:9px;margin-top:11px')}>
          <Chip primary label="Open in review" onClick={() => this.openReview()} disabled={!pid} />
        </div>
      </div>
    );
  }
  render() {
    const gen = this.gen();
    const { pid, genId } = this.props;
    if (!genId) return <span style={sx('font-size:11.5px;color:var(--fg-muted)')}>no generation id to split</span>;
    if (!gen) return <span style={sx('font-size:11.5px;color:var(--fg-muted)')}>grid generation unavailable ({genId})</span>;
    if (gen.status !== 'done' || !gen.file) return <span style={sx('font-size:11.5px;color:var(--fg-muted)')}>generation has no finished render to split yet</span>;
    if (this.state.result) return this.renderResult();

    const { rows, cols, detected, skipped } = this.state;
    const src = api.renderUrl(pid, gen.file);
    const cells = this.cells();
    const keptCount = cells.filter(c => !skipped.has(cellKey(c.r, c.c))).length;
    return (
      <div>
        {/* preview: uncut sheet + computed overlay grid — click a cell to keep/skip */}
        <div style={{ ...sx('position:relative;border-radius:8px;overflow:hidden;background:var(--sunk)'), aspectRatio: aspectCss(gen.aspect) }}>
          <img src={src} alt="" style={sx('width:100%;height:100%;object-fit:contain;display:block')} />
          <div style={{ ...sx('position:absolute;inset:0;display:grid'), gridTemplateColumns: 'repeat(' + cols + ',1fr)', gridTemplateRows: 'repeat(' + rows + ',1fr)' }}>
            {cells.map(c => {
              const key = cellKey(c.r, c.c);
              const isSkip = skipped.has(key);
              const hasShot = !!this.state.shots[key];
              return (
                <div key={key} onClick={() => this.toggleSkip(key)}
                  style={{ ...sx('position:relative;cursor:pointer;display:flex;align-items:flex-start;justify-content:space-between;padding:3px'),
                    border: '1px solid ' + (isSkip ? 'rgba(240,91,84,.5)' : 'var(--accent-60)'),
                    background: isSkip ? 'rgba(10,11,14,.66)' : 'transparent' }}>
                  <span style={{ fontFamily: MONO, fontSize: 8.5, color: isSkip ? 'var(--danger)' : 'var(--accent)', background: 'rgba(6,7,10,.6)', padding: '0 3px', borderRadius: 3 }}>
                    {isSkip ? 'skip' : 'r' + (c.r + 1) + 'c' + (c.c + 1)}
                  </span>
                  {hasShot ? <span style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--ok)', background: 'rgba(6,7,10,.6)', padding: '0 3px', borderRadius: 3 }}>◆</span> : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* grid controls */}
        <div style={sx('display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:10px')}>
          <label style={sx('display:flex;align-items:center;gap:5px;font-size:10.5px;color:var(--fg-muted)')}>rows {numInput(rows, v => this.setState({ rows: v, autoSized: false }), 1, 6)}</label>
          <label style={sx('display:flex;align-items:center;gap:5px;font-size:10.5px;color:var(--fg-muted)')}>cols {numInput(cols, v => this.setState({ cols: v, autoSized: false }), 1, 6)}</label>
          <label style={sx('display:flex;align-items:center;gap:5px;font-size:10.5px;color:var(--fg-muted)')}>gutter% {numInput(this.state.gutter, v => this.setState({ gutter: v }), 0, 40)}</label>
          {detected ? <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>detected {detected.rows}×{detected.cols}</span> : null}
          <span style={sx('margin-left:auto;font-size:10px;color:var(--fg-muted)')}>{keptCount} keep / {cells.length - keptCount} skip</span>
        </div>

        {/* compact shot assignment for kept cells */}
        {keptCount ? (
          <div style={sx('display:flex;flex-direction:column;gap:5px;margin-top:9px;max-height:150px;overflow:auto')}>
            {cells.filter(c => !skipped.has(cellKey(c.r, c.c))).map(c => {
              const key = cellKey(c.r, c.c);
              return (
                <div key={key} style={sx('display:flex;align-items:center;gap:8px')}>
                  <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-muted)', flex: 'none', width: 40 }}>r{c.r + 1}c{c.c + 1}</span>
                  <select value={this.state.shots[key] || ''} onChange={e => this.setShot(key, e.target.value)}
                    style={{ ...sx('flex:1;min-width:0;border-radius:6px;border:1px solid var(--border-2);background:var(--void);color:var(--fg-soft);padding:3px 6px;font-size:10.5px'), fontFamily: MONO }}>
                    <option value="">— no shot —</option>
                    {this.state.shotList.map(s => <option key={s.id} value={s.id}>{this.shotLabel(s.id)}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        ) : null}

        {this.state.error ? <div style={sx('font-size:11px;color:var(--danger);margin-top:8px')}>{this.state.error}</div> : null}
        <div style={sx('display:flex;align-items:center;gap:9px;margin-top:11px')}>
          <Chip primary label={this.state.busy ? 'Splitting…' : 'Confirm split (' + keptCount + ')'}
            onClick={() => this.confirm()} disabled={this.state.busy || !keptCount} />
        </div>
      </div>
    );
  }
}

// Resolve the grid generation id a split directive points at. `ref`/`id`/`generation` accepted; the
// project comes off the directive or the chat context.
function splitGenId(d) {
  const raw = d && (d.ref !== undefined ? d.ref : d.id !== undefined ? d.id : d.generation !== undefined ? d.generation : d.gen);
  const one = Array.isArray(raw) ? raw[0] : raw;
  return one != null ? String(one) : null;
}
const splitPid = (d, ctx) => (d && (d.project || d.pid)) || (ctx || {}).pid || null;

// The directive-mounted card. Registered through the chat-tools registry under 'grid-splitter' so the
// enable-notice gate applies. Pre-fills the flow from the agent's rows/cols/gutter + shot mapping.
export function SplitCard({ directive, ctx }) {
  const pid = splitPid(directive, ctx);
  const genId = splitGenId(directive);
  const prefill = {
    rows: directive && directive.rows != null ? Number(directive.rows) : null,
    cols: directive && directive.cols != null ? Number(directive.cols) : null,
    gutter: directive && directive.gutter != null ? Number(directive.gutter) : null,
    skip: directiveSkip(directive),
    shots: directiveShots(directive)
  };
  return (
    <CardShell label="grid split" right={genId ? <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>{genId}</span> : null}>
      {!genId
        ? <span style={sx('font-size:11.5px;color:var(--fg-muted)')}>no grid generation id in the split directive</span>
        : <SplitFlow pid={pid} genId={genId} ctx={ctx} prefill={prefill} />}
    </CardShell>
  );
}

registerToolCard('grid-splitter', (directive, ctx) => <SplitCard directive={directive} ctx={ctx} />);
