/* Seed WYRMFALL into the live workspace as a real FrameForge project.

     node scripts/wyrmfall-extract.mjs     # the bible → scripts/.wyrmfall.json
     node scripts/wyrmfall-sheets.mjs      # 12 reference sheets → context/
     node scripts/wyrmfall-seed.mjs        # this: story + 34 shots + refs

   ── What "legit" means here ─────────────────────────────────────────────────
   Written through the app's own store/story modules, into workspace/projects/,
   in the app's own on-disk shape. Open FrameForge afterwards and it is simply
   there: a project with a story, 4 scenes, 34 shots, 12 tagged context assets,
   and every shot pointing at the cast, location and props it actually uses.
   Nothing about it is landing-page-specific.

   ── The tagging, which is the point ─────────────────────────────────────────
   Every shot's `desc` keeps the bible's own @mentions —

       @character:King_Oswin_Vale standing at the ice-glazed battlement of
       @location:Vardenhal_Keep, wolf-pelt mantle snapping in the wind …

   — and each mention is ALSO resolved to the asset it names and written into
   the shot's `cast` / `loc` / `props` arrays. Both matter and they are not the
   same thing: the mention is what a person reads and edits, the array is what
   refsForShot() (shotGenerate.js:64-71) turns into reference images at
   generation time. A demo that showed one without the other would be showing
   half the mechanism.

   Re-runnable: it rewrites the story and the shot list wholesale, and leaves
   context/ and renders/ alone. */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import '../backend/env.mjs';
import { writeMd, stamp, safe } from '../backend/store.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const PID = 'wyrmfall';
const ROOT = path.join(REPO, 'workspace', 'projects', PID);

const bible = JSON.parse(fs.readFileSync(path.join(HERE, '.wyrmfall.json'), 'utf8'));

/* ── mention → asset ───────────────────────────────────────────────────────
   The bible writes @character:King_Oswin_Vale; the asset is named "King Oswin
   Vale". One underscore swap, but it is done through a built index rather than
   inline so an unresolvable mention is a hard error instead of a silently
   dropped reference. */
const FOLDER = { character: 'Cast', location: 'Locations', prop: 'Props' };
const byMention = new Map(
  bible.assets.map(a => ['@' + a.kind + ':' + a.name.replace(/\s+/g, '_'), a])
);

const assetRef = a => FOLDER[a.kind] + '/' + safe(a.name) + '.png';

function refsOf(desc) {
  const out = { cast: [], loc: null, props: [] };
  for (const m of String(desc).match(/@(?:character|location|prop):[A-Za-z0-9_]+/g) || []) {
    const a = byMention.get(m);
    if (!a) throw new Error(`unresolvable mention ${m} — the bible and the asset list disagree`);
    const ref = assetRef(a);
    if (a.kind === 'character' && !out.cast.includes(ref)) out.cast.push(ref);
    else if (a.kind === 'location') out.loc = ref;
    else if (a.kind === 'prop' && !out.props.includes(ref)) out.props.push(ref);
  }
  return out;
}

/* ── the style paragraph, joined once ──────────────────────────────────────
   joinAxes (lookBuilder.js:95-101) semantics: a plain string join of the picked
   options. No model in the loop, so every one of the 34 prompts carries a
   byte-identical look block — which is the claim the whole product rests on. */

/* STYLE_PICKS holds catalog OPTION IDS — `look-and-feel-roger-deakins`,
   `film-stock-kodak-vision3-500t`. The Greenlight app turns those into prose
   with compileStyleFromPicks(); joining the raw ids instead put
   "style-cinematic, look-and-feel-roger-deakins" into all 34 prompts, which is
   not a look block, it is a slug dump. Strip the axis prefix and restore the
   human phrase — the same words the bible's own style table prints. */
const CAPS = { arri: 'ARRI', lf: 'LF', s4: 'S4', '500t': '500T', mini: 'Mini', '35mm': '35mm' };
const deslug = (id, axisPrefix) => String(id)
  .replace(new RegExp('^' + axisPrefix + '-'), '')
  .split('-')
  .map(w => CAPS[w] || (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
  .join(' ');

const AXES = [
  ['style', 'style'], ['lookAndFeel', 'look-and-feel'], ['cameraBody', 'camera-body'],
  ['focalLength', 'focal-length'], ['lensType', 'lens-type'], ['filmStock', 'film-stock'],
  ['lightingSource', 'lighting-source'], ['lightingStyle', 'lighting-style'],
  ['atmosphere', 'atmosphere'], ['filter', 'filter'],
];

const STYLE = AXES
  .flatMap(([key, prefix]) => (bible.style.picks[key] || []).map(id => deslug(id, prefix)))
  .join(', ') + '. ' + bible.style.notes;

/* the prompt the model would receive: mentions resolved to the names they
   stand for, then the look appended — joinFragment(ACTION, STYLE BLOCK) */
const resolve = desc =>
  String(desc).replace(/@(?:character|location|prop):([A-Za-z0-9_]+)/g, (_, n) => n.replace(/_/g, ' '));

/* ── review state ──────────────────────────────────────────────────────────
   The bible is explicit that the showcase is seeded MID-FLIGHT, not finished —
   approved takes, changes requested, pending, and one shot still in draft with
   nothing shot. A storyboard where everything is done demonstrates nothing, so
   the statuses are spread deterministically rather than all set to 'done'. */
const statusFor = i => (i % 7 === 6 ? 'todo' : i % 3 === 0 ? 'done' : i % 3 === 1 ? 'review' : 'generating');

/* ── write ─────────────────────────────────────────────────────────────── */

fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'renders'), { recursive: true });

const scenes = [...new Set(bible.shots.map(s => s.scene))].sort();
const sceneTitle = n => (bible.shots.find(s => s.scene === n) || {}).sceneTitle || '';

writeMd(path.join(ROOT, 'project.md'), {
  name: 'WYRMFALL', sub: 'epic fantasy · ' + bible.style.name,
  scenes: scenes.map(n => 'SC' + String(n).padStart(2, '0') + ' ' + sceneTitle(n)).join(' · '),
  model: 'fal-ai/nano-banana-pro', style: bible.style.name,
  when: 'created ' + stamp(), order: 2, gradIx: 3,
  listCols: ['cast', 'loc', 'look', 'props'],
});

fs.writeFileSync(path.join(ROOT, 'story.md'),
  `# WYRMFALL\n\n**Logline.** When the last king of a dying winter realm learns his crown will ` +
  `outlive his line, a scarred wizard offers him one final oath: wake the white wyrm sleeping ` +
  `beneath the frozen lake — and let it choose who is worthy to wear iron.\n\n` +
  `**Theme.** A crown is not inherited. It is survived.\n\n` +
  `**Look.** ${bible.style.name} — ${bible.style.aspect}. The \`environment\` axis is deliberately ` +
  `unpicked: every shot names its own location through an @location mention, so a locked global ` +
  `environment would contaminate the frozen-lake and battlefield shots.\n\n` +
  scenes.map(n => `## Scene ${n} — ${sceneTitle(n)}\n\n` +
    bible.shots.filter(s => s.scene === n).map(s => `- **${s.title}** — ${s.description}`).join('\n')
  ).join('\n\n') + '\n');

let wrote = 0, withRefs = 0, videos = 0;
const seen = new Set();

bible.shots.forEach((s, i) => {
  const id = 'SH' + String((i + 1) * 10).padStart(3, '0');
  const r = refsOf(s.description);
  if (r.cast.length || r.loc) withRefs++;
  if (s.motion) videos++;

  const data = {
    no: i + 1,
    /* the app's own title convention — scene, take, name */
    title: `S${String(s.scene).padStart(2, '0')}_T${String(i + 1).padStart(2, '0')} ${s.title.toUpperCase()}`,
    scene: s.scene,
    sceneTitle: s.sceneTitle,
    type: s.shotType === 'WIDE' ? 'Wide' : s.shotType === 'CU' ? 'Close' : 'Medium',
    dur: s.durationSeconds,
    skill: 'shot-builder', skillWhy: 'epic grammar — cast bible first, coverage per sequence',
    status: statusFor(i),
    /* the compiled prompt: mentions resolved, look appended, never rewritten */
    prompt: resolve(s.description) + ', ' + STYLE,
    /* the editable line, mentions INTACT — this is what MentionText renders as
       thumbnail pills and what a director actually edits */
    desc: s.description,
    tags: [], assets: [],
    created: stamp(), updated: stamp(), id,
    selectedCandidate: null,
    cast: r.cast, loc: r.loc || '', props: r.props,
    framing: s.shotTypeId,
    code: s.code,
  };

  if (s.motion) {
    data.videoPrompt = `Camera move — ${s.motion.movement}, ${s.motion.speed}, ${s.motion.stabilization}. ` +
      s.motion.notes;
  }

  writeMd(path.join(ROOT, 'shots', id + '.md'), data,
    `- ${stamp()} — seeded from the WYRMFALL bible (${s.code})\n`);
  seen.add(id);
  wrote++;
});

/* drop shot files from an earlier run that this one no longer produces */
let pruned = 0;
for (const f of fs.readdirSync(path.join(ROOT, 'shots'))) {
  if (!/^SH\d+\.md$/.test(f)) continue;
  if (seen.has(f.replace('.md', ''))) continue;
  fs.unlinkSync(path.join(ROOT, 'shots', f));
  pruned++;
}

const sheets = ['Cast', 'Locations', 'Props']
  .reduce((n, d) => n + (fs.existsSync(path.join(ROOT, 'context', d))
    ? fs.readdirSync(path.join(ROOT, 'context', d)).filter(f => f.endsWith(".png") && !f.startsWith("._")).length : 0), 0);

console.log(`
  WYRMFALL seeded into the live workspace

    project    workspace/projects/${PID}/
    story      ${scenes.length} scenes — ${scenes.map(sceneTitle).join(' · ')}
    shots      ${wrote}${pruned ? `  (${pruned} stale pruned)` : ''}
    tagged     ${withRefs} shots carry resolved cast/location refs
    video      ${videos} shots have a camera move
    sheets     ${sheets} reference plates in context/
    style      ${bible.style.name} — appended to all ${wrote} prompts, never rewritten

  Open FrameForge and it is just there. Nothing here is landing-page-specific.
`);
