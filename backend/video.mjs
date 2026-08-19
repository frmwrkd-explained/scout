// Local video import — download (yt-dlp) or take an uploaded file, detect shot cuts with
// ffmpeg scene detection, extract one JPEG per shot into a temp dir, and let the user pick
// which frames to keep. Chosen frames are written into the board folder via saveContextFile,
// where the existing Groq auto-analyze loop tags them like any other image. Fully local:
// no cloud service is involved beyond the platform the video is downloaded from.
//
// A detected scene is a RANGE, not a frame. The job keeps `shots[i] = {s,e}` alongside the
// poster so two things stay possible after detection:
//   · retrim — the scene filter cuts on a luma delta, so it lands early on a whip pan and late
//     through a dissolve. `retrimVideoShot` moves either boundary (frame-stepped off the real
//     fps) and re-extracts the poster. Nothing is re-detected; the source file stays in tmpDir.
//   · contact sheet — `buildContactSheet` samples the trimmed range evenly and tiles the panels
//     into ONE labelled JPEG. That is the whole point of keeping the range: a vision model
//     reading a single still cannot see a move, and reading 12 loose stills cannot order them.
//     One sheet, panels numbered and time-stamped in reading order, is what makes "the car
//     enters frame-left in panel 1 and clears frame-right by panel 9" a writable prompt.
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { saveContextFile, appendActivity, bumpHistory, contextFilePath } from './store.mjs';
import { writeMeta } from './library.mjs';
import { resolveBin } from './jobs.mjs';

// ── binary resolution (env override → PATH → common install dirs) ──
// Candidates are validated with --version: a present-but-broken install (e.g. a homebrew
// yt-dlp with a torn python env) must not shadow a working one elsewhere.
const toolCache = new Map();
function resolveTool(envKey, name) {
  if (toolCache.has(name)) return toolCache.get(name);
  const candidates = [];
  if (process.env[envKey]) candidates.push(process.env[envKey]);
  // Windows has no `which` — spawnSync returns ENOENT — and where a Git Bash `which` IS on PATH it
  // answers in MSYS form (`/d/Downloads/…/ffprobe`), which fs.existsSync rejects. Every fallback
  // below is a POSIX path too, so resolveTool() returned null for ALL THREE tools on every Windows
  // machine: ffprobe measured nothing, so imported video got null width/height/fps/duration and was
  // cut at authored rather than real length, and reel render simply did not run. Verified on a real
  // box where `where ffprobe` found ffprobe.exe and videoToolsStatus() still reported all false.
  // resolveBin does the PATHEXT walk properly; the --version validation below still gates the pick.
  if (process.platform === 'win32') {
    const hit = resolveBin(name);
    if (hit) candidates.push(hit);
  } else {
    const w = spawnSync('which', ['-a', name], { encoding: 'utf8' });
    candidates.push(...(w.stdout || '').split('\n').map(s => s.trim()).filter(Boolean));
    candidates.push('/opt/homebrew/bin/' + name, path.join(os.homedir(), '.local', 'bin', name), '/usr/local/bin/' + name);
  }
  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    const v = spawnSync(c, [name === 'yt-dlp' ? '--version' : '-version'], { encoding: 'utf8', timeout: 15000 });
    if (v.status === 0) { toolCache.set(name, c); return c; }
  }
  toolCache.set(name, null);
  return null;
}
const tools = () => ({
  ytdlp: resolveTool('FRFG_YTDLP', 'yt-dlp'),
  ffmpeg: resolveTool('FRFG_FFMPEG', 'ffmpeg'),
  ffprobe: resolveTool('FRFG_FFPROBE', 'ffprobe')
});
// The resolved binaries, for other modules that shell out. Exported so backend/probe.mjs and the
// reel renderer reuse THIS resolution (env → PATH → common install dirs, each candidate validated
// with --version) instead of adding a second discovery strategy — backend/threed.mjs's bare
// execFile('ffmpeg') is the one that already drifted.
export const videoTools = tools;
export function videoToolsStatus() {
  const t = tools();
  return { ytdlp: !!t.ytdlp, ffmpeg: !!t.ffmpeg, ffprobe: !!t.ffprobe };
}

// Sensitivity → how readily a frame counts as a cut, plus frame cap and jpeg size.
//
// These used to be ABSOLUTE ffmpeg `scene` thresholds (0.5/0.4/0.3) and that was the single
// worst bug in this feature. ffmpeg's scene score is a normalised frame difference, so it
// scales with how much light is in the picture: on a dark, moody grade a real hard cut scores
// 0.10 while a bright daylight cut scores 0.6. Measured on the Lamborghini Temerario ad
// (136s, ~120 real cuts) the old numbers found 30 — so a single "scene" swallowed six shots,
// every contact sheet built on it mixed unrelated footage, and the move analyzer then read
// that soup as one confident static shot. A global line cannot separate cuts from content.
//
// `ratio` and `minScore` feed the adaptive detector below, which asks whether a frame SPIKES
// against its own neighbourhood instead of whether it clears a fixed bar. Same ad, same file:
// 122 cuts, including all seven inside the montage the old detector reported as one scene.
const QUALITY = {
  strict: { ratio: 4.0, minScore: 0.06,  maxFrames: 60,  maxWidth: 1280, jpegQ: 5, intervalSec: 10 },
  medium: { ratio: 3.0, minScore: 0.035, maxFrames: 140, maxWidth: 1600, jpegQ: 3, intervalSec: 6 },
  high:   { ratio: 2.5, minScore: 0.02,  maxFrames: 260, maxWidth: 1920, jpegQ: 2, intervalSec: 4 }
};
// A frame scoring this high is a cut whatever its neighbours did — a hard cut between two
// bright, unrelated frames does not need the ratio test to vouch for it.
const HARD_CUT = 0.45;
// Floor under the neighbourhood baseline. Locked-off footage has a baseline near zero, where
// any sensor noise divides into a huge ratio; without this the detector cuts every few frames
// through a static shot.
const BASE_FLOOR = 0.012;

// ── pure scene math ──────────────────────────────────────────────────────────────────────
// Exported and separately tested (tests/phase-video-sheet.test.mjs) because every one of these
// is a rule an agent could plausibly re-derive at a call site and get subtly wrong.

// The shortest a scene may be trimmed to. Below this the poster and the sheet sample the
// same instant N times and the sheet reads as a still.
export const MIN_SCENE_SEC = 0.35;

// ── adaptive cut detection ───────────────────────────────────────────────────────────────
// `rows` is every frame's { t, s } from ffmpeg's scene score. A cut is a LOCAL SPIKE: a frame
// whose score dwarfs the frames either side of it. That is the only test that survives a grade
// change, because it compares a frame against its own footage rather than against a constant.
//
// Structured after PySceneDetect's adaptive detector for the same reason it exists there —
// content detectors with a fixed threshold miss cuts in dark scenes and invent them in busy
// ones. Pure and exported so the behaviour is testable without ffmpeg.
export function adaptiveCuts(rows, { ratio = 3, minScore = 0.035, win = 3, minLen = 0.3 } = {}) {
  const n = rows.length;
  const spikes = [];
  for (let i = 0; i < n; i++) {
    const s = rows[i].s;
    if (!(s >= minScore)) continue;
    // Baseline is a TRIMMED mean — the lower half of the neighbourhood, not its average.
    // A dissolve or whip scores high for several frames running, and a plain average lets
    // those frames vouch for each other: each one's neighbourhood is full of the others, the
    // ratio collapses below the threshold, and the cut is missed ENTIRELY rather than being
    // reported several times. Averaging only the quiet half asks "how still is this footage
    // when nothing is happening", which is the question the ratio actually needs answered.
    const near = [];
    for (let k = i - win; k <= i + win; k++) {
      if (k < 0 || k >= n || k === i) continue;
      near.push(rows[k].s);
    }
    near.sort((a, b) => a - b);
    const quiet = near.slice(0, Math.max(1, Math.ceil(near.length / 2)));
    const base = Math.max(quiet.length ? quiet.reduce((a, b) => a + b, 0) / quiet.length : 0, BASE_FLOOR);
    if (s >= HARD_CUT || s / base >= ratio) spikes.push({ t: rows[i].t, s });
  }
  // A dissolve, a whip or a flash frame scores high for several frames running and is ONE cut.
  // Collapse a run to its strongest frame rather than emitting a burst of 40ms "scenes".
  const cuts = [];
  for (const c of spikes) {
    const last = cuts[cuts.length - 1];
    if (last && c.t - last.t < minLen) { if (c.s > last.s) cuts[cuts.length - 1] = c; }
    else cuts.push(c);
  }
  return cuts.map(c => c.t);
}

// Parse ffmpeg's `metadata=print` output into { t, s } rows. The score sits on the line AFTER
// the frame line, which is why this is a two-line walk and not a single regex.
export function parseSceneScores(text) {
  const lines = String(text).split('\n');
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(/pts_time:([\d.]+)/);
    if (!f) continue;
    const m = (lines[i + 1] || '').match(/scene_score=([\d.eE+-]+)/);
    if (!m) continue;
    const t = parseFloat(f[1]), s = parseFloat(m[1]);
    if (isFinite(t) && isFinite(s)) rows.push({ t, s });
  }
  return rows;
}

// ── panel sampling ───────────────────────────────────────────────────────────────────────
// Panels are sampled EVERY Nth FRAME, not spread evenly across the shot. Even spreading gave
// a fixed panel count whatever the shot's length, so a 0.8s transition and a 12s drive both
// came back as nine panels — far too coarse to read a whip on one and pointlessly dense on
// the other. A frame step is the unit an editor already thinks in, and it makes panel-to-panel
// distance mean the same thing on every sheet.
//
// The start is INSET by a frame: ffmpeg reports a cut at the pts of the first frame of the NEW
// shot, so the boundary frame itself often still carries the dissolve out of the previous one.
// `step` is returned because it may have been coarsened to respect `maxPanels`.
export function stepTimes(start, end, fps, step, maxPanels = 60) {
  const rate = fps > 0 ? fps : 25;
  const span = Math.max(0, end - start);
  const a = start + Math.min(1 / rate, span * 0.05);
  const b = Math.max(a, end - Math.min(1.5 / rate, span * 0.05));
  const usable = Math.max(0, b - a);
  let k = Math.max(1, Math.round(Number(step) || 1));
  // Coarsen rather than truncate: a sheet that silently stops halfway through the shot is a
  // lie about what the shot does. Better a wider step that still spans the whole thing.
  const fits = s => Math.floor((usable * rate) / s) + 1;
  while (fits(k) > maxPanels) k++;
  const n = Math.max(1, Math.min(maxPanels, fits(k)));
  if (n === 1) return { times: [(a + b) / 2], step: k, panels: 1 };
  return { times: Array.from({ length: n }, (_, i) => a + (i * k) / rate), step: k, panels: n };
}

// Grid for an arbitrary panel count. The old code offered only counts that tiled exactly
// (4/6/9/12…) because ffmpeg's `tile` is asked for one output frame and a half-empty grid is a
// partial flush — but that constraint drove the panel count, which is backwards. buildContactSheet
// now pads the final row with blank panels, so the count is free and this just picks a shape.
// Target is a slightly-wide sheet: cols ≈ sqrt(1.4 * n / panelAspect).
export function gridFor(n, panelAspect = 16 / 9) {
  const count = Math.max(1, Math.round(n));
  const cols = Math.max(1, Math.min(6, Math.round(Math.sqrt((1.4 * count) / panelAspect)) || 1));
  return { cols, rows: Math.ceil(count / cols) };
}

// Clamp a requested trim into the video. Order is enforced (end always follows start by at
// least MIN_SCENE_SEC) rather than rejected, so dragging a handle past its partner nudges
// instead of erroring.
export function clampShot({ start, end }, duration) {
  const dur = Math.max(MIN_SCENE_SEC, Number(duration) || 0);
  const s = Math.max(0, Math.min(Number(start) || 0, dur - MIN_SCENE_SEC));
  const e = Math.min(dur, Math.max(Number(end) || 0, s + MIN_SCENE_SEC));
  return { s: +s.toFixed(3), e: +e.toFixed(3) };
}

// Compact clock label for a panel stamp: 1:23.45, or 1:02:03.45 past the hour. NOT a timecode —
// shared/timecode.mjs owns frame conversion and resolves to a fixed rate table, which would
// mislabel an arbitrary 23.976 download. This only ever formats seconds.
export function clock(sec) {
  const t = Math.max(0, Number(sec) || 0);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t - h * 3600) / 60);
  const s = t - h * 3600 - m * 60;
  const ss = (s < 10 ? '0' : '') + s.toFixed(2);
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
}

// in-memory job table — imports are interactive and short-lived, no persistence needed
const jobs = new Map();
let seq = 0;

function run(bin, args, { onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', buf = '';
    child.stdout.on('data', d => {
      const s = d.toString(); stdout += s;
      if (onLine) { buf += s; const lines = buf.split(/\r|\n/); buf = lines.pop() || ''; for (const l of lines) if (l.trim()) onLine(l); }
    });
    child.stderr.on('data', d => { stderr += d.toString(); if (stderr.length > 10_000_000) stderr = stderr.slice(-8_000_000); });
    child.on('error', err => reject(new Error(bin + ': ' + err.message)));
    child.on('close', code => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function friendlyDownloadError(stderr) {
  if (/Sign in to confirm|age.?restricted/i.test(stderr)) return 'Video requires sign-in or is age-restricted — download it manually and use "local file" instead.';
  if (/Video unavailable|Private video/i.test(stderr)) return 'Video is unavailable or private — try another link, or use a local file.';
  if (/is not a valid URL|Unsupported URL/i.test(stderr)) return 'Not a valid video URL — paste a YouTube or Vimeo link.';
  if (/HTTP Error 429|Too Many Requests|rate.?limit/i.test(stderr)) return 'The platform is rate-limiting downloads — wait a few minutes, or use a local file.';
  return 'Download failed — you can download the video manually and use "local file" instead.';
}

export function getVideoJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  return { id: job.id, status: job.status, stage: job.stage, progress: job.progress, error: job.error,
    frames: job.frames.length, duration: job.duration, source: job.sourceLabel, folder: job.folder,
    fps: job.fps, cuts: job.cuts,
    // `v` is a poster revision, bumped by every retrim. The poster path never changes, so
    // without it the browser re-renders the cached image and a trim looks like a no-op.
    shots: job.shots.map(x => ({ s: x.s, e: x.e, s0: x.s0, e0: x.e0, v: x.v })),
    sheets: job.sheets.map(sheetView),
    labels: job.labels !== false };
}
const sheetView = s => ({ id: s.id, shot: s.shot, panels: s.panels, cols: s.cols, rows: s.rows,
  step: s.step, fps: s.fps, s: s.s, e: s.e, times: s.times, labelled: s.labelled });

export function videoJobFramePath(id, ix) {
  const job = jobs.get(id);
  const p = job && job.frames[Number(ix)];
  return p && fs.existsSync(p) ? p : null;
}
export function videoSheetPath(id, sid) {
  const job = jobs.get(id);
  const sheet = job && job.sheets.find(x => x.id === sid);
  return sheet && fs.existsSync(sheet.file) ? sheet.file : null;
}

export function discardVideoJob(id) {
  const job = jobs.get(id);
  if (!job) return false;
  jobs.delete(id);
  if (job.tmpDir) fs.rmSync(job.tmpDir, { recursive: true, force: true });
  return true;
}

// Write the selected frames and contact sheets into the board and clean the job up.
export function commitVideoJob(id, indices, sheetIds = []) {
  const job = jobs.get(id);
  if (!job) throw new Error('import job not found (it may have expired)');
  if (job.status !== 'ready') throw new Error('import is not ready yet');
  const base = job.sourceLabel.replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'video';
  const saved = [];
  for (const ix of indices) {
    const p = job.frames[Number(ix)];
    if (!p || !fs.existsSync(p)) continue;
    const name = base + '-shot-' + String(Number(ix) + 1).padStart(2, '0') + '.jpg';
    saved.push(saveContextFile(job.pid, name, fs.readFileSync(p), job.folder));
  }
  const sheets = [];
  for (const sid of sheetIds) {
    const sheet = job.sheets.find(x => x.id === sid);
    if (!sheet || !fs.existsSync(sheet.file)) continue;
    const name = base + '-scene-' + String(sheet.shot + 1).padStart(2, '0') + '-sheet.jpg';
    const rec = saveContextFile(job.pid, name, fs.readFileSync(sheet.file), job.folder);
    sheets.push(rec);
    // The panel→time map rides in the sidecar, not in a second note file. writeMeta merges onto
    // the RAW frontmatter, so this key survives the vision analyzer later writing `description`
    // over the top — the agent keeps a machine-readable index of what each panel is.
    const abs = contextFilePath(job.pid, rec.name, rec.folder);
    if (abs) writeMeta(abs, {
      kind: 'reference',
      contactSheet: {
        source: job.sourceLabel, scene: sheet.shot + 1, of: job.shots.length,
        in: +sheet.s.toFixed(3), out: +sheet.e.toFixed(3), seconds: +(sheet.e - sheet.s).toFixed(3),
        grid: sheet.cols + 'x' + sheet.rows, order: 'left-to-right, top-to-bottom',
        sampledEvery: sheet.step + ' frames @ ' + sheet.fps + 'fps',
        panels: sheet.times.map((t, i) => ({ panel: i + 1, at: clock(t), seconds: +t.toFixed(3) }))
      }
    });
  }
  bumpHistory('briefs');
  const what = [saved.length ? saved.length + ' frames' : '', sheets.length ? sheets.length + ' contact sheet' + (sheets.length === 1 ? '' : 's') : '']
    .filter(Boolean).join(' + ') || 'nothing';
  appendActivity({ dot: 'amber', t: 'Video import', t2: '· ' + what + ' → ' + (job.folder || 'unsorted'),
    s: job.pid + ' — ' + job.sourceLabel + ' · shot-cut detection', kind: 'proj', ref: job.pid });
  discardVideoJob(id);
  return saved.concat(sheets);
}

// ── the pipeline ──
export function startVideoImport({ pid, url, filePath, sourceLabel, folder = '', quality = 'medium' }) {
  const t = tools();
  if (!t.ffmpeg || !t.ffprobe) throw new Error('ffmpeg/ffprobe not found — install with: brew install ffmpeg');
  if (url && !t.ytdlp) throw new Error('yt-dlp not found — install with: brew install yt-dlp');

  const id = 'vi' + Date.now().toString(36) + (seq++);
  const job = {
    id, pid, folder, status: 'working', stage: url ? 'Downloading' : 'Detecting cuts', progress: 2,
    // The sweep below ages jobs off this field. It used to re-derive the timestamp from the id,
    // but the id concatenates the base36 clock and the sequence number with no separator, so the
    // parse read `<ts><seq>` as one base36 number (~36x too large) and the computed age was always
    // hugely NEGATIVE — the sweep never fired for any job, ever, and every tmpDir (which holds a
    // full downloaded video) leaked until the process died.
    startedAt: Date.now(),
    error: null, frames: [], duration: 0,
    // retained past detection so a scene can be re-cut and re-sampled without touching yt-dlp
    // or the scene filter again: the source file, its real geometry, every detected cut, and
    // the live in/out of each scene.
    video: null, fps: 0, width: 0, height: 0, cuts: [], shots: [], sheets: [], atCache: new Map(),
    cfg: QUALITY[quality] || QUALITY.medium,
    sourceLabel: sourceLabel || (url ? url : path.basename(filePath || '')),
    tmpDir: fs.mkdtempSync(path.join(os.tmpdir(), 'frameforge-video-'))
  };
  jobs.set(id, job);
  runPipeline(job, { url, filePath, cfg: job.cfg, t })
    .catch(e => { job.status = 'failed'; job.error = e.friendly || e.message || 'Import failed'; });
  return getVideoJob(id);
}

async function runPipeline(job, { url, filePath, cfg, t }) {
  // 1. source file
  let video = filePath;
  if (url) {
    const out = path.join(job.tmpDir, 'source.%(ext)s');
    const onLine = l => { const m = l.match(/\[download\]\s+([\d.]+)%/); if (m) job.progress = Math.min(45, 2 + parseFloat(m[1]) * 0.43); };
    // Attempt 1: best merged mp4. Attempt 2: android player client with a single-file format —
    // YouTube's SABR streaming 403s the web-client formats on some videos (yt-dlp #12482).
    const attempts = [
      ['-f', 'bv*[height<=1080][ext=mp4]+ba/b[height<=1080]/b', '--merge-output-format', 'mp4'],
      ['--extractor-args', 'youtube:player_client=android', '-f', 'b[height<=1080]/b']
    ];
    const titleFile = path.join(job.tmpDir, 'title.txt');
    let r = null;
    for (const extra of attempts) {
      r = await run(t.ytdlp, [...extra, '--no-playlist', '--newline', '--print-to-file', '%(title)s', titleFile, '-o', out, url], { onLine });
      if (!jobs.has(job.id)) return; // discarded mid-flight
      if (r.code === 0 && fs.readdirSync(job.tmpDir).some(f => f.startsWith('source.'))) break;
      job.progress = 5; // reset the bar for the retry
    }
    const dl = fs.readdirSync(job.tmpDir).find(f => f.startsWith('source.'));
    if (!dl) { const e = new Error('yt-dlp: ' + (r?.stderr || '').slice(-400)); e.friendly = friendlyDownloadError(r?.stderr || ''); throw e; }
    video = path.join(job.tmpDir, dl);
    // saved frames are named after the video title, not the URL slug
    try { const title = fs.readFileSync(titleFile, 'utf8').trim().split('\n')[0]; if (title) job.sourceLabel = title; } catch { /* keep URL label */ }
  }

  // 2. geometry — duration, pixel size and real fps in ONE probe. Size sets the contact sheet's
  // panel aspect (a sheet built on a guessed 16:9 letterboxes every vertical reference) and fps
  // gives the trim controls a true one-frame step.
  job.stage = 'Detecting cuts'; job.progress = Math.max(job.progress, 46);
  job.video = video;
  const pr = await run(t.ffprobe, ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'format=duration:stream=width,height,avg_frame_rate', '-of', 'json', video]);
  let meta = {};
  try { meta = JSON.parse(pr.stdout || '{}'); } catch { /* handled by the isFinite check below */ }
  const duration = parseFloat(meta.format?.duration);
  if (pr.code !== 0 || !isFinite(duration)) { const e = new Error('ffprobe failed'); e.friendly = 'Could not read this video — it may be corrupted or an unsupported format.'; throw e; }
  if (duration < 3) { const e = new Error('too short'); e.friendly = 'Video is too short to split into scenes — add it as a normal media file instead.'; throw e; }
  job.duration = duration;
  const vs = meta.streams?.[0] || {};
  job.width = Number(vs.width) || 0;
  job.height = Number(vs.height) || 0;
  // avg_frame_rate is a rational ("24000/1001"), and it is "0/0" for a stream ffprobe cannot
  // rate — guard the divide rather than shipping NaN to the frame-step control.
  const [fn, fd] = String(vs.avg_frame_rate || '').split('/').map(Number);
  job.fps = fn && fd ? +(fn / fd).toFixed(3) : 0;

  // 3. shot-cut detection. Score EVERY frame (`gte(scene,0)`) and decide in JS, rather than
  // asking ffmpeg to pre-filter with `gt(scene,<threshold>)` — the threshold was the bug, and
  // a pre-filtered list cannot be re-judged because the neighbourhood scores are gone.
  // metadata=print goes to a file: its output is large (one pair of lines per frame) and would
  // otherwise interleave with ffmpeg's own stderr.
  const scoreFile = path.join(job.tmpDir, 'scores.txt');
  await run(t.ffmpeg, ['-i', video, '-vf', `select='gte(scene,0)',metadata=print:file=${scoreFile}`,
    '-fps_mode', 'vfr', '-f', 'null', '-']);
  if (!jobs.has(job.id)) return;
  let scored = [];
  try { scored = parseSceneScores(fs.readFileSync(scoreFile, 'utf8')); } catch { /* handled below */ }
  const cuts = adaptiveCuts(scored, { ratio: cfg.ratio, minScore: cfg.minScore })
    .filter(c => c > 0.2 && c < duration - 0.2);
  job.cuts = cuts;
  job.progress = 55;

  // one RANGE per shot; interval slicing when the film has no detectable cuts. The poster is the
  // midpoint of the range — but the range is what gets kept, because retrim and the contact sheet
  // both need boundaries, and re-deriving them from a bare midpoint is impossible.
  let shots;
  if (cuts.length < 2) {
    const n = Math.max(6, Math.min(cfg.maxFrames, Math.round(duration / cfg.intervalSec)));
    shots = Array.from({ length: n }, (_, i) => ({ s: (duration * i) / n, e: (duration * (i + 1)) / n }));
  } else {
    const bounds = [0, ...cuts, duration];
    shots = [];
    // 0.25s ≈ 6 frames at 25fps. Quick-cut ad grammar really does run shots this short, and
    // the old 0.4s floor deleted them — which then merged their footage into the neighbour.
    for (let i = 0; i < bounds.length - 1; i++) if (bounds[i + 1] - bounds[i] >= 0.25) shots.push({ s: bounds[i], e: bounds[i + 1] });
    if (shots.length > cfg.maxFrames) {
      shots = shots.slice().sort((a, b) => (b.e - b.s) - (a.e - a.s)).slice(0, cfg.maxFrames).sort((a, b) => a.s - b.s);
    }
  }

  // 4. extract one poster JPEG per shot. A shot whose poster fails to extract is dropped whole:
  // frames[i] and shots[i] index the same scene everywhere downstream, so they must stay aligned.
  job.stage = 'Extracting frames';
  for (let i = 0; i < shots.length; i++) {
    if (!jobs.has(job.id)) return;
    const out = path.join(job.tmpDir, 'frame_' + String(i).padStart(3, '0') + '.jpg');
    const ok = await extractPoster(job, t, out, (shots[i].s + shots[i].e) / 2);
    // s0/e0 keep the range the detector proposed, so "reset" survives any amount of trimming.
    if (ok) { job.frames.push(out); job.shots.push({ s: shots[i].s, e: shots[i].e, s0: shots[i].s, e0: shots[i].e, v: 1, file: out }); }
    job.progress = 55 + Math.round(((i + 1) / shots.length) * 43);
  }
  if (!job.frames.length) { const e = new Error('no frames'); e.friendly = 'Could not extract any frames from this video.'; throw e; }

  job.status = 'ready'; job.stage = 'Pick your frames'; job.progress = 100;
}

// One poster frame at `at`, written to `out`. Returns whether a non-empty file landed.
async function extractPoster(job, t, out, at) {
  const cfg = job.cfg;
  const r = await run(t.ffmpeg, ['-ss', Math.max(0, at).toFixed(3), '-i', job.video, '-frames:v', '1',
    '-q:v', String(cfg.jpegQ), '-vf', `scale='min(${cfg.maxWidth},iw)':-2`, '-y', out]);
  return r.code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0;
}

// ── scene trim ───────────────────────────────────────────────────────────────────────────
// Move either boundary of an already-detected scene and re-cut its poster. The scene filter
// fires on a luma delta, which lands early on a whip pan and late through a dissolve, so the
// range it hands back is a proposal — this is where it becomes the user's.
export async function retrimVideoShot(id, ix, { start, end }) {
  const job = jobs.get(id);
  if (!job) throw new Error('import job not found (it may have expired)');
  if (job.status !== 'ready') throw new Error('import is not ready yet');
  const shot = job.shots[Number(ix)];
  if (!shot) throw new Error('no such scene');
  const next = clampShot({ start: start ?? shot.s, end: end ?? shot.e }, job.duration);
  shot.s = next.s; shot.e = next.e; shot.v++;
  // Sheets are built off the boundaries, so a retrim invalidates every sheet on this scene.
  // Dropping them beats showing a sheet whose header no longer describes its own panels.
  for (const sheet of job.sheets.filter(x => x.shot === Number(ix))) {
    fs.rmSync(sheet.file, { force: true });
    job.sheets.splice(job.sheets.indexOf(sheet), 1);
  }
  await extractPoster(job, tools(), shot.file, (shot.s + shot.e) / 2);
  return { s: shot.s, e: shot.e, v: shot.v };
}

// A frame at an arbitrary instant, for scrubbing the in/out handles. Cached per 1/20s so
// holding a nudge key does not respawn ffmpeg for a timestamp already on disk.
export async function videoFrameAt(id, at) {
  const job = jobs.get(id);
  if (!job || !job.video) return null;
  const t = Math.max(0, Math.min(Number(at) || 0, job.duration));
  const key = t.toFixed(2);
  if (job.atCache.has(key)) return job.atCache.get(key);
  const out = path.join(job.tmpDir, 'at_' + key.replace('.', '_') + '.jpg');
  if (!fs.existsSync(out)) {
    const r = await run(tools().ffmpeg, ['-ss', t.toFixed(3), '-i', job.video, '-frames:v', '1',
      '-q:v', '4', '-vf', `scale='min(960,iw)':-2`, '-y', out]);
    if (r.code !== 0 || !fs.existsSync(out) || !fs.statSync(out).size) return null;
  }
  // Bounded so a long scrub cannot fill the temp dir with stills.
  if (job.atCache.size > 240) { const first = job.atCache.keys().next().value; fs.rmSync(job.atCache.get(first), { force: true }); job.atCache.delete(first); }
  job.atCache.set(key, out);
  return out;
}

// ── contact sheets ───────────────────────────────────────────────────────────────────────
// drawtext needs libfreetype in the ffmpeg build AND a font file on disk; neither is
// guaranteed. Both are probed once, and a miss degrades to an unlabelled sheet rather than
// failing the build — the .meta.md sidecar still carries the panel→time map either way.
const FONTS = [
  process.env.FRFG_SHEET_FONT,
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
  'C:/Windows/Fonts/arial.ttf',
  'C:/Windows/Fonts/segoeui.ttf'
];
let fontCache;
function sheetFont() {
  if (fontCache !== undefined) return fontCache;
  const t = tools();
  const filters = t.ffmpeg ? spawnSync(t.ffmpeg, ['-hide_banner', '-filters'], { encoding: 'utf8' }).stdout || '' : '';
  if (!/\bdrawtext\b/.test(filters)) return (fontCache = null);
  fontCache = FONTS.find(f => f && fs.existsSync(f)) || null;
  return fontCache;
}
// Filtergraph escaping. We spawn with an argv array so there is no shell to appease, but the
// graph parser still eats ':' as an option separator and '%' as an expansion sigil.
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/%/g, '\\%').replace(/:/g, '\\:');
const escPath = p => String(p).replace(/\\/g, '/').replace(/:/g, '\\:');
// A downloaded title can hold anything; keep the header to characters a Latin font certainly has.
const plain = s => String(s).replace(/[^\w \-.,()&/|+]+/g, '').trim().slice(0, 78);
const even = n => { const v = Math.max(2, Math.round(n)); return v % 2 ? v + 1 : v; };

export const MAX_PANELS = 60;

export async function buildContactSheet(id, ix, { step = 5, panels } = {}) {
  const job = jobs.get(id);
  if (!job) throw new Error('import job not found (it may have expired)');
  if (job.status !== 'ready') throw new Error('import is not ready yet');
  const shotIx = Number(ix);
  const shot = job.shots[shotIx];
  if (!shot) throw new Error('no such scene');
  const t = tools();
  const ar = job.width && job.height ? job.width / job.height : 16 / 9;
  // `panels` (a target count) is still accepted so an existing caller keeps working; it is
  // converted to the equivalent frame step so there is only ONE sampling rule underneath.
  const rate = job.fps > 0 ? job.fps : 25;
  const wantStep = panels ? Math.max(1, Math.round(((shot.e - shot.s) * rate) / Math.max(1, panels))) : step;
  const sampled = stepTimes(shot.s, shot.e, rate, wantStep, MAX_PANELS);
  const times = sampled.times;
  const layout = { ...gridFor(times.length, ar), panels: times.length };
  const font = sheetFont();

  // Target ~2400px across whatever the grid is: wide enough for a vision model to read a
  // licence plate in a 6-up, small enough to stay a sane attachment.
  const panelW = even(Math.max(300, Math.min(700, 2400 / layout.cols)));
  const panelH = even(panelW / ar);
  const fontSize = Math.max(12, Math.round(panelW / 30));
  const barH = Math.round(fontSize * 1.7);

  const dir = fs.mkdtempSync(path.join(job.tmpDir, 'sheet-'));
  for (let i = 0; i < times.length; i++) {
    if (!jobs.has(job.id)) throw new Error('import job was discarded');
    const out = path.join(dir, 'panel_' + String(i).padStart(3, '0') + '.jpg');
    // force_original_aspect_ratio + pad, not a bare scale: tile demands identical inputs, and a
    // source with a non-square sample aspect would otherwise hand it mismatched panels.
    const vf = [
      `scale=${panelW}:${panelH}:force_original_aspect_ratio=decrease`,
      `pad=${panelW}:${panelH}:(ow-iw)/2:(oh-ih)/2:color=0x0d0e11`
    ];
    if (font) {
      const label = String(i + 1).padStart(2, '0') + '   ' + clock(times[i]);
      // drawbox and drawtext do NOT share an expression vocabulary: drawbox knows `iw`/`ih`,
      // drawtext only knows `w`/`h`. Writing `y=ih-20` in the drawtext fails the whole graph
      // with "Undefined constant", which here means every labelled sheet silently refuses to
      // build. tests/phase-video-sheet.test.mjs guards the two apart.
      vf.push(`drawbox=x=0:y=ih-${barH}:w=iw:h=${barH}:color=0x000000@0.66:t=fill`);
      vf.push(`drawtext=fontfile='${escPath(font)}':text='${esc(label)}':fontcolor=0xE3FF32:fontsize=${fontSize}:x=${Math.round(fontSize * 0.6)}:y=h-${barH - Math.round(barH * 0.22)}`);
    }
    const r = await run(t.ffmpeg, ['-ss', times[i].toFixed(3), '-i', job.video, '-frames:v', '1',
      '-q:v', '2', '-vf', vf.join(','), '-y', out]);
    if (r.code !== 0 || !fs.existsSync(out) || !fs.statSync(out).size) {
      fs.rmSync(dir, { recursive: true, force: true });
      const e = new Error('panel extract failed'); e.friendly = 'Could not read frames for that scene — try trimming it slightly.'; throw e;
    }
  }

  // Pad the final row so the grid is exactly cols×rows. `tile` is asked for ONE output frame,
  // and a grid with empty slots is a partial flush that emits nothing — this is what used to
  // force the panel count to be a tiling number, which in turn forced even-spread sampling.
  // A blank tail panel costs one ffmpeg call and buys an arbitrary panel count.
  const slots = layout.cols * layout.rows;
  if (slots > times.length) {
    const blank = path.join(dir, 'panel_' + String(times.length).padStart(3, '0') + '.jpg');
    const br = await run(t.ffmpeg, ['-f', 'lavfi', '-i', `color=c=0x0d0e11:s=${panelW}x${panelH}`, '-frames:v', '1', '-y', blank]);
    if (br.code !== 0 || !fs.existsSync(blank)) {
      fs.rmSync(dir, { recursive: true, force: true });
      const e = new Error('blank panel failed'); e.friendly = 'Could not assemble the contact sheet.'; throw e;
    }
    for (let i = times.length + 1; i < slots; i++) fs.copyFileSync(blank, path.join(dir, 'panel_' + String(i).padStart(3, '0') + '.jpg'));
  }

  const sid = 's' + Date.now().toString(36) + (seq++);
  const file = path.join(job.tmpDir, 'sheet_' + sid + '.jpg');
  const tiled = path.join(dir, 'tiled.jpg');
  const tr = await run(t.ffmpeg, ['-start_number', '0', '-i', path.join(dir, 'panel_%03d.jpg'),
    '-vf', `tile=${layout.cols}x${layout.rows}:padding=6:margin=10:color=0x0d0e11`, '-frames:v', '1', '-q:v', '2', '-y', tiled]);
  if (tr.code !== 0 || !fs.existsSync(tiled)) {
    fs.rmSync(dir, { recursive: true, force: true });
    const e = new Error('tile failed: ' + tr.stderr.slice(-300)); e.friendly = 'Could not assemble the contact sheet.'; throw e;
  }

  // Header strip: the sheet has to say what it is, because it leaves here as a standalone JPEG
  // that an agent may read with no other context attached.
  if (font) {
    const headH = Math.max(44, Math.round(fontSize * 3.4));
    const h1 = Math.round(fontSize * 1.15), h2 = Math.round(fontSize * 0.92);
    const line1 = plain(job.sourceLabel) + '  |  scene ' + (shotIx + 1) + ' of ' + job.shots.length;
    const line2 = 'in ' + clock(shot.s) + '   out ' + clock(shot.e) + '   ' + (shot.e - shot.s).toFixed(2) + 's   '
      + layout.panels + ' panels, every ' + sampled.step + ' frame' + (sampled.step === 1 ? '' : 's')
      + ' at ' + rate + 'fps   ' + layout.cols + 'x' + layout.rows + '   read left to right, top to bottom';
    const hr = await run(t.ffmpeg, ['-i', tiled, '-vf', [
      `pad=iw:ih+${headH}:0:${headH}:color=0x0d0e11`,
      `drawtext=fontfile='${escPath(font)}':text='${esc(line1)}':fontcolor=0xF2F3F5:fontsize=${h1}:x=14:y=${Math.round(headH * 0.16)}`,
      `drawtext=fontfile='${escPath(font)}':text='${esc(line2)}':fontcolor=0x8B9096:fontsize=${h2}:x=14:y=${Math.round(headH * 0.56)}`
    ].join(','), '-frames:v', '1', '-q:v', '2', '-y', file]);
    if (hr.code !== 0 || !fs.existsSync(file)) fs.copyFileSync(tiled, file); // header is a garnish, never a failure
  } else {
    fs.copyFileSync(tiled, file);
  }
  fs.rmSync(dir, { recursive: true, force: true });

  const sheet = { id: sid, shot: shotIx, file, panels: layout.panels, cols: layout.cols, rows: layout.rows,
    step: sampled.step, fps: rate, s: shot.s, e: shot.e, times: times.map(x => +x.toFixed(3)), labelled: !!font };
  job.sheets.push(sheet);
  return sheetView(sheet);
}

export function discardContactSheet(id, sid) {
  const job = jobs.get(id);
  const sheet = job && job.sheets.find(x => x.id === sid);
  if (!sheet) return false;
  fs.rmSync(sheet.file, { force: true });
  job.sheets.splice(job.sheets.indexOf(sheet), 1);
  return true;
}

// Stale-job sweep: an abandoned picker (user closed the tab) shouldn't leak temp dirs forever.
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
setInterval(() => {
  for (const [id, job] of jobs) {
    if (Date.now() - (job.startedAt || 0) > STALE_AFTER_MS) discardVideoJob(id);
  }
}, 10 * 60 * 1000).unref();
