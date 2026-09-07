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
import { freshRoot, getStorageRoot, req } from './helpers.mjs';
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

// ── the router skill is a contract too, and it was lying ───────────────────────────────────────
//
// `skills/scout-router/` is copied fresh into EVERY agent session home on each run, so a wrong key
// in it is not a typo in a doc — it is a wrong key in every agent that ever runs. Reproduced:
// `references/api-mode.md` and `SKILL.md` both named the upsert response key `action`; the route
// answers `verdict`. An agent that followed the skill branched on `undefined` on every finding it
// submitted, so "already known, do not try again" never fired and no sweep ever deduped.
//
// Same property as the Index's, applied to the skill: it may omit something, it may never name
// something that is not there. The table below is the declaration, and it is checked BOTH ways —
// against the live routes, and against what the skill files actually say.
const RESPONSE_CONTRACT = [
  {
    route: 'POST /api/records/upsert',
    call: () => req('POST', '/api/records/upsert', { collection: 'guest', name: 'Maria Santos', actor: 'crystal' }),
    keys: ['verdict', 'id', 'path', 'confidence'],
  },
  {
    route: 'POST /api/records/batch',
    call: () => req('POST', '/api/records/batch', { items: [{ collection: 'guest', name: 'Jun Dela Cruz' }], actor: 'crystal' }),
    keys: ['tally', 'results'],
  },
  {
    route: 'POST /api/records/match',
    call: () => req('POST', '/api/records/match', { collection: 'guest', name: 'Maria Santos' }),
    keys: ['matches'],
  },
  {
    // Claimed twice on purpose: the shape the skill documents is the LOSING one, and the two
    // answers do not carry the same keys.
    route: 'POST /api/tasks/:id/claim',
    call: async () => {
      await req('POST', '/api/tasks/sweep-nurses-ph/claim', { project: 'otr', actor: 'scout-fb' });
      return req('POST', '/api/tasks/sweep-nurses-ph/claim', { project: 'otr', actor: 'scout-ig' });
    },
    keys: ['won', 'reason', 'assigned'],
  },
  {
    route: 'GET /api/cache/version',
    call: () => req('GET', '/api/cache/version'),
    keys: ['v', 'generated'],
  },
];

const skillText = () => ['SKILL.md', 'references/api-mode.md', 'references/folder-mode.md', 'references/field-types.md']
  .map(f => ({ file: f, text: fs.readFileSync(new URL(f, SKILL_DIR), 'utf8') }));

// Fenced blocks are examples of what to SEND; inline spans are what the prose asserts. Only the
// prose is checked, or the curl body's own field names would read as response keys.
const stripFences = s => s.replace(/```[\s\S]*?```/g, '\n');

test('every response key the router skill names is a key that route actually returns', async () => {
  freshRoot();
  saveCollection(GUEST);
  fs.mkdirSync(path.join(R(), 'projects', 'otr', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(R(), 'projects', 'otr', 'project.md'), '---\nname: otr\n---\n');
  fs.writeFileSync(path.join(R(), 'projects', 'otr', 'tasks', 'sweep-nurses-ph.md'),
    '---\nid: sweep-nurses-ph\nstatus: open\n---\nSweep it.\n');

  // 1 · the table is honest about the routes. Called for real, with the body the skill shows.
  const live = new Map();
  for (const row of RESPONSE_CONTRACT) {
    const res = await row.call();
    assert.ok(res.body && typeof res.body === 'object', row.route + ' answered nothing to parse');
    for (const k of row.keys) {
      assert.ok(k in res.body, row.route + ' does not return `' + k + '`, which the contract claims');
    }
    live.set(row.route, new Set(Object.keys(res.body)));
  }
  const allKeys = new Set(RESPONSE_CONTRACT.flatMap(r => r.keys));

  // 2 · a table in the skill whose HEADER cell is a code span is naming a response key — that is
  // the exact shape the `action` bug had: `| \`action\` | Meaning |`.
  for (const { file, text } of skillText()) {
    const lines = stripFences(text).split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (!/^\|\s*-+/.test(lines[i + 1] || '')) continue;            // the next line is the ---|--- rule
      const head = /^\|\s*`([a-z][a-z0-9_]*)`\s*\|/.exec(lines[i]);  // …so this line is a header row
      if (!head) continue;
      assert.ok(allKeys.has(head[1]),
        file + ':' + (i + 1) + ' documents a response key `' + head[1] + '` that no route returns. '
        + 'This file is copied into every agent session, so every agent branches on undefined.');
    }
  }

  // 3 · a `{…}` span on the same line as one of these routes is that route's response shape.
  for (const { file, text } of skillText()) {
    stripFences(text).split('\n').forEach((line, i) => {
      for (const row of RESPONSE_CONTRACT) {
        const p = row.route.split(' ')[1].replace(/:\w+/g, '');       // '/api/tasks//claim' → prefix match
        if (!line.includes(p.replace(/\/\//g, '/')) && !line.includes(row.route.split(' ')[1])) continue;
        for (const m of line.matchAll(/`\{([^`]*)\}`/g)) {
          for (const part of m[1].split(',')) {
            const key = /^\s*"?([a-z][a-z0-9_]*)"?\s*(:|$)/.exec(part);
            if (!key || key[1] === '') continue;
            assert.ok(live.get(row.route).has(key[1]),
              file + ':' + (i + 1) + ' says ' + row.route + ' answers `' + key[1]
              + '`; it does not. It answers: ' + [...live.get(row.route)].join(' · '));
          }
        }
      }
    });
  }
});

test('the router skill agrees with the route about a lost task claim', async () => {
  freshRoot();
  saveCollection(GUEST);
  fs.mkdirSync(path.join(R(), 'projects', 'otr', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(R(), 'projects', 'otr', 'project.md'), '---\nname: otr\n---\n');
  fs.writeFileSync(path.join(R(), 'projects', 'otr', 'tasks', 'sweep.md'),
    '---\nid: sweep\nstatus: open\n---\nSweep it.\n');

  const won = await req('POST', '/api/tasks/sweep/claim', { project: 'otr', actor: 'scout-fb' });
  const lost = await req('POST', '/api/tasks/sweep/claim', { project: 'otr', actor: 'scout-ig' });
  assert.equal(won.status, 200);
  assert.equal(lost.status, 409, 'the route no longer answers 409 to a lost claim');
  assert.equal(lost.body.won, false);

  // The skill used to say "It is a 200, not a 409: check the body, not the status" — so an agent
  // following it treated the 409 as a transport failure and either retried or gave up. The Index
  // said 409 all along, which is two documents disagreeing about one route.
  const api = fs.readFileSync(new URL('references/api-mode.md', SKILL_DIR), 'utf8');
  const claimLine = api.split('\n').find(l => l.includes('/api/tasks/:id/claim'));
  assert.ok(claimLine, 'the claim route left the skill');
  assert.doesNotMatch(claimLine, /not a 409/, 'the skill still tells agents to ignore the 409');
  assert.match(claimLine, /409/, 'the skill does not say what status a lost claim answers');
  const indexLine = INDEX_CAPABILITIES.find(c => c.route === 'POST /api/tasks/:id/claim');
  assert.match(indexLine.what, /409/, 'the Index and the skill must say the same thing');
});
