// Phase 10 — the merged style system.
//
// A STYLE IS A PROMPT-BUILDER COMPOSITION. Before the merge, saving a look threw away the picks
// it was built from and kept only the assembled prose, so reopening a saved style showed an empty
// axis grid — the reason Style Locks and the Prompt Builder felt like two unrelated products.
// These tests pin the round-trip that makes them one: picks in → picks out, through the store,
// through the composer's style/camera split, and back into the builder's flat 12-axis map.
import './_env.mjs'; // first — sets storage-root env before the store loads
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot } from './helpers.mjs';
import { saveLock, listLocks, getLock, importFromItem } from '../backend/stylelocks.mjs';
import {
  styleFromLock, cameraFromLock, lockPayload, splitFlatPicks, mergeToFlatPicks,
  styleFragment, countPicks, emptyCamera
} from '../frontend/lookBuilder.js';

const PICKS = { style: ['Cinematic'], look: ['Neon Noir'], lightsource: ['Neon Lights'], filter: ['Fog/Haze'] };
const CAMERA = { picks: { focal: ['85mm Portrait Lens'], framing: ['Close-up'] }, move: null, speed: 'normal', stabilization: 'smooth' };

test('a saved style keeps the composition it was built from', () => {
  freshRoot();
  const rec = saveLock({
    name: 'Neon Alley', fragment: 'neon-lit, foggy, cinematic',
    picks: PICKS, camera: CAMERA, aspect: '2.39:1', presetId: 'cyberpunk', tags: ['noir']
  });

  assert.deepEqual(rec.picks, PICKS);
  assert.equal(rec.aspect, '2.39:1');
  assert.equal(rec.presetId, 'cyberpunk');

  // and it survives the trip through disk — this is what the picker and the builder both read
  const [onDisk] = listLocks();
  assert.deepEqual(onDisk.picks, PICKS);
  assert.deepEqual(onDisk.camera.picks, CAMERA.picks);
  assert.equal(onDisk.aspect, '2.39:1');
  assert.equal(onDisk.fragment, 'neon-lit, foggy, cinematic');
});

test('reopening a saved style restores the axis grid, not opaque prose', () => {
  freshRoot();
  const rec = saveLock({ name: 'Neon Alley', fragment: 'neon-lit, foggy', picks: PICKS, camera: CAMERA, aspect: '2.39:1' });

  const style = styleFromLock(rec);
  assert.deepEqual(style.picks, PICKS, 'the picks come back');
  assert.equal(style.override, null, 'and NOT as a frozen override — editing the grid must still work');
  assert.equal(style.lockId, rec.id);
  assert.equal(style.lockName, 'Neon Alley');

  const cam = cameraFromLock(rec);
  assert.deepEqual(cam.picks, CAMERA.picks);

  // the fragment is now derived from the restored picks, so a later edit actually changes it
  assert.match(styleFragment(style), /neon/i);
});

test('a legacy text-only style still loads as editable prose', () => {
  freshRoot();
  // exactly what the old StyleStudio/import path produced: name + fragment, no picks
  const rec = importFromItem({ name: 'Old Lock', prompt: 'grainy super-8, blown highlights' });
  assert.deepEqual(rec.picks, {});

  const style = styleFromLock(rec);
  assert.deepEqual(style.picks, {});
  assert.equal(style.override, 'grainy super-8, blown highlights', 'falls back to the only thing it has');
  assert.equal(styleFragment(style), 'grainy super-8, blown highlights');
});

test('editing a style in place preserves the parts the editor did not send', () => {
  freshRoot();
  const rec = saveLock({ name: 'Keep Me', fragment: 'a', picks: PICKS, camera: CAMERA, aspect: '16:9', tags: ['x'] });
  // a caller that only renames must not silently wipe the composition
  const renamed = saveLock({ id: rec.id, name: 'Renamed', fragment: 'a' });

  assert.equal(renamed.name, 'Renamed');
  assert.deepEqual(renamed.picks, PICKS);
  assert.deepEqual(renamed.camera.picks, CAMERA.picks);
  assert.equal(renamed.aspect, '16:9');
});

test('an all-default camera is stored as nothing, not as a fake selection', () => {
  freshRoot();
  const rec = saveLock({ name: 'Look Only', fragment: 'a', picks: PICKS, camera: emptyCamera() });
  assert.equal(rec.camera, null);
  assert.equal(cameraFromLock(rec), null, 'so the composer leaves its own camera alone');
});

test('garbage on the wire cannot corrupt a style record', () => {
  freshRoot();
  const rec = saveLock({
    name: 'Hostile', fragment: 'a',
    picks: { style: 'not-an-array', look: ['ok'], bad: null },
    camera: 'nope', aspect: 12
  });
  assert.deepEqual(rec.picks, { look: ['ok'] }, 'non-array axes are dropped, valid ones survive');
  assert.equal(rec.camera, null);
  assert.equal(rec.aspect, '12');
  // and the record is still readable afterwards
  assert.deepEqual(getLock(rec.id).picks, { look: ['ok'] });
});

test('the builder’s flat 12-axis map and the composer’s style/camera split are the same selection', () => {
  const flat = {
    style: ['Cinematic'], look: ['Neon Noir'], lightsource: ['Neon Lights'],  // style half
    framing: ['Close-up'], focal: ['85mm Portrait Lens'],                      // camera half
    aspect: ['2.39:1 Anamorphic']                                              // neither — a control
  };
  const { style, camera, aspect } = splitFlatPicks(flat);

  assert.deepEqual(style.picks.style, ['Cinematic']);
  assert.deepEqual(camera.picks.framing, ['Close-up']);
  assert.equal(aspect, '2.39:1', 'the display name maps to what the frame-shape control speaks');

  // merging back reproduces the original map — the aspect axis rides along untouched
  assert.deepEqual(mergeToFlatPicks(style, camera), flat);
});

test('a style built in the Prompt Builder reopens in the Prompt Builder', () => {
  freshRoot();
  const flat = { style: ['Cinematic'], look: ['Neon Noir'], focal: ['85mm Portrait Lens'], aspect: ['2.39:1 Anamorphic'] };

  // save exactly the way PromptBuilder.saveStyle does
  const { style, camera, aspect } = splitFlatPicks(flat);
  const rec = saveLock({ name: 'From Builder', ...lockPayload(style, camera, aspect) });

  // reload exactly the way PromptBuilder.loadStyle does
  const back = { ...(getLock(rec.id).picks || {}) };
  for (const [k, v] of Object.entries(getLock(rec.id).camera?.picks || {})) back[k] = v;

  assert.deepEqual(back, flat, 'every axis the user picked comes back, aspect included');
  assert.equal(getLock(rec.id).aspect, '2.39:1');
});

test('the saved fragment covers the lens as well as the look', () => {
  // Everything that reads `fragment` (clipboard, ShotWorkspace's manual append, card excerpts,
  // the legacy fallback) wants the WHOLE look. Dropping the camera half silently lost the lens.
  const { style, camera } = splitFlatPicks({ look: ['Neon Noir'], focal: ['85mm Portrait Lens'] });
  const p = lockPayload(style, camera, null);
  assert.match(p.fragment, /85mm/, 'the lens is in the stored clause');
  assert.match(p.fragment, /neon/i, 'and so is the look');
});

test('a camera-only style does not say the lens twice', () => {
  freshRoot();
  const { style, camera } = splitFlatPicks({ focal: ['85mm Portrait Lens'] });
  const rec = saveLock({ name: 'Just Glass', ...lockPayload(style, camera, null) });

  // the fragment mentions the lens, and the restored camera will mention it again — so the style
  // half must NOT also carry it as override prose
  const back = styleFromLock(rec);
  assert.equal(back.override, null, 'no override, or suffix() would append the lens twice');
  assert.deepEqual(cameraFromLock(rec).picks.focal, ['85mm Portrait Lens'], 'the lens comes back once, from picks');
});

test('a style carrying only an aspect is still treated as legacy prose', () => {
  freshRoot();
  // aspect rides inside picks for round-tripping but is not a look — it must not make an
  // otherwise-empty lock masquerade as a builder composition and drop its fragment
  const rec = saveLock({ name: 'Aspect Only', fragment: 'hand written prose', picks: { aspect: ['16:9 HD'] } });
  const back = styleFromLock(rec);
  assert.equal(back.override, 'hand written prose', 'falls back to the prose it actually has');
  assert.equal(styleFragment(back), 'hand written prose');
});

test('a round trip through a surface that cannot edit aspect or motion keeps them', () => {
  freshRoot();
  // StyleLab / the presets can set a frame shape and a camera move; the Prompt Builder has no
  // control for either. Re-saving from there must carry them, not quietly drop them.
  const rec = saveLock({
    name: 'Full', fragment: 'a', picks: { look: ['Neon Noir'] },
    camera: { picks: { focal: ['85mm Portrait Lens'] }, move: 'dolly-in', speed: 'slow', stabilization: 'locked' },
    aspect: '2.39:1'
  });

  // what PromptBuilder.loadStyle now holds on to
  const cam = cameraFromLock(rec);
  const carried = { aspect: rec.aspect, move: cam.move, speed: cam.speed, stabilization: cam.stabilization };

  // ...and what stylePayload() re-emits
  const flat = mergeToFlatPicks(styleFromLock(rec), cam);
  const split = splitFlatPicks(flat);
  split.camera.move = carried.move;
  split.camera.speed = carried.speed;
  split.camera.stabilization = carried.stabilization;
  const again = saveLock({ id: rec.id, name: 'Full', ...lockPayload(split.style, split.camera, split.aspect || carried.aspect) });

  assert.equal(again.aspect, '2.39:1', 'frame shape survives');
  assert.equal(again.camera.move, 'dolly-in', 'camera move survives');
  assert.equal(again.camera.speed, 'slow');
  assert.equal(again.camera.stabilization, 'locked');
  assert.deepEqual(again.picks.look, ['Neon Noir']);
});

test('lockPayload carries everything needed to reconstruct the style later', () => {
  const { style, camera, aspect } = splitFlatPicks({ style: ['Cinematic'], framing: ['Close-up'], aspect: ['16:9 HD'] });
  style.presetId = 'br2049';
  const p = lockPayload(style, camera, aspect);

  assert.ok(p.fragment, 'the assembled clause generation actually consumes');
  assert.equal(countPicks({ picks: p.picks }) > 0, true);
  assert.equal(p.camera.picks.framing[0], 'Close-up');
  assert.equal(p.aspect, '16:9');
  assert.equal(p.presetId, 'br2049');
});
