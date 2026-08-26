import { tempRoots } from './_env.mjs'; // first — sets storage-root env before the store loads
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setStorageRoot, writeMd, readMd, paths, getStorageRoot } from '../backend/store.mjs';
import { app } from '../backend/index.mjs';

// Point the store at a brand-new empty root and return it. Call at the start of each test for
// isolation — every test then works against its own portable markdown folder.
export function freshRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-root-'));
  tempRoots.push(root); // cleaned up on process exit by _env.mjs
  fs.mkdirSync(path.join(root, 'projects'), { recursive: true });
  setStorageRoot(root);
  return root;
}

// Seed a project directory on disk directly (no HTTP) — the store reads whatever is there.
export function seedProject(pid, data = {}) {
  writeMd(paths.projectMd(pid), { name: pid, order: 1, ...data }, '');
  fs.mkdirSync(paths.itemsDir(pid), { recursive: true });
  fs.mkdirSync(path.join(paths.projectDir(pid), 'shots'), { recursive: true });
  return pid;
}

// Seed one triage item .md under a project.
export function seedItem(pid, id, data = {}, body = '## Item log') {
  const full = { id, name: id, label: id, type: 'img', st: 'new', rating: 0, fin: false, trashed: false, ...data };
  writeMd(paths.itemMd(pid, id), full, body + '\n');
  return full;
}

// Seed a shot .md under a project.
export function seedShot(pid, id, data = {}) {
  const full = { id, no: 1, title: id, status: 'todo', assets: [], ...data };
  writeMd(path.join(paths.projectDir(pid), 'shots', id + '.md'), full, '## Shot log\n');
  return full;
}

// Seed a generation record .md under a project.
export function seedGen(pid, id, data = {}) {
  const full = { id, status: 'done', model: 'fal-ai/flux/schnell', prompt: 'test', cost: 0.01, started: Date.now(), ...data };
  writeMd(path.join(paths.projectDir(pid), 'generations', id + '.md'), full, 'Generation record\n');
  return full;
}

let server, baseUrl;
// Start the shared Express app on an ephemeral port once per test-file process.
export async function server_() {
  if (baseUrl) return baseUrl;
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  server.unref(); // don't keep the test process alive after the tests finish
  const { port } = server.address();
  baseUrl = 'http://127.0.0.1:' + port;
  return baseUrl;
}

// JSON request helper → { status, body }.
export async function req(method, p, body) {
  const base = await server_();
  const r = await fetch(base + p, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let parsed = null;
  try { parsed = await r.json(); } catch { /* empty body */ }
  return { status: r.status, body: parsed };
}

export function readItemFile(pid, id) {
  return fs.readFileSync(paths.itemMd(pid, id), 'utf8');
}
// Patch a generation record on disk through the real store writer (proper YAML round-trip).
export function patchGenFile(pid, id, patch) {
  const file = path.join(paths.projectDir(pid), 'generations', id + '.md');
  const { data, content } = readMd(file);
  writeMd(file, { ...data, ...patch }, content);
}
export { paths, getStorageRoot, writeMd, readMd, fs, path };

// ── testing a .jsx module ──────────────────────────────────────────────────────────────────────
// Several screens keep their real logic in exported pure functions — `Today.overnightLines`,
// `Assistants.costToday`, `GalleryView.mediaSrc` — and none of it was reachable from `node --test`,
// because node cannot import JSX. So none of it was tested, and the defects that reached people
// lived exactly there: a formatter handed epoch milliseconds it could not read printed the word
// "null" into the panel header on the 9am screen.
//
// This compiles ONE module (not its React imports — `external: ['react', …]` keeps it a leaf) to a
// temp .mjs and imports it. It is deliberately narrow: it is for pure exported logic, not for
// rendering. A component that needs a DOM to be tested is telling you its logic wants to be a
// function.
export async function loadJsx(relPath) {
  const esbuild = await import('esbuild');
  // fileURLToPath, never `url.pathname` — a repo path with a space in it (this one has two) comes
  // back percent-encoded and esbuild reports it as "could not resolve", which reads like a
  // missing file rather than a mangled path.
  const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', relPath);
  // Output INSIDE the repo: the compiled module still imports `react` (it is external, so the
  // component code is left alone), and a file in os.tmpdir() cannot resolve it. node_modules/
  // is the one directory that is always present, always ignored, and always resolvable.
  const cache = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.cache', 'scout-jsx');
  fs.mkdirSync(cache, { recursive: true });
  const out = path.join(cache, relPath.replace(/[\\/]/g, '_') + '.mjs');
  await esbuild.build({
    entryPoints: [src], outfile: out, bundle: true, format: 'esm', platform: 'neutral',
    jsx: 'automatic', logLevel: 'silent',
    external: ['react', 'react-dom', 'react/jsx-runtime', '@codemirror/*', '@lezer/*', 'codemirror'],
  });
  return import(out);
}
