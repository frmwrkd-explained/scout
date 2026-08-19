// Measure a media file: real dimensions, real frame rate, real length.
//
// Why this exists: backend/imageSize.mjs:51-52 explicitly declines to parse MP4 ("MP4 dimensions
// live deep in the box tree; not worth parsing here"), so video generations carry width/height
// null. That is fine for a thumbnail and fatal for an export — an xmeml <file> with a hollow
// <samplecharacteristics> imports OFFLINE, and a clip laid down at its authored 4s when the file
// is really 5s produces a timeline that does not match the picture.
//
// This is NOT a new source of truth. generate.mjs already persists width/height for images onto
// the generation record; this completes the same field for video and adds the two the exporter
// additionally needs (srcFps, srcFrames).
import fs from 'fs';
import { execFile } from 'child_process';
import { videoTools } from './video.mjs';
import imageSize from './imageSize.mjs';

// Memoised on path + mtime + size: a re-roll writes a new file with a new name, and an edited
// file changes mtime, so a stale entry cannot survive a real change.
const cache = new Map();
const keyFor = (file, st) => file + ':' + st.mtimeMs + ':' + st.size;

const VIDEO_EXTS = ['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi'];
export const isVideoFile = f => VIDEO_EXTS.includes(String(f).split('.').pop().toLowerCase());

function ffprobeSync(bin, file) {
  return new Promise(resolve => {
    execFile(bin, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate,nb_frames,duration',
      '-show_entries', 'format=duration',
      '-of', 'json', file
    ], { timeout: 20000 }, (err, stdout) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}

// r_frame_rate arrives as '30000/1001' or '25/1'. Never parse it as a float first — 29.97 and
// 30 are different sequences and rounding them together is how a 30fps take silently conforms
// one frame short per second.
function parseRational(s) {
  const m = String(s || '').match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return null;
  const num = Number(m[1]), den = Number(m[2]);
  if (!den || !Number.isFinite(num)) return null;
  return num / den;
}

// Returns { width, height, fps, frames, duration, kind } or null when the file cannot be measured.
// Never throws: a missing ffprobe degrades to image-header parsing, and a missing file returns null.
export async function probeMedia(file) {
  if (!file) return null;
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const k = keyFor(file, st);
  if (cache.has(k)) return cache.get(k);

  let out = null;
  if (isVideoFile(file)) {
    const bin = videoTools().ffprobe;
    if (bin) {
      const j = await ffprobeSync(bin, file);
      const s = j && j.streams && j.streams[0];
      if (s) {
        const fps = parseRational(s.r_frame_rate);
        const duration = Number(s.duration) || Number(j.format && j.format.duration) || 0;
        // nb_frames is absent or '0' in plenty of real files (fragmented mp4, webm) — derive
        // from duration × fps in that case rather than exporting a zero-length clip.
        let frames = Number(s.nb_frames) || 0;
        if (!frames && fps && duration) frames = Math.round(duration * fps);
        out = {
          width: Number(s.width) || null, height: Number(s.height) || null,
          fps: fps || null, frames: frames || null, duration: duration || null, kind: 'video'
        };
      }
    }
    // ffprobe absent or failed: we know it is video but nothing else. The caller must fall back
    // to the authored duration and must NOT pretend to know the dimensions.
    if (!out) out = { width: null, height: null, fps: null, frames: null, duration: null, kind: 'video' };
  } else {
    let dim = null;
    try { dim = imageSize(fs.readFileSync(file)); } catch { /* unreadable or unsupported header */ }
    out = {
      width: dim ? dim.width : null, height: dim ? dim.height : null,
      fps: null, frames: null, duration: null, kind: 'image'
    };
  }

  cache.set(k, out);
  return out;
}

export function __resetProbeCacheForTests() { cache.clear(); }
