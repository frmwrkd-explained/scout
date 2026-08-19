// The Reel — a real multi-track timeline, per project. projects/<pid>/reel.md
//
// v2 MODEL (replaces the derived single-lane strip). A clip is a real, freely positioned object:
//
//   { id, track, offset, frames, in, shot?, src?, kind }
//
//   offset  — WHERE it sits on the timeline, in frames. Gaps are legal; overlaps are legal on
//             different tracks. This is what "add more footage" requires and what the old
//             ordered-shot-list model could not express.
//   shot    — an optional LINK to a shot. It does NOT control position or length; it controls
//             PICTURE: the clip renders whatever that shot's selectedCandidate currently is, so
//             swapping a take in the timeline (or in Story) updates both. A clip with no `shot`
//             is plain footage (library, import, audio) and carries `src` instead.
//
// The magic from v1 survives as an ACTION rather than a derivation: `layDownShots` (re)builds the
// V1 track from approved shots end to end. After that you are free to move, trim, ripple and layer.
// Nothing is derived behind your back, so nothing can silently move a cut you made by hand.
import fs from 'fs';
import path from 'path';
import { getStorageRoot, readMd, writeMd, stamp, safeScope, appendActivity, listItems, listContext, contextDir } from './store.mjs';
import { listShots, patchShot } from './story.mjs';
import { listGenerations, rendersDir } from './generate.mjs';
import { probeMedia, isVideoFile } from './probe.mjs';
import { rateOf, fpsOf, framesFor, secs, tcStr, humanDur } from '../shared/timecode.mjs';

const R = () => getStorageRoot();
const reelMd = pid => path.join(R(), 'projects', safeScope(pid), 'reel.md');

export const DEFAULT_SHOT_SECONDS = 4;
const MIN_FRAMES = 2;

// THE authored-duration rule, in one place. `shot.dur` is intent, not a cut: it is optional, it
// arrives from markdown so it can be a string, and a zero/negative/garbage value means "unset".
// This used to be inlined three times — twice below (layDownShots, addClip) and once in
// manifest.mjs as `s.dur || 4`, which is NOT the same function: `'0'` is a truthy string, so the
// manifest gave a 0-second cut where the reel gave 4, and a negative dur passed straight through.
// Anything that turns a shot into a length calls this.
export const shotSeconds = shot => (Number(shot && shot.dur) > 0 ? Number(shot.dur) : DEFAULT_SHOT_SECONDS);

// Fixed track stack, top to bottom as an editor reads it. Not user-editable: a project needs a
// place to put an overlay, a picture and two audio lanes, and every extra track is a track header,
// a targeting rule and a sync lock we would have to design.
export const TRACKS = [
  { id: 'V2', kind: 'video', label: 'V2' },   // overlays, titles, inserts — composited OVER V1
  { id: 'V1', kind: 'video', label: 'V1' },   // the picture track; layDownShots fills this one
  { id: 'A1', kind: 'audio', label: 'A1' },
  { id: 'A2', kind: 'audio', label: 'A2' }
];
export const isAudioTrack = t => (TRACKS.find(x => x.id === t) || {}).kind === 'audio';

const DEFAULTS = () => ({
  fpsNum: 24, fpsDen: 1, width: 1920, height: 1080,
  tcStart: 0, drop: false, targetFrames: 0, clips: [], seq: 0,
  // Magnetic timeline, Final Cut style: trimming and deleting close the gap by default.
  // Off = free positioning, where a trim leaves a hole exactly where it was.
  magnetic: true
});

const PATCHABLE = ['fpsNum', 'fpsDen', 'width', 'height', 'tcStart', 'drop', 'targetFrames', 'clips', 'magnetic'];

// ── the one shot→media joiner ────────────────────────────────────────────────────────────────
// Lifted out of index.mjs's old `shotsPayload`, with render paths through safeScope(pid) and a
// `path` alias (the Remotion starter reads that name and its local-file branch never worked).
export function resolveShotMedia(pid) {
  const gens = listGenerations(pid);
  const items = listItems().filter(x => x.proj === pid);
  const renders = f => path.join(rendersDir(pid), path.basename(String(f)));
  return listShots(pid).map(s => {
    const files = [];
    if (s.selectedCandidate) {
      const g = gens.find(x => x.id === s.selectedCandidate);
      if (g && g.file) files.push({ v: 'selected', file: renders(g.file), falUrl: g.resultUrl || '', generation: g.id });
    }
    if (!files.length) {
      for (const aid of (s.assets || [])) {
        const it = items.find(x => x.id === aid);
        (it?.versions || []).forEach(v => {
          if (!v.file) return;
          const gen = gens.find(g => g.file === v.file);
          files.push({ v: v.v, file: renders(v.file), falUrl: gen?.resultUrl || '' });
        });
      }
    }
    if (!files.length) {
      gens.filter(g => g.shot === s.id && g.file && (g.reviewState === 'kept' || g.final))
        .sort((a, b) => (b.final ? 1 : 0) - (a.final ? 1 : 0))
        .forEach(g => files.push({ v: g.id, file: renders(g.file), falUrl: g.resultUrl || '', generation: g.id, provisional: true }));
    }
    // 4. ANY take, newest first. In a real project most candidates are still 'new' — 30 of 34
    // shots in the-last-ferry have 3-4 images each and none reviewed — and treating those as
    // holes drew a black slate over a shot that plainly has pictures. An unreviewed take is a
    // picture you have not judged yet, not an absence, so it shows (flagged provisional) and the
    // slate is reserved for a shot with genuinely nothing rendered.
    if (!files.length) {
      gens.filter(g => g.shot === s.id && g.file && g.reviewState !== 'killed')
        .sort((a, b) => (b.started || 0) - (a.started || 0))
        .forEach(g => files.push({ v: g.id, file: renders(g.file), falUrl: g.resultUrl || '', generation: g.id, provisional: true, unreviewed: true }));
    }
    return {
      id: s.id, no: s.no, scene: s.scene, sceneTitle: s.sceneTitle, title: s.title, desc: s.desc,
      beat: s.beat, type: s.type, dur: s.dur, move: s.move, light: s.light, transition: s.transition,
      skill: s.skill, status: s.status, prompt: s.prompt, videoPrompt: s.videoPrompt,
      tags: s.tags, assets: s.assets, selectedCandidate: s.selectedCandidate || null,
      files: files.map(f => ({ ...f, path: f.file }))
    };
  });
}

// EVERY take for a shot, newest last, so the timeline can show alternates and swap between them.
// Unreviewed ('new') candidates are INCLUDED — 27 of 62 takes in a real project are unreviewed and
// were previously unreachable from any cut.
export function takesForShot(pid, shotId, gens) {
  const all = gens || listGenerations(pid);
  return all
    .filter(g => g.shot === shotId && g.file)
    .sort((a, b) => (a.started || 0) - (b.started || 0))
    .map(g => ({
      generation: g.id, file: path.join(rendersDir(pid), path.basename(g.file)),
      name: path.basename(g.file), model: g.model || '', seed: g.seed ?? null,
      reviewState: g.reviewState || 'new', final: !!g.final, rating: g.rating || 0,
      width: g.width || null, height: g.height || null, cost: g.cost || 0
    }));
}

function readReel(pid) {
  try {
    const { data } = readMd(reelMd(pid));
    return { ...DEFAULTS(), ...data, clips: Array.isArray(data.clips) ? data.clips : [] };
  } catch { return { ...DEFAULTS(), project: pid }; }
}

// Clamp and normalise every clip. Runs server-side on every write, before any UI can send a bad one.
export function normalizeClips(clips, rate) {
  const valid = new Set(TRACKS.map(t => t.id));
  const out = [];
  for (const c of clips || []) {
    if (!c || typeof c !== 'object') continue;
    const track = valid.has(c.track) ? c.track : 'V1';
    const frames = Math.round(Number(c.frames));
    if (!Number.isFinite(frames) || frames < 1) continue;
    const offset = Math.max(0, Math.round(Number(c.offset) || 0));
    const e = {
      id: String(c.id || ''),
      track,
      offset,
      frames: Math.max(MIN_FRAMES, frames),
      in: Math.max(0, Math.round(Number(c.in) || 0))
    };
    if (c.shot) e.shot = String(c.shot);
    if (c.src) e.src = String(c.src);
    if (c.gen) e.gen = String(c.gen);          // pinned take: overrides selectedCandidate for THIS clip
    if (c.label) e.label = String(c.label);
    if (!e.id) continue;
    out.push(e);
  }
  // stable order: track stack, then time
  const ti = id => TRACKS.findIndex(t => t.id === id);
  out.sort((a, b) => (ti(a.track) - ti(b.track)) || (a.offset - b.offset));
  return out;
}

function writeReel(pid, reel, logLine) {
  const body = (() => { try { return readMd(reelMd(pid)).content.trim(); } catch { return '## Reel log'; } })();
  const log = logLine ? (body + '\n- ' + stamp() + ' — ' + logLine).trim() : body;
  const rec = {
    ...reel, project: pid,
    created: reel.created || stamp(), createdAt: reel.createdAt || Date.now(),
    updated: stamp(), updatedAt: Date.now()
  };
  writeMd(reelMd(pid), rec, (log || '## Reel log') + '\n');
  return rec;
}

// ── build ────────────────────────────────────────────────────────────────────────────────────
// Resolve every clip to real media + real dimensions. A shot-linked clip takes its picture from
// the shot's current selection (or its own pinned `gen`), so approving a different take anywhere
// in the app updates the cut.
export async function buildReel(pid) {
  const reel = readReel(pid);
  const rate = rateOf({ fpsNum: reel.fpsNum, fpsDen: reel.fpsDen });
  const gens = listGenerations(pid);
  const shots = resolveShotMedia(pid);
  const byShot = new Map(shots.map(s => [s.id, s]));

  const clips = [];
  for (const c of normalizeClips(reel.clips, rate)) {
    let file = null, kind = 'slate', gen = null, provisional = false, title = c.label || '', prompt = '', takes = [];

    if (c.shot) {
      const s = byShot.get(c.shot);
      if (s) {
        title = title || s.title || s.id;
        prompt = s.prompt || '';
        takes = takesForShot(pid, c.shot, gens);
        // a clip-level pin beats the shot's selection, so two clips of the same shot can show
        // different takes side by side
        const pinned = c.gen ? takes.find(t => t.generation === c.gen) : null;
        const picked = pinned || (s.files[0] || null);
        if (picked) {
          file = pinned ? pinned.file : picked.file;
          gen = pinned ? pinned.generation : (picked.generation || null);
          provisional = !pinned && !!picked.provisional;
        }
      } else {
        title = title || c.shot + ' (deleted)';
      }
    } else if (c.src) {
      file = c.src;
      title = title || path.basename(c.src);
    }

    const exists = file && fs.existsSync(file);
    const measured = exists ? await probeMedia(file) : null;
    if (exists) kind = isAudioTrack(c.track) ? 'audio' : (isVideoFile(file) ? 'video' : 'image');

    clips.push({
      ...c,
      title, prompt,
      startFrame: c.offset,
      endFrame: c.offset + c.frames,
      tcIn: tcStr(reel.tcStart + c.offset, rate, { drop: reel.drop }),
      secs: Number(secs(c.frames, rate).toFixed(3)),
      state: exists ? 'filled' : 'slate',
      kind, file: exists ? file : null, generation: gen, provisional,
      model: gen ? (gens.find(g => g.id === gen) || {}).model || '' : '',
      srcW: measured ? measured.width : null,
      srcH: measured ? measured.height : null,
      srcFps: measured ? measured.fps : null,
      srcFrames: measured ? measured.frames : null,
      takeCount: takes.length,
      takeIndex: gen ? takes.findIndex(t => t.generation === gen) : -1
    });
  }

  const totalFrames = clips.reduce((m, c) => Math.max(m, c.endFrame), 0);
  return {
    project: pid,
    fpsNum: reel.fpsNum, fpsDen: reel.fpsDen, rate: rate.id, fps: fpsOf(rate),
    width: reel.width, height: reel.height,
    tcStart: reel.tcStart, drop: !!reel.drop && rate.dfLegal,
    targetFrames: reel.targetFrames || 0,
    magnetic: reel.magnetic !== false,
    tracks: TRACKS,
    clips,
    totalFrames,
    totalTc: tcStr(totalFrames, rate, { drop: reel.drop }),
    human: humanDur(totalFrames, rate),
    slates: clips.filter(c => c.state === 'slate').length,
    empty: clips.length === 0,
    shotCount: shots.length,
    updated: reel.updated || '', updatedAt: reel.updatedAt || 0
  };
}
export const getReel = buildReel;

// ── mutations ────────────────────────────────────────────────────────────────────────────────
const nextId = reel => { reel.seq = (reel.seq || 0) + 1; return 'c' + reel.seq; };

// Rebuild V1 from the shot list, end to end. THE "approved shots lay themselves down" action —
// now explicit, so it can never silently stomp a hand-made cut. `replace` clears V1 first;
// otherwise it appends after whatever is already there.
export async function layDownShots(pid, { replace = true, onlyApproved = false } = {}) {
  const reel = readReel(pid);
  const rate = rateOf({ fpsNum: reel.fpsNum, fpsDen: reel.fpsDen });
  const shots = resolveShotMedia(pid).sort((a, b) => (a.no ?? 99) - (b.no ?? 99));
  const gens = listGenerations(pid);

  const kept = replace ? reel.clips.filter(c => c.track !== 'V1') : reel.clips.slice();
  let offset = replace ? 0 : kept.filter(c => c.track === 'V1').reduce((m, c) => Math.max(m, c.offset + c.frames), 0);

  const added = [];
  for (const s of shots) {
    if (onlyApproved && !s.selectedCandidate) continue;
    const picked = s.files[0] || null;
    // A video take occupies its REAL measured length; a still holds for its authored dur.
    let frames = null;
    if (picked && fs.existsSync(picked.file) && isVideoFile(picked.file)) {
      const m = await probeMedia(picked.file);
      if (m && m.frames && m.fps) frames = Math.max(MIN_FRAMES, Math.round((m.frames / m.fps) * fpsOf(rate)));
    }
    if (frames == null) {
      frames = Math.max(MIN_FRAMES, framesFor(shotSeconds(s), rate));
    }
    added.push({ id: nextId(reel), track: 'V1', offset, frames, in: 0, shot: s.id });
    offset += frames;
  }

  reel.clips = normalizeClips([...kept, ...added], rate);
  const saved = writeReel(pid, reel, 'laid down ' + added.length + ' shots on V1' + (replace ? ' (replaced)' : ''));
  appendActivity({
    dot: 'green', t: 'Shots laid down', t2: '· ' + added.length + ' clips',
    s: pid + ' — V1 rebuilt from the shot list', kind: 'proj', ref: pid
  });
  return buildReel(pid);
}

export async function addClip(pid, spec) {
  const reel = readReel(pid);
  const rate = rateOf({ fpsNum: reel.fpsNum, fpsDen: reel.fpsDen });
  const track = TRACKS.find(t => t.id === spec.track) ? spec.track : 'V1';

  let frames = Number(spec.frames) || 0;
  let src = spec.src ? String(spec.src) : null;

  // an explicit file: measure it so a real clip lands at its true length
  if (!frames && src && fs.existsSync(src)) {
    const m = await probeMedia(src);
    if (m && m.frames && m.fps) frames = Math.round((m.frames / m.fps) * fpsOf(rate));
    else if (m && m.duration) frames = Math.round(m.duration * fpsOf(rate));
  }
  if (!frames && spec.shot) {
    const s = listShots(pid).find(x => x.id === spec.shot);
    frames = framesFor(shotSeconds(s), rate);
  }
  if (!frames) frames = framesFor(DEFAULT_SHOT_SECONDS, rate);

  // default placement: append to the end of the target track, so a click never buries a clip
  const at = spec.offset != null
    ? Math.max(0, Math.round(Number(spec.offset)))
    : reel.clips.filter(c => c.track === track).reduce((m, c) => Math.max(m, c.offset + c.frames), 0);

  const clip = {
    id: nextId(reel), track, offset: at, frames: Math.max(MIN_FRAMES, frames), in: Math.max(0, Number(spec.in) || 0)
  };
  if (spec.shot) clip.shot = String(spec.shot);
  if (src) clip.src = src;
  if (spec.gen) clip.gen = String(spec.gen);
  if (spec.label) clip.label = String(spec.label);

  reel.clips = normalizeClips([...reel.clips, clip], rate);
  writeReel(pid, reel, 'added ' + (clip.shot || clip.label || path.basename(src || '')) + ' to ' + track);
  return buildReel(pid);
}

export async function patchClip(pid, id, patch, { ripple } = {}) {
  const reel = readReel(pid);
  const rate = rateOf({ fpsNum: reel.fpsNum, fpsDen: reel.fpsDen });
  const i = reel.clips.findIndex(c => c.id === id);
  if (i < 0) throw new Error('no clip ' + id);
  const cur = reel.clips[i];
  const next = { ...cur };
  for (const k of ['track', 'offset', 'frames', 'in', 'gen', 'label']) {
    if (patch[k] !== undefined) next[k] = patch[k];
  }
  // clearing a pin returns the clip to following the shot's own selection
  if (patch.gen === null) delete next.gen;

  // MAGNETIC TRIM (Final Cut's default): changing a clip's LENGTH slides everything after it on
  // the same track by the same delta, so a trim closes its own gap instead of leaving a hole.
  // Head-trims arrive as {in, frames} with the offset untouched, so one delta rule covers both
  // edges. Turn `magnetic` off and a trim leaves the hole exactly where it was.
  const magnetic = ripple === undefined ? reel.magnetic !== false : !!ripple;
  const delta = (Number(next.frames) || 0) - (Number(cur.frames) || 0);
  let clips = reel.clips.slice();
  clips[i] = next;
  if (magnetic && delta !== 0 && next.track === cur.track && (patch.offset === undefined)) {
    const after = cur.offset + cur.frames;
    clips = clips.map((c, n) => (n !== i && c.track === cur.track && c.offset >= after)
      ? { ...c, offset: Math.max(0, c.offset + delta) } : c);
  }
  reel.clips = normalizeClips(clips, rate);
  writeReel(pid, reel, 'edited ' + id + (magnetic && delta ? ' (magnetic)' : ''));
  return buildReel(pid);
}

export async function removeClip(pid, id, { ripple } = {}) {
  const reel = readReel(pid);
  const rate = rateOf({ fpsNum: reel.fpsNum, fpsDen: reel.fpsDen });
  const c = reel.clips.find(x => x.id === id);
  if (!c) throw new Error('no clip ' + id);
  // magnetic by default: deleting closes the gap, the same as Final Cut
  const close = ripple === undefined ? reel.magnetic !== false : !!ripple;
  let rest = reel.clips.filter(x => x.id !== id);
  if (close) {
    // close the gap on THAT TRACK ONLY — rippling every track would desync a laid-in overlay
    rest = rest.map(x => (x.track === c.track && x.offset >= c.offset) ? { ...x, offset: Math.max(0, x.offset - c.frames) } : x);
  }
  reel.clips = normalizeClips(rest, rate);
  writeReel(pid, reel, (close ? 'ripple-deleted ' : 'deleted ') + id);
  return buildReel(pid);
}

// Swap which take a clip shows. `toShot` also writes shot.selectedCandidate, so the decision
// syncs back to Story, the review flow and every other surface — the timeline is a real place to
// choose, not a separate opinion.
export async function setClipTake(pid, id, generation, { toShot = true } = {}) {
  const reel = readReel(pid);
  const i = reel.clips.findIndex(c => c.id === id);
  if (i < 0) throw new Error('no clip ' + id);
  const clip = reel.clips[i];
  reel.clips[i] = { ...clip, gen: generation ? String(generation) : undefined };
  if (!generation) delete reel.clips[i].gen;
  writeReel(pid, reel, 'take → ' + (generation || 'shot default') + ' on ' + id);
  if (toShot && clip.shot && generation) {
    try { patchShot(pid, clip.shot, { selectedCandidate: generation, selectedAt: Date.now(), status: 'done' }, 'take chosen in the reel'); }
    catch { /* the clip still shows it even if the shot write fails */ }
  }
  return buildReel(pid);
}

export async function patchReel(pid, patch = {}, logLine) {
  const prev = readReel(pid);
  const next = { ...prev };
  for (const k of PATCHABLE) if (patch[k] !== undefined) next[k] = patch[k];

  const oldRate = rateOf({ fpsNum: prev.fpsNum, fpsDen: prev.fpsDen });
  const newRate = rateOf({ fpsNum: next.fpsNum, fpsDen: next.fpsDen });
  // changing fps rescales the whole timeline rather than silently reinterpreting it
  if (fpsOf(oldRate) !== fpsOf(newRate) && patch.clips === undefined) {
    const k = fpsOf(newRate) / fpsOf(oldRate);
    next.clips = prev.clips.map(c => ({
      ...c, offset: Math.round(c.offset * k), frames: Math.max(MIN_FRAMES, Math.round(c.frames * k)), in: Math.round((c.in || 0) * k)
    }));
  }
  next.clips = normalizeClips(next.clips, newRate);
  next.drop = !!next.drop && newRate.dfLegal;
  next.tcStart = Math.max(0, Math.round(Number(next.tcStart) || 0));
  next.targetFrames = Math.max(0, Math.round(Number(next.targetFrames) || 0));
  writeReel(pid, next, logLine);
  return buildReel(pid);
}

// ── sources ──────────────────────────────────────────────────────────────────────────────────
// Everything you can put on the timeline, in one call: every shot with every take, every project
// render, the shared library, and any imported/local footage or audio.
export function reelSources(pid) {
  const gens = listGenerations(pid);
  const shots = listShots(pid).sort((a, b) => (a.no ?? 99) - (b.no ?? 99));
  const rdir = rendersDir(pid);

  const shotRows = shots.map(s => ({
    id: s.id, no: s.no, title: s.title || s.id, status: s.status, dur: s.dur,
    prompt: s.prompt || '', scene: s.scene ?? null,
    selected: s.selectedCandidate || null,
    takes: takesForShot(pid, s.id, gens)
  }));

  // project renders not attached to any shot (quick-gens, promoted one-offs)
  const loose = gens
    .filter(g => g.file && !g.shot)
    .map(g => ({
      generation: g.id, name: path.basename(g.file), file: path.join(rdir, path.basename(g.file)),
      model: g.model || '', kind: isVideoFile(g.file) ? 'video' : 'image'
    }));

  // context/board assets + anything dropped into the project (imported footage lives here)
  let assets = [];
  try {
    const ctx = listContext(pid);
    assets = (ctx.items || []).map(a => ({
      name: a.name, folder: a.folder || '', type: a.type || '',
      file: path.join(contextDir(pid), a.folder || '', a.name),
      kind: /\.(mp4|mov|webm|mkv|m4v)$/i.test(a.name) ? 'video'
        : /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(a.name) ? 'audio' : 'image'
    }));
  } catch { /* no context yet */ }

  return {
    project: pid,
    shots: shotRows,
    renders: loose,
    assets: assets.filter(a => a.kind !== 'image' || true),
    audio: assets.filter(a => a.kind === 'audio'),
    counts: {
      shots: shotRows.length,
      takes: shotRows.reduce((n, s) => n + s.takes.length, 0),
      renders: loose.length,
      assets: assets.length
    }
  };
}

export function reelExists(pid) { return fs.existsSync(reelMd(pid)); }
export const reelPath = reelMd;

// ── routes ───────────────────────────────────────────────────────────────────────────────────
export function registerReelRoutes(app, { reveal, exportPack } = {}) {
  const ok = (res, p) => p.then(r => res.json(r)).catch(e => res.status(400).json({ error: e.message }));

  app.get('/api/reel/:pid', (req, res) => ok(res, buildReel(req.params.pid)));
  app.get('/api/reel/:pid/sources', (req, res) => {
    try { res.json(reelSources(req.params.pid)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.patch('/api/reel/:pid', (req, res) => ok(res, patchReel(req.params.pid, req.body?.patch || {}, req.body?.log)));
  app.post('/api/reel/:pid/laydown', (req, res) => ok(res, layDownShots(req.params.pid, {
    replace: req.body?.replace !== false, onlyApproved: !!req.body?.onlyApproved
  })));
  app.post('/api/reel/:pid/clips', (req, res) => ok(res, addClip(req.params.pid, req.body || {})));
  app.patch('/api/reel/:pid/clips/:id', (req, res) => ok(res, patchClip(req.params.pid, req.params.id, req.body || {}, { ripple: req.body?.ripple })));
  app.delete('/api/reel/:pid/clips/:id', (req, res) => ok(res, removeClip(req.params.pid, req.params.id,
    { ripple: req.query.ripple === undefined ? undefined : req.query.ripple === '1' })));
  app.post('/api/reel/:pid/clips/:id/take', (req, res) => ok(res, setClipTake(req.params.pid, req.params.id, req.body?.generation || null, { toShot: req.body?.toShot !== false })));

  if (exportPack) {
    app.post('/api/reel/:pid/export', async (req, res) => {
      try {
        const r = await exportPack(req.params.pid, { formats: req.body?.formats });
        appendActivity({
          dot: 'green', t: 'Animatic exported', t2: '· ' + r.clips + ' clips',
          s: req.params.pid + ' — ' + r.dir, kind: 'proj', ref: req.params.pid
        });
        if (reveal) { try { reveal(r.dir, false); } catch { /* best-effort */ } }
        res.json(r);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
  }
}
