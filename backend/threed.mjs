// 3D Stage backend — scene documents, image→3D generation (FAL Trellis), and render
// upload. Scenes and generated objects live as portable .md files under <root>/threed/,
// same store pattern as looks/styles/prompts. Rendered previews are pushed to fal's CDN
// so they can be attached to any video generation as a motion/composition reference.
import fs from 'fs';
import path from 'path';
import express from 'express';
import { spawn } from 'child_process';
import { getStorageRoot, readMd, writeMd, stamp, safe, appendActivity } from './store.mjs';
import { uploadToFal, falKey } from './fal.mjs';
import { saveAsset } from './library.mjs';
import { findAgent, buildAgentArgs, agentEnv } from './jobs.mjs';
import { planLaunch } from './launch.mjs';

const scenesDir = () => path.join(getStorageRoot(), 'threed', 'scenes');
const objectsDir = () => path.join(getStorageRoot(), 'threed', 'objects');

const listMd = dir => {
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('._')).map(f => {
      try { const { data, content } = readMd(path.join(dir, f)); return { id: f.slice(0, -3), ...data, content }; }
      catch { return null; }
    }).filter(Boolean).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  } catch { return []; }
};

// image→3D via FAL Trellis: single still in, GLB mesh out. ~30-60s, so the route polls
// the queue the same way providers.runFal does for images/video.
const TRELLIS = 'fal-ai/trellis';
const I23D_TIMEOUT = 6 * 60 * 1000;
async function imageTo3d(imageUrl) {
  const key = falKey();
  if (!key) throw new Error('No FAL key — add one in Settings');
  const sub = await fetch('https://queue.fal.run/' + TRELLIS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Key ' + key },
    body: JSON.stringify({ image_url: imageUrl })
  });
  if (!sub.ok) throw new Error('FAL submit ' + sub.status + ': ' + (await sub.text()).slice(0, 300));
  const sj = await sub.json();
  if (!sj.request_id) throw new Error('FAL returned no request_id');
  const statusUrl = sj.status_url || ('https://queue.fal.run/' + TRELLIS + '/requests/' + sj.request_id + '/status');
  const responseUrl = sj.response_url || ('https://queue.fal.run/' + TRELLIS + '/requests/' + sj.request_id);
  const t0 = Date.now();
  let done = false;
  while (Date.now() - t0 < I23D_TIMEOUT) {
    await new Promise(r => setTimeout(r, 2000));
    const st = await fetch(statusUrl, { headers: { Authorization: 'Key ' + key } });
    if (!st.ok) continue;
    const s = await st.json();
    if (s.status === 'COMPLETED') { done = true; break; }
    if (s.status === 'FAILED' || s.status === 'CANCELLED') throw new Error('FAL job ' + s.status.toLowerCase());
  }
  if (!done) throw new Error('image→3D timed out after ' + I23D_TIMEOUT / 1000 + 's');
  const resp = await fetch(responseUrl, { headers: { Authorization: 'Key ' + key } });
  if (!resp.ok) throw new Error('FAL result ' + resp.status + ': ' + (await resp.text()).slice(0, 300));
  const result = await resp.json();
  const glb = result.model_mesh?.url || result.model_mesh || result.model_glb?.url || null;
  const glbUrl = typeof glb === 'string' ? glb : glb?.url;
  if (!glbUrl) throw new Error('FAL result had no mesh URL');
  return glbUrl;
}

export function mountThreeD(app) {
  // ── scenes ──
  app.get('/api/threed/scenes', (req, res) => {
    const project = String(req.query.project || '');
    let all = listMd(scenesDir());
    if (project) all = all.filter(s => !s.project || s.project === project);
    // list view stays light — the (potentially large) scene doc only ships on the detail GET
    res.json(all.map(({ content, ...meta }) => meta));
  });
  app.get('/api/threed/scenes/:id', (req, res) => {
    const file = path.join(scenesDir(), safe(req.params.id) + '.md');
    try {
      const { data, content } = readMd(file);
      res.json({ id: safe(req.params.id), ...data, doc: JSON.parse(content || '{}') });
    } catch { res.status(404).json({ error: 'scene not found' }); }
  });
  app.put('/api/threed/scenes/:id', (req, res) => {
    const id = safe(req.params.id);
    const { name, project, doc } = req.body || {};
    if (!doc || typeof doc !== 'object') return res.status(400).json({ error: 'doc required' });
    const file = path.join(scenesDir(), id + '.md');
    let created = stamp();
    try { created = readMd(file).data.created || created; } catch { /* new scene */ }
    writeMd(file, {
      name: String(name || id), project: project ? String(project) : undefined,
      objects: Array.isArray(doc.objects) ? doc.objects.length : 0,
      duration: doc.duration || 0, created, updated: stamp()
    }, JSON.stringify(doc));
    appendActivity({ dot: 'green', t: '3D scene saved', t2: '· ' + (name || id), s: 'threed/scenes/' + id + '.md', kind: 'tool' });
    res.json({ ok: true, id });
  });
  app.delete('/api/threed/scenes/:id', (req, res) => {
    try { fs.unlinkSync(path.join(scenesDir(), safe(req.params.id) + '.md')); } catch { /* gone */ }
    res.json({ ok: true });
  });

  // ── generated 3D objects (image→3D library) ──
  app.get('/api/threed/objects', (_req, res) => res.json(listMd(objectsDir()).map(({ content, ...m }) => m)));
  app.delete('/api/threed/objects/:id', (req, res) => {
    try { fs.unlinkSync(path.join(objectsDir(), safe(req.params.id) + '.md')); } catch { /* gone */ }
    res.json({ ok: true });
  });
  app.post('/api/threed/image-to-3d', async (req, res) => {
    const { imageUrl, name } = req.body || {};
    if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });
    try {
      const glbUrl = await imageTo3d(String(imageUrl));
      const id = safe((name || 'object') + '-' + Date.now().toString(36));
      writeMd(path.join(objectsDir(), id + '.md'), {
        name: String(name || 'object'), glbUrl, sourceImage: String(imageUrl), created: stamp(), updated: stamp()
      }, '');
      appendActivity({ dot: 'green', t: 'Still converted to 3D', t2: '· ' + (name || 'object'), s: glbUrl.slice(0, 80), kind: 'tool' });
      res.json({ id, name: String(name || 'object'), glbUrl });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  // ── rendered animation → mp4 → fal CDN + library, so it can ride along as a video reference ──
  // The stage renders frames deterministically (no realtime MediaRecorder — dropped frames and
  // headless browsers both break it); frames land here one by one, then ffmpeg assembles the mp4.
  app.post('/api/threed/render-frames', express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
    const job = safe(String(req.query.job || ''));
    const i = Number(req.query.i);
    if (!job || !Number.isInteger(i) || i < 0 || i > 5000) return res.status(400).json({ error: 'job + frame index required' });
    if (!req.body?.length) return res.status(400).json({ error: 'empty frame' });
    const dir = path.join(getStorageRoot(), 'threed', 'render-tmp', job);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'frame' + String(i).padStart(5, '0') + '.jpg'), req.body);
    res.json({ ok: true });
  });
  app.post('/api/threed/render-assemble', async (req, res) => {
    const job = safe(String(req.query.job || ''));
    const fps = Math.min(60, Math.max(1, Number(req.query.fps) || 30));
    const name = safe(String(req.query.name || 'stage-render')) + '-' + job + '.mp4';
    const dir = path.join(getStorageRoot(), 'threed', 'render-tmp', job);
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'no frames for job' });
    const out = path.join(dir, 'out.mp4');
    try {
      const { execFile } = await import('child_process');
      await new Promise((resolve, reject) => execFile('ffmpeg', [
        '-y', '-framerate', String(fps), '-i', path.join(dir, 'frame%05d.jpg'),
        // canvas dimensions track the panel width and are often odd — libx264+yuv420p
        // hard-fails on odd sizes, so always snap down to even
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', out
      ], err => err ? reject(new Error('ffmpeg failed — is it installed and on PATH? ' + err.message.slice(0, 200))) : resolve()));
      const buf = fs.readFileSync(out);
      const url = await uploadToFal(buf, name);
      let saved = null;
      try { saved = saveAsset('library', name, buf, '3d-renders'); } catch { /* library optional */ }
      appendActivity({ dot: 'green', t: '3D render exported', t2: '· ' + name, s: url.slice(0, 80), kind: 'tool' });
      res.json({ url, name, saved });
    } catch (e) { res.status(502).json({ error: e.message }); }
    finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
  });

  // ── director chat — Claude Code stages the scene ──
  // Same hardened pattern as jobs.mjs: `claude --allowedTools '' -p` (no tools, scrubbed env),
  // strict-JSON contract. Claude speaks pos/target/rotY — never quaternions — and the frontend
  // converts on apply.
  app.post('/api/threed/director', (req, res) => {
    const { messages, doc } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages required' });
    const cmd = findAgent();
    if (!cmd) return res.status(503).json({ error: 'claude CLI not found — install it in Settings → Agent' });
    const history = messages.slice(-12).map(m => (m.role === 'user' ? 'USER: ' : 'DIRECTOR: ') + String(m.content).slice(0, 2000)).join('\n');
    const prompt = [
      'You are the Director of a 3D previz stage inside FrameForge, a film pre-production tool.',
      'The stage is used to block out scenes and camera moves, then export the animation as a',
      'video reference for image-to-video models (Seedance, Kling). Units are meters, y is up,',
      'the ground is y=0. Default camera: pos [7,4.5,9], target [0,1,0], fov 42.',
      '',
      'Available blockout props (kind "prop", field "prop"): man (1.75m figure), woman (1.62m figure),',
      'car (4.4m), tree (3.2m), wall (4x2.6m), cube (1m), sphere (1.1m), chair, light (glowing street lamp).',
      'Objects with kind "glb" are user-generated meshes — keep them unchanged unless told otherwise.',
      '',
      'CURRENT SCENE JSON:',
      JSON.stringify(doc || { duration: 5, camFrames: [], objects: [] }),
      '',
      'CONVERSATION:',
      history,
      '',
      'Respond with ONLY a JSON object, no markdown fences, in this shape:',
      '{"reply": "<short, concrete answer in the voice of a DP — no fluff>",',
      ' "scene": <optional: the FULL updated scene doc when you stage or animate anything>,',
      ' "videoPrompt": "<optional: a cinematic image-to-video prompt describing subject, motion and camera move, written only when asked or when the user is exporting>"}',
      '',
      'Scene doc schema: {"duration": seconds, "camFrames": [{"t": sec, "pos": [x,y,z], "target": [x,y,z], "fov": deg}],',
      ' "objects": [{"kind": "prop", "prop": "<id>", "name": "<label>", "pos": [x,y,z], "rotY": deg, "scale": n,',
      '   "keyframes": [{"t": sec, "pos": [x,y,z], "rotY": deg, "scale": n}]}]}',
      'Rules: 2-6 camFrames make a smooth move; keyframe times within [0, duration]; figures stand on the',
      'ground (pos y = 0); spread objects so they never intersect; when the user describes a scene, stage it',
      'fully — do not ask permission first.'
    ].join('\n');

    // agentEnv scrubs the host session's CLAUDE_*/BASE_URL vars, but a session-injected
    // ANTHROPIC_API_KEY survives it — that key only authenticates against the (removed)
    // session base URL, so the nested CLI would 401. Drop it too when nested; the CLI then
    // falls back to the user's own login.
    const env = agentEnv();
    if (process.env.CLAUDECODE || process.env.CLAUDE_CODE_SSE_PORT || process.env.ANTHROPIC_BASE_URL) delete env.ANTHROPIC_API_KEY;
    let out = '', err = '', settled = false;
    let child;
    try {
      // findAgent() returns a .cmd on Windows and spawn(shell:false) refuses it, so this route was
      // dead there exactly like jobs.mjs's turn runner. buildAgentArgs passes a multi-line prompt,
      // which is why planLaunch unwraps the shim to `node <script>` instead of using cmd.exe.
      const plan = planLaunch(cmd, buildAgentArgs(prompt));
      child = spawn(plan.file, plan.args, { cwd: getStorageRoot(), env: plan.env ? { ...env, ...plan.env } : env, shell: false, stdio: ['ignore', 'pipe', 'pipe'], ...(plan.verbatim ? { windowsVerbatimArguments: true } : {}) });
    } catch (e) { return res.status(502).json({ error: 'spawn failed: ' + e.message }); }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* raced */ } }, 180_000);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { if (!settled) { settled = true; clearTimeout(timer); res.status(502).json({ error: e.message }); } });
    child.on('close', code => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      const text = out.trim().replace(/^```(json)?\n?/, '').replace(/\n?```\s*$/, '');
      const start = text.indexOf('{');
      try {
        if (code !== 0 || start < 0) {
          // the CLI reports auth/quota problems on stdout — surface those, they're actionable
          const detail = (err || text || '').trim().slice(0, 240);
          throw new Error(detail || ('exit ' + code + ' — no JSON in output'));
        }
        const parsed = JSON.parse(text.slice(start));
        if (typeof parsed.reply !== 'string') throw new Error('missing reply field');
        res.json({ reply: parsed.reply, scene: parsed.scene || null, videoPrompt: parsed.videoPrompt || null });
      } catch (e) { res.status(502).json({ error: 'director failed: ' + e.message }); }
    });
  });

  // ── GLB proxy — fal CDN meshes load through same-origin so GLTFLoader never hits CORS ──
  app.get('/api/threed/proxy', async (req, res) => {
    const src = String(req.query.src || '');
    if (!/^https:\/\/([\w-]+\.)*fal\.(ai|media|run)\//.test(src) && !/^https:\/\/v3\.fal\.media\//.test(src)) {
      return res.status(400).json({ error: 'only fal-hosted assets are proxied' });
    }
    try {
      const r = await fetch(src);
      if (!r.ok) return res.status(502).json({ error: 'upstream ' + r.status });
      res.set('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch (e) { res.status(502).json({ error: e.message }); }
  });
}
