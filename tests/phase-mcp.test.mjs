// T14 step 4 — door 3, MCP over stdio.
//
// The one thing this file exists to prove is T14's Demonstrate: **the same job completes through
// all three doors and produces identical records.** Not "all three return 200" — identical bytes on
// disk. Everything else here guards the two ways door 3 could quietly stop being the same door:
// a hand-drifted tool list, and a gate that is only enforced on the HTTP path.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { freshRoot, writeMd, req, server_ } from './helpers.mjs';
import { getStorageRoot } from '../backend/store.mjs';
import { INDEX_CAPABILITIES } from '../backend/agentIndex.mjs';
import { upsertRecord } from '../backend/records.mjs';
import { processInboxFile, ensureInbox } from '../backend/inbox.mjs';
import { readCache, cacheVersion, regenerateCache, cancelCacheRegen } from '../backend/memory.mjs';
import { documentsFor } from '../backend/documents.mjs';
import {
  handleMessage, createServer, toolsFrom, toolName, TOOLS,
  SERVER_NAME, LATEST_PROTOCOL, PROTOCOL_VERSIONS, JSONRPC_ERRORS, defaultActor,
} from '../backend/mcp.mjs';

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────

// Every field the three doors will carry is DECLARED. An undeclared key goes to `extra` through
// door 2 and stays flat through doors 1 and 3, so an under-declared schema would fail the identity
// test for a reason that has nothing to do with the doors.
function seedGuestCollection() {
  writeMd(path.join(getStorageRoot(), '.scout', 'collections', 'guest.md'), {
    id: 'guest', label: 'Guests', query: { path: 'data/guests/**' },
    fields: [
      { key: 'name', type: 'text', required: true, primary: true },
      { key: 'status', type: 'status', gate: true, options: [
        { value: 'needs-review', group: 'todo' }, { value: 'shortlist', group: 'todo' },
        { value: 'contacted', group: 'active' }, { value: 'won', group: 'done' }] },
      { key: 'handle', type: 'text' },
      { key: 'found_in', type: 'relation', target: 'group' },
      { key: 'score', type: 'number' },
      { key: 'source', type: 'url' },
      { key: 'why', type: 'text' },
    ],
  }, 'Guests.\n');
}

const FINDING = {
  collection: 'guest',
  name: 'Maria Santos',
  handle: '@mariacooks',
  found_in: 'nurses-ph',
  score: 9,
  source: 'https://instagram.com/p/xyz',
  why: 'Nurse turned cook. Tells her own story, no brand deals in 40 posts.',
};
const BODY = 'A nurse who tells her own story rather than reviewing other people’s.';
const AGENT = 'scout-fb';
const RECORD_FILE = 'data/guests/maria-santos.md';

let n = 0;
const rpc = (method, params) => handleMessage({ jsonrpc: '2.0', id: ++n, method, params });
const call = (name, args = {}) => rpc('tools/call', { name, arguments: args });
const textOf = res => res.result.content[0].text;
const jsonOf = res => JSON.parse(textOf(res));

// ── 1 · the tool surface is generated, not maintained ──────────────────────────────────────────

test('tools/list is generated from INDEX_CAPABILITIES — one tool per capability, no second list', async () => {
  freshRoot();
  const res = await rpc('tools/list');
  const tools = res.result.tools;

  assert.equal(tools.length, INDEX_CAPABILITIES.length,
    'the tool surface and the capability table have drifted apart');

  // Every Index line reaches an agent as a tool. A capability the Index promises and the tool
  // surface omits is exactly the failure docs/decisions.md already records for the route reference.
  const byRoute = new Map(TOOLS.map(t => [t.route, t]));
  for (const cap of INDEX_CAPABILITIES) {
    assert.ok(byRoute.has(cap.route), 'no tool for the Index line "' + cap.route + '"');
  }

  const names = tools.map(t => t.name);
  assert.equal(new Set(names).size, names.length, 'two capabilities generated the same tool name');

  for (const t of tools) {
    assert.match(t.name, /^[A-Za-z0-9_-]{1,64}$/, t.name + ' is not a legal MCP tool name');
    assert.ok(t.description && t.description.length > 40, t.name + ' has no description worth reading');
    assert.equal(t.inputSchema.type, 'object', t.name + ' has no object inputSchema');
    assert.ok(Array.isArray(t.inputSchema.required), t.name + ' does not name its required fields');
    assert.ok(t.inputSchema.properties && typeof t.inputSchema.properties === 'object');
  }
});

test('the required fields are actually named, per tool, in the schema', () => {
  const required = name => TOOLS.find(t => t.name === name).inputSchema.required;
  assert.deepEqual(required('scout_post_records_upsert'), ['collection']);
  assert.deepEqual(required('scout_post_records_batch'), ['items']);
  assert.deepEqual(required('scout_post_records_move'), ['to']);
  assert.deepEqual(required('scout_get_search'), ['q']);
  assert.deepEqual(required('scout_get_document'), ['path']);
  assert.deepEqual(required('scout_put_views'), ['collection', 'view']);
  assert.deepEqual(required('scout_post_fields_propose'), ['collection', 'key', 'type', 'why', 'evidence']);
  assert.deepEqual(required('scout_post_collections_propose'), ['schema', 'why', 'evidence']);
  assert.deepEqual(required('scout_get_collections_documents'), ['id']);
});

test('a NEW Index line becomes a tool with no edit to backend/mcp.mjs', () => {
  // The whole point of generating rather than hand-maintaining. `toolsFrom` is the same function
  // that built TOOLS, so this is the real path, not a mock of it.
  const invented = { route: 'GET /api/weather/tomorrow', what: 'invented for this test.' };
  const tools = toolsFrom([...INDEX_CAPABILITIES, invented]);
  assert.equal(tools.length, INDEX_CAPABILITIES.length + 1);
  const made = tools.find(t => t.route === invented.route);
  assert.ok(made, 'a new capability line did not produce a tool');
  assert.equal(made.name, 'scout_get_weather_tomorrow');
  assert.equal(made.bound, false, 'an invented route cannot have a binding');
  assert.match(made.description, /invented for this test/);
});

test('tool names are derived mechanically from the route, so two lines can never collide silently', () => {
  assert.equal(toolName('GET /api/context'), 'scout_get_context');
  assert.equal(toolName('PATCH /api/territory/:id'), 'scout_patch_territory');
  assert.equal(toolName('POST /api/tasks/:id/claim'), 'scout_post_tasks_claim');
  // Two capabilities that mapped to one name would be a tool surface that silently loses one of
  // them. It throws instead.
  assert.throws(
    () => toolsFrom([{ route: 'GET /api/territory', what: 'a' }, { route: 'GET /api/territory/:id', what: 'b' }]),
    /generate the tool name/,
  );
});

// ── 2 · the protocol ───────────────────────────────────────────────────────────────────────────

test('initialize · notifications/initialized · tools/list · unknown method', async () => {
  freshRoot();

  const init = await rpc('initialize', {
    protocolVersion: LATEST_PROTOCOL,
    capabilities: {},
    clientInfo: { name: 'test-host', version: '1' },
  });
  assert.equal(init.jsonrpc, '2.0');
  assert.equal(init.result.protocolVersion, LATEST_PROTOCOL);
  assert.equal(init.result.serverInfo.name, SERVER_NAME);
  assert.ok(init.result.capabilities.tools, 'the server did not advertise tools');
  assert.match(init.result.instructions, /scout_get_context/);

  // An unknown protocol version is answered with ours, not refused — that is what the spec asks.
  const odd = await rpc('initialize', { protocolVersion: '1999-01-01' });
  assert.equal(odd.result.protocolVersion, LATEST_PROTOCOL);
  const old = await rpc('initialize', { protocolVersion: PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 1] });
  assert.equal(old.result.protocolVersion, PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 1]);

  // A notification has no id and gets NO frame back. Answering one corrupts the host's pairing.
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);

  const unknown = await rpc('tools/nonesuch');
  assert.equal(unknown.error.code, JSONRPC_ERRORS.METHOD_NOT_FOUND);
  assert.match(unknown.error.message, /initialize, tools\/list, tools\/call/);

  const junk = await handleMessage('not an object');
  assert.equal(junk.error.code, JSONRPC_ERRORS.INVALID_REQUEST);

  const missing = await call('scout_no_such_tool', {});
  assert.equal(missing.error.code, JSONRPC_ERRORS.INVALID_PARAMS);
  assert.match(missing.error.message, /no tool "scout_no_such_tool"/);
});

test('createServer({ log }) reports to the log it was given and never to stdout', async () => {
  freshRoot();
  const lines = [];
  const server = createServer({ log: m => lines.push(m) });
  const res = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(res.result.serverInfo.name, SERVER_NAME);
  assert.ok(lines.some(l => /initialize/.test(l)), 'the injected log never saw the handshake');
  assert.equal(server.listTools().length, INDEX_CAPABILITIES.length);
});

// ── 3 · the wake-up is text, byte for byte ─────────────────────────────────────────────────────

test('the wake-up tool returns the cache AS TEXT — the same bytes GET /api/context serves bare', async () => {
  freshRoot();
  seedGuestCollection();

  const res = await call('scout_get_context');
  assert.equal(res.result.content[0].type, 'text');
  const viaMcp = textOf(res);

  // Same bytes as the module (door 1's own readCache)…
  assert.equal(viaMcp, readCache({ project: null }).text, 'door 3 hands the agent different bytes');

  // …and the same bytes GET /api/context serves BARE. `req` parses JSON, and this route answers
  // markdown by design, so the raw body is fetched: the point of the assertion is the bytes.
  const base = await server_();
  const raw = await (await fetch(base + '/api/context')).text();
  assert.equal(viaMcp, raw, 'the wake-up read differs between door 1 and door 3');
  assert.ok(!viaMcp.startsWith('{'), 'the briefing came back as a JSON blob, not as the context');
});

// ── 4 · the gate applies identically ───────────────────────────────────────────────────────────

test('an MCP client is an agent: promoting past shortlist is refused with the same sentence as HTTP', async () => {
  freshRoot();
  seedGuestCollection();

  const stored = jsonOf(await call('scout_post_records_upsert', { ...FINDING, body: BODY }));
  assert.equal(stored.verdict, 'store');

  // shortlist is allowed — the agent may go exactly that far.
  const okMove = jsonOf(await call('scout_post_records_move', { id: stored.id, to: 'shortlist' }));
  assert.equal(okMove.to, 'shortlist');

  // one step further is refused
  const refused = await call('scout_post_records_move', { id: stored.id, to: 'contacted' });
  assert.ok(refused.error, 'the gate did not fire on door 3');
  assert.equal(refused.error.message, 'an agent may not promote past "shortlist"');
  assert.equal(refused.error.data.status, 403,
    'the refusal reached the agent without the status the HTTP door would have carried');

  // …and the HTTP door refuses the same move with the same sentence. Two doors, one rule.
  const http = await req('POST', '/api/records/move', { path: stored.path, to: 'contacted', actor: defaultActor() });
  assert.equal(http.status, 403);
  assert.equal(http.body.error, refused.error.message,
    'the two doors refuse with different words, so the rule lives in two places');
});

test('the refusal is the SENTENCE, not a status code', async () => {
  freshRoot();
  seedGuestCollection();
  const stored = jsonOf(await call('scout_post_records_upsert', { ...FINDING }));

  // A stage that does not exist comes back naming the ones that do — an agent handed a 400 would
  // have to guess, and guessing is how it burns a whole job.
  const bad = await call('scout_post_records_move', { id: stored.id, to: 'nowhere' });
  assert.match(bad.error.message, /"nowhere" is not one of needs-review · shortlist · contacted · won/);
  assert.equal(bad.error.data.status, 400);

  // A record that does not exist says so by name.
  const missing = await call('scout_post_records_move', { id: 'nobody-at-all', to: 'shortlist' });
  assert.equal(missing.error.message, 'no record "nobody-at-all"');
  assert.equal(missing.error.data.status, 404);

  // And a required argument the schema names is refused BY NAME, before anything is touched.
  const empty = await call('scout_post_records_move', { id: stored.id });
  assert.equal(empty.error.code, JSONRPC_ERRORS.INVALID_PARAMS);
  assert.match(empty.error.message, /`to` is required by scout_post_records_move/);
});

test('a write with no actor is treated as an agent — the gate is on by default on this door', async () => {
  freshRoot();
  seedGuestCollection();
  const stored = jsonOf(await call('scout_post_records_upsert', { ...FINDING }));
  const doc = documentsFor('guest').documents.find(d => d.path === stored.path);
  assert.equal(doc.fields.proposed, true, 'an MCP write did not land as proposed');
  assert.equal(doc.fields.created_by, defaultActor());
  assert.equal(doc.fields.status, 'needs-review', 'an agent write did not land in the first stage');
});

// ── 5 · the same pipeline, not a second one ────────────────────────────────────────────────────

test('door 3 dedupes against door 3, because it is the same upsertRecord', async () => {
  freshRoot();
  seedGuestCollection();

  const first = jsonOf(await call('scout_post_records_upsert', { ...FINDING, body: BODY }));
  assert.equal(first.verdict, 'store');

  const again = jsonOf(await call('scout_post_records_upsert', {
    collection: 'guest', name: 'Maria Santos', handle: '@maria_cooks', found_in: 'nurses-ph',
  }));
  assert.notEqual(again.verdict, 'store', 'a second sighting stored a duplicate');
  assert.equal(documentsFor('guest').documents.length, 1);

  // …and the dry run writes nothing at all.
  const dry = jsonOf(await call('scout_post_records_match', { collection: 'guest', name: 'Maria Santos' }));
  assert.ok(dry.matches.length >= 1);
  assert.equal(documentsFor('guest').documents.length, 1);
});

test('a batch through door 3 is one near-match pass, and one bad item does not cost the rest', async () => {
  freshRoot();
  seedGuestCollection();
  const out = jsonOf(await call('scout_post_records_batch', {
    items: [
      { collection: 'guest', name: 'Ana Cruz', found_in: 'nurses-ph' },
      { collection: 'guest', name: 'Ana Cruz', found_in: 'nurses-ph', handle: '@anacruz' },
      { name: 'No Collection' },
    ],
  }));
  assert.equal(out.tally.store, 1);
  assert.equal(out.results[2].verdict, 'refused');
  assert.match(out.results[2].error, /collection/);
  assert.equal(documentsFor('guest').documents.length, 1, 'the batch did not dedupe against itself');
});

// ── 6 · T14's Demonstrate ──────────────────────────────────────────────────────────────────────

test('THE SAME JOB THROUGH ALL THREE DOORS PRODUCES IDENTICAL RECORDS', async () => {
  const run = async which => {
    const root = freshRoot();
    seedGuestCollection();

    if (which === 'http-verb') {
      // Door 1. The function every HTTP route handler calls, with the arguments it passes.
      upsertRecord({ ...FINDING, body: BODY }, { actor: AGENT, via: 'api' });
    } else if (which === 'inbox') {
      // Door 2. A .md dropped into _inbox/, processed by the watcher's own entry point.
      const dir = ensureInbox();
      const file = path.join(dir, 'maria.md');
      fs.writeFileSync(file, [
        '---',
        'collection: guest',
        'name: Maria Santos',
        'handle: "@mariacooks"',
        'found_in: nurses-ph',
        'score: 9',
        'source: https://instagram.com/p/xyz',
        'why: Nurse turned cook. Tells her own story, no brand deals in 40 posts.',
        '---',
        '',
        BODY,
        '',
      ].join('\n'));
      const r = await processInboxFile(file, { actor: AGENT });
      assert.ok(r.ok, 'door 2 failed: ' + JSON.stringify(r));
    } else {
      // Door 3. tools/call, over the same handleMessage an MCP host reaches through stdio.
      const res = await call('scout_post_records_upsert', { ...FINDING, body: BODY, actor: AGENT });
      assert.ok(!res.error, 'door 3 failed: ' + JSON.stringify(res.error));
      assert.equal(JSON.parse(res.result.content[0].text).verdict, 'store');
    }

    const abs = path.join(root, RECORD_FILE);
    assert.ok(fs.existsSync(abs), which + ' did not produce ' + RECORD_FILE);
    return fs.readFileSync(abs, 'utf8');
  };

  const one = await run('http-verb');
  const two = await run('inbox');
  const three = await run('mcp');

  assert.equal(two, one, 'door 2 (_inbox) produced a different record than door 1 (upsertRecord)');
  assert.equal(three, one, 'door 3 (MCP) produced a different record than door 1 (upsertRecord)');

  // Not vacuously equal: the record really is the finding.
  assert.match(one, /name: Maria Santos/);
  assert.match(one, /found_in: nurses-ph/);
  assert.match(one, /proposed: true/);
  assert.match(one, /provenance: pipeline/);
  assert.ok(one.includes(BODY));
});

// ── 7 · the rest of the surface actually works ─────────────────────────────────────────────────

test('read tools answer without any HTTP server in the picture', async () => {
  freshRoot();
  seedGuestCollection();
  jsonOf(await call('scout_post_records_upsert', { ...FINDING, body: BODY }));

  const collections = jsonOf(await call('scout_get_collections'));
  assert.ok(collections.collections.some(c => c.id === 'guest'));
  assert.ok(collections.fieldTypes.includes('text'), 'the legal field types were not offered');

  const docs = jsonOf(await call('scout_get_collections_documents', { id: 'guest' }));
  assert.equal(docs.total, 1);
  assert.ok(Array.isArray(docs.quarantined));

  // NOTE: `GET /api/search` (backend/search.mjs) indexes projects and triage items, not records —
  // an inheritance from FrameForge that the Index line over-promises. The tool is bound to the same
  // function the route is, so it answers with the same envelope; asserting a record hit here would
  // be asserting a behaviour the app does not have.
  const found = jsonOf(await call('scout_get_search', { q: 'Maria' }));
  assert.ok(Array.isArray(found.results));
  assert.equal(typeof found.total, 'number');

  const doc = jsonOf(await call('scout_get_document', { path: RECORD_FILE }));
  assert.equal(doc.data.name, 'Maria Santos');

  const activity = jsonOf(await call('scout_get_activity', { limit: 10 }));
  assert.ok(activity.events.some(e => e.type === 'store'));

  const index = textOf(await call('scout_get_index'));
  assert.match(index, /<scout-index>/);
  assert.match(index, /#guest/);

  const version = jsonOf(await call('scout_get_cache_version'));
  assert.ok('v' in version);

  const missing = await call('scout_get_document', { path: 'data/guests/nobody.md' });
  assert.equal(missing.error.message, 'no document at that path');
  assert.equal(missing.error.data.status, 404);
});

test('views are free; fields and collections are proposals', async () => {
  freshRoot();
  seedGuestCollection();

  // A view saves outright — no card, no approval.
  const saved = jsonOf(await call('scout_put_views', {
    collection: 'guest',
    view: { id: 'top-scores', type: 'table', sort: [{ field: 'score', dir: 'desc' }], fields: ['name', 'score'] },
  }));
  assert.ok(saved.views.some(v => v.id === 'top-scores'));

  // A field does not. It becomes a card in DECIDE, carrying `why` verbatim.
  const card = jsonOf(await call('scout_post_fields_propose', {
    collection: 'guest', key: 'posts_video', type: 'checkbox',
    why: '14 of your last 20 shortlists post video.',
    evidence: ['data/guests/maria-santos.md', '13 more shortlisted guests with video'],
  }));
  assert.equal(card.kind, 'schema');
  assert.equal(card.status, 'open');
  assert.equal(card.why, '14 of your last 20 shortlists post video.');

  const queue = jsonOf(await call('scout_get_proposals', { status: 'open' }));
  assert.ok(queue.proposals.some(p => p.id === card.id));
});

test('a field proposal with no `why` is refused with the sentence, not a code', async () => {
  freshRoot();
  seedGuestCollection();
  const noWhy = await call('scout_post_fields_propose', { collection: 'guest', key: 'x', type: 'text', evidence: ['a'] });
  assert.ok(noWhy.error, 'a field proposal without `why` went through');
  assert.equal(noWhy.error.code, JSONRPC_ERRORS.INVALID_PARAMS);
  assert.match(noWhy.error.message, /`why` is required by scout_post_fields_propose/);

  // …and the deeper rule the pipeline itself enforces reaches the agent as ITS sentence, not ours.
  const emptyEvidence = await call('scout_post_fields_propose', {
    collection: 'guest', key: 'x', type: 'text', why: 'because', evidence: [],
  });
  assert.match(emptyEvidence.error.message, /evidence\[\] — what you observed, not what you think/);
});

test('tasks: claim, then report — and a lost claim is a result, not a crash', async () => {
  freshRoot();
  seedGuestCollection();
  writeMd(path.join(getStorageRoot(), 'projects', 'showp', 'tasks', 'sweep-nurses-ph.md'), {
    id: 'sweep-nurses-ph', project: 'showp', status: 'open', title: 'Sweep nurses-ph',
  }, 'Sweep the group.\n');

  const open = jsonOf(await call('scout_get_tasks', { status: 'open' }));
  assert.equal(open.tasks.length, 1);

  const won = jsonOf(await call('scout_post_tasks_claim', { id: 'sweep-nurses-ph' }));
  assert.equal(won.won, true);

  const lost = jsonOf(await call('scout_post_tasks_claim', { id: 'sweep-nurses-ph', actor: 'someone-else' }));
  assert.equal(lost.won, false, 'two agents both won one task');

  const done = jsonOf(await call('scout_patch_tasks', { id: 'sweep-nurses-ph', status: 'done' }));
  assert.equal(done.status, 'done');

  const run = jsonOf(await call('scout_post_runs', {
    assistant: AGENT, status: 'done', summary: 'Searched nurses-ph. Found one. Needs a look.',
  }));
  assert.equal(run.assistant, AGENT);

  const gone = await call('scout_post_tasks_claim', { id: 'no-such-task' });
  assert.equal(gone.error.message, 'no task "no-such-task"');
});

test('territory: computed keys can never be written by hand through this door', async () => {
  freshRoot();
  writeMd(path.join(getStorageRoot(), 'territory', 'nurses-ph.md'), {
    id: 'nurses-ph', name: 'Nurses PH', access: 'member',
  }, 'A group.\n');

  const list = jsonOf(await call('scout_get_territory'));
  assert.equal(list.territory.length, 1);

  const patched = jsonOf(await call('scout_patch_territory', {
    id: 'nurses-ph', last_swept: '2026-08-19', hit_rate: 99,
  }));
  assert.equal(patched.territory.data.last_swept, '2026-08-19');
  assert.ok((patched.stripped || []).includes('hit_rate'),
    'a computed key was accepted from an agent instead of being stripped and reported');
});

// ── the hot cache, on a door whose process may not outlive its own debounce ────────────────────
//
// Law 7 is a contract and `scout_get_cache_version` is the promise an agent acts on: an unchanged
// `v` means the context it cached is still good. Reproduced in one session before the fix:
//
//   scout_get_context          → COUNTS said `territory 0`, v = 1
//   scout_post_records_upsert  → a guest was stored
//   scout_get_context          → STILL `territory 0`; scout_get_cache_version → still v = 1
//   …and three seconds later, over HTTP, /api/cache/version was still 1
//
// Two separate faults met here. Nothing in `records.mjs` invalidated the cache at all, and the
// regeneration that memory.mjs schedules runs on a 2s debounce whose timer is `unref`ed — right for
// a server that stays up, useless in a process that answers four tool calls and exits. So this door
// settles the cache after every mutating call and once more on the way out.
test('a write through this door is in the very next scout_get_context, and moves the version', async () => {
  freshRoot();
  seedGuestCollection();
  cancelCacheRegen();

  const before = textOf(await call('scout_get_context'));
  const vBefore = jsonOf(await call('scout_get_cache_version')).v;
  assert.doesNotMatch(before, /guest 1/, 'the fixture starts with no guests in COUNTS');

  const stored = jsonOf(await call('scout_post_records_upsert', { ...FINDING }));
  assert.equal(stored.verdict, 'store');

  // No sleep. The agent's next call is the assertion: an MCP session is short and single-threaded,
  // and "wait two seconds and hope" is not a contract.
  const after = textOf(await call('scout_get_context'));
  assert.match(after, /guest 1/,
    'the briefing the agent reads does not contain the record it just wrote — Law 7 says it never '
    + 're-derives what it knew, not that it is told the opposite of the store');
  assert.notEqual(jsonOf(await call('scout_get_cache_version')).v, vBefore,
    'scout_get_cache_version told the agent its stale context was still good');

  // A dry run is not a write and must not move the version — an agent that re-reads its whole
  // context after every match call has lost the point of having one.
  const vAfter = jsonOf(await call('scout_get_cache_version')).v;
  await call('scout_post_records_match', { collection: 'guest', name: 'Maria Santos' });
  assert.equal(jsonOf(await call('scout_get_cache_version')).v, vAfter);
  cancelCacheRegen();
});

test('closing the session settles the cache rather than losing it to an unref-ed timer', async () => {
  freshRoot();
  seedGuestCollection();
  cancelCacheRegen();
  regenerateCache({});
  const v = cacheVersion({}).v;

  // A write made through a module rather than a tool — the state a session can be in when the host
  // goes away mid-turn. scripts/scout-mcp.mjs awaits exactly this before it exits.
  upsertRecord({ ...FINDING, name: 'Jun Dela Cruz' }, { actor: AGENT, via: 'mcp' });
  await createServer().close();
  assert.notEqual(cacheVersion({}).v, v,
    'the pending regeneration died with the process, so the NEXT run is told nothing changed');
  cancelCacheRegen();
});
