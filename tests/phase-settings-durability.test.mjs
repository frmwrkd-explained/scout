/* A data-loss bug found by an audit, reproduced before it was fixed.
 *
 * An unreadable settings.md degraded to defaults, and the next Settings toggle persisted those
 * defaults over the user's live API keys.
 *
 * This file also covered a second bug — setting an OUT point wiped the IN point on a shot trim.
 * That half went with the film domain on 2026-08-19 (backend/manifest.mjs). The shape of the bug
 * is worth remembering wherever Scout next accepts a partial patch: the UI sent one side at a
 * time, JSON.stringify dropped the undefined twin, and the server read a missing value as a real
 * 0 — so the natural order silently discarded the edit while reporting success. The one existing
 * test sent both sides together, the single shape the app never produced, which is why it stayed
 * green.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Hermetic root. `SCOUT_DATA` alone is NOT enough: `getStorageRoot()` reads the `config.md`
// POINTER first, and that file lives outside the storage root by design — so a config.md in the
// checkout (or one written by a dev server run) silently outranks SCOUT_DATA and this whole file
// reads somebody else's workspace. Claim both, the way tests/_env.mjs does.
function freshRoot(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-' + tag + '-'));
  process.env.SCOUT_DATA = root;
  process.env.SCOUT_CONFIG = path.join(root, 'config.md');
  return root;
}

/* ── settings.md must never be overwritten unread ────────────────────────────────────── */

const root = freshRoot('settings');
const store = await import('../backend/store.mjs');
const settingsFile = path.join(root, 'settings.md');

test('a healthy settings.md round-trips', () => {
  store.saveSettings({ groqApiKey: 'sk-live-GROQ', agentCommand: 'claude' });
  assert.equal(store.getSettings().groqApiKey, 'sk-live-GROQ');
  assert.equal(store.settingsUnreadable(), false);
});

test('an unreadable settings.md is detected rather than silently defaulted', () => {
  const good = fs.readFileSync(settingsFile, 'utf8');
  fs.writeFileSync(settingsFile, '---\ngroqApiKey: "unclosed\nagentCommand: sk-live-MARKER\n---\nbody\n');
  try {
    assert.equal(store.settingsUnreadable(), true);
    // Reads may still degrade — a read-only caller wants *something* — but the value is defaults.
    assert.equal(store.getSettings().groqApiKey, '', 'the read degrades, which is exactly the trap');
  } finally {
    fs.writeFileSync(settingsFile, good);
  }
});

test('saveSettings REFUSES to write over a file it could not read', () => {
  const good = fs.readFileSync(settingsFile, 'utf8');
  fs.writeFileSync(settingsFile, '---\ngroqApiKey: "unclosed\nagentCommand: sk-live-MARKER\n---\nbody\n');
  try {
    // The real trigger was innocuous: the client PUTs its whole settings object on ANY toggle,
    // so this is a user flipping "show hints" and losing every API key they had.
    assert.throws(() => store.saveSettings({ showHints: false }), /refusing to overwrite/);
    assert.match(fs.readFileSync(settingsFile, 'utf8'), /sk-live-MARKER/,
      'the unreadable file must be left exactly as it was, keys and all');
  } finally {
    fs.writeFileSync(settingsFile, good);
  }
});

test('a missing settings.md is still the legitimate first-run case', () => {
  const good = fs.readFileSync(settingsFile, 'utf8');
  fs.rmSync(settingsFile, { force: true });
  try {
    assert.equal(store.settingsUnreadable(), false, 'absent is not unreadable');
    assert.doesNotThrow(() => store.saveSettings({ showHints: true }), 'a fresh install must still be able to save');
  } finally {
    fs.writeFileSync(settingsFile, good);
  }
});
