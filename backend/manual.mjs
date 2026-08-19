// Manual round-trip — the BYO-render workflow.
//
// Some users never want FrameForge to call a provider. They keep the story, the shot list, the
// prompts, the review queue and the edit manifest, but render the actual frames in Google Flow /
// Midjourney / their own ComfyUI, because that spend is already paid for. This module is the two
// halves of that loop:
//
//   OUT — a HANDOFF: the exact prompts the app would have sent, composed by the frontend through
//         shotGenerate.js (never re-derived here), copied to the clipboard AND persisted as an
//         ORDERED record in projects/<pid>/handoffs/<id>.md.
//   IN  — an INBOX: projects/<pid>/inbox/. The user drops the downloads in; a matching cascade
//         maps files back onto shots; the user confirms; each accepted file becomes a normal
//         generation record.
//
// ── why the handoff record exists ──
// Flow hands back `Flow_20260730_1a2b3c.mp4`. The prompt text is gone, the shot is gone. But the
// ORDER survives: people paste prompts in the order they copied them, and downloads carry mtime.
// Persisting the order we handed out is what turns 100 anonymous files into a 1:1 mapping for free.
// Without it every ingest would need a vision call per file — the exact spend these users left to
// avoid. The agent tier exists for the residue, not for the bulk.
//
// ── why an ingested file becomes a GENERATION record ──
// The review inbox, the shot filmstrip, keep/kill, selects/, the edit manifest, shotsPayload and
// the Remotion handoff all key off projects/<pid>/generations/*.md. Writing a `provider:'manual'`
// record with status:'done' / reviewState:'new' means every one of those surfaces works on manual
// media with zero changes. A parallel "imported media" concept would have forked all of them.
//
// ── why the agent never writes ──
// agentSortInbox() returns PROPOSALS. Applying is a separate, user-confirmed call. A wrong match
// from a cheap model must cost a click to reject, not a lost hero shot. It also means the whole
// feature still works with no agent CLI installed: tiers 1 and 2 are pure string/mtime logic.
import fs from 'fs';
import path from 'path';
import {
  getStorageRoot, readMd, writeMd, stamp, safe, safeScope, getSettings, appendActivity
} from './store.mjs';
import { listShots, getShot, patchShot } from './story.mjs';
import { rendersDir, smartRenderBase, listGenerations } from './generate.mjs';
import { imageSize } from './imageSize.mjs';
import { stageTrash } from './trash.mjs';
import { runOnce, resolveBin } from './jobs.mjs';
import { providerFor } from './agentProviders.mjs';

const R = () => getStorageRoot();
export const inboxDir = pid => path.join(R(), 'projects', safeScope(pid), 'inbox');
const handoffsDir = pid => path.join(R(), 'projects', safeScope(pid), 'handoffs');
const handoffMd = (pid, id) => path.join(handoffsDir(pid), safe(id) + '.md');

// What the inbox accepts. Anything else a user drops is listed as `ignored` rather than silently
// swallowed — a stray .txt in the folder should be visible, not invisible.
const MEDIA_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'mp4', 'mov', 'webm', 'm4v', 'mp3', 'wav', 'm4a']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'm4v']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a']);
// Browsers write the download under a temp name and rename on completion. Ingesting one of these
// yields a truncated file that looks like a real render until someone opens it.
const PARTIAL_RE = /\.(crdownload|part|download|partial|tmp|opdownload|!qb)$/i;
// A file still being written must not be ingested. Downloads land with a fresh mtime; anything
// younger than this is assumed in flight and reported as `settling` instead of matched.
const SETTLE_MS = 2500;
// Hard ceiling on one agent sort so a 900-file dump can't quietly burn an afternoon of tokens.
const AGENT_MAX_FILES = 60;
const AGENT_TIMEOUT_MS = 180_000;

const extOf = n => (String(n).split('.').pop() || '').toLowerCase();
const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ── inbox listing ──
// Returns every entry with a `state` so the UI can explain itself: 'ready' (matchable now),
// 'settling' (still downloading), 'partial' (browser temp file), 'ignored' (not media).
export function listInbox(pid) {
  const dir = inboxDir(pid);
  if (!fs.existsSync(dir)) return [];
  const now = Date.now();
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    // `._x` AppleDouble sidecars are unavoidable on this repo's exFAT volume (CLAUDE.md) and would
    // otherwise show up as a phantom duplicate of every single dropped file.
    if (name.startsWith('.')) continue;
    let st;
    try { st = fs.statSync(path.join(dir, name)); } catch { continue; }
    if (!st.isFile()) continue;
    const ext = extOf(name);
    const state = PARTIAL_RE.test(name) ? 'partial'
      : !MEDIA_EXT.has(ext) ? 'ignored'
      : (now - st.mtimeMs < SETTLE_MS || st.size === 0) ? 'settling'
      : 'ready';
    out.push({
      name, ext, size: st.size, mtime: st.mtimeMs, state,
      kind: VIDEO_EXT.has(ext) ? 'video' : AUDIO_EXT.has(ext) ? 'audio' : 'image'
    });
  }
  // download order IS the matching signal — sort by it, not alphabetically (`img (10)` sorts
  // before `img (2)`, which would scramble every order-based match).
  out.sort((a, b) => a.mtime - b.mtime);
  return out;
}

export function saveToInbox(pid, name, buf) {
  const dir = inboxDir(pid);
  fs.mkdirSync(dir, { recursive: true });
  const clean = path.basename(String(name || 'drop')).replace(/[/\\]+/g, '_') || 'drop';
  const ext = extOf(clean);
  const base = ext ? clean.slice(0, -(ext.length + 1)) : clean;
  for (let v = 0; ; v++) {
    const fname = (v ? base + '-' + v : base) + (ext ? '.' + ext : '');
    try { fs.writeFileSync(path.join(dir, fname), buf, { flag: 'wx' }); return { name: fname, size: buf.length }; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
}

export function discardInboxFile(pid, name) {
  const p = path.join(inboxDir(pid), path.basename(String(name)));
  if (!fs.existsSync(p)) throw new Error('file not in inbox');
  stageTrash([p], { label: pid + ' inbox / ' + path.basename(p), itemKind: 'inbox' });
  return true;
}

// ── handoffs ──
// The frontend composes `entries` through shotGenerate.shotGenerateBody, so the prompt text handed
// to an external tool is byte-identical to what /api/generate would have received. This module
// deliberately does NOT compose prompts: look joining, ref resolution and model defaults live in
// one place (frontend/shotGenerate.js) and a second implementation here would drift within a week.
export function createHandoff(pid, { entries, perShot = 1, note = '', target = '' }) {
  const list = (Array.isArray(entries) ? entries : [])
    .map(e => ({
      shot: String(e.shot || ''), title: String(e.title || ''),
      prompt: String(e.prompt || '').trim(), model: String(e.model || ''),
      aspect: String(e.aspect || ''), refs: Array.isArray(e.refs) ? e.refs.map(r => String(r.name || r)) : []
    }))
    .filter(e => e.shot && e.prompt);
  if (!list.length) throw new Error('no shots with prompts to hand off');
  const n = Math.max(1, Math.min(16, Number(perShot) || 1));
  const id = 'HO-' + Date.now();
  const rec = {
    id, project: pid, created: stamp(), createdAt: Date.now(),
    perShot: n, note: String(note || ''), target: String(target || ''),
    status: 'open', shots: list.map(e => e.shot), entries: list
  };
  writeMd(handoffMd(pid, id), rec,
    'Manual handoff — the prompts handed out, IN ORDER. Ingest matches downloads back against this order.\n');
  return { ...rec, ...renderSheet(pid, rec) };
}

export function listHandoffs(pid) {
  const dir = handoffsDir(pid);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('.'))
    .map(f => { try { return readMd(path.join(dir, f)).data; } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
export function getHandoff(pid, id) {
  try { return readMd(handoffMd(pid, id)).data; } catch { return null; }
}
export function patchHandoff(pid, id, patch) {
  const h = getHandoff(pid, id);
  if (!h) return null;
  const next = { ...h, ...patch, updated: stamp() };
  writeMd(handoffMd(pid, id), next, 'Manual handoff — the prompts handed out, IN ORDER.\n');
  return next;
}
// The newest handoff that hasn't been closed — what a scan matches against unless told otherwise.
export function openHandoff(pid) {
  return listHandoffs(pid).find(h => h.status !== 'closed') || null;
}

// Two clipboard shapes, because the two ways people work are genuinely different:
//   `sheet` — numbered, with shot codes: for a document, or pasting one at a time while keeping
//             track of where you are.
//   `plain` — prompts only, blank-line separated: for a tool with a bulk/batch prompt box.
export function renderSheet(pid, h) {
  const head = [
    '# ' + pid + ' — manual handoff ' + h.id,
    '',
    h.entries.length + ' shot' + (h.entries.length === 1 ? '' : 's') +
      (h.perShot > 1 ? ' · ' + h.perShot + ' renders per shot' : '') +
      ' · generate in this order and keep the download order',
    ''
  ].join('\n');
  const body = h.entries.map((e, i) =>
    '## ' + (i + 1) + ' · ' + e.shot + (e.title ? ' — ' + e.title : '') + '\n\n' + e.prompt
  ).join('\n\n');
  const tail = '\n\n---\nBack in FrameForge: drop the downloads into the project Inbox and hit Scan. ' +
    'Order alone is enough — renaming a file to start with its shot code (' +
    (h.entries[0] ? h.entries[0].shot : 'SH010') + '_…) makes the match exact.\n';
  return { sheet: head + body + tail, plain: h.entries.map(e => e.prompt).join('\n\n') };
}

// ── the matching cascade ──
// Tier 1: the filename says which shot it is. Tier 2: the handoff says what order we handed them
// out in. Tier 3 (agentSortInbox, separate call): a model looks at the residue.

// Tier 1. Checked in descending order of how deliberate the signal is — an explicit shot code beats
// a title slug, which beats a bare shot number.
function matchByName(name, shots) {
  const stem = name.replace(/\.[^.]+$/, '');
  const up = stem.toUpperCase();
  // explicit shot code: SH030, sh030, SH030_v2, my-render-SH030-final
  const code = up.match(/\bSH[ _-]?(\d{2,4})\b/);
  if (code) {
    const want = 'SH' + code[1].padStart(3, '0');
    const hit = shots.find(s => String(s.id).toUpperCase() === want);
    if (hit) return { shot: hit.id, confidence: 0.98, matchedBy: 'filename', why: 'shot code in filename' };
  }
  // the shot id verbatim, for ids that aren't the SH### shape (duplicates get a `b` suffix)
  const idHit = shots.find(s => s.id && up.includes(String(s.id).toUpperCase()));
  if (idHit) return { shot: idHit.id, confidence: 0.95, matchedBy: 'filename', why: 'shot id in filename' };
  // the shot's title slug — how a render exported from FrameForge and re-downloaded comes back
  const slug = slugify(stem);
  const titled = shots
    .map(s => ({ s, t: slugify(s.title || '') }))
    .filter(x => x.t.length >= 6 && slug.includes(x.t))
    .sort((a, b) => b.t.length - a.t.length)[0];
  if (titled) return { shot: titled.s.id, confidence: 0.8, matchedBy: 'filename', why: 'shot title in filename' };
  return null;
}

// Tier 2. Files in download order, `perShot` consecutive files per handoff entry.
// The confidence is honest about drift: an exact count is a strong signal, a mismatched count means
// the user generated extra takes or dropped some, and the alignment past the first gap is a guess.
function matchByOrder(files, h) {
  if (!h || !h.entries || !h.entries.length) return new Map();
  const per = Math.max(1, Number(h.perShot) || 1);
  const expected = h.entries.length * per;
  const exact = files.length === expected;
  const out = new Map();
  files.forEach((f, i) => {
    const e = h.entries[Math.floor(i / per)];
    if (!e) return;
    out.set(f.name, {
      shot: e.shot, confidence: exact ? 0.7 : 0.4, matchedBy: 'order', handoff: h.id,
      prompt: e.prompt, model: e.model,
      why: exact
        ? 'position ' + (i + 1) + ' of ' + expected + ' in ' + h.id
        : 'position ' + (i + 1) + ' — ' + files.length + ' files for ' + expected + ' expected, alignment is a guess'
    });
  });
  return out;
}

// A shot that already has candidates is not wrong to match again (people re-roll manually), but the
// scan reports it so the UI can warn before piling a fifth take onto a finished shot.
function takeCounts(pid) {
  const m = new Map();
  for (const g of listGenerations(pid)) if (g.shot) m.set(g.shot, (m.get(g.shot) || 0) + 1);
  return m;
}

export function scanInbox(pid, { handoffId = null } = {}) {
  const shots = listShots(pid);
  const files = listInbox(pid);
  const ready = files.filter(f => f.state === 'ready');
  const h = handoffId ? getHandoff(pid, handoffId) : openHandoff(pid);
  const takes = takeCounts(pid);

  // Tier 1 runs first and its hits are REMOVED from the stream tier 2 counts. A file the user
  // renamed `SH030_hero.png` carries its own identity and was never part of the anonymous
  // download sequence — leaving it in would both shift every later position by one and make the
  // total disagree with what the handoff expected, which downgrades a whole batch of correct
  // order matches to "alignment is a guess" because of one file that didn't need order matching.
  const named = new Map();
  for (const f of ready) {
    const m = matchByName(f.name, shots);
    if (m) named.set(f.name, m);
  }
  const order = matchByOrder(ready.filter(f => !named.has(f.name)), h);

  const proposals = ready.map(f => {
    const byName = named.get(f.name) || null;
    const byOrder = order.get(f.name) || null;
    const pick = byName || byOrder;
    const sh = pick ? shots.find(s => s.id === pick.shot) : null;
    return {
      file: f.name, kind: f.kind, size: f.size, mtime: f.mtime,
      shot: pick ? pick.shot : null,
      shotTitle: sh ? sh.title : '',
      confidence: pick ? pick.confidence : 0,
      matchedBy: pick ? pick.matchedBy : 'none',
      why: pick ? pick.why : 'no shot code in the filename and no open handoff to match order against',
      // the prompt this file was PROBABLY rendered from — the handoff entry beats the shot's
      // current prompt, because the shot may have been edited since the handoff went out
      prompt: (byOrder && byOrder.prompt) || (sh ? (sh.prompt || sh.desc || '') : ''),
      intendedModel: (byOrder && byOrder.model) || '',
      handoff: (byOrder && byOrder.handoff) || (h ? h.id : null),
      existingTakes: pick ? (takes.get(pick.shot) || 0) : 0
    };
  });
  return {
    handoff: h ? { id: h.id, created: h.created, perShot: h.perShot, shots: h.shots, status: h.status } : null,
    counts: {
      ready: ready.length,
      settling: files.filter(f => f.state === 'settling').length,
      partial: files.filter(f => f.state === 'partial').length,
      ignored: files.filter(f => f.state === 'ignored').length,
      matched: proposals.filter(p => p.shot).length,
      unmatched: proposals.filter(p => !p.shot).length
    },
    files, proposals
  };
}

// ── tier 3: the agent ──
// One-shot, chunked, JSON-out. Deliberately NOT the streaming chat executor: this is a bounded
// classification with a machine-readable contract, which is exactly the shape jobs.mjs already
// runs. The CLI reads the images itself (Read works on image files), so a manual sort costs
// subscription tokens rather than a paid vision call per file — the whole point for these users.
function extractJson(text) {
  const s = String(text || '');
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : s;
  const a = body.indexOf('['), b = body.lastIndexOf(']');
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(body.slice(a, b + 1)); } catch { return null; }
}

function sortPrompt(pid, shots, chunk, dir) {
  return [
    'You are sorting rendered frames back onto the shots they belong to, for the film project "' + pid + '".',
    '',
    'THE SHOTS (id — title — the prompt the frame was rendered from):',
    ...shots.map(s => '- ' + s.id + ' — ' + (s.title || '(untitled)') + ' — ' + String(s.prompt || s.desc || '(no prompt)').replace(/\s+/g, ' ').slice(0, 240)),
    '',
    'THE FILES (read each one — they are images or video frames):',
    ...chunk.map(f => '- ' + path.join(dir, f.name)),
    '',
    'For each file: open it with Read, then decide which single shot it depicts. Match on subject,',
    'setting, framing and action described in the prompt — not on filename.',
    '',
    'Return ONLY a JSON array, one object per file, no prose:',
    '[{"file":"<basename exactly as listed>","shot":"<shot id or null>","confidence":<0-1>,"why":"<8 words max>"}]',
    '',
    'Rules:',
    '- If no shot is a clear match, return "shot":null. A wrong match is far worse than no match.',
    '- confidence is your honest belief, not politeness. Below 0.5 means "someone must check this".',
    '- Never invent a shot id that is not in the list above.'
  ].join('\n');
}

export async function agentSortInbox(pid, { files = [], model = '', batch = 0 } = {}) {
  const st = getSettings();
  const cmd = st.agentCommand || 'claude';
  const bin = resolveBin(cmd);
  if (!bin) throw new Error('No agent CLI found — install Claude Code or Codex in Settings → Agent, or match by filename/order instead.');
  const provider = providerFor(cmd);
  const dir = inboxDir(pid);
  const inbox = new Map(listInbox(pid).filter(f => f.state === 'ready').map(f => [f.name, f]));
  const wanted = (files.length ? files.map(String) : [...inbox.keys()])
    .filter(n => inbox.has(n));
  if (!wanted.length) throw new Error('nothing to sort — the inbox has no settled media files');
  const capped = wanted.slice(0, AGENT_MAX_FILES);
  const shots = listShots(pid);
  if (!shots.length) throw new Error('this project has no shots to sort against');

  const size = Math.max(2, Math.min(20, Number(batch) || Number(st.manualSortBatch) || 8));
  const chunks = [];
  for (let i = 0; i < capped.length; i += size) chunks.push(capped.slice(i, i + size).map(n => inbox.get(n)));

  const useModel = String(model || st.manualSortModel || '');
  const out = [];
  const errors = [];
  // Serial, not parallel: each turn reads several images, and two concurrent CLIs reading a dozen
  // large frames each is how you brown out a laptop mid-review. jobs.mjs caps at 2 for text work;
  // vision-heavy turns get 1.
  for (const chunk of chunks) {
    const args = [
      ...(provider.sessionArgs ? provider.sessionArgs({ model: useModel }) : []),
      ...provider.promptArgs(sortPrompt(pid, shots, chunk, dir), { allowedTools: 'Read,Glob' })
    ];
    const r = await runOnce(bin, args, AGENT_TIMEOUT_MS, dir);
    const parsed = extractJson(r.out);
    if (!parsed) {
      errors.push((r.err || 'the agent returned no usable JSON').slice(0, 160));
      continue;
    }
    for (const row of parsed) {
      const name = path.basename(String(row?.file || ''));
      if (!inbox.has(name)) continue;
      const sid = row.shot == null ? null : String(row.shot);
      const sh = sid ? shots.find(s => s.id === sid) : null;
      out.push({
        file: name,
        shot: sh ? sh.id : null,          // an invented id resolves to null rather than to garbage
        shotTitle: sh ? sh.title : '',
        confidence: sh ? Math.max(0, Math.min(1, Number(row.confidence) || 0)) : 0,
        matchedBy: sh ? 'agent' : 'none',
        why: String(row.why || '').slice(0, 120) || (sh ? 'matched by the agent' : 'the agent found no clear match'),
        prompt: sh ? (sh.prompt || sh.desc || '') : '',
        intendedModel: ''
      });
    }
  }
  if (!out.length && errors.length) throw new Error('agent sort failed — ' + errors[0]);
  return {
    proposals: out,
    model: useModel || (provider.id + ' default'),
    skipped: wanted.length - capped.length,   // reported, never silently dropped
    errors
  };
}

// ── apply ──
// Moves the file into renders/ under a scene/shot-aware name and writes the generation record that
// makes it a first-class candidate. `shot: null` is legal and lands it as a shot-less quick-gen so
// it still reaches the review inbox instead of being stranded in a folder nobody opens again.
function moveIntoRenders(pid, gen, src, ext) {
  const dir = rendersDir(pid);
  fs.mkdirSync(dir, { recursive: true });
  const base = smartRenderBase(pid, gen);
  for (let v = 1; ; v++) {
    const name = base + '_v' + v + '.' + ext;
    const dst = path.join(dir, name);
    if (fs.existsSync(dst)) continue;
    try { fs.renameSync(src, dst); }
    catch (e) {
      // EXDEV: the inbox and the renders dir are on different volumes (a storage root symlinked
      // elsewhere). Copy then unlink — same outcome, one extra read.
      if (e.code !== 'EXDEV') throw e;
      fs.copyFileSync(src, dst);
      fs.unlinkSync(src);
    }
    return name;
  }
}

let seq = 0;
export function applyIngest(pid, decisions = []) {
  const applied = [], skipped = [];
  const dir = inboxDir(pid);
  for (const d of Array.isArray(decisions) ? decisions : []) {
    const name = path.basename(String(d?.file || ''));
    const src = path.join(dir, name);
    try {
      if (!name || !fs.existsSync(src)) throw new Error('no longer in the inbox');
      const ext = extOf(name);
      if (!MEDIA_EXT.has(ext)) throw new Error('not a media file');
      if (PARTIAL_RE.test(name)) throw new Error('still downloading');
      const shotId = d.shot ? String(d.shot) : null;
      if (shotId && !getShot(pid, shotId)) throw new Error('shot ' + shotId + ' not found');

      const id = 'gen-manual-' + Date.now() + '-' + (++seq);
      const prompt = String(d.prompt || (shotId ? (getShot(pid, shotId).prompt || '') : '') || '').trim()
        || '(rendered outside FrameForge — no prompt recorded)';
      // Shaped exactly like a provider generation (backend/generate.mjs) so every downstream
      // reader — inbox, filmstrip, selects, edit manifest, Remotion — treats it identically.
      const gen = {
        id, schema: 2, shot: shotId, tool: 'import',
        // `model` is what produced the pixels, and we genuinely don't know. Recording the model the
        // handoff INTENDED separately keeps the honest answer honest — a fabricated model id here
        // would poison the cost ledger and the "which model works" read of the whole project.
        model: 'manual', provider: 'manual', intendedModel: String(d.intendedModel || ''),
        prompt, aspect: String(d.aspect || ''), resolution: '', seed: null, params: {},
        width: null, height: null, refUrls: [], refs: [], refInputs: [],
        status: 'done', reviewState: 'new', rating: 0, final: false,
        reviewedAt: null, decidedAt: null, note: String(d.note || ''),
        parentGeneration: null, batchId: null, sessionId: null, variantIndex: null,
        idempotencyKey: id,
        routedTo: { kind: 'none', project: null, shot: null, folder: null, name: null },
        promotedAssets: [],
        file: null, cost: 0, requestId: null, resultUrl: '',
        // provenance — how this file got here, so a bad agent match is auditable later
        manual: {
          source: 'inbox', originalName: name,
          matchedBy: String(d.matchedBy || 'manual'),
          confidence: Number(d.confidence) || 0,
          handoff: d.handoff ? String(d.handoff) : null,
          importedAt: stamp()
        },
        createdAt: stamp(), started: Date.now(), startedAt: stamp(), ended: Date.now(), endedAt: stamp(), error: null
      };
      const fname = moveIntoRenders(pid, gen, src, ext);
      gen.file = fname;
      if (!VIDEO_EXT.has(ext) && !AUDIO_EXT.has(ext)) {
        try {
          const dim = imageSize(fs.readFileSync(path.join(rendersDir(pid), fname)));
          if (dim) { gen.width = dim.width; gen.height = dim.height; }
        } catch { /* size is a nicety, never a reason to fail an import */ }
      }
      const gdir = path.join(R(), 'projects', safeScope(pid), 'generations');
      fs.mkdirSync(gdir, { recursive: true });
      writeMd(path.join(gdir, safe(id) + '.md'), gen, 'Generation record — imported from the manual inbox.\n');
      if (shotId) {
        patchShot(pid, shotId, { status: 'review' },
          'imported ' + name + ' → renders/' + fname + ' (' + gen.manual.matchedBy + ')');
      }
      applied.push({ file: name, shot: shotId, genId: id, render: fname });
    } catch (e) {
      skipped.push({ file: name, reason: String(e.message || e).slice(0, 160) });
    }
  }
  if (applied.length) {
    appendActivity({
      dot: 'green', t: 'Manual media imported', t2: '· ' + applied.length + ' file' + (applied.length === 1 ? '' : 's'),
      s: pid + ' — inbox → renders/, waiting in the review inbox', kind: 'proj', ref: pid, hl: 1
    });
  }
  return { applied, skipped };
}

// ── routes ──
// `raw` is the caller's express.raw({ type:'*/*', limit }) — injected rather than imported so this
// module never pulls in express, matching every other feature-module route block.
export function registerManualRoutes(app, { reveal, raw } = {}) {
  // everything the Inbox surface needs in one call
  app.get('/api/manual/:pid', (req, res) => {
    const pid = req.params.pid;
    try {
      res.json({
        inbox: listInbox(pid),
        handoffs: listHandoffs(pid).slice(0, 20),
        open: openHandoff(pid),
        dir: inboxDir(pid)
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/manual/:pid/handoff', (req, res) => {
    try {
      const h = createHandoff(req.params.pid, {
        entries: req.body?.entries, perShot: req.body?.perShot,
        note: req.body?.note, target: req.body?.target
      });
      // create the drop folder now, so "Reveal" works before anything has been imported
      fs.mkdirSync(inboxDir(req.params.pid), { recursive: true });
      appendActivity({
        dot: 'amber', t: 'Prompts handed off', t2: '· ' + h.entries.length + ' shots',
        s: req.params.pid + ' — ' + h.id + ' · render externally, drop the files in the project Inbox',
        kind: 'proj', ref: req.params.pid
      });
      res.json(h);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.patch('/api/manual/:pid/handoff/:id', (req, res) => {
    const h = patchHandoff(req.params.pid, req.params.id, { status: String(req.body?.status || 'open') });
    if (!h) return res.status(404).json({ error: 'handoff not found' });
    res.json(h);
  });

  app.post('/api/manual/:pid/scan', (req, res) => {
    try { res.json(scanInbox(req.params.pid, { handoffId: req.body?.handoff || null })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/manual/:pid/sort', async (req, res) => {
    try {
      res.json(await agentSortInbox(req.params.pid, {
        files: Array.isArray(req.body?.files) ? req.body.files : [],
        model: req.body?.model || '', batch: req.body?.batch || 0
      }));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post('/api/manual/:pid/apply', (req, res) => {
    try { res.json(applyIngest(req.params.pid, req.body?.decisions)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post('/api/manual/:pid/upload', raw, (req, res) => {
    try { res.json(saveToInbox(req.params.pid, String(req.query.name || 'drop'), req.body)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Serve an inbox file so the triage grid can show what it is actually filing. path.basename +
  // an existence check inside inboxDir is the whole guard — the same shape /api/renders uses.
  app.get('/api/manual/:pid/file', (req, res) => {
    const name = path.basename(String(req.query.name || ''));
    const p = path.join(inboxDir(req.params.pid), name);
    if (!name || name.startsWith('.') || !fs.existsSync(p)) return res.status(404).end();
    res.sendFile(p);
  });

  app.delete('/api/manual/:pid/file', (req, res) => {
    try { discardInboxFile(req.params.pid, req.body?.name); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post('/api/manual/:pid/reveal', (req, res) => {
    const dir = inboxDir(req.params.pid);
    fs.mkdirSync(dir, { recursive: true });
    if (reveal) reveal(dir, false);
    res.json({ ok: true, dir });
  });
}
