#!/usr/bin/env node
// scripts/demo.mjs — put the checked-in demonstration workspace where the app looks for one.
//
//   npm run demo      # workspace-demo/ → workspace/, then `npm start` and press D
//
// `workspace/` is a user's data and is gitignored, so a fresh clone has none and `npm start`
// lands on the first-run interview with nothing to look at. This copies the fixture into place so
// the first thing a new person sees is a populated app.
//
// IT NEVER OVERWRITES AN EXISTING `workspace/`. Law 5 — never delete a user file — is not a rule
// about the app only: a convenience script that clobbers somebody's real vault to save them one
// `rm` is the same failure with a friendlier name. If `workspace/` is there, this refuses and says
// so, and moving it out of the way stays the person's decision.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'workspace-demo');
const DEST = path.join(ROOT, 'workspace');

if (!fs.existsSync(SRC)) {
  console.error('workspace-demo/ is missing — this clone has no fixture to copy.');
  process.exit(1);
}

if (fs.existsSync(DEST)) {
  console.error('workspace/ already exists — refusing to overwrite it. Move or rename it first, then run `npm run demo` again.');
  process.exit(1);
}

fs.cpSync(SRC, DEST, { recursive: true });

// macOS writes a `._X` AppleDouble beside almost every file on an exFAT volume, and they are not
// cosmetic: `._librarian.md` once shipped a phantom assistant into GET /api/assistants with a body
// of raw AppleDouble bytes. Sweep them out of the copy rather than into the app.
let swept = 0;
(function sweep(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) sweep(f);
    else if (e.name.startsWith('._')) { fs.rmSync(f, { force: true }); swept++; }
  }
})(DEST);

const files = (function count(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? count(path.join(dir, e.name)) : 1;
  return n;
})(DEST);

console.log('workspace-demo/ → workspace/  ·  ' + files + ' files' + (swept ? '  ·  swept ' + swept + ' ._* sidecars' : ''));
console.log('Now: npm start   then press D to work the queue.');
