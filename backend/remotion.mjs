// Remotion library + re-render console.
//
// Philosophy: the user's Remotion repo stays external (settings.remotionProject) and keeps its own
// install. FrameForge never bundles Remotion — it orchestrates the project's OWN @remotion/bundler +
// @remotion/renderer (to read real compositions incl. defaultProps) and its OWN `remotion` CLI (to
// render). Everything here is queued through a single heavy-render worker so the machine never runs
// two renders at once. All routes live inside registerRemotionRoutes(app, { getSettings }).
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getStorageRoot, readMd, writeMd, stamp, safe, appendActivity } from './store.mjs';
import { resolveBin, agentEnv, runOnce } from './jobs.mjs';
import { planLaunch } from './launch.mjs';
import { stageTrash } from './trash.mjs';

// ── storage layout under <root>/remotion/ ──────────────────────────────────────────────
const remRoot = () => path.join(getStorageRoot(), 'remotion');
const dir = sub => { const p = path.join(remRoot(), sub); fs.mkdirSync(p, { recursive: true }); return p; };
const presetsDir = () => dir('presets');
const jobsDir = () => dir('jobs');
const thumbsDir = () => dir('thumbs');
const outDir = () => dir('out');
const tmpDir = () => dir('tmp');
const previewsDir = () => dir('previews');

function slugify(s) { return String(s || '').toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'untitled'; }

// Order-independent JSON, for cache keys only. JSON.stringify follows insertion order, so the
// same prop set built by the form and by the JSON editor would otherwise hash differently and
// miss a preview that is already on disk.
function stableJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
}
function propsHash(props) {
  const s = stableJson(props ?? {});
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ── project + entry resolution ─────────────────────────────────────────────────────────
function requireProject(getSettings) {
  const proj = (getSettings() || {}).remotionProject;
  if (!proj || !fs.existsSync(proj)) {
    const err = new Error('No Remotion project configured — set a valid Remotion project path in Settings');
    err.code = 'not-configured';
    throw err;
  }
  return proj;
}

// Entry point: first read package.json scripts for `remotion <cmd> <entry>`, then fall back to the
// conventional layouts. Returns a path RELATIVE to the project (Remotion resolves it from cwd).
// Only files that actually call registerRoot() belong here. `src/Root.tsx` does NOT — it exports
// the component the real entry registers — so listing it used to shadow three valid entries below
// it and produce a confusing runtime error instead of a clean no-entry.
const ENTRY_CANDIDATES = [
  'src/index.ts', 'src/index.tsx', 'src/index.js', 'src/index.jsx',
  'src/remotion/index.ts', 'src/remotion/index.tsx', 'src/remotion/index.js', 'src/remotion/index.jsx',
  'remotion/index.ts', 'remotion/index.tsx', 'remotion/index.js', 'remotion/index.jsx',
  'index.ts', 'index.tsx'
];

// Remotion's own documented escape hatch for a non-standard entry point.
function entryFromConfig(proj) {
  for (const f of ['remotion.config.ts', 'remotion.config.js', 'remotion.config.mjs']) {
    const p = path.join(proj, f);
    if (!fs.existsSync(p)) continue;
    try {
      const m = /setEntryPoint\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/.exec(fs.readFileSync(p, 'utf8'));
      if (m) {
        const rel = m[1].replace(/^\.\//, '');
        if (fs.existsSync(path.join(proj, rel))) return rel;
      }
    } catch { /* unreadable config — fall through */ }
  }
  return null;
}

function detectEntry(proj, override) {
  // explicit user override always wins
  if (override) {
    const rel = String(override).replace(/^\.\//, '');
    if (fs.existsSync(path.join(proj, rel))) return rel;
  }
  const cfg = entryFromConfig(proj);
  if (cfg) return cfg;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(proj, 'package.json'), 'utf8'));
    for (const s of Object.values(pkg.scripts || {})) {
      const m = /remotion\s+(?:render|still|preview|studio|compositions|bundle|lambda)\s+(?:[^\s]*\s+)*?([^\s'"]+\.[cm]?[jt]sx?)/.exec(String(s));
      if (m && fs.existsSync(path.join(proj, m[1]))) return m[1];
    }
  } catch { /* no/invalid package.json — fall through to conventions */ }
  for (const c of ENTRY_CANDIDATES) if (fs.existsSync(path.join(proj, c))) return c;
  return null;
}

// The project's own remotion CLI (preferred — no install prompt, uses its pinned version).
function remotionCli(proj) {
  const binDir = path.join(proj, 'node_modules', '.bin');
  // npm writes THREE shims on Windows — `remotion`, `remotion.cmd`, `remotion.ps1`. The
  // extensionless one is a POSIX sh script that CreateProcess cannot run, so testing it first (as
  // this did) always picked the unrunnable spelling and every Remotion feature died: render, still,
  // thumb, preview and Studio. Worse than a plain error — the throw is synchronous inside a
  // Promise at the render site, so `run(job).catch(() => {})` swallowed it and the job sat at 0%
  // in "running" forever, leaking its props temp file and blocking every job queued behind it.
  const names = process.platform === 'win32'
    ? ['remotion.cmd', 'remotion.exe', 'remotion']
    : ['remotion'];
  for (const n of names) {
    const p = path.join(binDir, n);
    if (fs.existsSync(p)) return { cmd: p, pre: [] };
  }
  const npx = resolveBin('npx');   // npx.cmd on Windows — planLaunch unwraps it at the spawn site
  if (npx) return { cmd: npx, pre: ['--no-install', 'remotion'] };
  return null;
}

// ── composition scan ───────────────────────────────────────────────────────────────────
// Best path: run a throwaway .cjs inside the project that uses its OWN bundler+renderer to return
// id/dims/fps/duration + REAL defaultProps in one shot. Fallback: `remotion compositions` (ids only).
let compCache = null; // { project, entry, scanMode, scannedAt, compositions }

const SCAN_SCRIPT = `
const path = require('path');
const { createRequire } = require('module');
(async () => {
  // Resolve the project's OWN @remotion/* install. require() resolves relative to THIS script's
  // location (<root>/remotion/tmp/), not cwd — so a bare require can never see the project's
  // node_modules. createRequire anchored at the project's package.json fixes that.
  const proj = process.argv[3] || process.cwd();
  const preq = createRequire(path.join(proj, 'package.json'));
  const { bundle } = preq('@remotion/bundler');
  const { getCompositions } = preq('@remotion/renderer');
  const entry = path.resolve(proj, process.argv[2]);
  let serveUrl;
  try { serveUrl = await bundle({ entryPoint: entry }); }
  catch (e) { serveUrl = await bundle(entry); }
  const comps = await getCompositions(serveUrl, {});
  const out = comps.map(c => ({
    id: c.id, width: c.width, height: c.height, fps: c.fps,
    durationInFrames: c.durationInFrames, defaultProps: c.defaultProps || c.props || {}
  }));
  process.stdout.write('__FRFG_COMPS__' + JSON.stringify(out) + '__END__');
})().catch(e => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });
`;

// A REAL node binary to run the scan script with. Under Electron (the packaged desktop path) the
// backend lives in a utilityProcess, where process.execPath is "Electron Helper" — spawning that
// with a .cjs boots a whole second Electron app that never exits, so every scan burned the full
// 180s timeout and returned nothing. Prefer a node on PATH; otherwise re-enter our own Electron
// binary in pure-node mode via ELECTRON_RUN_AS_NODE (harmless when execPath is already node).
function nodeRunner() {
  if (!process.versions.electron) return { cmd: process.execPath, env: null };
  const node = resolveBin('node');
  if (node) return { cmd: node, env: null };
  return { cmd: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
}

async function scanViaBundler(proj, entry) {
  const scriptPath = path.join(tmpDir(), 'frameforge-scan-' + Date.now() + '.cjs');
  fs.writeFileSync(scriptPath, SCAN_SCRIPT);
  try {
    const node = nodeRunner();
    const r = await runOnce(node.cmd, [scriptPath, entry, proj], 180_000, proj, node.env);
    const marker = /__FRFG_COMPS__([\s\S]*?)__END__/.exec(r.out || '');
    if (!marker) {
      const line = String(r.err || r.out || '').split('\n').map(s => s.trim()).find(Boolean) || 'bundler scan produced no output';
      throw new Error(line.replace(/^Error:\s*/, '').slice(0, 200));
    }
    return JSON.parse(marker[1]);
  } finally {
    try { fs.rmSync(scriptPath, { force: true }); } catch { /* best effort */ }
  }
}

async function scanViaCli(proj, entry) {
  const cli = remotionCli(proj);
  if (!cli) throw new Error('neither the project remotion binary nor npx was found');
  const r = await runOnce(cli.cmd, [...cli.pre, 'compositions', entry, '--quiet'], 120_000, proj);
  if (r.enoent) throw new Error('remotion CLI not runnable');
  // `remotion compositions --quiet` prints every id SPACE-separated on a single line
  // (@remotion/cli print-compositions → ids.join(' ')). Splitting on '\n' and rejecting lines
  // with spaces therefore yielded zero ids for any project with more than one composition.
  const ids = String(r.out || '')
    .split(/\s+/).map(l => l.trim())
    .filter(l => l && /^[A-Za-z0-9][\w-]*$/.test(l) && l !== 'Compositions');
  if (!ids.length) throw new Error((r.err || 'no compositions listed').slice(-240).trim());
  return ids.map(id => ({ id, width: null, height: null, fps: null, durationInFrames: null, defaultProps: {} }));
}

async function getCompositions(getSettings, refresh) {
  const settings = getSettings() || {};
  const project = requireProject(getSettings);
  if (!refresh && compCache && compCache.project === project) return compCache;
  const entry = detectEntry(project, settings.remotionEntry);
  if (!entry) {
    const err = new Error('No Remotion entry file found — looked at remotion.config.ts setEntryPoint(), package.json scripts, then src/index.ts(x), src/remotion/index.ts(x), remotion/index.ts(x). Set an explicit entry in Settings if yours lives elsewhere.');
    err.code = 'no-entry';
    throw err;
  }
  let compositions, scanMode, warning = null;
  try {
    compositions = await scanViaBundler(project, entry);
    scanMode = 'bundler';
  } catch (e) {
    // degrade to ids-only so the user still sees their library and can render by hand-writing props.
    // Surface BOTH reasons — the old bare `.catch()` discarded the CLI error and rethrew the
    // bundler one, so the message never described what actually went wrong on the fallback path.
    compositions = await scanViaCli(project, entry).catch(e2 => {
      throw new Error('composition scan failed — bundler: ' + (e.message || e) + ' | cli: ' + (e2.message || e2));
    });
    scanMode = 'cli';
    warning = 'defaultProps unavailable (bundler scan failed) — ' + (e.message || '').slice(0, 160);
  }
  compCache = { project, entry, scanMode, warning, scannedAt: stamp(), compositions };
  return compCache;
}

// ── presets (saved prop sets) ──────────────────────────────────────────────────────────
function presetFile(comp, name) { return safe(comp) + '--' + slugify(name) + '.md'; }
function listPresets(comp) {
  const d = presetsDir();
  return fs.readdirSync(d).filter(f => f.endsWith('.md') && !f.startsWith('.')).map(f => {
    try {
      const { data, content } = readMd(path.join(d, f));
      let props = {};
      try { props = JSON.parse(content); } catch { /* corrupt body — expose empty */ }
      return { file: f, comp: data.comp || '', name: data.name || f.replace(/\.md$/, ''), created: data.created || '', updated: data.updated || '', props };
    } catch { return null; }
  }).filter(Boolean).filter(p => !comp || p.comp === comp).sort((a, b) => (a.name > b.name ? 1 : -1));
}
function savePreset(comp, name, props) {
  if (!comp || !name) throw new Error('comp and name are required');
  const file = presetFile(comp, name);
  const full = path.join(presetsDir(), file);
  let created = stamp();
  try { created = readMd(full).data.created || created; } catch { /* new */ }
  writeMd(full, { comp, name, created, updated: stamp() }, JSON.stringify(props ?? {}, null, 2) + '\n');
  return { file, comp, name };
}

// ── render queue: one worker, two lanes (user drains before thumbs) ─────────────────────
let seq = 0;
const jobs = []; // newest first; also persisted as remotion/jobs/<id>.md
let running = false;

function listJobs() {
  return jobs.map(j => ({
    id: j.id, kind: j.kind, lane: j.lane, comp: j.comp, pid: j.pid || null,
    status: j.status, progress: j.progress, error: j.error, file: j.file || null,
    outUrl: j.outUrl || null, startedAt: j.startedAt, endedAt: j.endedAt
  }));
}
function persist(job) {
  try {
    writeMd(path.join(jobsDir(), job.id + '.md'), {
      id: job.id, kind: job.kind, lane: job.lane, comp: job.comp, pid: job.pid || null,
      status: job.status, file: job.file || null, error: job.error || null,
      startedAt: job.startedAt, endedAt: job.endedAt
    }, '## Render log\n\n' + (job.log || []).map(l => '- ' + l).join('\n') + '\n');
  } catch { /* logging must never break a render */ }
}
const MAX_JOBS = 400; // must stay well above any realistic composition count (MotionKit ships 144)
function push(job) {
  jobs.unshift(job);
  // Trim from the OLDEST end, but only settled jobs. The previous unconditional pop() evicted the
  // oldest entry even when it was still `queued`, so a bulk /thumbs enqueue over a large project
  // silently dropped most of its own jobs and reported success for renders that never ran.
  if (jobs.length > MAX_JOBS) {
    for (let i = jobs.length - 1; i >= 0 && jobs.length > MAX_JOBS; i--) {
      if (jobs[i].status === 'done' || jobs[i].status === 'failed') jobs.splice(i, 1);
    }
  }
  persist(job);
  tick();
  return job;
}
// Lane priority: an explicit user render always beats the previews the library fires on open,
// which in turn beat the bulk thumbnail sweep.
function nextJob() {
  return jobs.filter(j => j.status === 'queued' && j.lane === 'user').pop()
    || jobs.filter(j => j.status === 'queued' && j.lane === 'preview').pop()
    || jobs.filter(j => j.status === 'queued' && j.lane === 'thumb').pop();
}

function tick() {
  if (running) return;
  const job = nextJob();
  if (!job) return;
  running = true;
  run(job).catch(() => { }).finally(() => { running = false; tick(); });
}

function parseProgress(text, job) {
  // best-effort: Remotion prints "Rendered 30/120" style counts and/or a NN% figure
  let m = /(\d+)\s*\/\s*(\d+)/.exec(text);
  if (m && Number(m[2]) > 0) { job.progress = Math.max(job.progress || 0, Math.min(1, Number(m[1]) / Number(m[2]))); return; }
  m = /(\d{1,3})\s?%/.exec(text);
  if (m) job.progress = Math.max(job.progress || 0, Math.min(1, Number(m[1]) / 100));
}

async function run(job) {
  job.status = 'running'; job.startedAt = Date.now(); job.progress = 0;
  job.log.push(stamp() + ' — started (' + job.kind + '/' + job.lane + ')');
  persist(job);

  const cli = remotionCli(job.project);
  if (!cli) return finish(job, false, 'remotion CLI not found — install the project deps (npm i) in ' + job.project);

  // props to a temp file → --props=<path> (dodges all shell-escaping of JSON)
  const propsPath = path.join(tmpDir(), 'props-' + job.id + '.json');
  try { fs.writeFileSync(propsPath, JSON.stringify(job.props ?? {}, null, 2)); }
  catch (e) { return finish(job, false, 'could not stage props — ' + e.message); }

  fs.mkdirSync(path.dirname(job.outAbs), { recursive: true });
  const verb = job.kind === 'still' ? 'still' : 'render';
  const args = [...cli.pre, verb, job.entry, job.comp, job.outAbs, '--props=' + propsPath];
  // `--frame` is a still-only flag. This used to read `job.kind !== 'video'`, which was correct
  // when still/video were the only kinds — preview is a third video kind, so test for still.
  if (job.kind === 'still' && Number.isFinite(job.frame)) args.push('--frame=' + job.frame);
  if (job.kind === 'preview') {
    // Small, cheap, disposable: half scale + a loose CRF so the loop lands in seconds, not minutes.
    args.push('--scale=' + PREVIEW_SCALE, '--crf=' + PREVIEW_CRF, '--log=error');
    if (Number.isFinite(job.lastFrame)) args.push('--frames=0-' + job.lastFrame);
  }

  // MUST await the child here: tick() resets `running` in run()'s .finally, so if run() resolved
  // before the render finished the queue would launch every job at once (two heavy renders in
  // parallel — the exact thing the single-worker design forbids). Wrap the child lifecycle in a
  // promise that only settles when the render is done/failed/timed-out.
  return new Promise(resolve => {
    let err = '', settled = false;
    // planLaunch unwraps remotion.cmd / npx.cmd — spawn(shell:false) refuses a .cmd, and here the
    // throw is SYNCHRONOUS inside this Promise, which is what left jobs stuck at 0% forever.
    const plan = planLaunch(cli.cmd, args);
    const child = spawn(plan.file, plan.args, { cwd: job.project, env: plan.env ? { ...agentEnv(), ...plan.env } : agentEnv(), shell: false, stdio: ['ignore', 'pipe', 'pipe'], ...(plan.verbatim ? { windowsVerbatimArguments: true } : {}) });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { } done(false, 'timed out after 20 min'); }, 20 * 60_000);
    const done = (ok, detail) => {
      if (settled) return; settled = true;
      clearTimeout(timer);
      try { fs.rmSync(propsPath, { force: true }); } catch { /* best effort */ }
      finish(job, ok, detail);
      resolve();
    };
    child.on('error', e => done(false, e.code === 'ENOENT' ? 'remotion binary not runnable' : e.message));
    child.stdout.on('data', d => { parseProgress(String(d), job); });
    child.stderr.on('data', d => { err += d; parseProgress(String(d), job); });
    child.on('close', code => {
      if (code === 0 && fs.existsSync(job.outAbs)) done(true, null);
      else done(false, 'exit ' + code + (err ? ' — ' + err.trim().slice(-280) : ' — no output file produced'));
    });
  });
}

function finish(job, ok, detail) {
  job.endedAt = Date.now();
  if (ok) {
    job.status = 'done'; job.progress = 1; job.file = path.basename(job.outAbs);
    job.log.push(stamp() + ' — done → ' + job.outAbs);
    // Only deliberate user renders are activity. Thumbs and previews are machinery the user
    // never asked for by name — logging them buries the real events.
    if (job.lane === 'user') {
      // NOTE: never pass `ref: undefined` — appendActivity → writeMd only strips top-level undefined,
      // so a nested undefined reaches js-yaml and throws ("unacceptable kind of an object to dump"),
      // which (appendActivity is un-try/caught) would crash the whole server after a no-pid render.
      const ev = { dot: 'green', t: 'Remotion render done', t2: '· ' + job.comp, s: (job.pid ? job.pid + ' · ' : '') + job.file, kind: job.pid ? 'proj' : 'library' };
      if (job.pid) ev.ref = job.pid;
      appendActivity(ev);
    }
  } else {
    job.status = 'failed'; job.error = String(detail || 'render failed').slice(0, 300);
    job.log.push(stamp() + ' — FAILED: ' + job.error);
    if (job.lane === 'user') appendActivity({ dot: 'red', t: 'Remotion render failed', t2: '· ' + job.comp, s: job.error.slice(0, 90), kind: 'library' });
  }
  persist(job);
}

// enqueue a user render/still. pid → into that project's renders/ (existing review flow), else out/.
function enqueueRender({ project, entry, comp, kind, props, pid }) {
  const ts = Date.now();
  const ext = kind === 'video' ? 'mp4' : 'png';
  const fname = 'remotion-' + safe(comp) + '-' + ts + '.' + ext;
  let outAbs, outUrl;
  if (pid) {
    outAbs = path.join(getStorageRoot(), 'projects', pid, 'renders', fname);
    outUrl = '/api/renders/' + pid + '/file?name=' + encodeURIComponent(fname);
  } else {
    outAbs = path.join(outDir(), fname);
    outUrl = '/api/remotion/file?name=' + encodeURIComponent('out/' + fname);
  }
  return push({
    id: 'rem-' + ts + '-' + (++seq), kind, lane: 'user', comp, pid: pid || null,
    project, entry, props: props || {}, outAbs, outUrl, frame: null,
    status: 'queued', progress: 0, error: null, file: null, log: [], startedAt: null, endedAt: null
  });
}

function enqueueThumb({ project, entry, comp, frame, props }) {
  const outAbs = path.join(thumbsDir(), safe(comp) + '.png');
  return push({
    id: 'remthumb-' + Date.now() + '-' + (++seq), kind: 'still', lane: 'thumb', comp, pid: null,
    project, entry, props: props || {}, outAbs,
    outUrl: '/api/remotion/file?name=' + encodeURIComponent('thumbs/' + safe(comp) + '.png'),
    frame: Number.isFinite(frame) ? frame : 0,
    status: 'queued', progress: 0, error: null, file: null, log: [], startedAt: null, endedAt: null
  });
}

// ── previews: the loop that makes the library actually move ────────────────────────────
// A preview is a fast, half-scale, duration-capped MP4 of one composition at one prop set,
// cached on disk by comp+props so re-opening a composition (or flipping back to a preset you
// already looked at) is instant instead of a fresh render.
const PREVIEW_SCALE = 0.5;
const PREVIEW_CRF = 30;
const PREVIEW_MAX_SECONDS = 10;

function previewName(comp, props) { return safe(comp) + '-' + propsHash(props) + '.mp4'; }

function enqueuePreview({ project, entry, comp, props, fps, durationInFrames }) {
  const file = previewName(comp, props);
  const outAbs = path.join(previewsDir(), file);
  const url = '/api/remotion/file?name=' + encodeURIComponent('previews/' + file);
  if (fs.existsSync(outAbs)) return { ready: true, cached: true, url, file, jobId: null };
  // Never queue the same preview twice — the library fires one on every open, and a slow render
  // would otherwise stack a job per revisit.
  const live = jobs.find(j => j.lane === 'preview' && j.outAbs === outAbs && (j.status === 'queued' || j.status === 'running'));
  if (live) return { ready: false, cached: false, url, file, jobId: live.id };

  const cap = Number.isFinite(fps) && fps > 0 ? Math.round(fps * PREVIEW_MAX_SECONDS) : 0;
  const dur = Number.isFinite(durationInFrames) && durationInFrames > 0 ? durationInFrames : 0;
  const lastFrame = dur ? Math.max(0, Math.min(dur, cap || dur) - 1) : null;
  const job = push({
    id: 'rempv-' + Date.now() + '-' + (++seq), kind: 'preview', lane: 'preview', comp, pid: null,
    project, entry, props: props || {}, outAbs, outUrl: url, frame: null, lastFrame,
    status: 'queued', progress: 0, error: null, file: null, log: [], startedAt: null, endedAt: null
  });
  return { ready: false, cached: false, url, file, jobId: job.id, truncated: !!(dur && lastFrame !== null && lastFrame + 1 < dur) };
}

// ── Remotion Studio — the real thing, run as a managed child process ────────────────────
// FrameForge cannot embed a live player for an EXTERNAL project: Remotion explicitly does not
// support iframing the Studio (remotion.dev/docs/miscellaneous/embed-studio), and @remotion/player
// needs the composition compiled into our own bundle, which is exactly the coupling this module
// exists to avoid. So when the user wants true scrubbing we start the project's own Studio on a
// loopback port and hand over the URL. One at a time; killed on exit.
let studio = null; // { proc, port, url, project, entry, startedAt }

function studioStatus() {
  if (!studio) return { running: false };
  return { running: true, url: studio.url, port: studio.port, project: studio.project, entry: studio.entry, startedAt: studio.startedAt };
}

function stopStudio() {
  if (studio) { try { studio.proc.kill('SIGTERM'); } catch { /* already gone */ } studio = null; }
  return { running: false };
}

function startStudio(getSettings, port) {
  if (studio) return studioStatus();
  const project = requireProject(getSettings);
  const entry = detectEntry(project, (getSettings() || {}).remotionEntry);
  if (!entry) { const e = new Error('No Remotion entry file found'); e.code = 'no-entry'; throw e; }
  const cli = remotionCli(project);
  if (!cli) throw new Error('remotion CLI not found — run `npm install` inside ' + project);

  const p = Number(port) > 0 ? Number(port) : 6173;
  const studioPlan = planLaunch(cli.cmd, [...cli.pre, 'studio', entry, '--port=' + p, '--no-open']);
  const proc = spawn(studioPlan.file, studioPlan.args, {
    cwd: project, env: agentEnv(), shell: false, stdio: ['ignore', 'pipe', 'pipe']
  });
  const rec = { proc, port: p, url: 'http://127.0.0.1:' + p, project, entry, startedAt: Date.now(), err: '' };
  proc.stderr.on('data', d => { rec.err = (rec.err + d).slice(-600); });
  proc.on('error', () => { if (studio === rec) studio = null; });
  proc.on('close', () => { if (studio === rec) studio = null; });
  studio = rec;
  return studioStatus();
}

// A Studio outliving the app would hold its port and keep rebuilding on file changes.
process.on('exit', () => { if (studio) { try { studio.proc.kill('SIGKILL'); } catch { /* exiting */ } } });

// serve a file under <root>/remotion/ (thumbs/…, out/…, previews/…) with no path traversal
function safeRemotionFile(name) {
  const base = remRoot();
  const abs = path.resolve(base, String(name || ''));
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return fs.existsSync(abs) ? abs : null;
}

// ── routes ───────────────────────────────────────────────────────────────────────────
export function registerRemotionRoutes(app, deps = {}) {
  const getSettings = deps.getSettings || (() => ({}));

  app.get('/api/remotion/compositions', async (req, res) => {
    try {
      const c = await getCompositions(getSettings, req.query.refresh === '1' || req.query.refresh === 'true');
      res.json({ project: c.project, entry: c.entry, scanMode: c.scanMode, warning: c.warning || null, scannedAt: c.scannedAt, compositions: c.compositions });
    } catch (e) {
      res.status(400).json({ error: e.message, code: e.code || 'error' });
    }
  });

  // presets CRUD
  app.get('/api/remotion/presets', (req, res) => {
    try { res.json(listPresets(req.query.comp ? String(req.query.comp) : null)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/remotion/presets', (req, res) => {
    const { comp, name, props } = req.body || {};
    try { res.json(savePreset(String(comp || ''), String(name || ''), props || {})); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.delete('/api/remotion/presets/:file', (req, res) => {
    const f = path.basename(String(req.params.file));
    // staged, not destroyed — restorable from the Trash page (Phase 3D)
    stageTrash(path.join(presetsDir(), f), { label: 'remotion preset ' + f, itemKind: 'remotion-preset' });
    res.json({ ok: true });
  });

  // single-worker render (user lane) — { comp, props, kind:'still'|'video', pid? }
  app.post('/api/remotion/render', async (req, res) => {
    const { comp, props, kind, pid } = req.body || {};
    if (!comp) return res.status(400).json({ error: 'comp is required' });
    const k = kind === 'video' ? 'video' : 'still';
    let project, entry;
    try { project = requireProject(getSettings); }
    catch (e) { return res.status(400).json({ error: e.message, code: e.code || 'error' }); }
    entry = (compCache && compCache.project === project && compCache.entry) || detectEntry(project, (getSettings() || {}).remotionEntry);
    if (!entry) return res.status(400).json({ error: 'No Remotion entry file found', code: 'no-entry' });
    if (pid && !/^[\w-]+$/.test(String(pid))) return res.status(400).json({ error: 'invalid project id' });
    const job = enqueueRender({ project, entry, comp: String(comp), kind: k, props: props || {}, pid: pid ? String(pid) : null });
    res.json({ job: listJobs().find(j => j.id === job.id) });
  });

  // queue a middle-frame thumbnail per comp (thumb lane — never counts as a comp's latest render)
  app.post('/api/remotion/thumbs', async (req, res) => {
    let project, cache;
    try { cache = await getCompositions(getSettings, false); project = cache.project; }
    catch (e) { return res.status(400).json({ error: e.message, code: e.code || 'error' }); }
    const only = req.body && Array.isArray(req.body.comps) ? req.body.comps.map(String) : null;
    const targets = cache.compositions.filter(c => !only || only.includes(c.id));
    const queued = [];
    for (const c of targets) {
      const frame = Math.max(0, Math.floor(((c.durationInFrames || 1) - 1) / 2));
      const job = enqueueThumb({ project, entry: cache.entry, comp: c.id, frame, props: c.defaultProps || {} });
      queued.push(job.id);
    }
    res.json({ queued: queued.length });
  });

  // Cached low-res loop for one comp at one prop set. Returns { ready:true, url } straight away
  // when it is already on disk, so the common case costs no render at all.
  app.post('/api/remotion/preview', async (req, res) => {
    const { comp, props } = req.body || {};
    if (!comp) return res.status(400).json({ error: 'comp is required' });
    let project;
    try { project = requireProject(getSettings); }
    catch (e) { return res.status(400).json({ error: e.message, code: e.code || 'error' }); }
    const entry = (compCache && compCache.project === project && compCache.entry) || detectEntry(project, (getSettings() || {}).remotionEntry);
    if (!entry) return res.status(400).json({ error: 'No Remotion entry file found', code: 'no-entry' });
    const meta = (compCache && compCache.project === project ? compCache.compositions : []).find(c => c.id === String(comp)) || {};
    try {
      res.json(enqueuePreview({
        project, entry, comp: String(comp), props: props || {},
        fps: meta.fps, durationInFrames: meta.durationInFrames
      }));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // The OG Remotion Studio, as a managed child process — real playback, real scrubbing.
  app.get('/api/remotion/studio', (_req, res) => res.json(studioStatus()));
  app.post('/api/remotion/studio', (req, res) => {
    try { res.json(startStudio(getSettings, req.body && req.body.port)); }
    catch (e) { res.status(400).json({ error: e.message, code: e.code || 'error' }); }
  });
  app.delete('/api/remotion/studio', (_req, res) => res.json(stopStudio()));

  app.get('/api/remotion/jobs', (_req, res) => res.json(listJobs()));

  // Probe a candidate project path WITHOUT committing it to settings — powers the Test button
  // next to the path field, so a typo is caught at the point of typing rather than as a mystery
  // empty state later.
  app.get('/api/remotion/probe', (req, res) => {
    const proj = String(req.query.path || '').trim();
    if (!proj) return res.json({ ok: false, reason: 'No path given' });
    if (!fs.existsSync(proj)) return res.json({ ok: false, reason: 'That folder does not exist' });
    if (!fs.statSync(proj).isDirectory()) return res.json({ ok: false, reason: 'That is a file, not a project folder' });
    const entry = detectEntry(proj, (getSettings() || {}).remotionEntry);
    if (!entry) return res.json({ ok: false, reason: 'No Remotion entry point found in that folder', hasNodeModules: fs.existsSync(path.join(proj, 'node_modules')) });
    const deps = fs.existsSync(path.join(proj, 'node_modules', 'remotion'));
    return res.json({
      ok: true, entry,
      depsInstalled: deps,
      reason: deps ? 'Entry found — ready to scan' : 'Entry found, but the project\'s dependencies are not installed. Run npm install inside it.'
    });
  });

  // Look for a MotionKit / Remotion Marketplace checkout next to (or near) the app, so the very
  // common "I have no Remotion project" cold start has a one-click answer instead of a dead end.
  // Purely a suggestion — it never writes settings; the client confirms and saves.
  app.get('/api/remotion/suggest', (_req, res) => {
    const home = process.env.HOME || '';
    const roots = [path.resolve(process.cwd(), '..'), path.join(home, 'Documents'), path.join(home, 'Projects'), home];
    const names = ['Remotion Marketplace', 'motionkit', 'MotionKit', 'remotion-marketplace'];
    const found = [];
    for (const root of roots) {
      for (const n of names) {
        for (const sub of ['app', '']) {
          const cand = path.join(root, n, sub);
          if (found.some(f => f.path === cand)) continue;
          try {
            if (!fs.existsSync(cand) || !fs.statSync(cand).isDirectory()) continue;
            const entry = detectEntry(cand, null);
            if (entry) found.push({ path: cand, entry, label: n, depsInstalled: fs.existsSync(path.join(cand, 'node_modules', 'remotion')) });
          } catch { /* unreadable candidate — skip */ }
        }
      }
    }
    res.json({ found });
  });

  app.get('/api/remotion/file', (req, res) => {
    const p = safeRemotionFile(req.query.name);
    if (!p) return res.status(404).end();
    res.sendFile(p);
  });
}
