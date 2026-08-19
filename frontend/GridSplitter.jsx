// Grid Splitter — cut AI contact sheets (2x2, 3x3, turnarounds, storyboard grids)
// into individual frames on canvas. 100% client-side; auto-detects the grid, per-cell
// keep/skip, downloads single cells or every kept cell as one dependency-free .zip.
import React from 'react';
import { sx } from './sx';
// Detection/scoring/cell-geometry live once in shared/gridsplit.mjs — imported by BOTH this tool page
// and the backend split route (backend/gridsplit.mjs), so the same grid math runs on either side.
import { detectGrid, cellRects } from '../shared/gridsplit.mjs';
import { MONO } from './tokens';

const ACCENT = 'var(--accent)';

// ── auto grid detection ─────────────────────────────────────────────────
// Downscale the image on a canvas to a ~600px analysis pass, then hand the RGBA pixels to the shared
// detectGrid core (which scores edge energy on the cut lines + a common-aspect bonus). Returns the
// winner plus the runner-up so the UI can show how decisive the call was.
function pickBestGrid(imgEl) {
  const w = imgEl.naturalWidth, h = imgEl.naturalHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, 600 / Math.max(w, h));
  const sw = Math.max(1, Math.floor(w * scale));
  const sh = Math.max(1, Math.floor(h * scale));
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(imgEl, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh).data;
  return detectGrid({ data, width: sw, height: sh });
}

// ── minimal ZIP writer (STORE, no deflate) ──────────────────────────────
// JPEGs are already compressed, so STORE matches deflate output while staying
// fast and dependency-free. Spec: PKZIP APPNOTE §4. No Zip64. Names are the
// user's filename, so they can be non-ASCII — see UTF8_FLAG below.
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function dataUrlToBytes(url) {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// General-purpose bit 11: names are UTF-8. TextEncoder always emits UTF-8, so without
// this an accented/CJK source filename unzips as CP437 mojibake.
const UTF8_FLAG = 0x800;

// entries: [{ name, bytes: Uint8Array }] → Blob
function buildZip(entries) {
  const encoder = new TextEncoder();
  const { time, date } = dosTime(new Date());
  const resolved = entries.map(e => {
    const nameBytes = encoder.encode(e.name);
    return { nameBytes, bytes: e.bytes, crc: crc32(e.bytes) };
  });
  const parts = [], central = [];
  let offset = 0;
  for (const r of resolved) {
    const lh = new Uint8Array(30 + r.nameBytes.length);
    const lhv = new DataView(lh.buffer);
    lhv.setUint32(0, 0x04034b50, true);
    lhv.setUint16(4, 20, true);
    lhv.setUint16(6, UTF8_FLAG, true);
    lhv.setUint16(8, 0, true); // STORE
    lhv.setUint16(10, time, true);
    lhv.setUint16(12, date, true);
    lhv.setUint32(14, r.crc, true);
    lhv.setUint32(18, r.bytes.length, true);
    lhv.setUint32(22, r.bytes.length, true);
    lhv.setUint16(26, r.nameBytes.length, true);
    lhv.setUint16(28, 0, true);
    lh.set(r.nameBytes, 30);
    parts.push(lh, r.bytes);

    const cd = new Uint8Array(46 + r.nameBytes.length);
    const cdv = new DataView(cd.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, UTF8_FLAG, true);
    cdv.setUint16(10, 0, true); // STORE
    cdv.setUint16(12, time, true);
    cdv.setUint16(14, date, true);
    cdv.setUint32(16, r.crc, true);
    cdv.setUint32(20, r.bytes.length, true);
    cdv.setUint32(24, r.bytes.length, true);
    cdv.setUint16(28, r.nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    cd.set(r.nameBytes, 46);
    central.push(cd);
    offset += lh.length + r.bytes.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const eocdv = new DataView(eocd.buffer);
  eocdv.setUint32(0, 0x06054b50, true);
  eocdv.setUint16(4, 0, true);
  eocdv.setUint16(6, 0, true);
  eocdv.setUint16(8, resolved.length, true);
  eocdv.setUint16(10, resolved.length, true);
  eocdv.setUint32(12, centralSize, true);
  eocdv.setUint32(16, offset, true);
  eocdv.setUint16(20, 0, true);
  return new Blob(parts.concat(central, [eocd]), { type: 'application/zip' });
}

export default class GridSplitter extends React.Component {
  constructor(props) {
    super(props);
    this.state = { fileName: '', preview: '', rows: 3, cols: 3, gutter: 0, cells: [], drag: false, skip: {}, detect: null, zipping: false };
    this.imgRef = React.createRef();
    this.timers = []; // pending download/zip timeouts, cleared on unmount
  }
  componentDidUpdate(prevProps, prevState) {
    const S = this.state;
    if (S.preview && (prevState.preview !== S.preview || prevState.rows !== S.rows || prevState.cols !== S.cols || prevState.gutter !== S.gutter)) {
      this.split();
    }
    // a different grid means different panels — old keep/skip picks no longer map to anything
    if ((prevState.preview !== S.preview || prevState.rows !== S.rows || prevState.cols !== S.cols) && Object.keys(S.skip).length) {
      this.setState({ skip: {} });
    }
  }
  onFile(f) {
    if (!f || !f.type.startsWith('image/')) return;
    if (this.state.preview) URL.revokeObjectURL(this.state.preview);
    this.setState({ fileName: f.name, preview: URL.createObjectURL(f), cells: [], skip: {}, detect: null });
  }
  split() {
    const img = this.imgRef.current;
    if (!img) return;
    const run = () => {
      const { rows, cols, gutter } = this.state;
      const w = img.naturalWidth, h = img.naturalHeight;
      // gutter is % of a cell trimmed off each inner edge (kills grid lines / borders) — geometry
      // comes from the shared cellRects core so the tool and the backend split identically.
      const cells = [];
      for (const rect of cellRects({ width: w, height: h, rows, cols, gutter })) {
        const canvas = document.createElement('canvas');
        canvas.width = rect.sw; canvas.height = rect.sh;
        const cctx = canvas.getContext('2d');
        if (!cctx) return;
        cctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.sw, rect.sh);
        cells.push({ r: rect.r, c: rect.c, url: canvas.toDataURL('image/jpeg', 0.92) });
      }
      this.setState({ cells });
    };
    // not-yet-loaded is covered by the <img onLoad> calling split() again — a second
    // img.onload here made every sheet split twice (rows×cols canvases + JPEGs, twice)
    if (img.complete && img.naturalWidth) run();
  }
  autoDetect() {
    const img = this.imgRef.current;
    if (!img || !img.complete || !img.naturalWidth) {
      this.props.app.showToast('Drop a grid image first', 'var(--danger)');
      return;
    }
    const best = pickBestGrid(img);
    if (!best) { this.props.app.showToast('Could not read that image', 'var(--danger)'); return; }
    this.setState({ rows: best.rows, cols: best.cols, detect: best });
    this.props.app.showToast('Detected ' + best.rows + '×' + best.cols + ' grid', ACCENT);
  }
  cellKey(cell) { return cell.r + '-' + cell.c; }
  keptCells() { return this.state.cells.filter(c => !this.state.skip[this.cellKey(c)]); }
  toggleCell(cell) {
    const k = this.cellKey(cell);
    this.setState(s => {
      const skip = { ...s.skip };
      if (skip[k]) delete skip[k]; else skip[k] = 1;
      return { skip };
    });
  }
  setAllKeep(keep) {
    if (keep) { this.setState({ skip: {} }); return; }
    const skip = {};
    this.state.cells.forEach(c => { skip[this.cellKey(c)] = 1; });
    this.setState({ skip });
  }
  componentWillUnmount() {
    // stop queued downloads / the zip pass — otherwise they fire anchors and setState
    // on a component the user has already navigated away from
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.state.preview) URL.revokeObjectURL(this.state.preview);
  }
  baseName() { return this.state.fileName.replace(/\.[^.]+$/, '') || 'grid'; }
  downloadCell(cell) {
    const a = document.createElement('a');
    a.href = cell.url;
    a.download = this.baseName() + '_r' + (cell.r + 1) + 'c' + (cell.c + 1) + '.jpg';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }
  downloadAll() {
    this.state.cells.forEach((cell, i) => this.timers.push(setTimeout(() => this.downloadCell(cell), i * 120)));
    this.props.app.showToast(this.state.cells.length + ' frames downloading', ACCENT);
  }
  downloadZip() {
    const kept = this.keptCells();
    if (!kept.length) { this.props.app.showToast('Every cell is skipped — nothing to zip', 'var(--danger)'); return; }
    this.setState({ zipping: true });
    // one tick so the button state paints before the synchronous crc/zip pass
    this.timers.push(setTimeout(() => {
      try {
        const base = this.baseName();
        const entries = kept.map(cell => ({
          name: base + '-r' + (cell.r + 1) + 'c' + (cell.c + 1) + '.jpg',
          bytes: dataUrlToBytes(cell.url)
        }));
        const blob = buildZip(entries);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = base + '-frames.zip';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 200);
        this.props.app.showToast(kept.length + ' frames zipped', 'var(--ok)');
      } catch (e) {
        this.props.app.showToast('Zip failed — ' + (e.message || 'unknown error'), 'var(--danger)');
      }
      this.setState({ zipping: false });
    }, 20));
  }
  render() {
    const S = this.state;
    const kept = this.keptCells().length;
    const eyebrow = (color = 'var(--fg-muted)') => ({ ...sx('font-weight:700;text-transform:uppercase'), fontFamily: MONO, fontSize: 10, letterSpacing: '.16em', color });
    const num = (label, key, min, max) => (
      <div key={key}>
        <div style={{ ...eyebrow('var(--fg-muted)'), ...sx('margin-bottom:6px') }}>{label} — {S[key]}{key === 'gutter' ? '%' : ''}</div>
        <input type="range" min={min} max={max} value={S[key]} onChange={e => this.setState({ [key]: +e.target.value })} style={sx('width:100%;accent-color:var(--accent)')} />
      </div>
    );
    const presets = [[2, 2], [3, 3], [1, 3], [3, 1], [2, 3], [4, 4]];
    return (
      <div style={sx('padding:22px 28px 90px')}>
        <div style={sx('display:flex;align-items:baseline;gap:12px;margin-bottom:4px')}>
          <div style={sx('font-weight:700;font-size:16px')}>Grid Splitter</div>
          <span style={sx('font-size:12px;color:var(--fg-faint)')}>cut AI contact sheets & turnarounds into single frames — 100% in-browser</span>
        </div>
        <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-bottom:16px')}>Drop a 3x3 contact sheet or character turnaround, auto-detect or set the grid, trim the gutters, skip bad panels, download frames.</div>

        <div style={sx('display:grid;grid-template-columns:260px minmax(0,1fr);gap:22px;align-items:start')}>
          <div style={sx('position:sticky;top:16px;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:14px;display:flex;flex-direction:column;gap:14px')}>
            <div>
              <div style={{ ...eyebrow(), ...sx('margin-bottom:8px') }}>Grid</div>
              <div style={sx('display:flex;gap:4px;flex-wrap:wrap')}>
                {presets.map(([r, c]) => {
                  const on = S.rows === r && S.cols === c;
                  return <span key={r + 'x' + c} onClick={() => this.setState({ rows: r, cols: c })}
                    style={{ ...sx('padding:4px 11px;border-radius:6px;cursor:pointer'), fontFamily: MONO, fontSize: 10, fontVariantNumeric: 'tabular-nums', color: on ? 'var(--on-accent)' : 'var(--fg-muted)', background: on ? 'var(--fg)' : 'var(--surface-2)', border: '1px solid ' + (on ? 'var(--fg)' : 'var(--border)'), fontWeight: on ? 700 : 400 }}>{r}×{c}</span>;
                })}
              </div>
              <div onClick={() => this.autoDetect()} className="hBd" style={{ ...sx('margin-top:8px;text-align:center;padding:7px 0;border:1px solid var(--border-2);border-radius:7px;color:var(--fg-soft);cursor:pointer'), fontFamily: MONO, fontSize: 10, opacity: S.preview ? 1 : .45 }}>AUTO-DETECT GRID</div>
              {S.detect && (
                <div style={{ ...sx('margin-top:6px;line-height:1.5'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)', fontVariantNumeric: 'tabular-nums' }}>
                  best <span style={{ color: ACCENT }}>{S.detect.rows}×{S.detect.cols}</span> · score {S.detect.score.toFixed(1)}
                  {S.detect.runnerUp ? ' · +' + S.detect.margin.toFixed(1) + ' over ' + S.detect.runnerUp.rows + '×' + S.detect.runnerUp.cols : ''}
                </div>
              )}
            </div>
            {num('Rows', 'rows', 1, 6)}
            {num('Columns', 'cols', 1, 6)}
            {num('Gutter trim', 'gutter', 0, 12)}
            <div style={{ ...sx('border-top:1px dashed var(--border);padding-top:10px;line-height:1.5;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>
              gutter trim shaves the inner edges of every cell — use it to remove grid lines baked into AI sheets. auto-detect scores 2×2…5×5 against common cell aspects.
            </div>
            {S.cells.length > 0 && (
              <div style={sx('display:flex;flex-direction:column;gap:6px')}>
                <div onClick={() => this.downloadAll()} className="hBtnAccent" style={{ ...sx('text-align:center;padding:8px 0;border-radius:7px;background:var(--accent);color:var(--on-accent);font-weight:700;cursor:pointer'), fontFamily: MONO, fontSize: 10 }}>DOWNLOAD ALL {S.cells.length}</div>
                <div onClick={() => { if (!S.zipping) this.downloadZip(); }} className="hBd" style={{ ...sx('text-align:center;padding:8px 0;border:1px solid var(--border-2);border-radius:7px;color:var(--fg-soft);cursor:pointer'), fontFamily: MONO, fontSize: 10, opacity: kept ? 1 : .45 }}>
                  {S.zipping ? 'ZIPPING…' : 'DOWNLOAD ALL (.ZIP) · ' + kept + ' OF ' + S.cells.length}
                </div>
              </div>
            )}
          </div>

          <div>
            {!S.preview ? (
              <div onDragOver={e => { e.preventDefault(); this.setState({ drag: true }); }}
                onDragLeave={() => this.setState({ drag: false })}
                onDrop={e => { e.preventDefault(); this.setState({ drag: false }); this.onFile(e.dataTransfer.files[0]); }}
                onClick={() => this.fileInput && this.fileInput.click()}
                style={{ ...sx('border-radius:12px;padding:90px 20px;text-align:center;cursor:pointer'), border: '1px dashed ' + (S.drag ? ACCENT : 'var(--border-2)'), background: S.drag ? 'var(--accent-05)' : 'var(--surface)' }}>
                <div style={{ fontFamily: MONO, fontSize: 12, color: 'var(--fg-muted)' }}>Drop a grid image — or click to browse</div>
                <div style={{ ...sx('margin-top:6px'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}>contact sheets · turnarounds · storyboard grids</div>
                <input ref={el => this.fileInput = el} type="file" accept="image/*" style={sx('display:none')}
                  onChange={e => this.onFile(e.target.files[0])} />
              </div>
            ) : (
              <div style={sx('display:flex;flex-direction:column;gap:14px')}>
                <img ref={this.imgRef} src={S.preview} alt="" style={sx('display:none')} onLoad={() => this.split()} />
                <div>
                  <div style={sx('display:flex;align-items:baseline;gap:10px;margin-bottom:8px')}>
                    <span style={eyebrow(ACCENT)}>Frames · {S.rows}×{S.cols}</span>
                    <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>{S.fileName}</span>
                    {S.cells.length > 0 && <span style={{ fontFamily: MONO, fontSize: 9.5, fontVariantNumeric: 'tabular-nums', color: kept === S.cells.length ? 'var(--fg-faint)' : ACCENT }}>{kept}/{S.cells.length} kept</span>}
                    {S.cells.length > 0 && <span onClick={() => this.setAllKeep(true)} className="hFgL" style={{ ...sx('margin-left:auto;cursor:pointer'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}>KEEP ALL</span>}
                    {S.cells.length > 0 && <span onClick={() => this.setAllKeep(false)} className="hFgL" style={{ ...sx('cursor:pointer'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}>SKIP ALL</span>}
                    <span onClick={() => { URL.revokeObjectURL(S.preview); this.setState({ preview: '', cells: [], fileName: '', skip: {}, detect: null }); }} className="hFgL" style={{ ...sx('cursor:pointer'), ...(S.cells.length ? {} : sx('margin-left:auto')), fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}>CLEAR</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + S.cols + ',1fr)', gap: 8 }}>
                    {S.cells.map((cell, i) => {
                      const off = !!S.skip[this.cellKey(cell)];
                      return (
                        <div key={i} className="ctxTile" style={{ ...sx('position:relative;border-radius:8px;overflow:hidden;cursor:pointer'), border: '1px solid ' + (off ? 'var(--border)' : 'var(--line)'), opacity: off ? .38 : 1 }}
                          onClick={() => this.downloadCell(cell)} title="Click to download">
                          <img src={cell.url} alt="" style={{ ...sx('width:100%;display:block;position:static;height:auto'), filter: off ? 'grayscale(.85)' : 'none' }} />
                          <span style={{ ...sx('position:absolute;top:6px;left:6px;background:rgba(5,6,8,.75);border-radius:4px;padding:1px 6px'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-soft)' }}>r{cell.r + 1}c{cell.c + 1}</span>
                          <span onClick={e => { e.stopPropagation(); this.toggleCell(cell); }} className={off ? '' : 'hDel'}
                            title={off ? 'Skipped — click to keep' : 'Click to skip this panel'}
                            style={{ ...sx('position:absolute;top:6px;right:6px;border-radius:4px;padding:1px 6px;cursor:pointer'), background: 'rgba(5,6,8,.75)', border: '1px solid ' + (off ? 'rgba(240,91,84,.5)' : 'var(--border-2)'), fontFamily: MONO, fontSize: 9, color: off ? 'var(--danger)' : 'var(--fg-soft)' }}>{off ? 'SKIP' : '✓'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}
