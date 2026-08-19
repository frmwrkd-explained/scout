// Film Emulation — heuristic film-stock grading on canvas, fully client-side
// Drop a render, pick a stock,
// tune intensity/grain, download the graded frame. Nothing is uploaded anywhere.
import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';

const ACCENT = 'var(--accent)';

const STOCKS = [
  { id: 'portra-400', name: 'Kodak Portra 400', description: 'Pastel skin tones, soft highlights, fine grain.', shadowTint: [8, 4, -2], highlightTint: [6, 2, -4], contrast: 0.18, saturation: -0.05, warmth: 0.18, grain: 0.06, halation: 0.05, blackLift: 0.04 },
  { id: 'vision3-5219', name: 'Kodak Vision3 5219', description: 'Tungsten-balanced cinema neg, deep shadows.', shadowTint: [-2, -2, 4], highlightTint: [4, 2, -2], contrast: 0.32, saturation: 0.04, warmth: 0.06, grain: 0.05, halation: 0.04, blackLift: 0.02 },
  { id: 'cinestill-800t', name: 'CineStill 800T', description: 'Tungsten + remjet removed → halation around lights.', shadowTint: [-4, -2, 8], highlightTint: [12, 2, -8], contrast: 0.24, saturation: 0.10, warmth: -0.15, grain: 0.10, halation: 0.28, blackLift: 0.05 },
  { id: 'fuji-pro-400h', name: 'Fuji Pro 400H', description: 'Cool greens, pale skin, airy highlights.', shadowTint: [-4, 4, 4], highlightTint: [-6, 4, 6], contrast: 0.14, saturation: -0.10, warmth: -0.15, grain: 0.05, halation: 0.02, blackLift: 0.06 },
  { id: 'ektachrome', name: 'Kodak Ektachrome', description: 'Slide film: vivid, cool, punchy.', shadowTint: [-2, 0, 6], highlightTint: [4, 4, -2], contrast: 0.34, saturation: 0.20, warmth: -0.08, grain: 0.04, halation: 0.03, blackLift: 0.0 },
  { id: 'ilford-hp5', name: 'Ilford HP5 (B&W)', description: 'Classic mono — full grayscale + grain.', shadowTint: [0, 0, 0], highlightTint: [0, 0, 0], contrast: 0.30, saturation: -1, warmth: 0, grain: 0.10, halation: 0, blackLift: 0.04 },
  { id: 'kodachrome', name: 'Kodachrome 64', description: 'Saturated reds, deep blues, archival vibe.', shadowTint: [4, -2, -2], highlightTint: [8, 4, -4], contrast: 0.36, saturation: 0.22, warmth: 0.20, grain: 0.04, halation: 0.06, blackLift: 0.0 },
  { id: 'polaroid-600', name: 'Polaroid 600', description: 'Faded warmth, lifted shadows, low contrast.', shadowTint: [12, 6, 0], highlightTint: [10, 6, -4], contrast: -0.10, saturation: -0.18, warmth: 0.22, grain: 0.05, halation: 0.10, blackLift: 0.12 },
  { id: 'vhs-1992', name: 'VHS 1992', description: 'Soft, warm, low-fi — analog tape feel.', shadowTint: [4, 2, 2], highlightTint: [10, 4, -6], contrast: -0.15, saturation: -0.30, warmth: 0.10, grain: 0.14, halation: 0.12, blackLift: 0.08 }
];

function applySCurve(v, strength) {
  if (strength === 0) return v;
  // The normalized sigmoid is symmetric in k: sig(-k) == 1 - sig(k), and the normalization
  // cancels the sign — so a negative "strength" used to *boost* contrast identically to the
  // positive value, making the low-contrast stocks (Polaroid, VHS) render punchier, not softer.
  // Positive → sigmoid S-curve (more contrast). Negative → linear blend toward mid-grey (less).
  if (strength < 0) return v + (0.5 - v) * Math.min(1, -strength);
  const k = 6 * strength;
  const sig = 1 / (1 + Math.exp(-k * (v - 0.5)));
  const sig0 = 1 / (1 + Math.exp(-k * -0.5));
  const sig1 = 1 / (1 + Math.exp(-k * 0.5));
  return (sig - sig0) / (sig1 - sig0);
}

function processImage(src, canvas, stock, intensity, grainAmount) {
  const w = src.naturalWidth, h = src.naturalHeight;
  const max = 2000; // perf cap
  const scale = Math.min(1, max / Math.max(w, h));
  const cw = Math.round(w * scale), ch = Math.round(h * scale);
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(src, 0, 0, cw, ch);
  const imageData = ctx.getImageData(0, 0, cw, ch);
  const data = imageData.data;
  const k = intensity;
  const sat = stock.saturation * k;
  const warm = stock.warmth * k;
  const contrastK = stock.contrast * k;
  const blackLift = stock.blackLift * k;
  const halation = stock.halation * k;
  const isMono = stock.saturation === -1;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    r = blackLift + r * (1 - blackLift);
    g = blackLift + g * (1 - blackLift);
    b = blackLift + b * (1 - blackLift);
    r = applySCurve(r, contrastK); g = applySCurve(g, contrastK); b = applySCurve(b, contrastK);
    r = Math.min(1, r + warm * 0.08); b = Math.max(0, b - warm * 0.08);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const shadowMix = Math.max(0, 1 - lum * 1.4);
    const highMix = Math.max(0, lum * 1.4 - 0.4);
    r += (stock.shadowTint[0] / 255) * shadowMix * k + (stock.highlightTint[0] / 255) * highMix * k;
    g += (stock.shadowTint[1] / 255) * shadowMix * k + (stock.highlightTint[1] / 255) * highMix * k;
    b += (stock.shadowTint[2] / 255) * shadowMix * k + (stock.highlightTint[2] / 255) * highMix * k;
    if (isMono) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = gray;
    } else if (sat !== 0) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray + (r - gray) * (1 + sat);
      g = gray + (g - gray) * (1 + sat);
      b = gray + (b - gray) * (1 + sat);
    }
    if (halation > 0 && lum > 0.7) {
      const hk = (lum - 0.7) / 0.3;
      r = Math.min(1, r + halation * hk * 0.4);
      g = Math.min(1, g + halation * hk * 0.12);
    }
    data[i] = Math.max(0, Math.min(255, r * 255));
    data[i + 1] = Math.max(0, Math.min(255, g * 255));
    data[i + 2] = Math.max(0, Math.min(255, b * 255));
  }
  const grainK = (grainAmount * stock.grain * k) * 60;
  if (grainK > 0) {
    for (let i = 0; i < data.length; i += 4) {
      const n = (Math.random() - 0.5) * grainK;
      data[i] = Math.max(0, Math.min(255, data[i] + n));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

export default class FilmEmulation extends React.Component {
  constructor(props) {
    super(props);
    this.state = { fileName: '', preview: '', stockId: STOCKS[0].id, intensity: 100, grain: 100, split: true, drag: false };
    this.imgRef = React.createRef();
    this.canvasRef = React.createRef();
  }
  componentDidUpdate() { this.process(); }
  componentWillUnmount() {
    if (this.state.preview) URL.revokeObjectURL(this.state.preview);
  }
  process() {
    const img = this.imgRef.current, canvas = this.canvasRef.current;
    if (!this.state.preview || !img || !canvas) return;
    const stock = STOCKS.find(s => s.id === this.state.stockId) || STOCKS[0];
    const run = () => processImage(img, canvas, stock, this.state.intensity / 100, this.state.grain / 100);
    if (img.complete && img.naturalWidth) run();
    else img.onload = run;
  }
  onFile(f) {
    if (!f || !f.type.startsWith('image/')) return;
    if (this.state.preview) URL.revokeObjectURL(this.state.preview);
    this.setState({ fileName: f.name, preview: URL.createObjectURL(f) });
  }
  async download() {
    const canvas = this.canvasRef.current;
    if (!canvas || !canvas.width || !canvas.height) { this.props.app.showToast('Drop an image first', 'var(--danger)'); return; }
    const blob = await new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', 0.92));
    if (!blob) { this.props.app.showToast('Nothing to download yet — wait for the image to finish loading', 'var(--danger)'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (this.state.fileName.replace(/\.[^.]+$/, '') || 'image') + '-' + this.state.stockId + '.jpg';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 200);
    this.props.app.showToast('Graded frame downloaded', ACCENT);
  }
  render() {
    const S = this.state;
    const stock = STOCKS.find(s => s.id === S.stockId) || STOCKS[0];
    const eyebrow = (color = 'var(--fg-muted)') => ({ ...sx('font-weight:700;text-transform:uppercase'), fontFamily: MONO, fontSize: 10, letterSpacing: '.16em', color });
    return (
      <div style={sx('padding:22px 28px 90px')}>
        <div style={sx('display:flex;align-items:baseline;gap:12px;margin-bottom:4px')}>
          <div style={sx('font-weight:700;font-size:16px')}>Film Emulation</div>
          <span style={sx('font-size:12px;color:var(--fg-faint)')}>heuristic film-stock grading — 100% in-browser, nothing uploaded</span>
        </div>
        <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-bottom:16px')}>Drop a render or reference, pick a stock, tune intensity and grain. ~2000px max for performance.</div>

        <div style={sx('display:grid;grid-template-columns:260px minmax(0,1fr);gap:22px;align-items:start')}>
          {/* controls */}
          <div style={sx('position:sticky;top:16px;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:14px;display:flex;flex-direction:column;gap:6px')}>
            <div style={{ ...eyebrow(), ...sx('padding:0 2px 6px') }}>Film Stock</div>
            {STOCKS.map(s => {
              const on = s.id === S.stockId;
              return (
                <div key={s.id} onClick={() => this.setState({ stockId: s.id })} className={on ? '' : 'hRow'}
                  style={{ ...sx('padding:7px 9px;border-radius:6px;cursor:pointer'), background: on ? 'var(--accent-05)' : 'transparent', border: '1px solid ' + (on ? 'var(--accent-35)' : 'transparent') }}>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: on ? ACCENT : 'var(--fg)', fontWeight: on ? 700 : 400 }}>{s.name}</div>
                  <div style={sx('font-size:10px;color:var(--fg-faint);line-height:1.45;margin-top:2px')}>{s.description}</div>
                </div>
              );
            })}
            <div style={sx('border-top:1px solid var(--line);margin-top:8px;padding-top:12px')}>
              <div style={{ ...eyebrow('var(--fg-muted)'), ...sx('margin-bottom:6px') }}>Intensity — {S.intensity}%</div>
              <input type="range" min="0" max="150" value={S.intensity} onChange={e => this.setState({ intensity: +e.target.value })} style={sx('width:100%;accent-color:var(--accent)')} />
              <div style={{ ...eyebrow('var(--fg-muted)'), ...sx('margin:10px 0 6px') }}>Grain — {S.grain}%</div>
              <input type="range" min="0" max="200" value={S.grain} onChange={e => this.setState({ grain: +e.target.value })} style={sx('width:100%;accent-color:var(--accent)')} />
            </div>
            <div style={{ ...sx('border-top:1px dashed var(--border);margin-top:10px;padding-top:10px;line-height:1.5;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>
              heuristic emulation, not LUT-accurate. nothing leaves the browser.
            </div>
          </div>

          {/* preview */}
          <div>
            {!S.preview ? (
              <div onDragOver={e => { e.preventDefault(); this.setState({ drag: true }); }}
                onDragLeave={() => this.setState({ drag: false })}
                onDrop={e => { e.preventDefault(); this.setState({ drag: false }); this.onFile(e.dataTransfer.files[0]); }}
                onClick={() => this.fileInput && this.fileInput.click()}
                style={{ ...sx('border-radius:12px;padding:90px 20px;text-align:center;cursor:pointer'), border: '1px dashed ' + (S.drag ? ACCENT : 'var(--border-2)'), background: S.drag ? 'var(--accent-05)' : 'var(--surface)' }}>
                <div style={{ fontFamily: MONO, fontSize: 12, color: 'var(--fg-muted)' }}>Drop an image — or click to browse</div>
                <div style={{ ...sx('margin-top:6px'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}>JPEG · PNG · WebP</div>
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
                    <div style={{ ...eyebrow(ACCENT), ...sx('margin-bottom:6px') }}>Graded · {stock.name}</div>
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
