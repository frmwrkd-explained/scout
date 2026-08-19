// The conform pack — what an editor actually receives. NOT a bare XML.
//
// projects/<pid>/cuts/animatic-export/
//   animatic.xml   FCP7 xmeml v5 → Premiere, Resolve
//   media/         COPIED, not symlinked
//   CONFORM.md     what to open, what is missing, how to relink
//
// Every interchange path points INSIDE media/, so the pack survives being emailed, dropped on a
// shuttle drive, or opened under another account. That single decision determines whether an
// editor relinks or throws the file away.
//
// media/ is COPIED (hardlinked within a volume), never symlinked. manifest.mjs:59-79's
// symlink-first trick is right for a local selects/ folder and wrong here: cp -R, ditto, and
// rsync without -L all preserve symlinks, so the pack would arrive with dangling links into a
// workspace the recipient does not have.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { getStorageRoot, safeScope, safe } from './store.mjs';
import { buildReel } from './reel.mjs';
import { reelToTimeline, toXmeml, toFcpxml, preflight } from './reelExport.mjs';
import { tcStr, humanDur } from '../shared/timecode.mjs';

const packDir = pid => path.join(getStorageRoot(), 'projects', safeScope(pid), 'cuts', 'animatic-export');

// Resolve's still list from XML is TIF/JPG/PNG/DPX/TGA/DNG. FAL image endpoints return .webp
// regularly and generate.mjs writes the provider extension verbatim, so without this transcode
// every webp still imports OFFLINE with no error.
const NEEDS_TRANSCODE = ['webp', 'avif', 'heic', 'heif'];

const slug = s => String(s || '').toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

// Copy, preferring a hardlink (same volume → no disk cost, and it is a real file to every tool).
function place(src, dst) {
  try { fs.rmSync(dst, { force: true }); } catch { /* nothing there */ }
  try { fs.linkSync(src, dst); return 'linked'; }
  catch { fs.copyFileSync(src, dst); return 'copied'; }
}

async function slatePng(dst, { width, height, shot, prompt }) {
  // A slate is a REAL clip pointing at a real file, so the hole is visible in the timeline at the
  // right length rather than being an absence the editor has to infer.
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const wrapped = String(prompt || '').slice(0, 160).match(/.{1,52}(\s|$)/g) || [];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#0B0C0E"/>
  <text x="${width / 2}" y="${height / 2 - 40}" fill="#E3FF32" font-family="monospace" font-size="${Math.round(height / 14)}" font-weight="bold" text-anchor="middle">${esc(shot)}</text>
  <text x="${width / 2}" y="${height / 2 + 20}" fill="#626B78" font-family="monospace" font-size="${Math.round(height / 38)}" text-anchor="middle">NO APPROVED TAKE</text>
  ${wrapped.map((l, i) => `<text x="${width / 2}" y="${height / 2 + 70 + i * Math.round(height / 30)}" fill="#8A94A2" font-family="monospace" font-size="${Math.round(height / 45)}" text-anchor="middle">${esc(l.trim())}</text>`).join('\n  ')}
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(dst);
}

// Build the pack. Returns { dir, clips, files, warnings, errors, bytes }.
export async function exportReelPack(pid, { formats = ['xmeml', 'fcpxml'] } = {}) {
  const reel = await buildReel(pid);
  if (!reel.clips.length) throw new Error('The timeline is empty — lay down the shots or add a clip first.');

  // STRUCTURAL PREFLIGHT, before anything is destroyed.
  //
  // The full preflight below runs before the XML is written, which the comment there is right
  // about — but by then this function has already `rmSync`'d the previous pack and spent minutes
  // copying and transcoding media. So an export that fails preflight took the user's last GOOD
  // export with it, and handed back an error instead. Losing working output to a failed attempt is
  // the worst shape a build step can have.
  //
  // Everything except the path checks can be answered from `reel` alone: empty timeline,
  // drop-frame legality, odd sequence dimensions, sub-2-frame clips, unknown source dimensions,
  // reads past the end of a source, track overlaps. Only "path does not survive URL encoding"
  // needs the packed filenames, and that is what the later call still covers.
  const probe = preflight(reelToTimeline(reel, { mediaFor: c => (c.file ? 'probe.mov' : null) }));
  const structural = probe.errors.filter(e => !/does not survive URL encoding/.test(e));
  if (structural.length) {
    const e = new Error('Export preflight failed:\n  · ' + structural.join('\n  · '));
    e.errors = structural;
    throw e;                                          // nothing has been touched yet
  }

  const dir = packDir(pid);
  const media = path.join(dir, 'media');
  fs.rmSync(dir, { recursive: true, force: true });   // a stale pack is worse than no pack
  fs.mkdirSync(media, { recursive: true });

  let bytes = 0, linked = 0, copied = 0, transcoded = 0;
  const nameFor = new Map();

  let i = 0;
  for (const c of reel.clips) {
    const ord = String(++i).padStart(3, '0');
    const stem = safe(c.shot || c.title || c.id).slice(0, 40);
    if (c.kind === 'slate' || !c.file || !fs.existsSync(c.file)) {
      // a hole is a REAL clip pointing at a real slate, so it is visible in the NLE at the right
      // length rather than an absence the editor has to infer
      const out = path.join(media, `${ord}_${stem}_SLATE.png`);
      await slatePng(out, { width: reel.width, height: reel.height, shot: c.shot || c.title || c.id, prompt: c.prompt });
      nameFor.set(c.id, out);
      c.srcW = reel.width; c.srcH = reel.height;
      bytes += fs.statSync(out).size;
      continue;
    }
    const ext = c.file.split('.').pop().toLowerCase();
    const base = `${ord}_${stem}_${slug(c.title) || 'take'}`;
    if (NEEDS_TRANSCODE.includes(ext)) {
      const out = path.join(media, base + '.png');
      await sharp(c.file).png().toFile(out);
      nameFor.set(c.id, out);
      transcoded++; bytes += fs.statSync(out).size;
    } else {
      const out = path.join(media, base + '.' + ext);
      const how = place(c.file, out);
      how === 'linked' ? linked++ : copied++;
      nameFor.set(c.id, out);
      try { bytes += fs.statSync(out).size; } catch { /* stat is best-effort */ }
    }
  }

  // Point every path INSIDE the pack.
  const tl = reelToTimeline(reel, { mediaFor: c => nameFor.get(c.id) || null });
  const pre = preflight(tl);
  // Preflight runs BEFORE the write. Premiere fails a malformed import with no usable message,
  // so refusing to write a known-bad file is worth more than reporting it afterwards.
  if (!pre.ok) {
    const e = new Error('Export preflight failed:\n  · ' + pre.errors.join('\n  · '));
    e.errors = pre.errors;
    throw e;
  }

  const files = [];
  if (formats.includes('xmeml')) {
    fs.writeFileSync(path.join(dir, 'animatic.xml'), toXmeml(tl));
    files.push('animatic.xml');
  }
  if (formats.includes('fcpxml')) {
    fs.writeFileSync(path.join(dir, 'animatic.fcpxml'), toFcpxml(tl));
    files.push('animatic.fcpxml');
  }

  fs.writeFileSync(path.join(dir, 'CONFORM.md'), conformDoc(reel, tl, pre, { linked, copied, transcoded, bytes }));
  files.push('CONFORM.md');

  return {
    dir, clips: reel.clips.length, files,
    slates: reel.slates, warnings: pre.warnings, errors: [],
    bytes, linked, copied, transcoded,
    totalFrames: reel.totalFrames, totalTc: reel.totalTc
  };
}

function conformDoc(reel, tl, pre, stats) {
  const r = tl.rate;
  const mb = (stats.bytes / 1048576).toFixed(1);
  const rows = reel.clips.map((c, i) => {
    const src = c.state === 'slate' ? '— (slate)' : path.basename(c.file || '');
    return `| ${i + 1} | ${c.track} | ${c.shot || c.title || c.id} | ${c.tcIn} | ${c.frames} | ${c.secs.toFixed(2)} | ${c.kind} | ${src} | ${c.model || '—'} |`;
  });
  const missing = reel.clips.filter(c => c.state === 'slate');

  return `# Conform — ${reel.project} animatic

**Premiere Pro or DaVinci Resolve → open \`animatic.xml\`** (Premiere: File → Import.
Resolve: File → Import → Timeline → Pre-Conformed EDL/XML/AAF). It is Final Cut Pro 7 XML
(xmeml v5), the only timeline interchange Premiere imports.

**Final Cut Pro → open \`animatic.fcpxml\`** (File → Import → XML). Modern Final Cut cannot
read xmeml at all, which is why both files are here. Resolve reads either.

All media lives in \`media/\` beside the XML and every clip points there, so this folder relinks
as a unit. Move the whole folder, not the XML alone.

## Sequence

| | |
|---|---|
| Frame rate | ${r.label} fps ${tl.drop ? 'DF' : 'NDF'} |
| Resolution | ${reel.width} × ${reel.height} |
| Start timecode | ${tcStr(reel.tcStart, r, { drop: tl.drop })} |
| Duration | ${reel.totalTc} · ${reel.totalFrames} frames · ${humanDur(reel.totalFrames, r)} |
| Clips | ${reel.clips.length}${missing.length ? ` (${missing.length} slate${missing.length === 1 ? '' : 's'})` : ''} |
| Media | ${mb} MB · ${stats.linked} hardlinked, ${stats.copied} copied${stats.transcoded ? `, ${stats.transcoded} transcoded to PNG` : ''} |

## Clips

| # | track | clip | tc in | frames | secs | kind | source | model |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}
${missing.length ? `
## Missing — ${missing.length} shot${missing.length === 1 ? '' : 's'} has no approved take

These are in the cut at their intended length as black slates, so the pacing is right and the
holes are deliberate rather than dropped. Replace the slate clip when the shot is approved.

${missing.map(c => `- **${c.shot || c.title || c.id}** — ${c.frames} frames (${c.secs.toFixed(2)}s) — ${c.prompt || c.title || '(no prompt)'}`).join('\n')}
` : ''}${pre.warnings.length ? `
## Warnings

${pre.warnings.map(w => '- ' + w).join('\n')}
` : ''}
## Notes

- **Transitions export as hard cuts.** A dissolve needs handles on both sides of the edit and a
  held still has none, so shipping one that imports as a freeze would be worse than an honest cut.
  Each shot's intended transition rides along in the clip's log note.
- Shot ids and prompts are in the clip **Comment** columns (\`mastercomment1\` / \`mastercomment2\`)
  and in the logging info, so they survive the import and are searchable in the project panel.
- Generated by FrameForge — this is an animatic, not a locked cut.
`;
}

export const animaticPackDir = packDir;
