/* Two data-loss bugs found by an audit, both reproduced before they were fixed.
 *
 * 1. Setting an OUT point wiped the IN point. The UI sends one side at a time, JSON.stringify
 *    drops the undefined twin, and the server read a missing `in` as a real 0 — so the natural
 *    order (mark in, then mark out) silently discarded the trim while toasting success. The one
 *    existing test sent {in, out} together, the single shape the app never produces, which is why
 *    it stayed green.
 *
 * 2. An unreadable settings.md degraded to defaults, and the next Settings toggle persisted those
 *    defaults over the user's live API keys.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function freshRoot(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frfg-' + tag + '-'));
  process.env.FRFG_DATA = root;
  return root;
}

/* ── in/out trim ─────────────────────────────────────────────────────────────────────── */

const root = freshRoot('trim');
const { writeMd } = await import('../backend/store.mjs');
const { setInOut, buildManifest } = await import('../backend/manifest.mjs');

const PID = 'neon';
const P = p => path.join(root, 'projects', PID, p);
fs.mkdirSync(P('shots'), { recursive: true });
fs.mkdirSync(P('generations'), { recursive: true });
writeMd(P('project.md'), { id: PID, name: 'Neon' }, '');
writeMd(P('shots/SH010.md'), { id: 'SH010', no: 10, dur: 6, selectedCandidate: 'gA' }, '');
writeMd(P('generations/gA.md'), { id: 'gA', shot: 'SH010', file: 'a.mp4' }, '');

const trim = m => {
  const e = m.entries.find(x => x.shot === 'SH010');
  return e ? { in: e.in, out: e.out } : null;
};

test('setting an OUT point preserves a previously-set IN point', () => {
  assert.deepEqual(trim(buildManifest(PID)), { in: 0, out: 6 }, 'baseline');
  assert.deepEqual(trim(setInOut(PID, 'SH010', 1.5, undefined)), { in: 1.5, out: 6 });
  // The bug: this returned { in: 0, out: 3.2 } and destroyed the 1.5.
  assert.deepEqual(trim(setInOut(PID, 'SH010', undefined, 3.2)), { in: 1.5, out: 3.2 });
  assert.deepEqual(trim(buildManifest(PID)), { in: 1.5, out: 3.2 }, 'and it survives a re-read from disk');
});

test('IN survives when OUT is sent as an explicit null', () => {
  // App.jsx sends `out: null` when no <video> is mounted. null survives JSON.stringify, so this
  // reached the server as a real value where undefined would not have — and still wiped `in`.
  setInOut(PID, 'SH010', 2.0, undefined);
  assert.deepEqual(trim(setInOut(PID, 'SH010', undefined, null)), { in: 2.0, out: 3.2 },
    'an explicit null means "leave it", not "clear it"');
});

test('0 is a storable trim value, not a synonym for absent', () => {
  setInOut(PID, 'SH010', 1.5, undefined);
  assert.equal(trim(setInOut(PID, 'SH010', 0, undefined)).in, 0,
    'the guard must be == null, never falsy — 0 is a legitimate in point');
});

test('the reverse order works too', () => {
  setInOut(PID, 'SH010', 0, 6);
  assert.deepEqual(trim(setInOut(PID, 'SH010', undefined, 4)), { in: 0, out: 4 });
  assert.deepEqual(trim(setInOut(PID, 'SH010', 1, undefined)), { in: 1, out: 4 },
    'setting IN after OUT must not disturb OUT');
});

/* ── settings.md must never be overwritten unread ────────────────────────────────────── */

const store = await import('../backend/store.mjs');
const settingsFile = path.join(root, 'settings.md');

test('a healthy settings.md round-trips', () => {
  store.saveSettings({ falApiKey: 'sk-live-FAL', kieApiKey: 'sk-live-KIE', agentCommand: 'claude' });
  assert.equal(store.getSettings().falApiKey, 'sk-live-FAL');
  assert.equal(store.settingsUnreadable(), false);
});

test('an unreadable settings.md is detected rather than silently defaulted', () => {
  const good = fs.readFileSync(settingsFile, 'utf8');
  fs.writeFileSync(settingsFile, '---\nfalApiKey: "unclosed\nkieApiKey: sk-live-KIE\n---\nbody\n');
  try {
    assert.equal(store.settingsUnreadable(), true);
    // Reads may still degrade — a read-only caller wants *something* — but the value is defaults.
    assert.equal(store.getSettings().falApiKey, '', 'the read degrades, which is exactly the trap');
  } finally {
    fs.writeFileSync(settingsFile, good);
  }
});

test('saveSettings REFUSES to write over a file it could not read', () => {
  const good = fs.readFileSync(settingsFile, 'utf8');
  fs.writeFileSync(settingsFile, '---\nfalApiKey: "unclosed\nkieApiKey: sk-live-KIE\n---\nbody\n');
  try {
    // The real trigger was innocuous: the client PUTs its whole settings object on ANY toggle,
    // so this is a user flipping "show hints" and losing every API key they had.
    assert.throws(() => store.saveSettings({ showHints: false }), /refusing to overwrite/);
    assert.match(fs.readFileSync(settingsFile, 'utf8'), /sk-live-KIE/,
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
