// LUT Applier — apply .cube LUTs (DaVinci Resolve et al) or built-in procedural
// looks to any frame, with trilinear interpolation on canvas. Also derives a LUT
// from a reference frame (Reinhard LAB transfer) and writes it out as .cube.
// 100% client-side. LUT preview applier for the FrameForge pipeline.
import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';

const ACCENT = 'var(--accent)';

// ————— .cube parsing —————
function parseCubeLut(text) {
  let size = 0, title = '';
  const data = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('TITLE')) { title = (line.match(/"([^"]*)"/) || [])[1] || ''; continue; }
    if (line.startsWith('LUT_3D_SIZE')) { size = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (/^[A-Z_]/.test(line)) continue; // DOMAIN_MIN/MAX etc — assume 0..1
    const parts = line.split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every(n => !isNaN(n))) data.push(parts[0], parts[1], parts[2]);
  }
  if (!size || data.length !== size * size * size * 3) return null;
  return { size, data: new Float32Array(data), title };
}

// trilinear sample of a 3D LUT (cube order: r fastest, then g, then b)
function sampleLut(lut, r, g, b) {
  const n = lut.size, max = n - 1;
  const fr = Math.min(Math.max(r, 0), 1) * max;
  const fg = Math.min(Math.max(g, 0), 1) * max;
  const fb = Math.min(Math.max(b, 0), 1) * max;
  const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
  const r1 = Math.min(r0 + 1, max), g1 = Math.min(g0 + 1, max), b1 = Math.min(b0 + 1, max);
  const tr = fr - r0, tg = fg - g0, tb = fb - b0;
  const idx = (ri, gi, bi) => 3 * (ri + gi * n + bi * n * n);
  const out = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const c000 = lut.data[idx(r0, g0, b0) + ch], c100 = lut.data[idx(r1, g0, b0) + ch];
    const c010 = lut.data[idx(r0, g1, b0) + ch], c110 = lut.data[idx(r1, g1, b0) + ch];
    const c001 = lut.data[idx(r0, g0, b1) + ch], c101 = lut.data[idx(r1, g0, b1) + ch];
    const c011 = lut.data[idx(r0, g1, b1) + ch], c111 = lut.data[idx(r1, g1, b1) + ch];
    const c00 = c000 + (c100 - c000) * tr, c10 = c010 + (c110 - c010) * tr;
    const c01 = c001 + (c101 - c001) * tr, c11 = c011 + (c111 - c011) * tr;
    const c0 = c00 + (c10 - c00) * tg, c1 = c01 + (c11 - c01) * tg;
    out[ch] = c0 + (c1 - c0) * tb;
  }
  return out;
}

// ————— procedural LUTs (generated 17³ cubes) —————
function makeLut(fn) {
  const n = 17, data = new Float32Array(n * n * n * 3);
  let i = 0;
  for (let bi = 0; bi < n; bi++) for (let gi = 0; gi < n; gi++) for (let ri = 0; ri < n; ri++) {
    const [r, g, b] = fn(ri / (n - 1), gi / (n - 1), bi / (n - 1));
    data[i++] = Math.min(Math.max(r, 0), 1);
    data[i++] = Math.min(Math.max(g, 0), 1);
    data[i++] = Math.min(Math.max(b, 0), 1);
  }
  return { size: n, data };
}
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const PROCEDURAL = [
  { id: 'teal-orange', name: 'Teal & Orange', description: 'Blockbuster split grade — warm skin, cool shadows.', lut: makeLut((r, g, b) => { const L = lum(r, g, b); const sh = Math.max(0, 1 - L * 1.6), hi = Math.max(0, L * 1.6 - 0.6); return [r + hi * 0.10 - sh * 0.04, g + hi * 0.02, b + sh * 0.12 - hi * 0.08]; }) },
  { id: 'bleach-bypass', name: 'Bleach Bypass', description: 'Silver-retained look — desaturated, crunchy contrast.', lut: makeLut((r, g, b) => { const L = lum(r, g, b); const c = v => Math.pow(v, 1.25) * 1.1; const mix = 0.55; return [c(r) * (1 - mix) + c(L) * mix, c(g) * (1 - mix) + c(L) * mix, c(b) * (1 - mix) + c(L) * mix]; }) },
  { id: 'warm-film', name: 'Warm Film', description: 'Gentle amber print — lifted blacks, soft highlights.', lut: makeLut((r, g, b) => { const lift = 0.03; const f = v => lift + v * (1 - lift); return [f(r) * 1.06, f(g) * 1.01, f(b) * 0.94]; }) },
  { id: 'noir-mono', name: 'Noir Mono', description: 'Hard B&W — deep blacks, punchy midtone contrast.', lut: makeLut((r, g, b) => { let L = lum(r, g, b); L = 1 / (1 + Math.exp(-7 * (L - 0.5))); const lo = 1 / (1 + Math.exp(3.5)), hi = 1 / (1 + Math.exp(-3.5)); L = (L - lo) / (hi - lo); return [L, L, L]; }) },
  { id: 'moonlight', name: 'Moonlight', description: 'Cool nocturne — blue cast, crushed warm channel.', lut: makeLut((r, g, b) => { const L = lum(r, g, b); return [r * 0.85, g * 0.95, Math.min(1, b * 1.08 + (1 - L) * 0.06)]; }) },
  { id: 'fade-matte', name: 'Fade Matte', description: 'Faded print — lifted matte blacks, softened whites.', lut: makeLut((r, g, b) => { const f = v => 0.08 + v * 0.86; return [f(r), f(g) * 1.01, f(b) * 1.02]; }) }
];

// ————— reference matching: sRGB ↔ LAB + Reinhard statistic transfer —————
// Same maths as the ReelStack extractor: mean/std of L,a,b are measured on the
// reference, the source distribution is remapped onto them, and the result is
// baked into a 33³ cube. Heuristic — close enough for mood, not lab-accurate.
function srgbToLin(v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function linToSrgb(v) {
  if (v <= 0) return 0;
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
const XN = 0.95047, YN = 1.0, ZN = 1.08883; // D65 reference white
function rgbToLab(r, g, b) {
  const rl = srgbToLin(r), gl = srgbToLin(g), bl = srgbToLin(b);
  const x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl;
  const z = 0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl;
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / XN), fy = f(y / YN), fz = f(z / ZN);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function labToRgb(L, a, bb) {
  const fy = (L + 16) / 116, fx = a / 500 + fy, fz = fy - bb / 200;
  const finv = t => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };
  const X = XN * finv(fx), Y = YN * finv(fy), Z = ZN * finv(fz);
  const rl = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const gl = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
  const bl = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  return [linToSrgb(rl), linToSrgb(gl), linToSrgb(bl)];
}

// fallback source distribution — a typical mid-key daylight photo in LAB
const NEUTRAL_BASELINE = { meanL: 55, meana: 2, meanb: 6, stdL: 22, stda: 12, stdb: 14 };

function computeLabStats(img, sampleMax = 65536) {
  const ratio = Math.sqrt(sampleMax / Math.max(1, img.naturalWidth * img.naturalHeight));
  const scale = Math.min(1, ratio);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  let sumL = 0, suma = 0, sumb = 0, sumL2 = 0, suma2 = 0, sumb2 = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [L, a, bv] = rgbToLab(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    sumL += L; suma += a; sumb += bv;
    sumL2 += L * L; suma2 += a * a; sumb2 += bv * bv;
    n++;
  }
  if (!n) return null;
  const meanL = sumL / n, meana = suma / n, meanb = sumb / n;
  return {
    meanL, meana, meanb,
    stdL: Math.max(1e-6, Math.sqrt(Math.max(0, sumL2 / n - meanL * meanL))),
    stda: Math.max(1e-6, Math.sqrt(Math.max(0, suma2 / n - meana * meana))),
    stdb: Math.max(1e-6, Math.sqrt(Math.max(0, sumb2 / n - meanb * meanb))),
    samples: n
  };
}

// roll-off above 0.85 so the remap does not clip highlights flat
function softClip(v) {
  if (v <= 0) return 0;
  if (v <= 0.85) return v;
  if (v >= 1.5) return 1;
  const t = (v - 0.85) / 0.65;
  return 0.85 + 0.15 * (1 - Math.pow(1 - t, 2));
}

// bake the src→tgt LAB transfer into a cube (same axis order as parseCubeLut: r fastest)
function buildMatchLut(src, tgt, size, title) {
  const data = new Float32Array(size * size * size * 3);
  const denom = size - 1;
  let i = 0;
  for (let bi = 0; bi < size; bi++) for (let gi = 0; gi < size; gi++) for (let ri = 0; ri < size; ri++) {
    const [L, a, bv] = rgbToLab(ri / denom, gi / denom, bi / denom);
    const L2 = ((L - src.meanL) / src.stdL) * tgt.stdL + tgt.meanL;
    const a2 = ((a - src.meana) / src.stda) * tgt.stda + tgt.meana;
    const b2 = ((bv - src.meanb) / src.stdb) * tgt.stdb + tgt.meanb;
    const [nr, ng, nb] = labToRgb(L2, a2, b2);
    data[i++] = Math.min(1, Math.max(0, softClip(nr)));
    data[i++] = Math.min(1, Math.max(0, softClip(ng)));
    data[i++] = Math.min(1, Math.max(0, softClip(nb)));
  }
  return { size, data, title };
}

// .cube writer — every in-memory LUT here is 0..1, so the domain is fixed.
// Emission order matches parseCubeLut/sampleLut indexing (r fastest, then g, then b).
function serializeCubeLut(lut) {
  const lines = ['TITLE "' + (lut.title || 'LUT') + '"', 'LUT_3D_SIZE ' + lut.size, 'DOMAIN_MIN 0.000 0.000 0.000', 'DOMAIN_MAX 1.000 1.000 1.000', ''];
  for (let i = 0; i < lut.data.length; i += 3) {
    lines.push(lut.data[i].toFixed(6) + ' ' + lut.data[i + 1].toFixed(6) + ' ' + lut.data[i + 2].toFixed(6));
  }
  return lines.join('\n') + '\n';
}

function processImage(src, canvas, lut, intensity) {
  const w = src.naturalWidth, h = src.naturalHeight;
  const max = 2000;
  const scale = Math.min(1, max / Math.max(w, h));
  const cw = Math.round(w * scale), ch = Math.round(h * scale);
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(src, 0, 0, cw, ch);
  if (!lut) return;
  const imageData = ctx.getImageData(0, 0, cw, ch);
  const data = imageData.data;
  const k = intensity;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const [nr, ng, nb] = sampleLut(lut, r, g, b);
    data[i] = (r + (nr - r) * k) * 255;
    data[i + 1] = (g + (ng - g) * k) * 255;
    data[i + 2] = (b + (nb - b) * k) * 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

export default class LutApplier extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      fileName: '', preview: '', lutId: 'teal-orange', customLut: null, customName: '',
      intensity: 100, split: true, drag: false,
      mode: 'looks', refPreview: '', refName: '', refLut: null, refBasis: '', refDrag: false, extracting: false
    };
    this.imgRef = React.createRef();
    this.canvasRef = React.createRef();
    this.refImgEl = null; // decoded reference frame, kept so the match can be re-derived
    this.deriveT = null; // pending derive timeout, cleared on unmount
  }
  componentDidUpdate() { this.process(); }
  componentWillUnmount() {
    clearTimeout(this.deriveT);
    if (this.state.preview) URL.revokeObjectURL(this.state.preview);
    if (this.state.refPreview) URL.revokeObjectURL(this.state.refPreview);
  }
  currentLut() {
    if (this.state.mode === 'match') return this.state.refLut;
    if (this.state.lutId === 'custom' && this.state.customLut) return this.state.customLut;
    const p = PROCEDURAL.find(l => l.id === this.state.lutId);
    return p ? p.lut : null;
  }
  process() {
    const img = this.imgRef.current, canvas = this.canvasRef.current;
    if (!this.state.preview || !img || !canvas) return;
    const run = () => processImage(img, canvas, this.currentLut(), this.state.intensity / 100);
    if (img.complete && img.naturalWidth) run();
    else img.onload = run;
  }
  onFile(f) {
    if (!f || !f.type.startsWith('image/')) return;
    if (this.state.preview) URL.revokeObjectURL(this.state.preview);
    this.setState({ fileName: f.name, preview: URL.createObjectURL(f) });
  }
  async onCube(f) {
    if (!f) return;
    const text = await f.text();
    const lut = parseCubeLut(text);
    if (!lut) { this.props.app.showToast('Could not parse .cube file', 'var(--danger)'); return; }
    this.setState({ customLut: lut, customName: lut.title || f.name.replace(/\.cube$/i, ''), lutId: 'custom' });
    this.props.app.showToast('LUT loaded — ' + (lut.title || f.name) + ' (' + lut.size + '³)', 'var(--ok)');
  }
  async onRef(f) {
    if (!f || !f.type.startsWith('image/')) return;
    if (this.state.refPreview) URL.revokeObjectURL(this.state.refPreview);
    const url = URL.createObjectURL(f);
    const img = new Image();
    try {
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode')); img.src = url; });
    } catch (e) {
      URL.revokeObjectURL(url);
      this.props.app.showToast('Could not read that reference image', 'var(--danger)');
      return;
    }
    this.refImgEl = img;
    this.setState({ refPreview: url, refName: f.name, extracting: true }, () => this.derive());
  }
  // measure the reference, measure the working frame (or fall back to a neutral
  // baseline), then bake the LAB transfer between them into a 33³ cube
  derive() {
    const img = this.refImgEl;
    if (!img) { this.setState({ extracting: false }); return; }
    // one tick so the "DERIVING LUT…" label paints before the synchronous LAB pass.
    // setTimeout, not requestAnimationFrame: rAF never fires while the tab is hidden,
    // which left the panel stuck on "DERIVING LUT…" with no LUT ever produced.
    clearTimeout(this.deriveT);
    this.deriveT = setTimeout(() => {
      const tgt = computeLabStats(img);
      if (!tgt) { this.setState({ extracting: false }); this.props.app.showToast('Could not sample the reference', 'var(--danger)'); return; }
      const work = this.imgRef.current;
      const measured = (work && work.complete && work.naturalWidth) ? computeLabStats(work) : null;
      const src = measured || NEUTRAL_BASELINE;
      const name = this.state.refName.replace(/\.[^.]+$/, '') || 'reference';
      const lut = buildMatchLut(src, tgt, 33, 'Match · ' + name);
      this.setState({ refLut: lut, refBasis: measured ? 'working frame' : 'neutral baseline', extracting: false });
      this.props.app.showToast('LUT derived from ' + this.state.refName + ' (33³)', 'var(--ok)');
    }, 20);
  }
  downloadCube() {
    const lut = this.state.refLut;
    if (!lut) { this.props.app.showToast('Drop a reference frame first', 'var(--danger)'); return; }
    // the emitted TITLE carries a '·', so the charset has to be explicit or readers
    // that default to latin-1 mangle the name
    const blob = new Blob([serializeCubeLut(lut)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (lut.title || 'match').replace(/[^\w.-]+/g, '-') + '.cube';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 200);
    this.props.app.showToast('.cube exported — ' + lut.size + '³', ACCENT);
  }
  async download() {
    const canvas = this.canvasRef.current;
    if (!canvas || !canvas.width || !canvas.height) { this.props.app.showToast('Drop an image first', 'var(--danger)'); return; }
    const blob = await new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', 0.92));
    if (!blob) { this.props.app.showToast('Nothing to download yet — wait for the image to finish loading', 'var(--danger)'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (this.state.fileName.replace(/\.[^.]+$/, '') || 'image') + '-' + (this.state.mode === 'match' ? 'match' : this.state.lutId) + '.jpg';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 200);
    this.props.app.showToast('Graded frame downloaded', ACCENT);
  }
  render() {
    const S = this.state;
    const eyebrow = (color = 'var(--fg-muted)') => ({ ...sx('font-weight:700;text-transform:uppercase'), fontFamily: MONO, fontSize: 10, letterSpacing: '.16em', color });
    const match = S.mode === 'match';
    const lutName = match
      ? (S.refLut ? 'Match · ' + S.refName : 'No reference yet')
      : (S.lutId === 'custom' ? S.customName : (PROCEDURAL.find(l => l.id === S.lutId) || {}).name);
    const modeChip = (id, label) => {
      const on = S.mode === id;
      return <span key={id} onClick={() => this.setState({ mode: id })}
        style={{ ...sx('flex:1;text-align:center;padding:5px 0;border-radius:6px;cursor:pointer'), fontFamily: MONO, fontSize: 10, color: on ? 'var(--on-accent)' : 'var(--fg-muted)', background: on ? 'var(--fg)' : 'var(--surface-2)', border: '1px solid ' + (on ? 'var(--fg)' : 'var(--border)'), fontWeight: on ? 700 : 400 }}>{label}</span>;
    };
    return (
      <div style={sx('padding:22px 28px 90px')}>
        <div style={sx('display:flex;align-items:baseline;gap:12px;margin-bottom:4px')}>
          <div style={sx('font-weight:700;font-size:16px')}>LUT Applier</div>
          <span style={sx('font-size:12px;color:var(--fg-faint)')}>.cube LUTs + procedural looks + reference matching, trilinear sampling — 100% in-browser</span>
        </div>
        <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-bottom:16px')}>Preview any Resolve/production LUT on a render before committing a grade, or match a reference frame and export the derived LUT as .cube. Nothing is uploaded.</div>

        <div style={sx('display:grid;grid-template-columns:260px minmax(0,1fr);gap:22px;align-items:start')}>
          <div style={sx('position:sticky;top:16px;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:14px;display:flex;flex-direction:column;gap:6px')}>
            <div style={sx('display:flex;gap:4px;margin-bottom:4px')}>
              {modeChip('looks', 'LOOKS')}
              {modeChip('match', 'MATCH REF')}
            </div>
            {!match && <>
            <div style={{ ...eyebrow(), ...sx('padding:0 2px 6px') }}>Look</div>
            {PROCEDURAL.map(l => {
              const on = S.lutId === l.id;
              return (
                <div key={l.id} onClick={() => this.setState({ lutId: l.id })} className={on ? '' : 'hRow'}
                  style={{ ...sx('padding:7px 9px;border-radius:6px;cursor:pointer'), background: on ? 'var(--accent-05)' : 'transparent', border: '1px solid ' + (on ? 'var(--accent-35)' : 'transparent') }}>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: on ? ACCENT : 'var(--fg)', fontWeight: on ? 700 : 400 }}>{l.name}</div>
                  <div style={sx('font-size:10px;color:var(--fg-faint);line-height:1.45;margin-top:2px')}>{l.description}</div>
                </div>
              );
            })}
            {S.customLut && (
              <div onClick={() => this.setState({ lutId: 'custom' })} className={S.lutId === 'custom' ? '' : 'hRow'}
                style={{ ...sx('padding:7px 9px;border-radius:6px;cursor:pointer'), background: S.lutId === 'custom' ? 'var(--accent-05)' : 'transparent', border: '1px solid ' + (S.lutId === 'custom' ? 'var(--accent-35)' : 'transparent') }}>
                <div style={{ fontFamily: MONO, fontSize: 11, color: S.lutId === 'custom' ? ACCENT : 'var(--fg)', fontWeight: 700 }}>{S.customName}</div>
                <div style={{ ...sx('color:var(--fg-faint);margin-top:2px'), fontFamily: MONO, fontSize: 9.5, fontVariantNumeric: 'tabular-nums' }}>.cube · {S.customLut.size}³ · custom</div>
              </div>
            )}
            <div onClick={() => this.cubeInput && this.cubeInput.click()} className="hBd"
              style={{ ...sx('margin-top:6px;text-align:center;padding:7px 0;border-radius:7px;border:1px dashed var(--border-2);color:var(--fg-muted);cursor:pointer'), fontFamily: MONO, fontSize: 10 }}>+ LOAD .CUBE FILE</div>
            <input ref={el => this.cubeInput = el} type="file" accept=".cube" style={sx('display:none')}
              onChange={e => this.onCube(e.target.files[0])} />
            </>}

            {match && <>
            <div style={{ ...eyebrow(), ...sx('padding:0 2px 6px') }}>Reference frame</div>
            {/* dragover fires on every mouse move. Unlike the working-frame zone below, this one
                renders alongside a live canvas, so an unconditional setState would re-run the full
                trilinear pass (~146ms on a 2000px frame) per event and lock the main thread. */}
            <div onDragOver={e => { e.preventDefault(); if (!this.state.refDrag) this.setState({ refDrag: true }); }}
              onDragLeave={() => this.setState({ refDrag: false })}
              onDrop={e => { e.preventDefault(); this.setState({ refDrag: false }); this.onRef(e.dataTransfer.files[0]); }}
              onClick={() => this.refInput && this.refInput.click()}
              style={{ ...sx('text-align:center;padding:16px 8px;border-radius:6px;cursor:pointer'), border: '1px dashed ' + (S.refDrag ? ACCENT : 'var(--border-2)'), background: S.refDrag ? 'var(--accent-05)' : 'transparent', fontFamily: MONO, fontSize: 10, color: 'var(--fg-muted)' }}>
              {S.extracting ? 'DERIVING LUT…' : 'DROP A REFERENCE FRAME'}
              <div style={{ ...sx('margin-top:4px;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9 }}>the grade you want to match</div>
            </div>
            <input ref={el => this.refInput = el} type="file" accept="image/*" style={sx('display:none')}
              onChange={e => this.onRef(e.target.files[0])} />
            {S.refPreview && (
              <div style={sx('display:flex;gap:8px;align-items:center;margin-top:8px')}>
                <img src={S.refPreview} alt="reference" style={sx('width:56px;height:38px;object-fit:cover;border-radius:4px;border:1px solid var(--line);display:block')} />
                <div style={sx('min-width:0')}>
                  <div style={{ ...sx('overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 10, color: 'var(--fg)' }}>{S.refName}</div>
                  <div style={{ ...sx('margin-top:2px'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)', fontVariantNumeric: 'tabular-nums' }}>{S.refLut ? S.refLut.size + '³ · vs ' + S.refBasis : '—'}</div>
                </div>
              </div>
            )}
            {S.refLut && (
              <div style={sx('display:flex;gap:4px;margin-top:8px')}>
                <div onClick={() => this.downloadCube()} className="hBdAccent" style={{ ...sx('flex:1;text-align:center;padding:7px 0;border-radius:7px;border:1px solid var(--accent-35);color:var(--accent);font-weight:700;cursor:pointer'), fontFamily: MONO, fontSize: 10 }}>EXPORT .CUBE</div>
                <div onClick={() => this.setState({ extracting: true }, () => this.derive())} className="hBd" style={{ ...sx('padding:7px 10px;border:1px solid var(--border-2);border-radius:7px;color:var(--fg-muted);cursor:pointer'), fontFamily: MONO, fontSize: 10 }}>RE-DERIVE</div>
              </div>
            )}
            <div style={{ ...sx('border-top:1px dashed var(--border);margin-top:10px;padding-top:10px;line-height:1.5;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>
              reinhard LAB statistic transfer baked to a 33³ cube. re-derive after swapping the working frame. heuristic — close enough for mood, not lab-accurate.
            </div>
            </>}

            <div style={sx('border-top:1px solid var(--line);margin-top:8px;padding-top:12px')}>
              <div style={{ ...eyebrow('var(--fg-muted)'), ...sx('margin-bottom:6px') }}>{match ? 'Strength' : 'Intensity'} — {S.intensity}%</div>
              <input type="range" min="0" max="100" value={S.intensity} onChange={e => this.setState({ intensity: +e.target.value })} style={sx('width:100%;accent-color:var(--accent)')} />
            </div>
          </div>

          <div>
            {!S.preview ? (
              <div onDragOver={e => { e.preventDefault(); if (!this.state.drag) this.setState({ drag: true }); }}
                onDragLeave={() => this.setState({ drag: false })}
                onDrop={e => { e.preventDefault(); this.setState({ drag: false }); this.onFile(e.dataTransfer.files[0]); }}
                onClick={() => this.fileInput && this.fileInput.click()}
                style={{ ...sx('border-radius:12px;padding:90px 20px;text-align:center;cursor:pointer'), border: '1px dashed ' + (S.drag ? ACCENT : 'var(--border-2)'), background: S.drag ? 'var(--accent-05)' : 'var(--surface)' }}>
                <div style={{ fontFamily: MONO, fontSize: 12, color: 'var(--fg-muted)' }}>Drop an image — or click to browse</div>
                <div style={{ ...sx('margin-top:6px'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}>JPEG · PNG · WebP — then pick a look or load a .cube</div>
                <input ref={el => this.fileInput = el} type="file" accept="image/*" style={sx('display:none')}
                  onChange={e => this.onFile(e.target.files[0])} />
              </div>
            ) : (
              <div style={sx('display:flex;flex-direction:column;gap:12px')}>
                <img ref={this.imgRef} src={S.preview} alt="" style={sx('display:none')} />
                <div style={{ display: 'grid', gridTemplateColumns: S.split ? '1fr 1fr' : '1fr', gap: 10 }}>
                  {S.split && (
                    <div>
                      <div style={{ ...eyebrow(), ...sx('margin-bottom:6px') }}>Original</div>
                      <img src={S.preview} alt="original" style={sx('width:100%;border-radius:8px;border:1px solid var(--line);display:block')} />
                    </div>
                  )}
                  <div>
                    <div style={{ ...eyebrow(ACCENT), ...sx('margin-bottom:6px') }}>Graded · {lutName}</div>
                    <canvas ref={this.canvasRef} style={sx('width:100%;border-radius:8px;border:1px solid var(--accent-35);display:block')} />
                  </div>
                </div>
                <div style={sx('display:flex;gap:8px')}>
                  <div onClick={() => this.download()} className="hBtnAccent" style={{ ...sx('padding:7px 16px;border-radius:7px;background:var(--accent);color:var(--on-accent);font-weight:700;cursor:pointer'), fontFamily: MONO, fontSize: 10 }}>DOWNLOAD GRADED</div>
                  <div onClick={() => this.setState(s => ({ split: !s.split }))} className="hBd" style={{ ...sx('padding:7px 13px;border:1px solid var(--border-2);border-radius:7px;color:var(--fg-soft);cursor:pointer'), fontFamily: MONO, fontSize: 10 }}>{S.split ? 'HIDE ORIGINAL' : 'SHOW SPLIT'}</div>
                  <div style={sx('flex:1')} />
                  <div onClick={() => { URL.revokeObjectURL(S.preview); this.setState({ preview: '', fileName: '' }); }} className="hFgL" style={{ ...sx('padding:7px 10px;color:var(--fg-faint);cursor:pointer'), fontFamily: MONO, fontSize: 10 }}>CLEAR</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}
