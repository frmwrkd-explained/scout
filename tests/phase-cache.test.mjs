// M3 · T10 — THE HOT CACHE. docs/03_MEMORY.md §2, docs/01_CANON.md Law 7.
//
// The agent's entire wake-up read is one file, and it has a HARD TOKEN BUDGET. The acceptance test
// is T10's Demonstrate: 5,000 records, 40 territories and 30 playbook claims render UNDER 2,000
// tokens and the render NAMES WHAT IT DROPPED. A silent truncation is a defect, not a warning.

import './_env.mjs'; // first — sets the storage root before store.mjs captures it
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { freshRoot, getStorageRoot } from './helpers.mjs';
import { saveCollection } from '../backend/collections.mjs';
import { saveTerritory } from '../backend/territory.mjs';
import {
  CACHE_TOKEN_BUDGET, CACHE_CHAR_BUDGET, estimateTokens,
  readMe, writeMe, listGoals, saveGoal, getGoal,
  listPlaybook, getPlaybook, savePlaybook, listLearnings, saveLearning, graduationCandidates,
  renderCache, readCache, cacheVersion, regenerateCache, scheduleCacheRegen, cancelCacheRegen,
  registerScoutMemoryRoutes, setScoutMemoryHooks, isAgentActor,
} from '../backend/memory.mjs';

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
  query: { path: 'data/guests/**' },
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

// A small, believable workspace: one identity, two goals, three territories, two claims, two
// learnings. Every later test starts from this and changes one thing.
function seed({ activeProject = null } = {}) {
  freshRoot();
  cancelCacheRegen();
  setScoutMemoryHooks({ readEvents: () => [] });
  saveCollection(GUEST);
  write('me.md', '---\nname: Crystal\ncreated_by: crystal\ntype: identity\n' +
    (activeProject ? 'active_project: ' + activeProject + '\n' : '') + 'verified_at: ' + day(0) + '\n---\n\n' +
    "Crystal — finds guests for the Off The Record podcast.\nA win = they reply and agree to a call.\n\n" +
    '## Notes\n\nShe works from her phone between recordings.\n');

  saveTerritory('nurses-ph', { label: 'Nurses PH', kind: 'facebook-group', access: 'joined', last_swept: day(2), verified_at: day(2) }, { actor: 'crystal' });
  saveTerritory('solo-parents', { label: 'Solo Parents', kind: 'facebook-group', access: 'joined', last_swept: day(4), verified_at: day(4) }, { actor: 'crystal' });
  saveTerritory('ofw-stories', { label: 'OFW', kind: 'facebook-group', access: 'joined', last_swept: day(12), verified_at: day(12) }, { actor: 'crystal' });
  for (let i = 0; i < 12; i++) {
    write('data/guests/g' + i + '.md',
      '---\nname: G' + i + '\nstatus: ' + (i < 2 ? 'won' : i < 5 ? 'shortlist' : 'needs-review') +
      '\nfound_in: ' + (i % 3 === 0 ? 'nurses-ph' : i % 3 === 1 ? 'solo-parents' : 'ofw-stories') + '\n---\n\nbody\n');
  }
  saveGoal('book-8', { label: 'Book 8 guests by 30 September', target: 8, current: 2, unit: 'guests', deadline: day(-11), created: day(30) }, { actor: 'crystal' });
  savePlaybook('warm-intro-openers', { claim: 'asking for a referral beats asking for the story', evidence: ['[[data/guests/g0]]'], wins: 9, verified_at: day(3) }, { actor: 'crystal' });
  savePlaybook('posting-windows', { claim: 'Tue/Thu evenings, 3x the replies', evidence: ['[[data/guests/g1]]'], wins: 2, verified_at: day(4) }, { actor: 'crystal' });
  saveLearning('video-beats-photos', { claim: 'People who post video convert better than photo-only', evidence: ['[[data/guests/g0]]'], status: 'active', verified_at: day(2) }, { actor: 'crystal' });
  cancelCacheRegen();
  return R();
}

// The eleven top-level headings, in the order docs/08 §5 fixes them.
const SPEC_ORDER = ['WHO I WORK FOR', 'GOALS', 'PROJECT', 'BEST GROUND', 'BLOCKED', 'NEVER TRIED',
  'WHAT WORKS', 'LEARNED', 'SINCE YOUR LAST RUN', 'OPEN QUESTIONS FROM YOU', 'COUNTS'];
const headingsOf = text => (text.match(/^## .*$/gm) || []).map(h => h.slice(3).split('  ')[0].split(' · ')[0].trim());

test('the budget is 2000 tokens, and a token is four characters', () => {
  assert.equal(CACHE_TOKEN_BUDGET, 2000);
  assert.equal(CACHE_CHAR_BUDGET, 8000);
  assert.equal(estimateTokens('x'.repeat(8000)), 2000);
});

test('the cache renders the shape in docs/03_MEMORY.md §2', () => {
  seed({ activeProject: '2026-08-hazing' });
  write('projects/2026-08-hazing/brief.md', '---\nid: 2026-08-hazing\n---\n\nFraternity hazing survivors. Never DM first.\n');
  const out = renderCache({});
  assert.match(out.text, /^<scout-context v="\d+" generated="\d{4}-\d{2}-\d{2} \d{2}:\d{2}" project="2026-08-hazing">\n/);
  assert.match(out.text, /<\/scout-context>\n$/);
  const heads = headingsOf(out.text);
  // Every heading present is a spec heading, and they appear in the spec's order.
  for (const h of heads) assert.ok(SPEC_ORDER.includes(h), 'unexpected section "' + h + '"');
  const seq = heads.map(h => SPEC_ORDER.indexOf(h));
  assert.deepEqual(seq, [...seq].sort((a, b) => a - b), 'sections are out of order: ' + heads.join(' → '));
  assert.match(out.text, /## WHO I WORK FOR\nCrystal — finds guests/);
  assert.match(out.text, /## BEST GROUND\n- #group\/nurses-ph .*\d+ wins? \/ \d+ finds · swept 2d ago/);
  assert.match(out.text, /Brief: projects\/2026-08-hazing\/brief\.md/);
  assert.match(out.text, /## COUNTS\nguest 12 · /);
});

test('no raw JS Date ever reaches the cache', () => {
  seed();
  // Hand-written frontmatter with an UNQUOTED yaml date — gray-matter returns a real Date object.
  write('territory/manila-nurses.md',
    '---\nid: manila-nurses\ntype: territory\nlabel: Manila Nurses\nkind: facebook-group\n' +
    'access: rejected\naccess_changed: 2026-07-30\nverified_at: 2026-08-18\n---\n\nMods said no.\n');
  const { text } = renderCache({});
  assert.match(text, /- #group\/manila-nurses\s+rejected 2026-07-30 · do not re-request/);
  // A JS Date stringifies as "Thu Jul 30 2026 02:00:00 GMT+0200 (…)". Match that SHAPE, not a
  // bare weekday — a playbook claim is allowed to say "Tue/Thu evenings".
  assert.ok(!/GMT[+-]\d{4}/.test(text), 'a Date was interpolated raw somewhere');
  assert.ok(!/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} \d{2} \d{4}\b/.test(text), 'a Date was interpolated raw somewhere');
});

test('an injected body never opens a twelfth section', () => {
  seed({ activeProject: 'p1' });
  write('projects/p1/brief.md', '---\nid: p1\n---\n\nThe brief.\n\n## Scope\n\nOnly Luzon.\n');
  const { text } = renderCache({});
  // me.md's own "## Notes" and the brief's "## Scope" are content, not sections.
  assert.ok(!headingsOf(text).includes('Notes'), 'me.md leaked a top-level heading into the cache');
  assert.ok(!headingsOf(text).includes('Scope'), 'the brief leaked a top-level heading into the cache');
  assert.match(text, /### Notes/, 'and identity still goes in IN FULL — the heading is demoted, not dropped');
  assert.match(text, /She works from her phone/);
});

test('a retired claim gives the reason it was retired, never the retired belief', () => {
  seed();
  savePlaybook('follower-count', {
    claim: 'People with more followers are more likely to reply',
    retired_because: 'no correlation after 40 bookings',
    status: 'retired', evidence: ['[[data/guests/g2]]'], verified_at: day(1),
  }, { actor: 'crystal' });
  const { text } = renderCache({});
  assert.match(text, /- ~~follower-count~~ — RETIRED, no correlation after 40 bookings/);
  assert.ok(!/more followers are more likely/.test(text), 'printing the belief is how the agent re-derives it');
});

test('WHAT WORKS leads with the most-proven claim and ends with the retired one', () => {
  seed();
  savePlaybook('follower-count', { claim: 'x', retired_because: 'no correlation', status: 'retired', evidence: ['[[e]]'], verified_at: day(1) }, { actor: 'crystal' });
  const lines = renderCache({}).text.split('\n');
  const start = lines.findIndex(l => l.startsWith('## WHAT WORKS'));
  const block = lines.slice(start + 1, lines.indexOf('', start));
  assert.match(block[0], /warm-intro-openers .* 9 wins/);
  assert.match(block[1], /posting-windows/);
  assert.match(block[2], /~~follower-count~~/, 'the retired claim is the one line that must be last');
});

test('DEMONSTRATE · a claim aged past its window is absent from the cache and its file is unchanged', () => {
  seed();
  savePlaybook('cold-open', { claim: 'open with the question, not the show', evidence: ['[[data/guests/g3]]'], verified_at: day(90) }, { actor: 'crystal' });
  const file = path.join(R(), 'playbook', 'cold-open.md');
  const before = fs.readFileSync(file, 'utf8');

  const out = renderCache({});
  assert.ok(!/cold-open/.test(out.text), 'a stale claim is excluded from the cache');
  assert.deepEqual(out.excluded, ['playbook/cold-open (stale — re-verify or retire)'], 'and it says so out loud');
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'the file is untouched — it stays for the Librarian');
  assert.ok(getPlaybook('cold-open').stale, 'and it is still readable, marked stale');
  assert.match(renderCache({}).text, /warm-intro-openers/, 'while the live claims stay');
});

test('DEMONSTRATE · 5,000 records, 40 territories and 30 claims fit under 2,000 tokens', () => {
  seed();
  const ids = [];
  for (let i = 0; i < 40; i++) {
    const id = 'ground-' + String(i).padStart(2, '0');
    ids.push(id);
    const access = i < 26 ? 'joined' : i < 32 ? 'untried' : i < 36 ? 'requested' : 'rejected';
    write('territory/' + id + '.md',
      '---\nid: ' + id + '\ntype: territory\nlabel: Ground ' + i + '\nkind: facebook-group\n' +
      'access: ' + access + '\naccess_changed: ' + day(i) + '\nlast_swept: ' + day(i % 20) +
      '\nverified_at: ' + day(i % 20) + '\ncreated: ' + day(40) + '\ncreated_by: vetter\n---\n\n' +
      'Rules for ground ' + i + ': no links, introductions on Tuesdays.\n');
  }
  const dir = path.join(R(), 'data', 'guests');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 5000; i++) {
    fs.writeFileSync(path.join(dir, 'r' + i + '.md'),
      '---\nname: Person ' + i + '\nstatus: ' + (i % 17 === 0 ? 'won' : i % 3 === 0 ? 'shortlist' : 'needs-review') +
      '\nfound_in: ' + ids[i % ids.length] + '\ncreated: ' + day(30) + '\n---\n\nA person found in ' + ids[i % ids.length] + '.\n');
  }
  for (let i = 0; i < 30; i++) {
    savePlaybook('claim-' + String(i).padStart(2, '0'), {
      claim: 'Claim number ' + i + ' about how this work actually gets done, at some length',
      evidence: ['[[data/guests/r' + i + ']]'], wins: 30 - i, verified_at: day(1),
    }, { actor: 'crystal' });
  }
  for (let i = 0; i < 12; i++) {
    saveLearning('learning-' + i, {
      claim: 'Learning number ' + i + ' that the human approved after seeing the evidence',
      evidence: ['[[data/guests/r' + i + ']]'], status: 'active',
      verified_at: day(i < 6 ? 2 : 70),
    }, { actor: 'crystal' });
  }
  setScoutMemoryHooks({ readEvents: () => Array.from({ length: 40 }, (_, i) => ({
    at: Date.now() - 3600e3, type: i % 4 ? 'store' : 'archive', actor: i % 4 ? 'scout-fb' : 'crystal',
    target: 'data/guests/r' + i + '.md', detail: i % 4 ? {} : { reason: 'off-target' },
  })) });
  cancelCacheRegen();

  const out = renderCache({});
  console.log('\n' + out.text);
  console.log('tokens ' + out.tokens + '/' + CACHE_TOKEN_BUDGET + ' · chars ' + out.chars +
    '\ndropped: ' + JSON.stringify(out.dropped, null, 2) + '\nexcluded: ' + JSON.stringify(out.excluded));

  assert.ok(out.tokens < CACHE_TOKEN_BUDGET, 'over budget: ' + out.tokens + ' tokens');
  assert.ok(out.chars <= CACHE_CHAR_BUDGET);
  assert.ok(out.dropped.length, 'it compressed and must name what it dropped');
  assert.match(out.dropped[0], /^territory beyond top-\d+ \/ stalest-3 \/ blocked \(\d+ rows\)/,
    'territory is the first thing summarised (docs/03_MEMORY.md §2, rung 1)');
  assert.match(out.text, /## COMPRESSED\nDropped to stay under the 2000-token budget: /,
    'the drop is named in the file itself, not only in the return value');
  assert.ok(!/\(truncated\)/.test(out.text), 'the ladder should fit this without a hard trim');
  // It is still a usable context, not a stub.
  assert.match(out.text, /## WHO I WORK FOR\nCrystal/);
  assert.match(out.text, /## BEST GROUND/);
  assert.match(out.text, /## COUNTS\nguest 5012 · /);
});

test('the compression ladder runs in the fixed order and each rung names itself', () => {
  seed();
  // Enough of everything that the ladder has to descend several rungs.
  for (let i = 0; i < 60; i++) {
    write('territory/t' + i + '.md', '---\nid: t' + i + '\ntype: territory\nlabel: T' + i +
      '\nkind: facebook-group\naccess: joined\nlast_swept: ' + day(i % 30) + '\nverified_at: ' + day(i % 30) + '\n---\n\nx\n');
    write('data/guests/x' + i + '.md', '---\nname: X' + i + '\nstatus: won\nfound_in: t' + i + '\n---\n\nx\n');
  }
  for (let i = 0; i < 40; i++) {
    savePlaybook('c' + i, { claim: 'A fairly long claim number ' + i + ' that costs real characters in the context file', evidence: ['[[e]]'], verified_at: day(1) }, { actor: 'crystal' });
  }
  for (let i = 0; i < 40; i++) {
    saveLearning('l' + i, { claim: 'A learning number ' + i + ' that also costs real characters in the context file', evidence: ['[[e]]'], status: 'active', verified_at: day(i < 20 ? 1 : 75) }, { actor: 'crystal' });
  }
  setScoutMemoryHooks({ readEvents: () => Array.from({ length: 80 }, (_, i) => ({
    at: Date.now() - 3600e3, type: 'store', actor: 'agent-' + i, target: 'data/guests/x' + i + '.md', detail: {},
  })) });
  cancelCacheRegen();

  const out = renderCache({});
  console.log('ladder · ' + out.tokens + '/' + CACHE_TOKEN_BUDGET + ' tokens · dropped ' + JSON.stringify(out.dropped, null, 2));
  assert.ok(out.tokens < CACHE_TOKEN_BUDGET, out.tokens + ' tokens');
  const order = ['territory beyond', 'playbook one-liners', 'learnings older than 60d', 'since-your-last-run'];
  const hit = out.dropped.map(d => order.findIndex(o => d.startsWith(o))).filter(i => i >= 0);
  assert.ok(hit.length >= 2, 'expected several rungs, got: ' + JSON.stringify(out.dropped));
  assert.deepEqual(hit, [...hit].sort((a, b) => a - b), 'the ladder ran out of order: ' + JSON.stringify(out.dropped));
  for (const d of out.dropped) assert.match(d, /\(\d+/, 'every drop says how much went: "' + d + '"');
});

test('an unreasonable identity is hard-trimmed — and says so rather than truncating in silence', () => {
  seed();
  write('me.md', '---\nname: Crystal\ncreated_by: crystal\n---\n\n' + 'Everything about how I work. '.repeat(600));
  const out = renderCache({});
  assert.ok(out.chars <= CACHE_CHAR_BUDGET, 'the cap holds even when one section alone exceeds it');
  assert.ok(out.dropped.includes('tail (hard trim)'), 'a silent truncation is a defect');
  assert.match(out.text, /\(truncated\)\n<\/scout-context>\n$/, 'and it still closes its own tag');
});

test('the version an agent polls is the version stamped in the text it reads', () => {
  seed();
  assert.deepEqual(cacheVersion({}), { v: 0, generated: null }, 'nothing generated yet');
  const first = regenerateCache({});
  assert.equal(first.version, 1);
  assert.match(first.text, /^<scout-context v="1"/);
  assert.equal(cacheVersion({}).v, 1);
  assert.equal(readCache({}).version, 1, 'and a read serves that same artefact');
  assert.match(readCache({}).text, /^<scout-context v="1"/);

  const second = regenerateCache({});
  assert.equal(second.version, 2, 'v increments on every regeneration');
  assert.equal(cacheVersion({}).v, 2);
  assert.match(readCache({}).text, /^<scout-context v="2"/);
  assert.equal(fs.readFileSync(path.join(R(), '.scout', 'cache', 'context.md'), 'utf8'), second.text);
});

test('a read regenerates when the cache has been deleted — .scout is disposable (Law 1)', () => {
  seed();
  regenerateCache({});
  fs.rmSync(path.join(R(), '.scout', 'cache'), { recursive: true, force: true });
  const out = readCache({});
  assert.equal(out.version, 1, 'the counter restarts with the folder, and the two still agree');
  assert.equal(cacheVersion({}).v, 1);
  assert.ok(fs.existsSync(path.join(R(), '.scout', 'cache', 'context.md')));
});

test('a project cache lives beside the project and sees only its own ground', () => {
  seed({ activeProject: 'p1' });
  write('projects/p1/brief.md', '---\nid: p1\n---\n\nOnly nurses.\n');
  write('data/guests/p1a.md', '---\nname: P1A\nstatus: won\nfound_in: nurses-ph\nproject: p1\n---\n\nx\n');
  const out = regenerateCache({ project: 'p1' });
  assert.equal(out.path, 'projects/p1/.cache/context.md');
  assert.ok(fs.existsSync(path.join(R(), 'projects', 'p1', '.cache', 'context.md')));
  assert.match(out.text, /project="p1"/);
  assert.match(out.text, /#group\/nurses-ph/);
  assert.ok(!/solo-parents/.test(out.text), 'territory is filtered to what this project touches');
  assert.equal(cacheVersion({ project: 'p1' }).v, 1);
});

test('regeneration is debounced, not immediate', () => {
  seed();
  scheduleCacheRegen({});
  assert.equal(cacheVersion({}).v, 0, 'a write schedules the regeneration; it does not perform it');
  cancelCacheRegen();
});

test('me.md is human-owned — an agent actor is refused', () => {
  seed();
  assert.equal(isAgentActor('crystal'), false, 'the declared owner is the human');
  assert.equal(isAgentActor('scout-fb'), true, 'anyone else, once an owner is declared, is not');
  assert.throws(() => writeMe('I am the agent now', {}, { actor: 'scout-fb' }), e => e.status === 403 && /human-owned/.test(e.message));
  assert.match(readMe().body, /Crystal — finds guests/, 'the file is untouched');
  const ok = writeMe('Crystal — still finds guests.', {}, { actor: 'crystal' });
  assert.match(ok.body, /still finds guests/);
  cancelCacheRegen();
});

test('a fresh workspace has no owner yet, so the person can write their own identity', () => {
  freshRoot(); cancelCacheRegen();
  write('me.md', '---\nname: __NAME__\n---\n\n(not set yet)\n');
  assert.equal(isAgentActor('crystal'), false, 'the placeholder declares nobody');
  assert.match(writeMe('I am Theo.', {}, { actor: 'theo' }).body, /I am Theo/);
  // …but a declared assistant is an agent from the very first run.
  write('assistants/scout-fb.md', '---\nid: scout-fb\n---\n\nSweeps groups.\n');
  assert.equal(isAgentActor('scout-fb'), true);
  assert.throws(() => writeMe('mine now', {}, { actor: 'scout-fb' }), e => e.status === 403);
  cancelCacheRegen();
});

test('DEMONSTRATE · a playbook claim submitted without evidence is refused', () => {
  seed();
  assert.throws(
    () => savePlaybook('gut-feeling', { claim: 'posting at night just feels better' }, { actor: 'scout-fb' }),
    e => e.status === 400 && /needs evidence\[\]/.test(e.message));
  assert.ok(!fs.existsSync(path.join(R(), 'playbook', 'gut-feeling.md')), 'nothing was written');
  assert.throws(() => savePlaybook('gut-feeling', { claim: 'x', evidence: [] }, { actor: 'crystal' }), e => e.status === 400);
  const ok = savePlaybook('gut-feeling', { claim: 'posting at night works', evidence: ['[[data/guests/g0]]'] }, { actor: 'scout-fb' });
  assert.equal(ok.evidence.length, 1);
  cancelCacheRegen();
});

test('an agent may only propose a learning, never activate one', () => {
  seed();
  const l = saveLearning('agent-idea', { claim: 'video converts better', evidence: ['[[data/guests/g0]]'], status: 'active' }, { actor: 'scout-fb' });
  assert.equal(l.status, 'proposed', 'Law 4 — the gate is in the pipeline, not in the prompt');
  assert.match(fs.readFileSync(path.join(R(), 'learnings', 'agent-idea.md'), 'utf8'), /proposed: true/);
  assert.equal(saveLearning('agent-idea', { status: 'active' }, { actor: 'crystal' }).status, 'active');
  assert.throws(() => saveLearning('bare', { claim: 'no evidence here', status: 'active' }, { actor: 'crystal' }), e => e.status === 400);
  cancelCacheRegen();
});

test('a claim that holds in a second project is proposed for graduation', () => {
  seed();
  saveLearning('video-a', { claim: 'People who post video convert better', scope: 'project', project: 'p1', evidence: ['[[e]]'], status: 'active' }, { actor: 'crystal' });
  saveLearning('video-b', { claim: 'people who post VIDEO convert better!', scope: 'project', project: 'p2', evidence: ['[[e]]'], status: 'active' }, { actor: 'crystal' });
  const g = graduationCandidates();
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].projects.sort(), ['p1', 'p2']);
  assert.deepEqual(g[0].ids.sort(), ['video-a', 'video-b']);
  cancelCacheRegen();
});

test('goal progress is a rollup when the goal declares one, and it drives `behind`', () => {
  seed();
  saveGoal('won-guests', {
    label: 'Six wins', target: 6, unit: 'guests', deadline: day(-2), created: day(28),
    count: { path: 'data/guests/**', where: { status: 'won' } },
  }, { actor: 'crystal' });
  const g = getGoal('won-guests');
  assert.equal(g.current, 2, 'counted from the records, not typed');
  assert.equal(g.computed, true);
  assert.equal(g.behind, true, '2 of 6 with 2 days left is behind');
  // A typed `current` cannot shadow the rollup.
  const after = saveGoal('won-guests', { current: 99 }, { actor: 'crystal' });
  assert.equal(after.current, 2);
  assert.match(renderCache({}).text, /- Six wins — 2\/6 guests, 2 days left {2}← behind/);
  cancelCacheRegen();
});

test('goals and me.md refuse an agent; territory and playbook do not', () => {
  seed();
  assert.throws(() => saveGoal('book-8', { target: 99 }, { actor: 'scout-fb' }), e => e.status === 403);
  assert.equal(listGoals()[0].target, 8);
  assert.equal(savePlaybook('posting-windows', { wins: 3, evidence: ['[[e]]'] }, { actor: 'scout-fb' }).wins, 3,
    'an agent writes the playbook — with evidence — because that is how it gets better');
  cancelCacheRegen();
});

test('SINCE YOUR LAST RUN summarises the log, and collapses to counts under pressure', () => {
  seed();
  setScoutMemoryHooks({ readEvents: () => ([
    { at: Date.now() - 3600e3, type: 'archive', actor: 'crystal', target: 'a', detail: { reason: 'off-target' } },
    { at: Date.now() - 3600e3, type: 'archive', actor: 'crystal', target: 'b', detail: { reason: 'off-target' } },
    { at: Date.now() - 3600e3, type: 'archive', actor: 'crystal', target: 'c', detail: { reason: 'already-contacted' } },
    { at: Date.now() - 7200e3, type: 'store', actor: 'scout-fb', target: 'd', detail: {} },
  ]) });
  const { text } = renderCache({});
  assert.match(text, /## SINCE YOUR LAST RUN\n- crystal rejected 3: 2× off-target, 1× already-contacted\n- scout-fb added 1/);
  assert.match(text, /## COUNTS/, 'and the sections after it still render');
});

test('an open question from the agent is carried until it is answered', () => {
  seed();
  write('proposals/q-video.md', '---\nkind: question\nstatus: open\nactor: scout-fb\nquestion: Should I rank video over photos?\n---\n\nx\n');
  assert.match(renderCache({}).text, /## OPEN QUESTIONS FROM YOU\n- "Should I rank video over photos\?" — still unanswered/);
  write('proposals/q-video.md', '---\nkind: question\nstatus: answered\nactor: scout-fb\nquestion: Should I rank video over photos?\n---\n\nx\n');
  assert.ok(!/OPEN QUESTIONS/.test(renderCache({}).text));
});

test('the routes serve one artefact, and hold the two gates', async () => {
  seed();
  const app = express();
  app.use(express.json());
  registerScoutMemoryRoutes(app, { readEvents: () => [] });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (p, body, method = 'POST') => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    // BARE `curl /api/context` MUST return the cache itself. docs/04_AGENT_CONTRACT.md §2 writes
    // the route and `read .scout/cache/context.md` as the same act, and skills/scout-router curls
    // it bare and reads the answer as its wake-up context. Answering JSON there would hand an
    // agent a quoted blob with escaped newlines — and would still have passed a status-code check.
    const bare = await fetch(base + '/api/context');
    assert.match(bare.headers.get('content-type') || '', /text\/markdown/,
      'a bare curl must get the cache, not an envelope around it');
    const bareText = await bare.text();
    assert.match(bareText, /^<scout-context v="/);

    // The UI wants the envelope and asks for it — two ways, because api.js sends the query and a
    // fetch with an Accept header should not get markdown it cannot use.
    const ctx = await (await fetch(base + '/api/context?format=json')).json();
    const viaHeader = await (await fetch(base + '/api/context', { headers: { accept: 'application/json' } })).json();
    assert.equal(viaHeader.version, ctx.version, 'Accept: application/json is the same door as ?format=json');
    assert.ok(ctx.tokens < CACHE_TOKEN_BUDGET);
    assert.equal(ctx.budget, CACHE_TOKEN_BUDGET);
    const ver = await (await fetch(base + '/api/cache/version')).json();
    assert.equal(ver.v, ctx.version, 'GET /api/context and GET /api/cache/version must never disagree');
    assert.match(ctx.text, new RegExp('^<scout-context v="' + ver.v + '"'));
    assert.equal(bareText, ctx.text, 'the same bytes either way — one artefact, two wrappers');

    const md = await fetch(base + '/api/context?format=md');
    assert.match(md.headers.get('content-type') || '', /text\/markdown/);
    assert.equal(await md.text(), ctx.text, '?format=md stays supported for anything already using it');

    const bumped = await (await post('/api/cache/regenerate', {})).json();
    assert.equal(bumped.version, ver.v + 1);
    assert.equal((await (await fetch(base + '/api/cache/version')).json()).v, ver.v + 1);

    assert.equal((await post('/api/me', { body: 'nope', actor: 'scout-fb' }, 'PUT')).status, 403);
    assert.equal((await post('/api/me', { body: 'Crystal, updated.', actor: 'crystal' }, 'PUT')).status, 200);
    assert.equal((await post('/api/goals/book-8', { patch: { target: 99 }, actor: 'scout-fb' }, 'PATCH')).status, 403);

    const bad = await post('/api/playbook/no-evidence', { patch: { claim: 'a hunch' }, actor: 'scout-fb' }, 'PATCH');
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /needs evidence\[\]/);

    const proposed = await (await post('/api/learnings/propose', { claim: 'Video posts convert better', evidence: ['[[data/guests/g0]]'], scope: 'project', actor: 'scout-fb' })).json();
    assert.equal(proposed.learning.status, 'proposed');
    assert.equal(proposed.learning.id, 'video-posts-convert-better');

    const pb = await (await fetch(base + '/api/playbook/warm-intro-openers')).json();
    assert.equal(pb.wins, 9);
    assert.equal((await fetch(base + '/api/playbook/nope')).status, 404);
  } finally { server.close(); cancelCacheRegen(); }
});
