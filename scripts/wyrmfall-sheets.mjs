/* Generate the WYRMFALL cast / location / prop sheets on fal.

   Input   scripts/.wyrmfall.json   (scripts/wyrmfall-extract.mjs)
   Output  workspace/projects/wyrmfall/context/{Cast,Locations,Props}/*.png
   Key     FAL_KEY from .env — never a literal, never an argument.

   ── Why these are generated rather than borrowed ────────────────────────────
   The landing page already carries 28 WYRMFALL frames, and an earlier pass used
   the first frame of each subject as that character's "sheet". They are not
   sheets — they are coverage: a dragon's eye in macro, a wide of a burning
   plain, a hand on a whetstone. Presented as a cast bible they were simply
   wrong, and no amount of picking a different index fixes a set that does not
   contain the picture being claimed.

   A cast sheet is a specific thing: the subject centred, full figure, neutral
   ground, even light, no scene. So it gets generated as one, from the bible's
   own description, in the project's own locked style.

   ── The prompt is composed the way the app composes one ─────────────────────
   Sheet prompt = sheet framing + the asset's description + the style paragraph.
   That mirrors composeSheetPrompt() in the Greenlight app, and joinFragment()
   in this one: the look is appended, never rewritten, so every sheet and every
   shot in the project share one grade.

   Idempotent. A sheet that already exists is skipped, so a re-run after adding
   one asset costs one image, not twelve.

     node scripts/wyrmfall-extract.mjs
     node scripts/wyrmfall-sheets.mjs            # generate what is missing
     node scripts/wyrmfall-sheets.mjs --force    # re-generate everything
     node scripts/wyrmfall-sheets.mjs --dry      # print prompts, spend nothing
*/

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import '../backend/env.mjs';
import { falKey } from '../backend/fal.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const MODEL = 'fal-ai/nano-banana-pro';   // modelCatalog.js — $0.05, the hero still model
const COST = 0.05;

const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry');

const bible = JSON.parse(fs.readFileSync(path.join(HERE, '.wyrmfall.json'), 'utf8'));

const PID = 'wyrmfall';
const ROOT = path.join(REPO, 'workspace', 'projects', PID);
const FOLDER = { character: 'Cast', location: 'Locations', prop: 'Props' };

/* ── the style paragraph ───────────────────────────────────────────────────
   Built from the bible's own axis picks, joined the way lookBuilder.joinAxes
   does: plain string join, no model in the loop, so it is byte-identical on
   every shot and every sheet. */
const STYLE = [
  bible.style.picks.style, bible.style.picks.lookAndFeel,
  bible.style.picks.cameraBody, bible.style.picks.focalLength,
  bible.style.picks.lensType, bible.style.picks.filmStock,
  bible.style.picks.lightingSource, bible.style.picks.lightingStyle,
  bible.style.picks.atmosphere, bible.style.picks.filter,
].filter(Boolean).flat().join(', ') + '. ' + bible.style.notes;

/* ── sheet framing, per kind ───────────────────────────────────────────────
   A sheet is not a shot. Each of these says "reference plate", not "scene" —
   which is the entire difference between what this writes and what was on the
   page before. */
const FRAMING = {
  character: 'Full-figure character reference sheet, single subject centred and facing camera, ' +
    'head to feet in frame, neutral seamless charcoal backdrop, even three-quarter key with soft fill, ' +
    'no scene, no environment, no props beyond those worn or carried, no text, no border.',
  location: 'Establishing location reference plate, no people anywhere in frame, ' +
    'wide clean view of the place itself, natural light for the hour described, no text, no border.',
  prop: 'Single-object prop reference plate, the object alone and centred on a neutral dark surface, ' +
    'raking side light to read material and edge, no hands, no people, no text, no border.',
};

const ASPECT = { character: '3:4', location: '21:9', prop: '1:1' };

const safe = n => String(n).replace(/[^\w.\-]+/g, '_');

/* ── fal queue ─────────────────────────────────────────────────────────────
   The plain queue API rather than the app's generate.mjs: that path writes
   generation records, ledger rows and activity into the live workspace, which
   is right for a user pressing Generate and wrong for a seeding script. */
async function run(prompt, aspect) {
  const submit = await fetch(`https://queue.fal.run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: 'Key ' + falKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, aspect_ratio: aspect, num_images: 1, output_format: 'png' }),
  });
  if (!submit.ok) throw new Error(`submit ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
  const { status_url, response_url } = await submit.json();

  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const st = await fetch(status_url, { headers: { Authorization: 'Key ' + falKey() } });
    const js = await st.json();
    if (js.status === 'COMPLETED') break;
    if (js.status === 'FAILED') throw new Error('generation failed: ' + JSON.stringify(js).slice(0, 200));
    if (i === 119) throw new Error('timed out after 4 minutes');
  }

  const res = await fetch(response_url, { headers: { Authorization: 'Key ' + falKey() } });
  const out = await res.json();
  const img = (out.images || [])[0];
  if (!img || !img.url) throw new Error('no image in response: ' + JSON.stringify(out).slice(0, 200));

  const bin = await fetch(img.url);
  return Buffer.from(await bin.arrayBuffer());
}

/* ------------------------------------------------------------------- main */

if (!falKey() && !DRY) {
  console.error('\n  ✗ no FAL_KEY. Put it in .env (it is gitignored) — never on the command line.\n');
  process.exit(1);
}

const todo = [];
for (const a of bible.assets) {
  const dir = path.join(ROOT, 'context', FOLDER[a.kind]);
  const file = path.join(dir, safe(a.name) + '.png');
  if (fs.existsSync(file) && !FORCE) { console.log(`  · skip   ${a.name} (exists)`); continue; }
  todo.push({ ...a, dir, file });
}

if (!todo.length) {
  console.log('\n  nothing to generate — all 12 sheets already on disk. --force to redo.\n');
  process.exit(0);
}

console.log(`\n  ${todo.length} sheets · ${MODEL} · ≈$${(todo.length * COST).toFixed(2)}${DRY ? '  (DRY RUN — no spend)' : ''}\n`);

let made = 0, failed = 0;
for (const a of todo) {
  const prompt = `${FRAMING[a.kind]} ${a.description}. ${STYLE}`;

  if (DRY) {
    console.log(`  ── ${a.name} [${a.kind} · ${ASPECT[a.kind]}]\n     ${prompt.replace(/\s+/g, ' ').slice(0, 260)}…\n`);
    continue;
  }

  process.stdout.write(`  · ${a.name.padEnd(30)} `);
  try {
    const buf = await run(prompt, ASPECT[a.kind]);
    fs.mkdirSync(a.dir, { recursive: true });
    fs.writeFileSync(a.file, buf);
    /* the sidecar the app reads for an asset's kind and description — without
       it the sheet is just a loose file in a folder */
    fs.writeFileSync(a.file.replace(/\.png$/, '.meta.md'),
      `---\nname: ${a.name}\nkind: ${a.kind}\nhandle: '@${a.name.replace(/\s+/g, '_')}'\n` +
      `model: ${MODEL}\ncost: ${COST}\nsource: WYRMFALL bible\n---\n\n${a.description}\n`);
    console.log(`ok  ${(buf.length / 1024).toFixed(0)}KB`);
    made++;
  } catch (e) {
    console.log(`FAILED — ${e.message.slice(0, 90)}`);
    failed++;
  }
}

if (!DRY) {
  console.log(`\n  ${made} written${failed ? `, ${failed} failed` : ''} · spent ≈$${(made * COST).toFixed(2)}`);
  console.log(`  → ${path.relative(REPO, path.join(ROOT, 'context'))}\n`);
}
