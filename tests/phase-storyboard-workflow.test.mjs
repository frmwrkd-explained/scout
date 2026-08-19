// Ticket 23 — the blessed storyboard-first workflow, shipped as a DEFAULT built-in skill pack.
// Hermetic seams only (no CLI, no FAL): the built-in pack is discovered, defaults ON, mounts into the
// session home + Index, toggles off cleanly, and its mounted copy is tamper-reset from source on every
// prepare (exactly like the router). Plus the record-level economy check: the STORYBOARD framing note
// composes into every storyboard candidate's stored prompt via the batch styleLockFragment suffix seam.
//
// The full LIVE run (a real continuous chat session: story → breakdown → estimate → sheets → split →
// review → style lock → re-render) needs a live Claude subscription + FAL spend and is NOT run here —
// each seam it rides is covered by a committed test (this file + phase7-batches, phase-shot-board,
// phase-grid-split-chat, phase-review-integration, phase10-styles, phase22-cost-surfacing).
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, seedShot, req, getStorageRoot, fs, path } from './helpers.mjs';
import { saveSettings } from '../backend/store.mjs';
import {
  listSkillPacks, enabledPacks, prepareAgentHome, agentHomeDir, storyboardWorkflowDir
} from '../backend/agentHome.mjs';
import { listGenerations } from '../backend/generate.mjs';

const PACK_ID = 'storyboard-workflow';

// ── the built-in pack is discovered from the backend source tree and defaults ON ──
test('the storyboard-workflow pack is a built-in, listed and enabled by default', () => {
  freshRoot();
  const p = listSkillPacks().find(x => x.id === PACK_ID);
  assert.ok(p, 'built-in storyboard pack not discovered');
  assert.equal(p.builtin, true, 'must be flagged as a built-in pack');
  assert.equal(p.repo, 'built-in');
  assert.equal(p.enabled, true, 'the demo vehicle must default ON');
  // its Index metadata comes from its OWN frontmatter (description + triggers)
  assert.match(p.description, /storyboard/i);
  assert.match(p.triggers, /storyboard/i);
  assert.ok(enabledPacks().some(x => x.id === PACK_ID), 'default-ON pack absent from enabledPacks()');
});

// ── a user toggle still overrides the built-in default (off = absent, not refused) ──
test('disabling the built-in pack removes it from listing/enablement', () => {
  freshRoot();
  saveSettings({ enabledSkillPacks: { [PACK_ID]: false } });
  const p = listSkillPacks().find(x => x.id === PACK_ID);
  assert.equal(p.enabled, false, 'explicit off toggle must win over the built-in default');
  assert.equal(enabledPacks().some(x => x.id === PACK_ID), false);
});

// ── it mounts into the session home + Index when enabled, and vanishes when disabled ──
test('the built-in pack mounts (copied, tree intact) and appears in the Index; disabling drops it', () => {
  freshRoot();
  const session = { id: 'sbw-mount', project: null, mode: 'agent', agentCommand: 'claude' };

  // default ON → mounted with its file tree intact + one Index line pointing at its mounted path
  let home = prepareAgentHome({ session });
  const dst = path.join(home.home, 'skills', PACK_ID);
  assert.ok(fs.existsSync(path.join(dst, 'SKILL.md')), 'pack SKILL.md not mounted');
  assert.ok(fs.existsSync(path.join(dst, 'references', 'prompts.md')), 'pack reference not mounted');
  // built-in packs are COPIED, never symlinked (so a tamper can never reach the source tree)
  assert.equal(fs.lstatSync(dst).isSymbolicLink(), false, 'built-in pack must be a copy, not a symlink');
  assert.match(home.indexText, new RegExp(PACK_ID + ' — .*storyboard.*\\[skills/' + PACK_ID + '\\]', 'i'));

  // disable → next prepare drops it from both the home and the Index
  saveSettings({ enabledSkillPacks: { [PACK_ID]: false } });
  home = prepareAgentHome({ session });
  assert.equal(fs.existsSync(path.join(home.home, 'skills', PACK_ID)), false, 'disabled built-in still mounted');
  assert.doesNotMatch(home.indexText, new RegExp('\\[skills/' + PACK_ID + '\\]'));
});

// ── tamper-reset: an edit to the mounted copy is overwritten from source on the next prepare ──
test('tamper-reset: editing the mounted built-in pack copy is wiped on next prepare', () => {
  freshRoot();
  const session = { id: 'sbw-tamper', project: null, mode: 'agent', agentCommand: 'claude' };
  prepareAgentHome({ session });
  const copy = path.join(agentHomeDir(session.id), 'skills', PACK_ID, 'SKILL.md');
  fs.writeFileSync(copy, '# TAMPERED — economy law removed\n');
  assert.match(fs.readFileSync(copy, 'utf8'), /TAMPERED/);

  prepareAgentHome({ session }); // next session start
  const fresh = fs.readFileSync(copy, 'utf8');
  const source = fs.readFileSync(path.join(storyboardWorkflowDir(), 'SKILL.md'), 'utf8');
  assert.equal(fresh, source, 'mounted pack copy was not reset from source');
  assert.doesNotMatch(fresh, /TAMPERED/);
});

// ── the STORYBOARD framing note lands in every storyboard candidate's composed prompt ──
// This is the economy law made spot-checkable at the record level: the action prompt carries framing
// only, and the literal "STORYBOARD" note rides in via the batch styleLockFragment suffix seam, which
// backend/batches.mjs composes onto EVERY candidate's stored prompt (composedPrompt = prompt + ' ' + suffix).
test('STORYBOARD framing composes into each batch candidate prompt via the styleLockFragment suffix', async () => {
  freshRoot();
  seedProject('neon');
  seedShot('neon', 'SH010', { no: 1 });
  seedShot('neon', 'SH020', { no: 2 });
  await req('PUT', '/api/settings', { falApiKey: 'test-key' });

  const action = 'Wide establishing shot, a lone figure crosses an empty plaza toward a lit doorway';
  const framing = 'STORYBOARD — rough black-and-white storyboard frame, blocking only, not final look';
  const r = await req('POST', '/api/batches', {
    pid: 'neon', shotIds: ['SH010', 'SH020'], prompt: action,
    model: 'fal-ai/flux/schnell', variantCount: 1, styleLockFragment: framing
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const gens = listGenerations('neon').filter(g => g.batchId === r.body.id);
  assert.equal(gens.length, 2, 'one candidate per shot expected');
  for (const g of gens) {
    assert.ok(g.prompt.includes('STORYBOARD'), 'candidate prompt is missing the STORYBOARD framing note');
    assert.ok(g.prompt.startsWith(action), 'action-and-framing prompt should lead; style/note suffix follows');
    // economy law spot-check: no grade/lens/stock prose typed into the action prompt
    assert.doesNotMatch(g.prompt, /anamorphic|teal-and-orange|sodium|35mm|golden hour/i);
  }
});
