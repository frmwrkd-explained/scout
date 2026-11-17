// Automations (backend/automations.mjs): "when this happens to a record, do that".
//
// The tests are the safety list at the top of that file, one by one, on a private copy of the CRM
// showcase — which ships two rules on the same trigger: an invoice that ASKS and a to-do that is
// simply made.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempRoots } from './_env.mjs';
import { req } from './helpers.mjs';
import { setStorageRoot } from '../backend/store.mjs';
import { documentsFor, forgetParsed } from '../backend/documents.mjs';
import { upsertRecord, patchRecord } from '../backend/records.mjs';
import { listProposals } from '../backend/proposals.mjs';
import { readEvents } from '../backend/log.mjs';
import {
  checkRule, brokenReasons, createAutomation, updateAutomation, getAutomation, listAutomations, flushAutomations, sentenceOf,
} from '../backend/automations.mjs';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const INVOICE = 'invoice-when-a-deal-is-won', KICKOFF = 'kickoff-to-do-when-a-deal-is-won';

function crm() {
  flushAutomations();                       // nothing from the previous test's workspace leaks in
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-automations-'));
  tempRoots.push(root);
  fs.cpSync(path.join(repo, 'workspace-crm'), root, { recursive: true, filter: src => !path.basename(src).startsWith('._') });
  setStorageRoot(root);
  forgetParsed();
  return root;
}
const docs = id => { forgetParsed(); return documentsFor(id).documents; };
const dealIn = stage => docs('deals').find(d => d.fields.stage === stage);
const cards = () => listProposals({ status: 'open', kind: 'automation' });
const phases = () => readEvents({ type: 'run', limit: 500 }).filter(e => String(e.detail && e.detail.phase).startsWith('automation-')).map(e => e.detail.phase.slice(11));
const set = async (p, patch, actor = 'crystal') => { await patchRecord(p, patch, { actor }); flushAutomations(); };
const WON = { on: 'field_becomes', collection: 'deals', field: 'stage', value: 'won' };

test('a rule is checked when it is saved, and what it cannot be is said in words', () => {
  crm();
  const good = checkRule({ name: 'x', when: WON, do: { run: 'plugin', plugin: 'invoice', action: 'create' } });
  assert.deepEqual(good.problems, []);
  assert.equal(good.rule.mode, 'ask', 'ask is the default');
  assert.equal(good.rule.enabled, false, 'nothing is on unless it says so');
  const said = bad => checkRule(bad).problems.join(' | ');
  assert.match(said({ when: WON, do: { run: 'plugin', plugin: 'invoice', action: 'create' } }), /no name/);
  assert.match(said({ name: 'x', mode: 'always', when: WON, do: { run: 'plugin', plugin: 'i', action: 'a' } }), /mode "always"/);
  assert.match(said({ name: 'x', when: { on: 'every_morning', collection: 'deals' }, do: { run: 'plugin', plugin: 'i', action: 'a' } }), /a record is created · a field becomes a value/);
  assert.match(said({ name: 'x', when: { on: 'field_becomes', collection: 'deals' }, do: { run: 'plugin', plugin: 'i', action: 'a' } }), /which field.*which value/);
  assert.match(said({ name: 'x', when: WON, do: { run: 'create_record', collection: 'todos', fields: {} } }), /no fields/);
  // Everything that is not "file one new record" is refused outright, in either mode.
  for (const run of ['send_assistant', 'delete_record', 'update_record', 'send_email', 'run_skill', '']) {
    assert.match(said({ name: 'x', mode: 'auto', when: WON, do: { run, target: 'x' } }), /must be one of: press a plugin button · create a record/, run);
    assert.throws(() => createAutomation({ name: 'x', mode: 'auto', when: WON, do: { run } }), e => e.status === 400);
  }
  assert.deepEqual(sentenceOf(good.rule), { when: 'When a Deal’s stage becomes won', then: 'Create invoice (Invoice plugin)', mode: 'ask me first' });
});

test('a rule that names something missing is reported as broken with the reason, and cannot be switched on', async () => {
  crm();
  const reasons = rule => brokenReasons(checkRule({ name: 'x', ...rule }).rule).join(' | ');
  const press = { run: 'plugin', plugin: 'invoice', action: 'create' };
  assert.equal(reasons({ when: WON, do: press }), '');
  assert.match(reasons({ when: { ...WON, collection: 'orders' }, do: press }), /no collection called "orders"/);
  assert.match(reasons({ when: { ...WON, field: 'phase' }, do: press }), /Deals has no field called "phase"/);
  assert.match(reasons({ when: { ...WON, value: 'closed' }, do: press }), /"stage" has no option called "closed" \(it has lead · qualified/);
  assert.match(reasons({ when: { on: 'field_becomes', collection: 'companies', field: 'pipeline_value', value: '1' }, do: press }), /worked out from other records/);
  assert.match(reasons({ when: WON, do: { ...press, plugin: 'quote' } }), /no plugin called "quote"/);
  assert.match(reasons({ when: WON, do: { ...press, action: 'send' } }), /Invoice plugin has no button called "send"/);
  assert.match(reasons({ when: { on: 'record_created', collection: 'companies' }, do: press }), /"Create invoice" is a button on Deals, not on Companies/);
  // The line `auto` may not cross: an action that files no new record.
  assert.match(reasons({ mode: 'auto', when: { on: 'record_created', collection: 'invoices' }, do: { ...press, action: 'print' } }), /only shows a document and files no record/);
  assert.match(reasons({ when: WON, do: { run: 'create_record', collection: 'tasks', fields: { name: 'x' } } }), /no collection called "tasks"/);
  assert.match(reasons({ when: WON, do: { run: 'create_record', collection: 'todos', fields: { status: 'todo' } } }), /would have no name/);
  assert.match(reasons({ when: WON, do: { run: 'create_record', collection: 'todos', fields: { name: 'Call {{contact_name}}' } } }), /\{\{contact_name\}\} is not something a Deal has/);

  // Saved, but switched off, and listed with why. Never dropped, never skipped quietly.
  const saved = createAutomation({ name: 'Print every invoice', mode: 'auto', when: { on: 'record_created', collection: 'invoices' }, do: { ...press, action: 'print' } });
  assert.equal(saved.enabled, false);
  assert.equal(saved.broken, true);
  assert.match(saved.problems[0], /files no record/);
  const on = await req('PATCH', '/api/automations/' + saved.id, { enabled: true });
  assert.equal(on.status, 409);
  assert.match(on.body.error, /cannot be switched on/);
  const listed = (await req('GET', '/api/automations')).body;
  assert.equal(listed.automations.find(a => a.id === saved.id).broken, true);
  assert.ok(listed.options.buttons.every(b => b.creates), 'the builder only offers buttons that file a record');
  assert.ok(listed.options.buttons.some(b => b.plugin === 'invoice' && b.action === 'create' && b.on === 'deals'));
});

test('a field BECOMING a value fires once: not on a re-save, not for a new record, not a second time', async () => {
  const root = crm();
  const deal = dealIn('proposal');
  const todosBefore = docs('todos').length;
  await set(deal.path, { amount: deal.fields.amount + 50 });          // a change, but not the one
  assert.equal(cards().length, 0);
  await set(deal.path, { stage: 'won' });
  // One trigger, two rules: the invoice asks, the to-do is simply made.
  assert.equal(cards().length, 1);
  const card = cards()[0];
  assert.equal(card.automation, INVOICE);
  assert.equal(card.record, deal.path);
  assert.equal(card.title, deal.title + ': stage became won. Create invoice?');
  assert.equal(card.created_by, 'automation:' + INVOICE);
  const made = docs('todos').find(t => t.title === 'Book the kickoff — ' + deal.title);
  assert.ok(made, 'the auto rule made its to-do');
  assert.equal(docs('todos').length, todosBefore + 1);
  assert.deepEqual([made.fields.status, made.fields.deal, made.fields.company, made.fields.owner], ['todo', deal.slug, deal.fields.company, deal.fields.owner]);
  // Through the one writer, in the name of the person who switched the rule on, stamped with the rule.
  assert.equal(made.fields.provenance, 'pipeline');
  assert.equal(made.fields.created_by, 'crystal');
  assert.equal(made.fields.proposed, undefined);
  assert.equal(made.fields.automation, KICKOFF);
  assert.equal(readEvents({ target: made.path, type: 'store' })[0].detail.via, 'automation:' + KICKOFF);

  // A re-save that leaves the stage as it is — and the same value written again — fire nothing.
  await set(deal.path, { amount: deal.fields.amount + 100 });
  await set(deal.path, { stage: 'won' });
  // Away and back: it becomes won again, and the receipt says it already fired for this record.
  await set(deal.path, { stage: 'negotiation' });
  await set(deal.path, { stage: 'won' });
  assert.equal(cards().length, 1);
  assert.equal(docs('todos').length, todosBefore + 1);
  assert.equal(phases().filter(p => p === 'skipped').length, 2, 'both rules said "already fired", once each');
  // The receipt is a file, so a restart remembers it.
  const receipts = JSON.parse(fs.readFileSync(path.join(root, '.scout', 'automations', KICKOFF + '.json'), 'utf8'));
  assert.deepEqual(Object.values(receipts).map(r => [r.record, r.state, r.made]), [[deal.path, 'ran', made.path]]);

  // A deal that is CREATED already won did not become won.
  upsertRecord({ collection: 'deals', name: 'Walk-in job — Paid on the day', stage: 'won', amount: 300, company: 'brightloom-coffee' }, { actor: 'crystal' });
  flushAutomations();
  assert.equal(cards().length, 1);
  assert.equal(docs('todos').length, todosBefore + 1);
});

test('asking raises a card in Needs you; yes runs the plugin and files the record; an agent cannot say yes', async () => {
  crm();
  const deal = dealIn('negotiation');
  const before = docs('invoices').length;
  await set(deal.path, { stage: 'won' });
  const card = cards()[0];
  const listed = (await req('GET', '/api/proposals')).body.proposals.find(c => c.id === card.id);
  assert.equal(listed.kind, 'automation');
  assert.equal(docs('invoices').length, before, 'asking writes nothing');

  assert.equal((await req('POST', '/api/proposals/' + card.id + '/accept', { actor: 'some-agent' })).status, 403);
  const yes = await req('POST', '/api/proposals/' + card.id + '/accept', {});
  assert.equal(yes.status, 200, JSON.stringify(yes.body));
  assert.equal(yes.body.effect, 'automation');
  const invoice = docs('invoices').find(i => i.path === yes.body.result.made.path);
  assert.ok(invoice && docs('invoices').length === before + 1);
  assert.deepEqual([invoice.fields.deal, invoice.fields.company, invoice.fields.amount, invoice.fields.status], [deal.slug, deal.fields.company, deal.fields.amount, 'draft']);
  assert.equal(invoice.fields.provenance, 'pipeline');
  assert.equal(invoice.fields.created_by, 'crystal', 'written in the name of the person who said yes');
  assert.equal(invoice.fields.automation, INVOICE);
  assert.equal(readEvents({ target: invoice.path, type: 'store' })[0].detail.via, 'automation:' + INVOICE + '+plugin:invoice/create');
  // The card is closed, the run is on the rule, and the Plugins screen sees who pressed its button.
  assert.equal((await req('POST', '/api/proposals/' + card.id + '/accept', {})).status, 409);
  const rule = getAutomation(INVOICE);
  assert.deepEqual([rule.runs[0].state, rule.runs[0].made, rule.runs[0].record, rule.runs[0].by], ['ran', invoice.path, deal.path, 'crystal']);
  const history = (await req('GET', '/api/plugins/history')).body.runs[0];
  assert.deepEqual([history.plugin, history.action, history.automation, history.target], ['invoice', 'create', INVOICE, invoice.path]);
  const button = (await req('GET', '/api/plugins')).body.plugins.find(p => p.id === 'invoice').actions.find(a => a.id === 'create');
  assert.deepEqual(button.automations.map(a => a.name), ['Invoice when a deal is won']);
  // A record an automation made fired nothing: no card for the new invoice, no to-do for the to-do.
  assert.equal(cards().length, 0);
});

test('no is one step, is recorded, and is not asked again for that record', async () => {
  crm();
  const deal = dealIn('qualified');
  const before = docs('invoices').length;
  await set(deal.path, { stage: 'won' });
  const card = cards()[0];
  const no = await req('POST', '/api/proposals/' + card.id + '/reject', {});
  assert.equal(no.status, 200, JSON.stringify(no.body));
  assert.equal(no.body.reason, 'declined');
  assert.equal(no.body.effect, 'declined');
  assert.equal(docs('invoices').length, before);
  assert.equal(getAutomation(INVOICE).runs[0].state, 'declined');
  await set(deal.path, { stage: 'lost' });
  await set(deal.path, { stage: 'won' });
  assert.equal(cards().length, 0, 'declined once is declined for that record');
  // Every step is in the one log.
  assert.deepEqual(phases().reverse(), ['asked', 'ran', 'declined', 'skipped', 'skipped']);
  assert.ok(readEvents({ type: 'decide', limit: 20 }).some(e => e.detail.kind === 'automation' && e.detail.decision === 'reject'));
  // A reason is still required for every other kind of card.
  assert.equal((await req('POST', '/api/proposals/' + card.id + '/reject', { reason: 'declined' })).status, 409);
});

test('an automation never fires an automation, and only ever makes a NEW record', async () => {
  crm();
  // A rule that would loop forever if its own records could fire it.
  const echo = createAutomation({ name: 'Echo', mode: 'auto', when: { on: 'record_created', collection: 'todos' },
    do: { run: 'create_record', collection: 'todos', fields: { name: 'Echo of a new to-do ({{status}})', status: 'doing', deal: '{{deal}}' } } });
  assert.equal(echo.enabled, true);
  const start = docs('todos').length;
  upsertRecord({ collection: 'todos', name: 'Ring the venue', status: 'todo' }, { actor: 'crystal' });
  flushAutomations();
  assert.deepEqual(docs('todos').map(t => t.title).filter(t => /venue|Echo/.test(t)).sort(), ['Echo of a new to-do (todo)', 'Ring the venue']);
  assert.equal(docs('todos').length, start + 2, 'one record, one echo — the echo is not echoed');
  // The kickoff rule's to-do is automation-made too, so Echo ignores it.
  const deal = dealIn('lead');
  await set(deal.path, { stage: 'won' });
  assert.equal(docs('todos').length, start + 3);
  assert.equal(docs('todos').filter(t => t.title.startsWith('Echo')).length, 1);

  // A seeded won deal already has "Book the kickoff — …". Won again, the rule would write the same
  // name — which the record writer would fold into the existing to-do. That is refused, in words.
  const old = dealIn('won');
  const existing = docs('todos').find(t => t.fields.deal === old.slug);
  await set(old.path, { stage: 'negotiation' });
  await set(old.path, { stage: 'won' });
  assert.equal(docs('todos').length, start + 3, 'nothing was created…');
  assert.equal(docs('todos').find(t => t.path === existing.path).fields.updated, existing.fields.updated, '…and the existing to-do was not touched');
  const failed = getAutomation(KICKOFF).runs.find(r => r.record === old.path);
  assert.equal(failed.state, 'failed');
  assert.match(failed.error, /too close to an existing record in To-dos/);
  assert.ok(phases().includes('failed'));
});

test('only a person switches a rule on, edits or archives it; an assistant\'s rule lands switched off', async () => {
  const root = crm();
  for (const [method, url, body] of [
    ['PATCH', '/api/automations/' + KICKOFF, { enabled: false, actor: 'some-agent' }],
    ['PATCH', '/api/automations/' + KICKOFF, { mode: 'ask', actor: 'some-agent' }],
    ['PATCH', '/api/automations/' + INVOICE, { mode: 'auto', actor: 'some-agent' }],
    ['POST', '/api/automations/' + KICKOFF + '/archive', { reason: 'x', actor: 'some-agent' }],
  ]) {
    const r = await req(method, url, body);
    assert.equal(r.status, 403, method + ' ' + url);
    assert.match(r.body.error, /Only a person can/);
  }
  assert.equal((await req('DELETE', '/api/automations/' + KICKOFF, {})).status, 404, 'there is no delete');
  assert.deepEqual([getAutomation(KICKOFF).enabled, getAutomation(KICKOFF).mode], [true, 'auto'], 'nothing changed');

  // An assistant may propose one. It arrives off, marked as a proposal, and does not fire.
  const proposed = await req('POST', '/api/automations', { name: 'Thank new customers', mode: 'auto', enabled: true, actor: 'some-agent',
    when: { on: 'field_becomes', collection: 'companies', field: 'stage', value: 'customer' },
    do: { run: 'create_record', collection: 'todos', fields: { name: 'Send a thank-you — {{name}}', status: 'todo', company: '{{slug}}' } } });
  assert.equal(proposed.status, 200, JSON.stringify(proposed.body));
  assert.deepEqual([proposed.body.enabled, proposed.body.proposed, proposed.body.proposed_by], [false, true, 'some-agent']);
  assert.equal(readEvents({ target: proposed.body.path, type: 'propose' }).length, 1);
  const company = docs('companies').find(c => c.fields.stage === 'prospect');
  const start = docs('todos').length;
  await set(company.path, { stage: 'customer' });
  assert.equal(docs('todos').length, start, 'a switched-off rule does nothing');
  // A person switches it on: it is theirs now, and it fires for the next one.
  const on = await req('PATCH', '/api/automations/' + proposed.body.id, { enabled: true });
  assert.deepEqual([on.body.enabled, on.body.proposed, on.body.enabled_by], [true, false, 'crystal']);
  const next = docs('companies').find(c => c.fields.stage === 'lead');
  await set(next.path, { stage: 'customer' });
  assert.ok(docs('todos').some(t => t.title === 'Send a thank-you — ' + next.title && t.fields.company === next.slug));

  // A change an ASSISTANT makes never runs an automation by itself — even an `auto` rule asks.
  const third = docs('companies').find(c => c.fields.stage === 'past');
  const count = docs('todos').length;
  await set(third.path, { stage: 'customer' }, 'some-agent');
  assert.equal(docs('todos').length, count);
  assert.ok(cards().some(c => c.automation === proposed.body.id && c.record === third.path));

  // Archiving needs a reason, switches it off, and keeps the file.
  assert.equal((await req('POST', '/api/automations/' + KICKOFF + '/archive', {})).status, 400);
  const gone = await req('POST', '/api/automations/' + KICKOFF + '/archive', { reason: 'we book kickoffs by phone now' });
  assert.deepEqual([gone.body.archived, gone.body.enabled, gone.body.archive_reason], [true, false, 'we book kickoffs by phone now']);
  assert.ok(fs.existsSync(path.join(root, 'automations', KICKOFF + '.md')));
  assert.ok(!listAutomations().some(a => a.id === KICKOFF) && listAutomations({ archived: true }).some(a => a.id === KICKOFF));
  assert.throws(() => updateAutomation(KICKOFF, { enabled: true }), e => e.status === 409);
});

test('a record that is created fires a rule; one an assistant proposed fires it when a person accepts it', async () => {
  crm();
  createAutomation({ name: 'Welcome a new company', mode: 'ask', when: { on: 'record_created', collection: 'companies' },
    do: { run: 'create_record', collection: 'todos', fields: { name: 'Introduce ourselves — {{name}}', status: 'todo', company: '{{slug}}' } } });
  upsertRecord({ collection: 'companies', name: 'Quietwater Bakery', stage: 'lead' }, { actor: 'crystal' });
  flushAutomations();
  assert.deepEqual(cards().map(c => c.title), ['Quietwater Bakery was added to Companies. Create a To-do called “Introduce ourselves — [its name]”?']);
  const found = upsertRecord({ collection: 'companies', name: 'Nettlecombe Pottery', stage: 'lead' }, { actor: 'some-agent' });
  flushAutomations();
  assert.equal(cards().length, 1, 'an assistant\'s proposed record is not a record yet');
  await set(found.path, { tier: 'standard' });                          // a person touching it is the acceptance
  assert.equal(cards().length, 2);
  const yes = await req('POST', '/api/proposals/' + cards().find(c => /Nettlecombe/.test(c.title)).id + '/accept', {});
  assert.equal(yes.status, 200, JSON.stringify(yes.body));
  assert.ok(docs('todos').some(t => t.title === 'Introduce ourselves — Nettlecombe Pottery' && t.fields.company === 'nettlecombe-pottery'));
});
