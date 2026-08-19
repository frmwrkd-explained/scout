// Ticket 16 — grid split without leaving the chat.
//
// The split UI (preview overlay, keep/skip, shot selectors, confirm) is React/JSX driven by app state
// and build-verified; the underlying route-driven flow (child generations + shot candidates) is fully
// covered by phase6-gridsplit and is not re-exercised here. What this file locks down is the wire +
// registry contract the card depends on:
//   1. a `proposal.split` fence round-trips through the directive protocol carrying the grid ref,
//      rows/cols, and the per-cell shot mapping the card pre-fills from;
//   2. the grid-splitter chat-tool entry owns the split directive types and points at the REAL split
//      route, so the enable-notice gate wraps the card and the agent's Index line is accurate;
//   3. with the tool disabled (the default) the agent is never told splitting exists.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot } from './helpers.mjs';
import { saveSettings } from '../backend/store.mjs';
import { parseDirectives } from '../backend/agentRunner.mjs';
import { prepareAgentHome, seedChatTools } from '../backend/agentHome.mjs';
import { CHAT_TOOL_BY_DIRECTIVE, chatToolById } from '../shared/chatTools.mjs';

seedChatTools();

// ── unit: a split proposal fence parses to a typed directive carrying the card's pre-fill inputs ──
test('parseDirectives parses a `proposal.split` fence into a directive with ref, rows/cols and shot mapping', () => {
  const fence = '```frameforge\n' +
    JSON.stringify({ type: 'proposal.split', ref: 'sheet-1', project: 'p', rows: 3, cols: 3, shots: { '0-0': 'SH010', '1-2': 'SH020' } }) +
    '\n```';
  const { directives } = parseDirectives('here is the split\n' + fence);
  assert.equal(directives.length, 1);
  const d = directives[0];
  assert.equal(d.type, 'proposal.split');
  assert.equal(d.ref, 'sheet-1');
  assert.equal(d.rows, 3);
  assert.equal(d.cols, 3);
  assert.deepEqual(d.shots, { '0-0': 'SH010', '1-2': 'SH020' });
});

// ── the split directive types are owned by the grid-splitter tool (so the enable gate wraps the card) ──
test('proposal.split (and the grid aliases) route to the grid-splitter tool', () => {
  for (const t of ['proposal.split', 'split', 'grid', 'show.grid', 'grid-split', 'grid-splitter']) {
    const tool = CHAT_TOOL_BY_DIRECTIVE.get(t);
    assert.ok(tool, 'no tool owns directive type ' + t);
    assert.equal(tool.id, 'grid-splitter', t + ' must route to grid-splitter');
  }
});

// ── the entry points at the real split route (not the pre-06 placeholder path) ──
test('the grid-splitter invocation pointer is the real split route', () => {
  const tool = chatToolById('grid-splitter');
  assert.equal(tool.invocation, 'POST /api/generations/:pid/:id/split-grid');
});

// ── registry → Index: enabling surfaces an accurate line; disabled it is invisible (nothing told) ──
test('enabling grid-splitter adds its Index line with the split route + directives; off it is absent', () => {
  freshRoot();
  const session = { id: 'gs-index', project: 'p', mode: 'agent' };

  // default OFF → the agent is never told splitting exists
  let home = prepareAgentHome({ session });
  assert.doesNotMatch(home.indexText, /grid-splitter/, 'a disabled tool must not appear in the Index');

  saveSettings({ enabledChatTools: { 'grid-splitter': true } });
  home = prepareAgentHome({ session });
  assert.match(home.indexText, /grid-splitter — Split a finished grid generation.*\[POST \/api\/generations\/:pid\/:id\/split-grid\]/);
  assert.match(home.indexText, /directives: .*proposal\.split/);

  saveSettings({ enabledChatTools: { 'grid-splitter': false } });
  home = prepareAgentHome({ session });
  assert.doesNotMatch(home.indexText, /grid-splitter/, 'disabling removes the Index line again');
});
