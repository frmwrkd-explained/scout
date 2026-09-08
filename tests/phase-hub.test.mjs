// The hub link — three small additions, one test file. docs/HUB.md §10.
//
// The hub (OpsGraph) is where several operators' units, flows and SOPs live. Scout is one
// operator's local instrument. The link is thin on purpose and this file gates all three halves:
//
//   (a) the frontmatter ids ride through Scout untouched and change nothing it indexes,
//   (b) `hub-push` builds a body of numbers Scout ALREADY COUNTED and posts it — and does nothing
//       at all when no hub is configured,
//   (c) `renderCache` prefixes the hub bundle, stays under the 2,000-token cap, and trims the HUB
//       first — Scout's memory of its own work is never the first thing to go to make room for
//       somebody else's summary — naming every drop in the log the way the cache already does.
//
// Nothing here may relax a hard rule: the gate, the archive reason, the never-delete rule and the
// cap are all still exactly where they were.

import './_env.mjs'; // first — sets the storage root before store.mjs captures it
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { freshRoot, getStorageRoot, req } from './helpers.mjs';
import { saveCollection } from '../backend/collections.mjs';
import { saveTerritory, isRecord } from '../backend/territory.mjs';
import { saveSettings, getSettings, publicSettings, REDACTED } from '../backend/store.mjs';
import { allDocuments } from '../backend/documents.mjs';
import { saveAssistant, getAssistant } from '../backend/tasks.mjs';
import {
  readMe, writeMe, listGoals, saveGoal, listLearnings, saveLearning,
  savePlaybook, renderCache, setScoutMemoryHooks, cancelCacheRegen, CACHE_TOKEN_BUDGET, CACHE_CHAR_BUDGET,
} from '../backend/memory.mjs';
import {
  hubConfig, buildPushPayload, pushToHub, readHubBundle, composeHub, splitHubSections,
  fetchHubBundle, hubCachePath,
} from '../backend/hub.mjs';

const R = () => getStorageRoot();
const DAY = 864e5;
const day = n => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const write = (rel, body) => {
  const abs = path.join(R(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
};

const GUEST = {
  id: 'guest',
  query: { path: 'data/guests/**', tag: 'guest' },
  fields: [
    { key: 'name', type: 'text', primary: true },
    { key: 'status', type: 'status', gate: true, options: [
      { value: 'needs-review', group: 'todo' },
      { value: 'shortlist', group: 'active' },
      { value: 'won', group: 'done' },
    ] },
    { key: 'found_in', type: 'text' },
  ],
};

// The OTR workspace the hub docs describe, in miniature: one operator with hub ids, two goals of
// which ONE is linked, two pieces of ground with real records under them, one accepted learning
// inside its window and one that has gone past it.
function seedOtr() {
  freshRoot();
  cancelCacheRegen();
  setScoutMemoryHooks({ readEvents: () => [] });
  saveCollection(GUEST);

  write('me.md', '---\n'
    + 'person: person/crystal\nentity: entity/vonas-media\nunit: unit/otr\n'
    + 'roles:\n  - role/otr/producer\n'
    + 'type: identity\nname: Crystal\ncreated_by: crystal\nverified_at: ' + day(0) + '\n---\n\n'
    + 'Crystal — finds guests for Off The Record.\n');

  saveAssistant('scout-fb', { name: 'Scout FB', job: 'reads the groups', step: 'flow/otr/episode-production#book-guest' }, { actor: 'crystal' });

  saveTerritory('nurses-ph', { label: 'Nurses PH', kind: 'facebook-group', access: 'joined', last_swept: day(2), verified_at: day(2) }, { actor: 'crystal' });
  saveTerritory('solo-parents', { label: 'Solo Parents', kind: 'facebook-group', access: 'joined', last_swept: day(4), verified_at: day(4) }, { actor: 'crystal' });

  // 4 finds in nurses-ph, 1 of them won → 0.25. 2 finds in solo-parents, 0 won → 0.
  for (const [i, terr, status] of [
    [0, 'nurses-ph', 'won'], [1, 'nurses-ph', 'shortlist'], [2, 'nurses-ph', 'needs-review'], [3, 'nurses-ph', 'needs-review'],
    [4, 'solo-parents', 'shortlist'], [5, 'solo-parents', 'needs-review'],
  ]) {
    write('data/guests/g' + i + '.md',
      '---\ntag: guest\nname: G' + i + '\nstatus: ' + status + '\nfound_in: ' + terr + '\n---\n\nbody\n');
  }

  savePlaybook('warm-intro-openers', {
    claim: 'asking for a referral beats asking for the story',
    evidence: ['[[data/guests/g0]]'], wins: 9, verified_at: day(3),
  }, { actor: 'crystal' });

  saveGoal('book-8-guests', {
    hub_goal: 'goal/otr/book-8-guests', label: 'Book 8 guests by 30 September',
    target: 8, unit: 'guests', deadline: day(-22), created: day(38),
    count: { tag: 'guest', where: { status: 'won' } }, verified_at: day(1),
  }, { actor: 'crystal' });
  // No hub_goal: it must not appear in the payload at all.
  saveGoal('join-2-groups', { label: 'Join 2 groups', target: 2, current: 1, unit: 'groups', deadline: day(-30), created: day(10) }, { actor: 'crystal' });

  // The real flow: the assistant PROPOSES the claim (the gate forces `proposed` however it was
  // addressed), and Crystal accepts it on a DECIDE card. `created_by` is therefore the assistant,
  // which is where the learning's hub `step` comes from.
  saveLearning('never-name-the-show-first', {
    claim: 'Never name the show in the first message.', evidence: ['[[data/guests/g0]]'],
  }, { actor: 'scout-fb' });
  saveLearning('never-name-the-show-first', { status: 'active', verified_at: day(3) }, { actor: 'crystal' });
  // 90-day learning window (decay.mjs TYPE_WINDOW) — 200 days is well past it.
  saveLearning('stale-belief', {
    claim: 'An old belief nobody has re-verified.',
    evidence: ['[[data/guests/g1]]'], status: 'active', verified_at: day(200), created: day(240),
  }, { actor: 'crystal' });
  // An agent may only PROPOSE: this one must never reach the hub either.
  saveLearning('agent-proposed', {
    claim: 'Something the agent thinks.', evidence: ['[[data/guests/g2]]'], status: 'active',
  }, { actor: 'scout-fb' });

  cancelCacheRegen();
  return R();
}

// ═══ (a) the frontmatter ids ═══════════════════════════════════════════════════════════════════
//
// The whole design of these fields is that Scout does not care about them. That is a claim about
// two things — that they survive a read/write round trip, and that nothing that indexes the
// workspace grows a row because of them — and both are testable.

test('hub ids round-trip through me.md, goals and assistants and change nothing Scout computes', () => {
  seedOtr();

  const me = readMe();
  assert.equal(me.data.person, 'person/crystal');
  assert.equal(me.data.entity, 'entity/vonas-media');
  assert.equal(me.data.unit, 'unit/otr');
  assert.deepEqual(me.data.roles, ['role/otr/producer']);

  // A write through the human's own door must not lose them: writeMe merges over what is there.
  const after = writeMe('Crystal — finds guests for Off The Record. Edited.', {}, { actor: 'crystal' });
  assert.equal(after.data.person, 'person/crystal', 'a write of the body dropped the hub ids');
  assert.deepEqual(after.data.roles, ['role/otr/producer']);
  assert.match(fs.readFileSync(path.join(R(), 'me.md'), 'utf8'), /^person: person\/crystal$/m,
    'the id must still be plain text in the file — this workspace is markdown a person can read');

  const goal = listGoals({}).find(g => g.id === 'book-8-guests');
  assert.equal(goal.data.hub_goal, 'goal/otr/book-8-guests');
  // The rollup is untouched by the new key: 1 guest is `won`.
  assert.equal(goal.current, 1);
  assert.equal(goal.computed, true, 'hub_goal must not shadow the count query');

  // saveGoal round-trips it like any other frontmatter, without being taught about it.
  const bumped = saveGoal('book-8-guests', { unit: 'guests' }, { actor: 'crystal' });
  assert.equal(bumped.data.hub_goal, 'goal/otr/book-8-guests');

  assert.equal(getAssistant('scout-fb').step, 'flow/otr/episode-production#book-guest');
  const kept = saveAssistant('scout-fb', { status: 'idle' }, { actor: 'crystal' });
  assert.equal(kept.step, 'flow/otr/episode-production#book-guest', 'a run must not erase the step');
});

test('hub ids are invisible to the index — no new record, no new search row', async () => {
  seedOtr();

  // `me.md`, `goals/` and `assistants/` are not under `data/`, so they were never records and the
  // new keys must not make them into any. The count is the six seeded guests, exactly.
  const docs = allDocuments();
  const guests = docs.filter(d => d.path.startsWith('data/guests/'));
  assert.equal(guests.length, 6);
  // `me.md` and `goals/` are memory, not records — the new keys must not promote either into the
  // record set the gate, the rollups and the collections all read.
  assert.ok(!docs.filter(isRecord).some(d => d.path === 'me.md'), 'me.md is identity, never a record');
  assert.ok(!docs.filter(isRecord).some(d => d.path.startsWith('goals/')), 'a goal is not a record');
  assert.equal(docs.filter(isRecord).length, 6, 'the hub ids added a record');

  // Nothing indexes the id strings as content: searching for the hub id finds nothing, so an agent
  // cannot stumble into hub bookkeeping while looking for a guest.
  for (const q of ['entity/vonas-media', 'role/otr/producer', 'flow/otr/episode-production']) {
    const { body } = await req('GET', '/api/search?q=' + encodeURIComponent(q));
    const rows = (body && body.results) || (body && body.rows) || [];
    assert.equal(rows.length, 0, 'the hub id "' + q + '" leaked into search as ' + JSON.stringify(rows));
  }

  // And the wake-up context never mentions them either — they are for the hub, not for the agent.
  const out = renderCache({});
  assert.ok(!out.text.includes('person/crystal'), 'the cache must not spend tokens on hub ids');
  assert.ok(!out.text.includes('goal/otr/book-8-guests'));
});

// ═══ (b) the numbers push ══════════════════════════════════════════════════════════════════════

// A real local HTTP server, because "we post the right body" is a claim about the wire, and a
// stubbed fetch would let a wrong header or a wrong path pass forever.
function fakeHub({ goalsUpdated = 0, proposalsCreated = [], status = 200 } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url === '/mcp/bundle') {
        res.writeHead(200, { 'content-type': 'text/markdown' });
        return res.end('# Off The Record\n\n## Units\n- OTR — 8 episodes a quarter\n');
      }
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ goalsUpdated, proposalsCreated }));
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      server.unref();
      resolve({ server, seen, url: 'http://127.0.0.1:' + server.address().port,
        close: () => new Promise(r => server.close(r)) });
    });
  });
}

test('hub-push builds the payload out of what Scout already counted', () => {
  seedOtr();
  const payload = buildPushPayload({});

  // THE BODY, in full. Every number in it is a rollup Scout computed: the goal `current` is the
  // count query's answer, the territory figures are territory.mjs's sole authorship, and the
  // learning is one a HUMAN accepted. Not one of them was typed by an agent.
  assert.deepEqual(payload, {
    operator: 'person/crystal',
    goals: [
      { hubGoal: 'goal/otr/book-8-guests', current: 1, target: 8, verifiedAt: day(1) },
    ],
    territory: [
      { slug: 'nurses-ph', finds: 4, wins: 1, hitRate: 0.25 },
      { slug: 'solo-parents', finds: 2, wins: 0, hitRate: 0 },
    ],
    learnings: [
      { slug: 'never-name-the-show-first', text: 'Never name the show in the first message.',
        verifiedAt: day(3), step: 'flow/otr/episode-production#book-guest' },
    ],
  });

  // The three exclusions, each stated so a later change has to argue with a named line:
  const ids = payload.learnings.map(l => l.slug);
  assert.ok(!ids.includes('stale-belief'), 'a learning past its window is not "verified inside" it');
  assert.ok(!ids.includes('agent-proposed'), 'an agent may only propose — a proposal is not a fact the hub may act on');
  assert.ok(!payload.goals.some(g => g.hubGoal.includes('join-2-groups')), 'a goal with no hub_goal is not the hub\'s business');

  // The step came from the ASSISTANT that wrote the learning, not from the learning's own file.
  assert.equal(readMe().data.person, payload.operator);
});

test('the verifiedAt fields are calendar days, never a stringified Date', () => {
  seedOtr();
  // A bare YAML date parses to a JS Date (HANDOVER §3) and `String()` of one is
  // "Thu Jul 30 2026 02:00:00 GMT+0200". That has reached a file an agent reads once already.
  write('goals/bare-date.md', '---\ntype: goal\nid: bare-date\nhub_goal: goal/otr/bare\n'
    + 'label: Bare\ntarget: 3\ncurrent: 1\ndeadline: 2026-12-31\ncreated: 2026-01-01\n'
    + 'verified_at: 2026-08-17\n---\n\nbody\n');
  const g = buildPushPayload({}).goals.find(x => x.hubGoal === 'goal/otr/bare');
  assert.equal(g.verifiedAt, '2026-08-17');
  for (const row of [...buildPushPayload({}).goals, ...buildPushPayload({}).learnings]) {
    assert.match(row.verifiedAt, /^\d{4}-\d{2}-\d{2}$/, 'not a calendar day: ' + row.verifiedAt);
  }
});

test('hub-push posts the payload to the hub with the operator token, and reports what came back', async () => {
  seedOtr();
  const hub = await fakeHub({ goalsUpdated: 1, proposalsCreated: ['sop/otr/first-message'] });
  try {
    saveSettings({ hubUrl: hub.url, hubToken: 'tok-abc' });
    const cfg = hubConfig();
    assert.equal(cfg.canPush, true);

    const res = await pushToHub({ config: cfg });
    assert.equal(res.pushed, true);
    assert.equal(res.goalsUpdated, 1);
    assert.deepEqual(res.proposalsCreated, ['sop/otr/first-message']);

    assert.equal(hub.seen.length, 1, 'exactly one request');
    const req = hub.seen[0];
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/scout/push');
    assert.equal(req.headers.authorization, 'Bearer tok-abc');
    assert.match(req.headers['content-type'], /application\/json/);
    assert.deepEqual(JSON.parse(req.body), buildPushPayload({}));
  } finally { await hub.close(); }
});

test('with no hub configured, hub-push sends NOTHING and says so — it is not an error', async () => {
  seedOtr();
  assert.equal(hubConfig({}).canPush, false, 'a fresh workspace is not linked to anything');

  let called = 0;
  const res = await pushToHub({ config: hubConfig({}), fetchImpl: () => { called++; throw new Error('should not fetch'); } });
  assert.equal(called, 0, 'it must not reach the network at all');
  assert.equal(res.pushed, false);
  assert.match(res.reason, /no hub configured/);

  // Half-configured is still not configured: a URL with no token would post the numbers to a
  // stranger, and a token with no URL has nowhere to go.
  saveSettings({ hubUrl: 'http://127.0.0.1:9', hubToken: '' });
  assert.equal(hubConfig({}).canPush, false);

  // And an operator with no `person:` is refused before any request, because the hub would have
  // nothing to match the numbers to.
  saveSettings({ hubUrl: 'http://127.0.0.1:9', hubToken: 'tok' });
  write('me.md', '---\ntype: identity\nname: Crystal\n---\n\nno hub ids\n');
  const none = await pushToHub({ fetchImpl: () => { called++; throw new Error('should not fetch'); } });
  assert.equal(called, 0);
  assert.equal(none.pushed, false);
  assert.match(none.reason, /person/);
});

test('the hub token is a secret, like every other key in settings.md', () => {
  seedOtr();
  saveSettings({ hubUrl: 'http://127.0.0.1:9', hubToken: 'tok-secret' });
  assert.equal(publicSettings().hubToken, REDACTED, 'the token reached the client in cleartext');
  // A round-tripped settings object must not clobber the real token with the sentinel.
  saveSettings(publicSettings());
  assert.equal(getSettings().hubToken, 'tok-secret');
});

// ═══ (c) the bundle in ═════════════════════════════════════════════════════════════════════════

// A bundle in the hub's own shape (handover §8.1): who the subject is, units, flows, SOP index,
// open items, recent changes — in that order, which is also the order the last three come off.
function bundle({ pad = 0 } = {}) {
  const filler = n => Array.from({ length: n }, (_, i) => '- ' + 'x'.repeat(60) + ' line ' + i).join('\n');
  return [
    '# Off The Record — Crystal',
    'person/crystal · entity/vonas-media · role/otr/producer',
    '',
    '## Units',
    '- unit/otr — Off The Record · 8 episodes a quarter · owner person/theo',
    pad ? filler(pad) : '',
    '',
    '## Flows',
    '- flow/otr/episode-production: research → book-guest → shoot → edit → publish',
    '',
    '## SOP index',
    '- sop/otr/episode-production/book-guest · Booking a guest · owner role/otr/producer · verified 2026-08-19 · v4',
    pad ? filler(pad) : '',
    '',
    '## Open items',
    '- issue/otr/12 — the intake form drops the phone number',
    pad ? filler(pad) : '',
    '',
    '## Recent changes',
    '- 2026-09-04 sop/otr/episode-production/book-guest v4',
    pad ? filler(pad) : '',
  ].filter(l => l !== '').join('\n') + '\n';
}

// The mirror on Theo's machine: a folder Scout READS and never writes into.
function mirror(text = bundle()) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'opsgraph-mirror-'));
  const file = path.join(folder, '.opsgraph', 'bundle-crystal.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return { folder, file };
}

test('renderCache prefixes the hub bundle under a # Hub heading, from the read-only mirror', () => {
  seedOtr();
  const m = mirror();
  saveSettings({ hubFolder: m.folder });

  const out = renderCache({});
  assert.ok(out.hub, 'no bundle was read');
  assert.equal(out.hub.source, 'mirror');
  assert.match(out.text, /^<scout-context v="\d+"/, 'the envelope still opens the file');
  assert.match(out.text, /^# Hub$/m);
  assert.ok(out.text.indexOf('# Hub') < out.text.indexOf('## WHO I WORK FOR'), 'the hub is a PREFIX');
  assert.ok(out.text.includes('unit/otr — Off The Record'), 'the unit goal is what this is for');

  // The bundle's own headings are demoted: `## ` is Scout's grammar for the eleven sections
  // docs/08 §5 fixes, and a hub heading at that level reads as a Scout section to every consumer.
  const scoutHeads = (out.text.match(/^## .*$/gm) || []).map(h => h.slice(3).trim());
  for (const h of scoutHeads) {
    assert.ok(!/Units|Flows|SOP index|Open items|Recent changes/.test(h), 'hub heading at Scout level: ' + h);
  }
  assert.match(out.text, /^### Units$/m);

  // And the cap holds, as it does for every render.
  assert.ok(out.tokens <= CACHE_TOKEN_BUDGET, out.tokens + ' > ' + CACHE_TOKEN_BUDGET);

  // Scout never writes into the mirror.
  const before = fs.readdirSync(path.join(m.folder, '.opsgraph')).sort();
  renderCache({});
  assert.deepEqual(fs.readdirSync(path.join(m.folder, '.opsgraph')).sort(), before);
  assert.equal(fs.readFileSync(m.file, 'utf8'), bundle());
});

test('over the cap, the HUB is trimmed first — bottom up, and every drop is named in the log', () => {
  seedOtr();
  const events = [];
  setScoutMemoryHooks({ readEvents: () => [], logEvent: e => events.push(e) });
  const m = mirror(bundle({ pad: 40 }));   // a bundle far too big to fit beside Scout's own context
  saveSettings({ hubFolder: m.folder });

  const out = renderCache({});

  // 1. The cap is the feature. It is a test failure, not a warning.
  assert.ok(out.text.length <= CACHE_CHAR_BUDGET, out.text.length + ' chars > ' + CACHE_CHAR_BUDGET);
  assert.ok(out.tokens <= CACHE_TOKEN_BUDGET, out.tokens + ' > ' + CACHE_TOKEN_BUDGET);

  // 2. The hub went first, bottom up: recent changes, then open items, then the SOP index.
  const order = ['hub bundle: recent changes', 'hub bundle: open items', 'hub bundle: SOP index'];
  const hubDrops = out.dropped.filter(d => d.startsWith('hub bundle: '));
  assert.deepEqual(hubDrops, order.slice(0, hubDrops.length), 'the hub was trimmed out of order');
  assert.ok(hubDrops.length >= 1, 'nothing was trimmed from an oversized bundle');
  assert.ok(!out.text.includes('Recent changes'), 'the bottom section survived the trim');

  // 3. And Scout's own context was NOT compressed to make room for it: everything the un-hubbed
  //    render carried is still there. This is the whole point of the order.
  for (const heading of ['## WHO I WORK FOR', '## GOALS', '## BEST GROUND', '## WHAT WORKS', '## LEARNED', '## COUNTS']) {
    assert.ok(out.text.includes(heading), 'the hub bundle cost Scout its own ' + heading);
  }
  assert.ok(!out.dropped.some(d => !d.startsWith('hub bundle: ')),
    'Scout compressed its own memory before the hub had finished giving ground: ' + JSON.stringify(out.dropped));

  // 4. It is named in the file the person reads…
  assert.match(out.text, new RegExp('## COMPRESSED\\nDropped to stay under the ' + CACHE_TOKEN_BUDGET + '-token budget: '));
  assert.ok(out.text.includes('hub bundle: recent changes'));

  // 5. …and recorded in the log exactly the way every other compression is.
  const logged = events.filter(e => e.type === 'cache');
  assert.equal(logged.length, 1, 'one cache event per render, like before');
  assert.equal(logged[0].target, '.scout/cache/context.md');
  assert.deepEqual(logged[0].detail.dropped, out.dropped);
  assert.equal(logged[0].detail.tokens, out.tokens);
});

test('an absent, empty or unconfigured bundle costs the cache nothing', () => {
  seedOtr();
  const plain = renderCache({});
  assert.equal(plain.hub, null);
  assert.ok(!plain.text.includes('# Hub'));

  // A folder that exists with no file for this person: still nothing, and nothing thrown.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'opsgraph-empty-'));
  saveSettings({ hubFolder: empty });
  const out = renderCache({});
  assert.equal(out.hub, null);
  assert.equal(out.text, plain.text.replace(/generated="[^"]+"/, m => m), 'a missing bundle changed the render');
  assert.equal(readHubBundle({ person: 'person/crystal' }), null);
});

test('a fetched bundle is cached under .scout/ — never into the mirror folder', async () => {
  seedOtr();
  const hub = await fakeHub();
  try {
    saveSettings({ hubUrl: hub.url, hubToken: 'tok-abc', hubFolder: '' });
    const r = await fetchHubBundle({});
    assert.equal(r.fetched, true);
    assert.equal(r.path, hubCachePath());
    assert.ok(hubCachePath().includes(path.join('.scout', 'hub')), 'the cache is disposable, by Law 1');
    assert.equal(hub.seen[0].url, '/mcp/bundle');
    assert.equal(hub.seen[0].headers.authorization, 'Bearer tok-abc');

    const read = readHubBundle({ person: 'person/crystal' });
    assert.equal(read.source, 'fetched');
    const out = renderCache({});
    assert.match(out.text, /^# Hub$/m);
    assert.equal(out.hub.source, 'fetched');
    assert.ok(out.tokens <= CACHE_TOKEN_BUDGET);
  } finally { await hub.close(); }
});

test('splitHubSections and composeHub name what they drop, and never drop what they cannot classify', () => {
  const secs = splitHubSections(bundle());
  assert.deepEqual(secs.filter(s => s.name).map(s => s.name), ['SOP index', 'open items', 'recent changes']);
  // "Units" and "Flows" are not on the drop list, so they are never dropped by this trimmer.
  assert.deepEqual(secs.filter(s => s.heading && !s.name).map(s => s.heading),
    ['Off The Record — Crystal', 'Units', 'Flows']);

  const all = composeHub(bundle(), 3);
  assert.deepEqual(all.dropped, ['hub bundle: recent changes', 'hub bundle: open items', 'hub bundle: SOP index']);
  assert.ok(all.lines.join('\n').includes('### Units'));
  assert.ok(!all.lines.join('\n').includes('Recent changes'));
  assert.deepEqual(composeHub(bundle(), 0).dropped, []);
  assert.deepEqual(composeHub('', 0), { lines: [], dropped: [] });
});
