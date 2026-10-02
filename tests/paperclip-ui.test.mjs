import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freshRoot } from './helpers.mjs';
import { paperclipUi, savePaperclipConfig, paperclipStatus } from '../backend/paperclip.mjs';

const TOKEN = 'pcp_board_ui_test_only_0123456789';
const ORIGIN = 'http://127.0.0.1:5191';
function connect(t, { token = TOKEN, enabled = true } = {}) {
  const previous = process.env.PAPERCLIP_TOKEN;
  t.after(() => { if (previous === undefined) delete process.env.PAPERCLIP_TOKEN; else process.env.PAPERCLIP_TOKEN = previous; });
  process.env.PAPERCLIP_TOKEN = token;
  const root = freshRoot();
  savePaperclipConfig({ url: ORIGIN, companyId: 'company-1', agentId: 'worker-1', enabled });
  return root;
}
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

test('native board lookup resolves the configured company prefix with one read and no browser credential', async t => {
  const root = connect(t), calls = [];
  const before = fs.readFileSync(path.join(root, '.scout/paperclip.md'), 'utf8');
  const result = await paperclipUi({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return response({ id: 'company-1', issuePrefix: 'SCO', name: 'Scout ' + TOKEN, private: TOKEN });
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ORIGIN + '/api/companies/company-1');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.authorization, 'Bearer ' + TOKEN);
  assert.equal(result.boardUrl, ORIGIN + '/SCO/issues');
  assert.equal(result.company.prefix, 'SCO');
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  assert.equal(fs.readFileSync(path.join(root, '.scout/paperclip.md'), 'utf8'), before);
  assert.equal(paperclipStatus().receipts.length, 0);
});

test('local native board can open with the worker bridge off and no board API token', async t => {
  connect(t, { token: '', enabled: false });
  const result = await paperclipUi({ fetchImpl: async (_, options) => {
    assert.equal(options.headers.authorization, undefined);
    return response({ id: 'company-1', issuePrefix: 'OTHER', name: 'Another company' });
  } });
  assert.equal(result.boardUrl, ORIGIN + '/OTHER/issues');
});

test('unconfigured board lookup makes no request', async () => {
  freshRoot();
  const result = await paperclipUi({ fetchImpl: () => { assert.fail('No server is configured'); } });
  assert.equal(result.configured, false);
  assert.equal(result.boardUrl, null);
  assert.equal(result.appUrl, null);
});

test('board lookup refuses a different company or an injected board path', async t => {
  connect(t);
  for (const company of [
    { id: 'foreign-company', issuePrefix: 'SCO' },
    { id: 'company-1', issuePrefix: '//attacker.test' },
    { id: 'company-1', issuePrefix: 'SCO?token=' + TOKEN },
    { id: 'company-1', issuePrefix: TOKEN },
  ]) {
    const result = await paperclipUi({ fetchImpl: async () => response(company) });
    assert.equal(result.boardUrl, null);
    assert.match(result.error, /unexpected company or board address/);
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
  }
});

test('unavailable board keeps a safe native-app link without echoing remote errors', async t => {
  connect(t);
  for (const fetchImpl of [async () => { throw new Error(TOKEN); }, async () => new Response(TOKEN, { status: 401 })]) {
    const result = await paperclipUi({ fetchImpl });
    assert.equal(result.appUrl, ORIGIN);
    assert.equal(result.boardUrl, null);
    assert.ok(result.error);
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
  }
});

test('a late company response cannot open the previous workspace or connection', async t => {
  connect(t);
  await assert.rejects(paperclipUi({ fetchImpl: async () => {
    savePaperclipConfig({ companyId: 'company-2' });
    return response({ id: 'company-1', issuePrefix: 'SCO' });
  } }), /connection changed/);
  connect(t);
  await assert.rejects(paperclipUi({ fetchImpl: async () => {
    freshRoot();
    return response({ id: 'company-1', issuePrefix: 'SCO' });
  } }), /Workspace changed/);
});
