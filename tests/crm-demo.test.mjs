// The CRM showcase (scripts/seed-crm-demo.mjs → workspace-crm/).
//
// The seed is a fixture GENERATOR, so what is tested is what a person opening the workspace would
// notice if it were wrong: a company with no people, a relation that points nowhere, a rollup that
// shows nothing, a record the pipeline did not write — and that the checked-in copy is still what
// the script produces.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setStorageRoot } from '../backend/store.mjs';
import { documentsFor, viewFor, forgetParsed } from '../backend/documents.mjs';
import { getCollection } from '../backend/collections.mjs';
import { listViews } from '../backend/views.mjs';
import { listGoals, listPlaybook, listLearnings, readMe, renderCache, estimateTokens, CACHE_TOKEN_BUDGET } from '../backend/memory.mjs';
import { tempRoots } from './_env.mjs';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const script = path.join(repo, 'scripts', 'seed-crm-demo.mjs');
const COLLECTIONS = ['companies', 'people', 'deals', 'messages', 'invoices', 'todos'];

function seedInto(dir, extra = []) {
  return spawnSync(process.execPath, [script, '--workspace', dir, '--quiet', ...extra], { encoding: 'utf8', env: { ...process.env, SCOUT_DATA: '', SCOUT_CONFIG: '' } });
}
function freshSeed() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-crm-'));
  tempRoots.push(dir);
  const run = seedInto(dir);
  assert.equal(run.status, 0, 'the seed runs clean:\n' + run.stderr);
  return dir;
}
// Every file under a folder → sha256, skipping macOS sidecars and the disposable computed cache.
function fingerprint(dir, only = null) {
  const out = {};
  const walk = rel => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      if (name.startsWith('._') || name === '.DS_Store') continue;
      const r = rel ? rel + '/' + name : name;
      if (r === '.scout/cache') continue;
      if (fs.statSync(path.join(dir, r)).isDirectory()) walk(r);
      else if (!only || only.some(p => r.startsWith(p))) out[r] = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, r))).digest('hex');
    }
  };
  walk('');
  return out;
}

const root = freshSeed();
// Taken before anything reads it: opening a workspace appends to its log and its caches.
const pristine = fingerprint(root);
const open = () => { setStorageRoot(root); forgetParsed(); };
const docs = id => documentsFor(id).documents;

test('the seed writes a whole sales desk: companies, people, deals, messages, invoices', () => {
  open();
  const counts = Object.fromEntries(COLLECTIONS.map(id => [id, docs(id).length]));
  assert.deepEqual(counts, { companies: 30, people: 82, deals: 45, messages: 220, invoices: 25, todos: 16 });
  // Nothing invented looks real: every address is at .example, every phone a 555 number.
  for (const p of docs('people')) {
    assert.match(p.fields.email, /@[a-z0-9-]+\.example$/, p.slug);
    assert.match(p.fields.phone, /^\+1 555 01\d\d$/, p.slug);
  }
  for (const c of docs('companies')) assert.match(c.fields.website, /^https:\/\/[a-z0-9-]+\.example$/, c.slug);
});

test('every record came through the pipeline — none is quarantined, none is a proposal', async () => {
  open();
  for (const id of COLLECTIONS) {
    const view = await viewFor(id, { all: true });
    assert.equal(view.quarantined.length, 0, id + ' has quarantined records');
    assert.equal(view.total, docs(id).length, id);
    for (const d of docs(id)) {
      assert.equal(d.fields.provenance, 'pipeline', d.path);
      assert.equal(d.fields.created_by, 'crystal', d.path);
      assert.equal(d.fields.proposed, undefined, d.path);
    }
  }
});

test('every relation resolves to a record in the collection it names', () => {
  open();
  const slugs = Object.fromEntries(COLLECTIONS.map(id => [id, new Set(docs(id).map(d => d.slug))]));
  // Rollups look a slug up across the WHOLE workspace, so a slug used twice would read the wrong record.
  const all = COLLECTIONS.flatMap(id => [...slugs[id]]);
  assert.equal(new Set(all).size, all.length, 'slugs are unique across collections');
  let checked = 0;
  for (const id of COLLECTIONS) {
    const relations = getCollection(id).fields.filter(f => f.type === 'relation');
    assert.ok(relations.length, id + ' has relations');
    for (const d of docs(id)) for (const f of relations) {
      for (const value of [].concat(d.fields[f.key] ?? [])) {
        assert.ok(slugs[f.target].has(String(value)), d.path + ' · ' + f.key + ' → ' + value + ' is not a record in ' + f.target);
        checked++;
      }
    }
  }
  assert.ok(checked > 900, 'a real web of links, not a handful (' + checked + ')');
  // Nobody is orphaned: every person has a company, every deal a company and a contact at it.
  const people = Object.fromEntries(docs('people').map(p => [p.slug, p.fields]));
  for (const p of docs('people')) assert.ok(p.fields.company, p.slug);
  for (const d of docs('deals')) assert.equal(people[d.fields.person].company, d.fields.company, d.slug + ': the contact works at the deal\'s company');
  for (const m of docs('messages')) assert.equal(people[m.fields.person].company, m.fields.company, m.slug);
});

test('rollups compute: deal count, open pipeline and last contact on a company; last message on a person', () => {
  open();
  const deals = Object.fromEntries(docs('deals').map(d => [d.slug, d.fields]));
  const messages = Object.fromEntries(docs('messages').map(d => [d.slug, d.fields]));
  let withPipeline = 0;
  for (const c of docs('companies')) {
    const mine = Object.entries(deals).filter(([, d]) => d.company === c.slug);
    const openOnes = mine.filter(([, d]) => !['won', 'lost'].includes(d.stage));
    assert.equal(c.fields.deal_count, mine.length, c.slug + ' deal_count');
    assert.equal(c.fields.pipeline_value, openOnes.reduce((s, [, d]) => s + d.amount, 0), c.slug + ' pipeline_value');
    assert.deepEqual([...c.fields.deals].sort(), mine.map(([slug]) => slug).sort(), c.slug + ' lists exactly its deals');
    const dates = Object.values(messages).filter(m => m.company === c.slug).map(m => m.date).sort();
    assert.equal(c.fields.last_contact, dates.at(-1) ?? null, c.slug + ' last_contact');
    if (c.fields.pipeline_value > 0) withPipeline++;
  }
  assert.ok(withPipeline >= 15, 'most companies have something open');
  for (const p of docs('people')) {
    const dates = Object.values(messages).filter(m => m.person === p.slug).map(m => m.date).sort();
    assert.equal(p.fields.last_message, dates.at(-1) ?? null, p.slug + ' last_message');
  }
});

test('the stories hold together: wins are invoiced, line items add up, follow-ups are real', () => {
  open();
  const invoices = docs('invoices');
  for (const d of docs('deals')) {
    const lines = d.fields.line_items.reduce((s, l) => s + l.quantity * l.unit_price, 0);
    assert.equal(lines, d.fields.amount, d.slug + ': the line items add up to the deal');
    const mine = invoices.filter(i => i.fields.deal === d.slug);
    if (d.fields.stage === 'won') {
      assert.ok(mine.length >= 1, d.slug + ' is won and has a deposit invoice');
      assert.ok(mine.reduce((s, i) => s + i.fields.amount, 0) <= d.fields.amount, d.slug + ': never billed for more than the deal');
    } else assert.equal(mine.length, 0, d.slug + ' is not won and has no invoice');
  }
  for (const i of invoices) {
    assert.match(i.title, /^INV-\d{4}-\d{3}$/);
    assert.equal(i.fields.line_items.reduce((s, l) => s + l.quantity * l.unit_price, 0), i.fields.amount, i.slug);
    assert.ok(i.fields.due_date > i.fields.date, i.slug);
  }
  // "Needs follow-up" is derived from the thread, not sprinkled: the last word was theirs, 14+ days ago.
  const messages = docs('messages');
  const waiting = docs('people').filter(p => p.fields.follow_up === true);
  assert.ok(waiting.length >= 5 && waiting.length <= 30, 'a believable number of people waiting (' + waiting.length + ')');
  for (const p of waiting) {
    const last = messages.filter(m => m.fields.person === p.slug).sort((a, b) => a.fields.date.localeCompare(b.fields.date) || a.slug.localeCompare(b.slug)).at(-1);
    assert.equal(last.fields.direction, 'inbound', p.slug);
    assert.ok(last.fields.date < '2026-11-03', p.slug);
  }
});

test('each collection opens to a view a salesperson would keep, and every saved view returns rows', async () => {
  open();
  const expected = { companies: 'cards', people: 'by-company', deals: 'pipeline', messages: 'timeline', invoices: 'all', todos: 'open' };
  for (const id of COLLECTIONS) {
    const schema = getCollection(id);
    assert.equal(schema.default_view, expected[id]);
    assert.ok(schema.colour && Array.isArray(schema.header) && schema.header.length && schema.page, id + ' has a colour, a header and a page layout');
    for (const v of listViews(id).views) {
      const got = await viewFor(id, { view: v.id });
      assert.ok(got.rows.length > 0, id + ' / ' + v.label + ' is empty');
    }
  }
  const pipeline = await viewFor('deals', { view: 'pipeline' });
  assert.equal(pipeline.view.type, 'board');
  assert.deepEqual(pipeline.groups.map(g => g.key).sort(), ['lead', 'lost', 'negotiation', 'proposal', 'qualified', 'won'], 'every stage of the pipeline has deals in it');
  assert.equal(getCollection('companies').subtables.map(s => s.collection).join(), 'people,deals,messages,invoices');
});

test('the memory layer is there and the wake-up context still fits its budget', () => {
  open();
  assert.equal(readMe().data.business, 'Lantern Studio');
  const goals = listGoals();
  assert.equal(goals.length, 2);
  const won = docs('deals').filter(d => d.fields.stage === 'won' && d.fields.quarter === '2026-Q4').length;
  assert.equal(goals.find(g => g.id === 'win-twelve-deals-this-quarter').current, won, 'goal progress is counted from the deals, never typed');
  assert.equal(listPlaybook().length, 3);
  assert.equal(listLearnings().length, 2);
  assert.ok(fs.existsSync(path.join(root, 'skills', 'follow-up', 'SKILL.md')));
  assert.ok(estimateTokens(renderCache()) <= CACHE_TOKEN_BUDGET);
});

test('the seed is deterministic, and refuses a folder that already has something in it', () => {
  const again = freshSeed();
  assert.deepEqual(fingerprint(again), pristine, 'two runs write byte-identical workspaces');
  const before = fingerprint(again);
  const refused = seedInto(again);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Refusing to seed/);
  assert.deepEqual(fingerprint(again), before, 'a refused run writes nothing');
});

test('the checked-in workspace-crm/ is what the script produces', () => {
  const fixture = path.join(repo, 'workspace-crm');
  assert.ok(fs.existsSync(fixture), 'workspace-crm/ is checked in');
  const parts = ['data/', '.scout/collections/', '.scout/views/', 'goals/', 'playbook/', 'learnings/', 'skills/', 'automations/', 'me.md'];
  assert.deepEqual(fingerprint(fixture, parts), fingerprint(root, parts),
    'workspace-crm/ has drifted from the seed. Regenerate it:\n  rm -rf workspace-crm && mkdir workspace-crm && node scripts/seed-crm-demo.mjs --workspace workspace-crm');
});
