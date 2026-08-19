// Grid-split detection/scoring/geometry core — the single home for "where are the cut lines?".
//
// Imported by BOTH the browser tool page (frontend/GridSplitter.jsx, which feeds it canvas
// ImageData) and the backend split route (backend/gridsplit.mjs, which feeds it a decoded RGBA
// buffer from sharp). Nothing in here touches canvas, DOM, fs, or sharp — it is pure math over a
// plain { data, width, height } pixel view, so the same scoring runs identically on either side.
//
// `data` is an RGBA byte view (4 bytes/pixel, row-major): browser ImageData.data or sharp's
// ensureAlpha().raw() output. Only luminance is used, so an RGB-with-padding view also works as long
// as the stride is 4.

// Every candidate grid the auto-detector scores. Ordered small→large only for readability; the
// score, not the position, decides the winner.
export const CANDIDATE_GRIDS = [
  { rows: 2, cols: 2 }, { rows: 2, cols: 3 }, { rows: 3, cols: 2 },
  { rows: 3, cols: 3 }, { rows: 3, cols: 4 }, { rows: 4, cols: 3 },
  { rows: 4, cols: 4 }, { rows: 2, cols: 4 }, { rows: 4, cols: 2 },
  { rows: 5, cols: 5 }, { rows: 1, cols: 1 }
];

// Cell aspect ratios that earn a detection bonus — the shapes AI contact sheets actually emit.
export const COMMON_CELL_RATIOS = [16 / 9, 1, 9 / 16, 4 / 3, 3 / 4, 4 / 5, 3 / 2, 2 / 3];

// Per-row and per-column edge-energy profiles: the mean absolute vertical/horizontal luminance
// gradient at each scanline. Grid cut lines show up as spikes in these profiles.
export function buildLumProfiles(data, w, h) {
  const lum = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length && j < lum.length; i += 4, j++) {
    lum[j] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  const rowEdges = new Float32Array(h);
  const colEdges = new Float32Array(w);
  for (let y = 1; y < h - 1; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) s += Math.abs(lum[(y + 1) * w + x] - lum[(y - 1) * w + x]);
    rowEdges[y] = s / w;
  }
  for (let x = 1; x < w - 1; x++) {
    let s = 0;
    for (let y = 0; y < h; y++) s += Math.abs(lum[y * w + (x + 1)] - lum[y * w + (x - 1)]);
    colEdges[x] = s / h;
  }
  return { rowEdges, colEdges };
}

// Score one candidate grid: how much edge energy sits on its cut lines, plus an aspect bonus when
// the resulting cell shape lands on a common ratio, plus a mild preference for finer grids.
export function scoreGrid(rows, cols, rowEdges, colEdges, w, h) {
  const aspect = w / cols / (h / rows);
  let edgeScore = 0;
  const search = 4;
  for (let r = 1; r < rows; r++) {
    const y = Math.round((r / rows) * h);
    let m = 0;
    for (let i = Math.max(1, y - search); i <= Math.min(h - 2, y + search); i++) m = Math.max(m, rowEdges[i]);
    edgeScore += m;
  }
  for (let c = 1; c < cols; c++) {
    const x = Math.round((c / cols) * w);
    let m = 0;
    for (let i = Math.max(1, x - search); i <= Math.min(w - 2, x + search); i++) m = Math.max(m, colEdges[i]);
    edgeScore += m;
  }
  const lines = rows - 1 + (cols - 1);
  const edgeNorm = lines > 0 ? edgeScore / lines : 0;
  let aspectBonus = 0;
  for (const r of COMMON_CELL_RATIOS) {
    const err = Math.abs(aspect - r) / r;
    if (err < 0.1) aspectBonus = Math.max(aspectBonus, (1 - err) * 30);
  }
  if (Math.abs(aspect - 16 / 9) / (16 / 9) < 0.1) aspectBonus += 10;
  return edgeNorm + aspectBonus + Math.log(rows * cols + 1) * 4;
}

// Auto-detect the most likely grid from a pixel view. Caller downscales for speed (both the browser
// and the backend cap the analysis pass at ~600px on the long edge). Returns the winner plus the
// runner-up and the margin between them, so callers can show how decisive the call was.
// `pixels` = { data: RGBA byte view, width, height }.
export function detectGrid(pixels, candidates = CANDIDATE_GRIDS) {
  if (!pixels) return null;
  const { data, width: w, height: h } = pixels;
  if (!data || !w || !h) return null;
  const { rowEdges, colEdges } = buildLumProfiles(data, w, h);
  const scored = candidates
    .map(g => ({ rows: g.rows, cols: g.cols, score: scoreGrid(g.rows, g.cols, rowEdges, colEdges, w, h) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return null;
  const next = scored[1] || null;
  const margin = next ? best.score - next.score : best.score;
  return { rows: best.rows, cols: best.cols, score: best.score, margin, runnerUp: next };
}

// Cell geometry in SOURCE pixels. `gutter` is the percentage of a cell shaved off each inner edge —
// it kills grid lines / borders baked into AI sheets. Returns row-major rects the caller crops with
// (canvas drawImage on the browser, sharp extract on the backend). Rects are clamped to the image so
// a cell can never extract outside bounds.
export function cellRects({ width, height, rows, cols, gutter = 0 }) {
  const r = Math.max(1, Math.floor(rows || 1));
  const c = Math.max(1, Math.floor(cols || 1));
  const cw = width / c, ch = height / r;
  const trimX = cw * (gutter / 100), trimY = ch * (gutter / 100);
  const cells = [];
  for (let row = 0; row < r; row++) {
    for (let col = 0; col < c; col++) {
      let sx = Math.round(col * cw + trimX);
      let sy = Math.round(row * ch + trimY);
      let sw = Math.max(1, Math.round(cw - trimX * 2));
      let sh = Math.max(1, Math.round(ch - trimY * 2));
      if (sx + sw > width) sw = width - sx;
      if (sy + sh > height) sh = height - sy;
      cells.push({ r: row, c: col, sx, sy, sw, sh });
    }
  }
  return cells;
}

// Stable cell key shared by the tool page (keep/skip map) and the split route (skip / shot mapping).
export const cellKey = (r, c) => r + '-' + c;
