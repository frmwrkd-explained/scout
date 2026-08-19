// Board → a single flat PNG (and a printable HTML contact sheet).
//
// The board is the surface where a project gets decided; the export is what leaves the building.
// It renders the board EXACTLY as arranged — same coordinates, same frames, same notes — rather
// than re-flowing into a generic grid, because the arrangement is the information. A client who
// gets a tidy 4-up grid learns nothing about which reference sat next to which shot.
//
// ── HOW IT DRAWS ───────────────────────────────────────────────────────────────────────────────
// Chrome (background, frames, text, notes, arrows, captions) is one SVG rasterised by sharp;
// pictures are composited on top as real image buffers. That split is the same one reelPack uses
// for slates, and it exists because sharp cannot rasterise an <image href> pointing at a local
// file — an SVG-only renderer silently drops every picture and produces a beautiful empty board.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { getStorageRoot, safeScope } from './store.mjs';
import { assetPath } from './library.mjs';
import { resolveShotMedia } from './reel.mjs';
import { getBoard } from './board.mjs';
import { bounds, arrowGeom, isRect, TEXT_SIZES, CAPTION_H } from '../frontend/boardLayout.js';

const R = () => getStorageRoot();
const exportDir = pid => path.join(R(), 'projects', safeScope(pid), 'export');

// The palette, duplicated as literals ON PURPOSE and only here. This file writes a PNG that will
// be opened outside the app, where `var(--ink)` resolves to nothing. frontend/tokens.js is the
// mirror for JS sinks and is a frontend module; a backend rasteriser importing it would drag the
// frontend token file into the Electron main bundle for six hex strings. They are checked by
// tests/phase-board-export.test.mjs against tokens.js so they cannot drift silently.
const C = {
  ink: '#0D0E11', surface: '#101115', raise: '#1C1F26',
  border: '#22252C', border3: '#3A3F49',
  fg: '#ECEEF2', fgMuted: '#9AA3AF', fgFaint: '#7B8797',
  accent: '#E3FF32', ok: '#3FCF8E', warn: '#F0B23A', danger: '#F05B54', marked: '#5B9DFF'
};
const TONE = { accent: C.accent, ok: C.ok, warn: C.warn, danger: C.danger, neutral: C.fgFaint };

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Greedy wrap at a character budget derived from the font size. Not a text shaper — sharp has no
// measurement API — but at these sizes it is within a glyph or two and it never overflows the box.
function wrap(text, widthPx, fontPx, maxLines) {
  const per = Math.max(4, Math.floor(widthPx / (fontPx * 0.55)));
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + ' ' + w).length <= per) cur += ' ' + w; else { lines.push(cur); cur = w; }
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{1}$/, '…');
  }
  return lines;
}

// The picture a shot node shows, by the same rule the UI uses: the selected take, else whatever
// resolveShotMedia's fallback ladder found. One joiner, per CLAUDE.md — never a second query.
function shotPicture(shot) {
  if (!shot || !shot.files || !shot.files.length) return null;
  const sel = shot.files.find(f => f.v === 'selected');
  const f = sel || shot.files[0];
  return f && f.file && fs.existsSync(f.file) ? { file: f.file, provisional: !sel } : null;
}

export async function exportBoardPng(pid, { width = 2600, pad = 60, scaleMax = 2 } = {}) {
  const board = getBoard(pid);
  const rects = board.nodes.filter(isRect);
  if (!rects.length) throw new Error('The board is empty — add some shots or assets first.');

  const b = bounds(board.nodes);
  const k = Math.min(scaleMax, Math.max(0.2, (width - pad * 2) / b.w));
  const W = Math.round(b.w * k + pad * 2);
  const H = Math.round(b.h * k + pad * 2);
  // Board point → output pixel. Every coordinate below goes through these two, so there is exactly
  // one place the transform can be wrong.
  const X = v => Math.round((v - b.x) * k + pad);
  const Y = v => Math.round((v - b.y) * k + pad);
  const S = v => Math.max(1, Math.round(v * k));

  const shots = new Map(resolveShotMedia(pid).map(s => [s.id, s]));
  const byId = Object.fromEntries(board.nodes.map(n => [n.id, n]));

  const bg = [];
  const fg = [];
  const composites = [];

  // Frames are drawn first and pictures last, mirroring the document's own z-order (array order
  // IS z-order on the board, which is why "send to back" is a splice and not a field to reconcile).
  for (const n of board.nodes) {
    if (n.t === 'frame') {
      bg.push(`<rect x="${X(n.x)}" y="${Y(n.y)}" width="${S(n.w)}" height="${S(n.h)}" rx="${S(14)}" fill="${C.surface}" stroke="${C.border}" stroke-width="${Math.max(1, S(1.5))}"/>`);
      if (n.label) bg.push(`<text x="${X(n.x) + S(20)}" y="${Y(n.y) + S(32)}" fill="${C.fgMuted}" font-family="monospace" font-size="${S(15)}" font-weight="700" letter-spacing="${S(1.4)}">${esc(n.label)}</text>`);
    }
  }

  for (const n of board.nodes) {
    if (n.t === 'arrow') {
      // Endpoints come from the shared geometry; the CURVE is redrawn as a straight segment in
      // output space rather than transforming the cubic's control points. A print needs the
      // relationship legible, not the on-screen bezier reproduced.
      const g = arrowGeom(n, byId);
      const A = { x: X(g.a.x), y: Y(g.a.y) }, B = { x: X(g.b.x), y: Y(g.b.y) };
      fg.push(`<path d="M ${A.x} ${A.y} L ${B.x} ${B.y}" stroke="${C.border3}" stroke-width="${Math.max(1, S(2))}" fill="none" marker-end="url(#ah)"/>`);
      if (n.label) fg.push(`<text x="${(A.x + B.x) / 2}" y="${(A.y + B.y) / 2 - S(6)}" fill="${C.fgFaint}" font-family="monospace" font-size="${S(12)}" text-anchor="middle">${esc(n.label)}</text>`);
      continue;
    }
    if (n.t === 'text') {
      const size = S(TEXT_SIZES[n.size] || TEXT_SIZES.lg);
      wrap(n.text, S(n.w), size, 4).forEach((line, i) =>
        fg.push(`<text x="${X(n.x)}" y="${Y(n.y) + size * (i + 1)}" fill="${C.fg}" font-family="sans-serif" font-size="${size}" font-weight="700">${esc(line)}</text>`));
      continue;
    }
    if (n.t === 'note') {
      const tone = TONE[n.tone] || C.accent;
      fg.push(`<rect x="${X(n.x)}" y="${Y(n.y)}" width="${S(n.w)}" height="${S(n.h)}" rx="${S(10)}" fill="${C.raise}" stroke="${tone}" stroke-width="${Math.max(1, S(1.5))}"/>`);
      const size = S(14);
      wrap(n.text, S(n.w) - S(24), size, Math.max(1, Math.floor((S(n.h) - S(20)) / (size * 1.45))))
        .forEach((line, i) => fg.push(`<text x="${X(n.x) + S(12)}" y="${Y(n.y) + S(24) + i * size * 1.45}" fill="${C.fg}" font-family="sans-serif" font-size="${size}">${esc(line)}</text>`));
      continue;
    }

    // shot + asset: a card bed, the picture composited over it, a caption under it
    if (n.t === 'shot' || n.t === 'asset') {
      const picH = n.t === 'shot' ? n.h - CAPTION_H : n.h;
      bg.push(`<rect x="${X(n.x)}" y="${Y(n.y)}" width="${S(n.w)}" height="${S(n.h)}" rx="${S(10)}" fill="${C.raise}" stroke="${C.border}" stroke-width="1"/>`);

      let file = null, provisional = false, caption = '', sub = '';
      if (n.t === 'shot') {
        const s = shots.get(n.shot);
        const pic = shotPicture(s);
        if (pic) { file = pic.file; provisional = pic.provisional; }
        caption = s ? (s.no != null ? s.no + '. ' : '') + (s.title || s.id) : n.shot;
        sub = s ? [s.type, s.dur ? s.dur + 's' : '', s.status].filter(Boolean).join(' · ') : 'missing shot';
      } else {
        file = assetPath(n.scope, n.name, n.folder);
        caption = n.name;
      }

      if (file && /\.(png|jpe?g|webp|avif|gif)$/i.test(file)) {
        try {
          const buf = await sharp(file)
            .resize(S(n.w), S(picH), { fit: 'cover', position: 'centre' })
            .png().toBuffer();
          composites.push({ input: buf, left: X(n.x), top: Y(n.y) });
        } catch { file = null; }
      } else if (file) {
        // video / audio / anything sharp will not decode — a labelled bed, never a silent hole
        fg.push(`<text x="${X(n.x) + S(n.w) / 2}" y="${Y(n.y) + S(picH) / 2}" fill="${C.fgFaint}" font-family="monospace" font-size="${S(13)}" text-anchor="middle">${esc(path.extname(file).replace('.', '').toUpperCase() || 'FILE')}</text>`);
      } else {
        fg.push(`<text x="${X(n.x) + S(n.w) / 2}" y="${Y(n.y) + S(picH) / 2}" fill="${C.fgFaint}" font-family="monospace" font-size="${S(13)}" text-anchor="middle">NO TAKE</text>`);
      }

      if (n.t === 'shot') {
        fg.push(`<text x="${X(n.x) + S(10)}" y="${Y(n.y + picH) + S(20)}" fill="${C.fg}" font-family="sans-serif" font-size="${S(13)}" font-weight="600">${esc(wrap(caption, S(n.w) - S(20), S(13), 1)[0] || '')}</text>`);
        if (sub) fg.push(`<text x="${X(n.x) + S(10)}" y="${Y(n.y + picH) + S(34)}" fill="${provisional ? C.warn : C.fgFaint}" font-family="monospace" font-size="${S(10.5)}">${esc(sub)}${provisional ? ' · unapproved' : ''}</text>`);
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="${C.border3}"/></marker></defs>
  <rect width="100%" height="100%" fill="${C.ink}"/>
  ${bg.join('\n  ')}
</svg>`;

  const top = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="${C.border3}"/></marker></defs>
  ${fg.join('\n  ')}
</svg>`;

  fs.mkdirSync(exportDir(pid), { recursive: true });
  const out = path.join(exportDir(pid), 'board.png');
  // Chrome under, pictures over, labels over that — one pipeline, so a caption is never buried
  // under the image it describes.
  await sharp(Buffer.from(svg))
    .composite([...composites, { input: Buffer.from(top), left: 0, top: 0 }])
    .png().toFile(out);

  const st = fs.statSync(out);
  return { file: out, width: W, height: H, bytes: st.size, nodes: board.nodes.length };
}
