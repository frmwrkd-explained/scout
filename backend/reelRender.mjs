// Render the multi-track reel to an mp4, fully locally.
//
// PASS 1 — one normalised segment per clip. Every source (still, video take, slate) is encoded to
// the SAME codec, size, pixel format and frame rate, with its in-point and length baked in.
//
// PASS 2 — composite. V1 is laid onto a black canvas of the full timeline length (so GAPS are
// real black, not a missing stream), then each V2 clip is overlaid only during its own span, then
// the audio lanes are delayed to their offsets and mixed.
//
// NOTE on the concat gotcha: the demuxer's `duration` directive is not used anywhere here. The
// well-known "list the last file twice" trick applies to feeding raw stills with `duration` lines;
// baking each clip's length into its own segment in pass 1 removes the failure mode entirely.
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getStorageRoot, safeScope, safe, appendActivity } from './store.mjs';
import { videoTools } from './video.mjs';
import { buildReel, isAudioTrack } from './reel.mjs';
import { animaticPackDir } from './reelPack.mjs';

const outDir = pid => path.join(getStorageRoot(), 'projects', safeScope(pid), 'cuts');

const jobs = new Map();
let seq = 0;
export const getRenderJob = id => jobs.get(String(id)) || null;

function run(bin, args, { onProgress, totalFrames } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stdout.on('data', d => {
      if (!onProgress) return;
      for (const line of d.toString().split('\n')) {
        const m = line.match(/^frame=(\d+)/);
        if (m && totalFrames) onProgress(Math.min(1, Number(m[1]) / totalFrames));
      }
    });
    child.stderr.on('data', d => { err += d.toString(); if (err.length > 400000) err = err.slice(-200000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve()
      : reject(new Error(err.split('\n').filter(Boolean).slice(-4).join(' · ') || ('ffmpeg exited ' + code))));
  });
}

const even = n => (n % 2 ? n - 1 : n);

export async function renderReel(pid, { onProgress } = {}) {
  const { ffmpeg } = videoTools();
  if (!ffmpeg) {
    const e = new Error('ffmpeg is not installed, so the mp4 render is unavailable. The XML export and playback do not need it. Install ffmpeg (brew install ffmpeg) and try again.');
    e.code = 'no-ffmpeg';
    throw e;
  }

  const reel = await buildReel(pid);
  if (!reel.clips.length) throw new Error('The timeline is empty — nothing to render.');

  const pack = animaticPackDir(pid);
  const mediaDir = path.join(pack, 'media');
  if (!fs.existsSync(mediaDir)) throw new Error("Export the animatic first — the render reuses the pack's media/ folder.");

  const W = even(reel.width), H = even(reel.height);
  const fps = reel.fps;
  const total = reel.totalFrames;
  const segDir = path.join(outDir(pid), '.segments');
  fs.rmSync(segDir, { recursive: true, force: true });
  fs.mkdirSync(segDir, { recursive: true });

  const files = fs.readdirSync(mediaDir);
  // the pack names every clip <ord>_<stem>_… in clip order, so index alignment is exact
  const packFileFor = (c, i) => {
    const ord = String(i + 1).padStart(3, '0');
    const hit = files.find(f => f.startsWith(ord + '_'));
    return hit ? path.join(mediaDir, hit) : null;
  };

  const video = [], audio = [];
  let done = 0;

  for (let i = 0; i < reel.clips.length; i++) {
    const c = reel.clips[i];
    const src = packFileFor(c, i);
    if (!src) throw new Error('No media in the pack for ' + (c.shot || c.id) + ' — re-export the animatic.');
    const secs = c.frames / fps;
    const isVid = /\.(mp4|mov|webm|mkv|m4v|avi)$/i.test(src);

    if (isAudioTrack(c.track)) {
      const seg = path.join(segDir, 'a' + i + '.m4a');
      await run(ffmpeg, ['-y', '-ss', String((c.in || 0) / fps), '-i', src, '-t', String(secs),
        '-vn', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', seg]);
      audio.push({ seg, offset: c.offset / fps });
    } else {
      const seg = path.join(segDir, 'v' + i + '.mp4');
      const args = isVid
        ? ['-y', '-ss', String((c.in || 0) / fps), '-i', src, '-t', String(secs)]
        : ['-y', '-loop', '1', '-i', src, '-t', String(secs)];
      args.push(
        // scale+pad into the sequence frame: a 4:5 still and a 16:9 clip both letterbox rather
        // than stretch, matching what the XML tells the NLE
        '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${fps},format=yuv420p`,
        '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        '-r', String(fps), '-video_track_timescale', String(Math.round(fps * 1000)), seg
      );
      await run(ffmpeg, args);
      video.push({ seg, track: c.track, start: c.offset / fps, end: (c.offset + c.frames) / fps });
    }
    done++;
    onProgress && onProgress(0.8 * (done / reel.clips.length));
  }

  // ── pass 2: composite onto a black canvas of the full length ──
  const out = path.join(outDir(pid), 'animatic.mp4');
  const args = ['-y', '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${fps}:d=${(total / fps).toFixed(4)}`];
  for (const v of video) args.push('-i', v.seg);
  for (const a of audio) args.push('-i', a.seg);

  const filter = [];
  let cur = '[0:v]';
  // V1 first, then V2 on top — the array is already in track-stack order from buildReel
  const ordered = [...video].sort((a, b) => (a.track === b.track ? a.start - b.start : (a.track === 'V1' ? -1 : 1)));
  ordered.forEach((v, n) => {
    const idx = video.indexOf(v) + 1;
    // tpad shifts the segment to its timeline offset so overlay's `enable` window lines up with
    // the segment's own content, then the window keeps it off-screen everywhere else
    filter.push(`[${idx}:v]tpad=start_duration=${v.start.toFixed(4)}:start_mode=add:color=black,setpts=PTS-STARTPTS[s${n}]`);
    const next = `[o${n}]`;
    filter.push(`${cur}[s${n}]overlay=x=0:y=0:eof_action=pass:enable='between(t,${v.start.toFixed(4)},${(v.end - 1 / fps).toFixed(4)})'${next}`);
    cur = next;
  });
  filter.push(`${cur}format=yuv420p[vout]`);

  let map = ['-map', '[vout]'];
  if (audio.length) {
    audio.forEach((a, n) => {
      const idx = video.length + n + 1;
      filter.push(`[${idx}:a]adelay=${Math.round(a.offset * 1000)}|${Math.round(a.offset * 1000)}[ad${n}]`);
    });
    filter.push(audio.map((_, n) => `[ad${n}]`).join('') + `amix=inputs=${audio.length}:dropout_transition=0:normalize=0[aout]`);
    map = map.concat(['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k']);
  }

  await run(ffmpeg, [
    ...args, '-filter_complex', filter.join(';'), ...map,
    '-t', String((total / fps).toFixed(4)),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', String(fps),
    '-movflags', '+faststart', '-progress', 'pipe:1', out
  ], { onProgress: p => onProgress && onProgress(0.8 + 0.2 * p), totalFrames: total });

  onProgress && onProgress(1);
  try { fs.rmSync(segDir, { recursive: true, force: true }); } catch { /* best-effort */ }

  // Verify by COUNTING FRAMES, never by trusting the exit code — ffmpeg exits 0 on partial writes.
  const actual = await countFrames(out);
  return {
    file: out, frames: total, actualFrames: actual,
    ok: actual == null || Math.abs(actual - total) <= 2,
    width: W, height: H, fps: reel.rate,
    tracks: { video: video.length, audio: audio.length },
    bytes: fs.existsSync(out) ? fs.statSync(out).size : 0
  };
}

function countFrames(file) {
  const { ffprobe } = videoTools();
  if (!ffprobe) return Promise.resolve(null);
  return new Promise(resolve => {
    const child = spawn(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
      '-show_entries', 'stream=nb_read_frames', '-of', 'default=nokey=1:noprint_wrappers=1', file]);
    let o = '';
    child.stdout.on('data', d => { o += d.toString(); });
    child.on('close', () => resolve(Number(o.trim()) || null));
    child.on('error', () => resolve(null));
  });
}

export function registerRenderRoutes(app, { reveal } = {}) {
  app.post('/api/reel/:pid/render', (req, res) => {
    const { ffmpeg } = videoTools();
    if (!ffmpeg) return res.status(400).json({ error: 'ffmpeg is not installed — the mp4 render needs it. XML export and playback do not.', code: 'no-ffmpeg' });
    const id = 'rr' + (++seq);
    const job = { id, pid: req.params.pid, status: 'running', progress: 0, startedAt: Date.now(), file: null, error: null };
    jobs.set(id, job);
    renderReel(req.params.pid, { onProgress: p => { job.progress = p; } })
      .then(r => {
        Object.assign(job, { status: 'done', progress: 1, file: r.file, result: r, finishedAt: Date.now() });
        appendActivity({
          dot: 'green', t: 'Animatic rendered', t2: '· ' + (r.bytes / 1048576).toFixed(1) + ' MB',
          s: req.params.pid + ' — ' + r.file, kind: 'proj', ref: req.params.pid
        });
        if (reveal) { try { reveal(r.file, true); } catch { /* best-effort */ } }
      })
      .catch(e => { Object.assign(job, { status: 'failed', error: e.message, finishedAt: Date.now() }); });
    res.json(job);
  });

  app.get('/api/reel/:pid/render/:id', (req, res) => {
    const j = jobs.get(String(req.params.id));
    if (!j) return res.status(404).json({ error: 'no such render job' });
    res.json(j);
  });
}

export function __resetRenderJobsForTests() { jobs.clear(); seq = 0; }
