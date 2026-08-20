// M4 / T14 step 2 — the Index.
//
// Two properties, and the second is the one that has already cost this repo a day:
//
//   1. Adding a capability is a new Index line, never an edit to the router skill.
//   2. The Index may omit a capability. It may never advertise one that does not exist.
//
// Both are tested by breaking them and watching the guard bite (docs/decisions.md: "a guard that
// has not been observed failing is not a guard").

import './_env.mjs'; // first — sets the storage root before store.mjs captures it
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { freshRoot, getStorageRoot } from './helpers.mjs';
import {
  renderIndex, indexFacts, registerIndexRoutes, registeredRoutes,
  INDEX_CAPABILITIES, ROUTE_REFERENCE,
} from '../backend/agentIndex.mjs';
import { saveCollection } from '../backend/collections.mjs';
import { registerTaskRoutes } from '../backend/tasks.mjs';
import { registerProposalRoutes } from '../backend/proposals.mjs';
import { FIELD_TYPE_NAMES } from '../backend/collections.mjs';

const R = () => getStorageRoot();
const SKILL_DIR = new URL('../skills/scout-router/', import.meta.url);

// Run `fn` with an extra capability line in the table, then put the table back. This is the "adding
// a capability" gesture, performed literally.
function withCapability(cap, fn) {
  INDEX_CAPABILITIES.push(cap);
  try { return fn(); } finally { INDEX_CAPABILITIES.pop(); }
}

function seedProject(pid) {
  fs.mkdirSync(path.join(R(), 'projects', pid), { recursive: true });
  fs.writeFileSync(path.join(R(), 'projects', pid, 'project.md'), '---\nname: ' + pid + '\n---\n');
  return pid;
}

const GUEST = {
  id: 'guest',
  query: { path: 'data/guests/**' },
  fields: [
    { key: 'name', type: 'text', primary: true },
    { key: 'status', type: 'status', options: ['new', 'shortlist', 'booked'], gate: true },
    { key: 'score', type: 'number', display: 'bar' },
  ],
};

// ── shape ──────────────────────────────────────────────────────────────────────────────────────

test('the Index carries the five things the contract names, one line per capability', () => {
  freshRoot();
  saveCollection(GUEST);
  seedProject('guest-hunt');

  const text = renderIndex();
  assert.match(text, /^<scout-index>/);
  assert.match(text, /\napi: http:\/\/127\.0\.0\.1:\d+/);            // API base
  assert.match(text, /\nproject: guest-hunt/);                        // current project
  assert.match(text, new RegExp('\\nroutes: ' + ROUTE_REFERENCE.replace(/[/.]/g, '\\$&')));  // the pointer
  assert.match(text, /#guest — name\(text,primary\) · status\(status,gate\) · score\(number\)/); // collections + fields
  assert.match(text, /## Tools\n\(none enabled\)/);                   // enabled tools
  // the legal field types travel with the Index so a schema proposal has no excuse
  for (const t of FIELD_TYPE_NAMES) assert.ok(text.includes(t), 'field type "' + t + '" missing');

  const facts = indexFacts();
  for (const c of facts.capabilities) {
    assert.ok(text.includes(c.route + ' — ' + c.what), 'capability not rendered on its own line: ' + c.route);
  }
  process.stdout.write('\n' + text.split('\n').map(l => '    ' + l).join('\n') + '\n');
});

test('an empty workspace still renders — no collections is a first run, not an error', () => {
  freshRoot();
  const text = renderIndex();
  assert.match(text, /## Collections\n\(none yet — propose one\)/);
  assert.match(text, /\nproject: none/);
});

test('two projects and no active one is a question, and the Index does not guess', () => {
  freshRoot();
  seedProject('a'); seedProject('b');
  assert.match(renderIndex(), /\nproject: none/);
  assert.match(renderIndex({ project: 'b' }), /\nproject: b/);
});

// ── property 1: a capability is a line, and the skill never changes ────────────────────────────

test('adding a capability is one new line in the table — the router skill is not touched', () => {
  freshRoot();
  const before = fs.readdirSync(SKILL_DIR, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile()).map(e => fs.readFileSync(path.join(e.parentPath || e.path, e.name), 'utf8')).join('\n');

  const text = withCapability(
    { route: 'GET /api/tasks', what: 'A CAPABILITY ADDED BY A TEST.' },
    () => renderIndex(),
  );
  assert.ok(text.includes('GET /api/tasks — A CAPABILITY ADDED BY A TEST.'), 'the new line is not in the Index');

  const after = fs.readdirSync(SKILL_DIR, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile()).map(e => fs.readFileSync(path.join(e.parentPath || e.path, e.name), 'utf8')).join('\n');
  assert.equal(after, before, 'the router skill changed — the whole point is that it does not');
  assert.ok(!before.includes('A CAPABILITY ADDED BY A TEST'), 'the capability must live in the Index, not the skill');
});

// ── property 2: never advertise a route that does not exist ────────────────────────────────────

test('every capability the Index prints is a route that is actually registered', () => {
  freshRoot();
  const registered = registeredRoutes();
  assert.ok(registered.size > 40, 'sanity: found ' + registered.size + ' registered routes');
  const lying = indexFacts().capabilities.filter(c => !registered.has(c.route));
  assert.deepEqual(lying, [], 'advertised to every agent but never registered: ' + lying.map(c => c.route).join(', '));
});

test('the guard bites: a capability whose route does not exist is withheld, not printed', () => {
  freshRoot();
  const fake = { route: 'GET /api/definitely-not-a-route', what: 'should never be advertised.' };
  const { text, facts } = withCapability(fake, () => ({ text: renderIndex(), facts: indexFacts() }));
  assert.ok(!text.includes('definitely-not-a-route'), 'the Index advertised a route that does not exist');
  assert.ok(facts.withheld.includes(fake.route), 'a withheld capability must be reported, not silently dropped');
});

test('the table is fully accounted for — every line is either advertised or withheld', () => {
  freshRoot();
  const f = indexFacts();
  assert.equal(f.capabilities.length + f.withheld.length, INDEX_CAPABILITIES.length);
  assert.ok(f.capabilities.length > 0, 'the Index advertises nothing at all');
});

// ── the live app is the truest answer to "what exists" ─────────────────────────────────────────

test('given the running app, the Index reflects what that app actually mounted', async () => {
  freshRoot();
  const bare = express();
  registerIndexRoutes(bare, {});
  // Only /api/index is mounted here, so that must be the ONLY capability the Index claims.
  assert.deepEqual(indexFacts({ app: bare }).capabilities.map(c => c.route), ['GET /api/index']);

  const full = express();
  registerIndexRoutes(full, {});
  registerTaskRoutes(full, {});
  registerProposalRoutes(full, {});
  const routes = indexFacts({ app: full }).capabilities.map(c => c.route);
  for (const r of ['GET /api/tasks', 'POST /api/tasks/:id/claim', 'GET /api/proposals', 'POST /api/fields/propose']) {
    assert.ok(routes.includes(r), 'mounted but not advertised: ' + r);
  }
  assert.ok(!routes.includes('GET /api/context'), 'memory.mjs is not mounted here — /api/context must not be claimed');
});

// ── the route ──────────────────────────────────────────────────────────────────────────────────

test('GET /api/index serves JSON by default and plain text for an agent that asks', async () => {
  freshRoot();
  saveCollection(GUEST);
  const app = express();
  app.use(express.json());
  registerIndexRoutes(app, {});
  registerTaskRoutes(app, {});
  const s = await new Promise(resolve => { const x = app.listen(0, '127.0.0.1', () => resolve(x)); });
  s.unref();
  const base = 'http://127.0.0.1:' + s.address().port;

  const json = await (await fetch(base + '/api/index')).json();
  assert.ok(json.text.startsWith('<scout-index>'));
  assert.equal(json.reference, ROUTE_REFERENCE);
  assert.deepEqual(json.collections, ['#guest — name(text,primary) · status(status,gate) · score(number)']);
  assert.ok(json.capabilities.some(c => c.route === 'GET /api/tasks'));

  const raw = await fetch(base + '/api/index?format=text');
  assert.match(raw.headers.get('content-type') || '', /text\/plain/);
  assert.match(await raw.text(), /^<scout-index>/);
});
