// Phase 23 — manual round-trip: handoff records, the free matching cascade, and ingest.
//
// The properties worth pinning down are the ones that are expensive to be wrong about:
//   · a scan NEVER writes (it proposes; only /apply writes)
//   · order matching uses the recorded handoff, in download order, at the right stride
//   · a partially-downloaded file is never ingested
//   · an applied file becomes a normal generation record, so every downstream surface sees it
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, seedShot, req, paths, fs, path } from './helpers.mjs';
import { listInbox, scanInbox, applyIngest, createHandoff } from '../backend/manual.mjs';

const inbox = pid => path.join(paths.projectDir(pid), 'inbox');

// mtime is the download-order signal, so the fixtures must control it explicitly — writing three
// files in a loop can land them inside the same millisecond and make order tests flap.
function drop(pid, name, { age = 60_000, bytes = 4096 } = {}) {
  const dir = inbox(pid);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, Buffer.alloc(bytes, 7));
  const t = new Date(Date.now() - age);
  fs.utimesSync(p, t, t);
  return p;
}

function seedFilm() {
  freshRoot();
  seedProject('neon', { name: 'Neon Alley' });
  seedShot('neon', 'SH010', { no: 1, title: 'Rain on the dock', prompt: 'wide of the dock in rain' });
  seedShot('neon', 'SH020', { no: 2, title: 'Mara turns', prompt: 'close on Mara turning' });
  seedShot('neon', 'SH030', { no: 3, title: 'The drone lifts', prompt: 'drone rising over water' });
  return 'neon';
}

test('listInbox classifies partials, settling files and non-media instead of hiding them', () => {
  const pid = seedFilm();
  drop(pid, 'a.png');
  drop(pid, 'b.mp4.crdownload');
  drop(pid, 'fresh.png', { age: 0 });          // still being written
  drop(pid, 'notes.txt');
  drop(pid, '._a.png');                        // exFAT AppleDouble — must never surface
  const list = listInbox(pid);
  const by = Object.fromEntries(list.map(f => [f.name, f.state]));
  assert.equal(by['a.png'], 'ready');
  assert.equal(by['b.mp4.crdownload'], 'partial');
  assert.equal(by['fresh.png'], 'settling');
  assert.equal(by['notes.txt'], 'ignored');
  assert.equal(by['._a.png'], undefined, 'AppleDouble sidecars must not appear as inbox files');
});

test('tier 1 — a shot code in the filename matches exactly, whatever else is around it', () => {
  const pid = seedFilm();
  drop(pid, 'Flow_export_SH030_final.png');
  drop(pid, 'rain-on-the-dock (2).png');       // title slug
  const r = scanInbox(pid);
  const by = Object.fromEntries(r.proposals.map(p => [p.file, p]));
  assert.equal(by['Flow_export_SH030_final.png'].shot, 'SH030');
  assert.equal(by['Flow_export_SH030_final.png'].matchedBy, 'filename');
  assert.equal(by['rain-on-the-dock (2).png'].shot, 'SH010');
});

test('tier 2 — download order maps onto the handoff at the perShot stride', () => {
  const pid = seedFilm();
  createHandoff(pid, {
    perShot: 2,
    entries: [
      { shot: 'SH010', title: 'a', prompt: 'p1', model: 'm' },
      { shot: 'SH020', title: 'b', prompt: 'p2', model: 'm' },
      { shot: 'SH030', title: 'c', prompt: 'p3', model: 'm' }
    ]
  });
  // six anonymous downloads, oldest first — exactly what Flow hands back
  ['g1.png', 'g2.png', 'g3.png', 'g4.png', 'g5.png', 'g6.png']
    .forEach((n, i) => drop(pid, n, { age: 600_000 - i * 1000 }));
  const r = scanInbox(pid);
  const by = Object.fromEntries(r.proposals.map(p => [p.file, p.shot]));
  assert.deepEqual(by, {
    'g1.png': 'SH010', 'g2.png': 'SH010',
    'g3.png': 'SH020', 'g4.png': 'SH020',
    'g5.png': 'SH030', 'g6.png': 'SH030'
  });
  // the count matched what the handoff expected → the higher confidence tier
  assert.ok(r.proposals.every(p => p.confidence >= 0.7), 'exact count should read as confident');
  // and the prompt carried is the HANDOFF's, not the shot's current text
  assert.equal(r.proposals[0].prompt, 'p1');
});

test('a count mismatch still aligns but reports itself as a guess', () => {
  const pid = seedFilm();
  createHandoff(pid, { perShot: 2, entries: [{ shot: 'SH010', title: 'a', prompt: 'p1', model: 'm' }] });
  ['x1.png', 'x2.png', 'x3.png'].forEach((n, i) => drop(pid, n, { age: 600_000 - i * 1000 }));
  const r = scanInbox(pid);
  const matched = r.proposals.filter(p => p.shot);
  assert.equal(matched.length, 2, 'only as many files as the handoff has slots');
  assert.ok(matched.every(p => p.confidence < 0.5), 'a drifted alignment must not arrive pre-trusted');
  assert.match(matched[0].why, /guess/);
});

test('scan writes nothing — it only proposes', () => {
  const pid = seedFilm();
  drop(pid, 'SH010_take.png');
  scanInbox(pid);
  assert.equal(fs.existsSync(path.join(inbox(pid), 'SH010_take.png')), true, 'the file must stay in the inbox');
  assert.equal(fs.existsSync(path.join(paths.projectDir(pid), 'generations')), false, 'no records may be written');
});

test('apply moves the file into renders/ and writes a reviewable generation record', async () => {
  const pid = seedFilm();
  drop(pid, 'SH020_take.png');
  const r = applyIngest(pid, [{ file: 'SH020_take.png', shot: 'SH020', prompt: 'close on Mara turning', matchedBy: 'filename', confidence: 0.98 }]);
  assert.equal(r.applied.length, 1);
  assert.equal(r.skipped.length, 0);
  const { render, genId } = r.applied[0];
  assert.match(render, /SH020/, 'the render takes a scene/shot-aware name, like a native one');
  assert.equal(fs.existsSync(path.join(paths.projectDir(pid), 'renders', render)), true);
  assert.equal(fs.existsSync(path.join(inbox(pid), 'SH020_take.png')), false, 'moved, not copied');

  // it must read as an ordinary candidate to every downstream surface
  const gens = await req('GET', '/api/generations/' + pid);
  const g = gens.body.find(x => x.id === genId);
  assert.equal(g.status, 'done');
  assert.equal(g.reviewState, 'new');
  assert.equal(g.cost, 0);
  assert.equal(g.shot, 'SH020');
  assert.equal(g.provider, 'manual');
  assert.equal(g.manual.originalName, 'SH020_take.png');
});

test('apply refuses a partial download and reports why', () => {
  const pid = seedFilm();
  drop(pid, 'half.png.crdownload');
  const r = applyIngest(pid, [{ file: 'half.png.crdownload', shot: 'SH010' }]);
  assert.equal(r.applied.length, 0);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /downloading|media/);
});

test('apply refuses an unknown shot rather than filing the media loose', () => {
  const pid = seedFilm();
  drop(pid, 'z.png');
  const r = applyIngest(pid, [{ file: 'z.png', shot: 'SH999' }]);
  assert.equal(r.applied.length, 0);
  assert.match(r.skipped[0].reason, /not found/);
  assert.equal(fs.existsSync(path.join(inbox(pid), 'z.png')), true, 'the file stays put on a refusal');
});

test('an unmatched file can still be imported loose, into the review queue', async () => {
  const pid = seedFilm();
  drop(pid, 'mystery.png');
  const r = applyIngest(pid, [{ file: 'mystery.png', shot: null }]);
  assert.equal(r.applied.length, 1);
  assert.equal(r.applied[0].shot, null);
  const gens = await req('GET', '/api/generations/' + pid);
  assert.equal(gens.body.find(x => x.id === r.applied[0].genId).reviewState, 'new');
});

test('the handoff route records the order and returns paste-ready text', async () => {
  const pid = seedFilm();
  const r = await req('POST', '/api/manual/' + pid + '/handoff', {
    perShot: 4,
    entries: [
      { shot: 'SH010', title: 'Rain on the dock', prompt: 'wide of the dock in rain, amber sodium grade', model: 'fal-ai/flux' },
      { shot: 'SH020', title: 'Mara turns', prompt: 'close on Mara turning, amber sodium grade', model: 'fal-ai/flux' }
    ]
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.shots, ['SH010', 'SH020']);
  assert.equal(r.body.perShot, 4);
  assert.match(r.body.sheet, /SH010/);
  assert.match(r.body.sheet, /amber sodium grade/);
  // `plain` is prompts only — no headers, for a bulk prompt box
  assert.doesNotMatch(r.body.plain, /SH010/);
  assert.equal(r.body.plain.split('\n\n').length, 2);
});

test('a handoff with no usable prompts is refused rather than recorded empty', async () => {
  const pid = seedFilm();
  const r = await req('POST', '/api/manual/' + pid + '/handoff', { entries: [{ shot: 'SH010', prompt: '   ' }] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /no shots with prompts/);
});
