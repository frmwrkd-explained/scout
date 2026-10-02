#!/usr/bin/env node
// scripts/seed-today-demo.mjs <workspaceDir> — give a throwaway workspace four weeks of Today-loop
// history so the TIME column, the reviews and the weekly automation rule have something true to say.
//
//   cp -R workspace-demo /tmp/scout-today-demo          # a throwaway copy — never your vault
//   node scripts/seed-today-demo.mjs /tmp/scout-today-demo
//   PORT / app pointed at that workspace
//
// This is a FIXTURE GENERATOR, run by hand before the app starts — the same standing as
// scripts/demo.mjs copying workspace-demo. It writes plain markdown the way the app reads it:
//   data/work/<day>-<slug>.md   work items (frontmatter the `work` collection declares)
//   log/<UTC-day>.md            backdated work events — the clock is derived by replaying these
//   .scout/collections/*.md     the work + review schemas, copied from workspace-template/ if absent
// It is idempotent-ish (fixed slugs overwrite), and it never runs automatically.
//
// What it seeds, deliberately:
//   · ~30 items over the past 4 weeks, varied buckets, realistic 25–180m sessions, some results
//   · the current week Mon→yesterday and earlier days of the current month, so Week/Month show
//     more than one column
//   · facebook-groups with MANY hours and ~0 results — the weekly rule must flag it
//   · a couple of parked/stuck outcomes, two unfinished yesterday items (carryover demo)
//   · a few backlog items for the "empty plan pulls backlog" path and tomorrow's plan
//   · ONE item started ~50 min ago with a 20m estimate — the over-estimate nudge fires on the
//     first poll, without anybody touching the clock by hand.

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!DIR || !fs.existsSync(DIR) || !fs.statSync(DIR).isDirectory()) {
  console.error('usage: node scripts/seed-today-demo.mjs <workspaceDir>  (the dir must already exist — copy workspace-demo first)');
  process.exit(1);
}

// The one correct way to write a document file: matter.stringify({content}, data) — the bare-string
// form eats a leading `---` block into frontmatter (CLAUDE.md hard rule).
const writeDoc = (file, data, content = '') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, matter.stringify({ content }, data));
};

const localDay = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const utcDay = ms => new Date(ms).toISOString().slice(0, 10);
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const at = (ymd, h, m = 0) => { const [y, mo, d] = ymd.split('-').map(Number); return new Date(y, mo - 1, d, h, m).getTime(); };
const addDays = (ymd, n) => { const [y, mo, d] = ymd.split('-').map(Number); return localDay(new Date(y, mo - 1, d + n)); };
// The Monday of `n` weeks before this one — the weekly review reads the PREVIOUS Mon–Sun, so
// placing sessions by weekday (not "days ago") guarantees they land inside its window.
const mondayOf = n => { const t = new Date(); const dow = (t.getDay() + 6) % 7; t.setDate(t.getDate() - dow - 7 * n); return localDay(t); };

// Deterministic spread — the demo should look the same twice.
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = arr => arr[Math.floor(rnd() * arr.length)];

// ── the item ledger ───────────────────────────────────────────────────────────────────────────
// [ymd, hour, minutes, title, bucket, estimate, { result?, outcome?, prep? }]
const B = 'facebook-groups';
const W1 = mondayOf(1), W2 = mondayOf(2), W3 = mondayOf(3), W4 = mondayOf(4);
const SESSIONS = [
  // last week — the week the Monday review reads: facebook-groups heavy, nothing back
  [addDays(W1, 0), 9, 150, 'Cross-post the framework teaser to 12 groups', B, 60],
  [addDays(W1, 1), 14, 120, 'Answer comments across the nursing thread', B, 45],
  [addDays(W1, 2), 10, 95, 'Scout new buy/sell groups in PH niche', B, 60],
  [addDays(W1, 3), 16, 130, 'Follow up DMs from Tuesday\'s post', B, 40, { outcome: 'parked' }],
  [addDays(W1, 0), 13, 60, 'Outline: "one person production company" essay', 'research', 60, { result: 1 }],
  [addDays(W1, 1), 9, 80, 'SEO: refresh the Claude-Code tools post', 'seo', 75, { result: 2 }],
  [addDays(W1, 2), 15, 45, 'Newsletter: draft the Sunday issue', 'email', 45, { result: 1 }],
  [addDays(W1, 3), 11, 35, 'Read: the Kyahoo retention teardown', 'reading', 30],
  [addDays(W1, 4), 9, 70, 'Marketing: ship the Before/After carousel', 'marketing', 60, { result: 3 }],
  [addDays(W1, 4), 15, 40, 'Admin: invoices + bookkeeping sweep', 'admin', 45],
  // two weeks ago
  [addDays(W2, 0), 10, 170, 'Groups blitz: promo post + 30 comments', B, 90],
  [addDays(W2, 1), 13, 140, 'FB groups: answer + seed the gear thread', B, 60],
  [addDays(W2, 0), 15, 65, 'Keyword map for the devin-cli comparison', 'seo', 60, { result: 2 }],
  [addDays(W2, 2), 9, 55, 'Read: two papers on attention tracking', 'reading', 55],
  [addDays(W2, 3), 10, 85, 'Cut the 90s vertical from last week\'s shoot', 'marketing', 90, { result: 1 }],
  [addDays(W2, 4), 14, 50, 'Reddit: AMA follow-ups in r/SideProject', 'reddit', 45, { result: 4 }],
  [addDays(W2, 4), 9, 30, 'Inbox zero + reply to sponsor briefs', 'email', 30, { result: 2 }],
  // three weeks ago
  [addDays(W3, 0), 9, 160, 'FB groups: big value post + comments', B, 75],
  [addDays(W3, 1), 11, 110, 'Groups: soft-launch the waitlist link', B, 60],
  [addDays(W3, 0), 14, 70, 'Interview prep: questions for the ops guest', 'research', 60],
  [addDays(W3, 2), 10, 95, 'SEO: programmatic page brief', 'seo', 80, { result: 3 }],
  [addDays(W3, 3), 13, 40, 'Admin: receipts + quarterly estimated tax', 'admin', 45, { outcome: 'stuck' }],
  [addDays(W3, 4), 9, 50, 'Read: the browser-maker\'s strategy memo', 'reading', 45],
  // four weeks ago
  [addDays(W4, 0), 10, 120, 'FB groups: onboarding audit, 8 groups', B, 60],
  [addDays(W4, 5), 14, 60, 'Fix the landing page CLS regression', 'seo', 50, { result: 1 }],
  [addDays(W4, 6), 9, 75, 'Marketing: retargeting audiences refresh', 'marketing', 60, { result: 2 }],
  [addDays(W4, 0), 15, 35, 'Email: welcome-sequence copy pass', 'email', 40, { result: 1 }],
];

// This week and this month — the Week chart is the demo's first glance, and a seed that stops at
// last week leaves it a single column. Every uncovered day from min(this week's Monday, the 1st)
// through yesterday gets sessions: facebook-groups stays heavy with ~0 results, a second session
// rotates the other buckets so the bars have more than one colour.
const TODAY_D = localDay(new Date());
const W0 = mondayOf(0);
const M0 = TODAY_D.slice(0, 7) + '-01';
const covered = new Set(SESSIONS.map(s => s[0]));
const ROTATE = ['seo', 'research', 'email', 'marketing', 'reading', 'admin', 'reddit'];
const MONTH_TITLE = {
  seo: 'SEO: meta pass on the tools index', research: 'Research: teardown notes for the essay',
  email: 'Email: replies + sponsor follow-ups', marketing: 'Marketing: schedule the week\u2019s posts',
  reading: 'Read: saved queue, 3 posts', admin: 'Admin: expenses + desk clear',
  reddit: 'Reddit: answer build-in-public threads',
};
const FB_TITLE = ['Groups: morning comment sweep', 'Groups: answer the pinned questions', 'Groups: post + reply block'];
for (let d = (M0 < W0 ? M0 : W0), ri = 0; d < TODAY_D; d = addDays(d, 1)) {
  if (covered.has(d)) continue;
  const inWeek = d >= W0;
  const bucket = ROTATE[ri % ROTATE.length];
  SESSIONS.push(
    [d, 9, inWeek ? 120 + (ri % 3) * 20 : 60, FB_TITLE[ri % FB_TITLE.length], B, inWeek ? 60 : 45],
    [d, 14, inWeek ? 55 : 40, MONTH_TITLE[bucket], bucket, inWeek ? 50 : 40,
      inWeek && ri % 2 === 0 ? { result: 1 } : {}],
  );
  ri++;
}

// Yesterday: two items left unfinished on purpose — the morning plan must carry them over.
const CARRYOVER = [
  [1, 'Prep the FRMWRKD cold-open rewrite', 'research', 45, { prep: true }],
  [1, 'Email: chase the unpaid invoice', 'email', 20],
];

const BACKLOG = [
  ['Automate the newsletter section that repeats itself', 'admin', 45, { prep: true, why: 'weekly review flagged the repeated block' }],
  ['Split the ops-guest interview into 3 shorts', 'marketing', 60],
  ['Read: the long SQLite internals post', 'reading', 40],
  ['SEO: internal-link pass across dev tools posts', 'seo', 55, { prep: true }],
  ['Research: pricing page teardown of 5 competitors', 'research', 60],
];

const items = [];
const logLines = {}; // utc day file -> [lines]
const addEvent = (ms, id, detail) => {
  const line = '- ' + new Date(ms).toISOString() + ' · crystal · work · data/work/' + id + '.md · ' + JSON.stringify(detail);
  const key = utcDay(ms);
  (logLines[key] ||= []).push(line);
};

for (const [day, hour, mins, title, bucket, estimate, extra = {}] of SESSIONS) {
  const id = day + '-' + slug(title).slice(0, 40);
  const start = at(day, hour) - (rnd() * 20 - 10) * 60000;
  const end = start + mins * 60000;
  const outcome = extra.outcome || 'done';
  items.push({
    id, day, file: 'data/work/' + id + '.md',
    data: {
      tags: ['work'], title, bucket,
      status: outcome === 'done' ? 'done' : outcome, day,
      order: Math.round(hour), estimate_min: estimate,
      why: pick(['push the channel', 'keep the flywheel warm', 'feed the weekly numbers', 'clear the debt', '']),
      ...(extra.result ? { result: extra.result, result_note: pick(['shipped', 'posted', 'merged', 'sent']) } : {}),
      prep: false, prep_state: 'none',
      created: day, updated: day, created_by: 'crystal', updated_by: 'crystal', provenance: 'pipeline',
    },
    body: '',
  });
  addEvent(start, id, { action: 'start', id, bucket });
  addEvent(end, id, { action: 'stop', id, bucket, outcome, ...(outcome === 'stuck' ? { reason: 'needed a reply that never came' } : {}) });
}

for (const [ago, title, bucket, estimate, extra = {}] of CARRYOVER) {
  const day = localDay(new Date(Date.now() - ago * 86400000));
  const id = day + '-' + slug(title).slice(0, 40);
  items.push({
    id, day, file: 'data/work/' + id + '.md',
    data: {
      tags: ['work'], title, bucket, status: 'planned', day, order: 1,
      estimate_min: estimate, why: extra.why || '', prep: !!extra.prep, prep_state: 'none',
      created: day, updated: day, created_by: 'crystal', updated_by: 'crystal', provenance: 'pipeline',
    },
    body: '',
  });
}

let order = 0;
for (const [title, bucket, estimate, extra = {}] of BACKLOG) {
  const id = 'backlog-' + slug(title).slice(0, 40);
  items.push({
    id, day: '', file: 'data/work/' + id + '.md',
    data: {
      tags: ['work'], title, bucket, status: 'planned', order: ++order,
      estimate_min: estimate, why: extra.why || '', prep: !!extra.prep, prep_state: 'none',
      created: localDay(new Date()), updated: localDay(new Date()), created_by: 'crystal', updated_by: 'crystal', provenance: 'pipeline',
    },
    body: '',
  });
}

// One item running right now, 50 minutes into a 20-minute estimate — the nudge demo.
{
  const day = localDay(new Date());
  const id = day + '-' + slug('Groups: triage the pinned-thread replies');
  const startMs = Date.now() - 50 * 60000;
  items.push({
    id, day, file: 'data/work/' + id + '.md',
    data: {
      tags: ['work'], title: 'Groups: triage the pinned-thread replies', bucket: B,
      status: 'now', day, order: 99, estimate_min: 20,
      why: 'the thread went up this morning', prep: false, prep_state: 'none',
      created: day, updated: day, created_by: 'crystal', updated_by: 'crystal', provenance: 'pipeline',
    },
    body: '',
  });
  addEvent(startMs, id, { action: 'start', id, bucket: B });
}

// ── write it all ──────────────────────────────────────────────────────────────────────────────
for (const it of items) {
  writeDoc(path.join(DIR, it.file), it.data, it.body);
}
for (const [dayKey, lines] of Object.entries(logLines)) {
  lines.sort(); // the file is append-ordered — so is the fixture
  writeDoc(path.join(DIR, 'log', dayKey + '.md'), { type: 'log', date: dayKey },
    '# Activity · ' + dayKey + '\n\n' + lines.join('\n') + '\n');
}

// The schemas travel with the workspace — copy the canonical ones if the workspace lacks them.
for (const name of ['work', 'review']) {
  const dest = path.join(DIR, '.scout', 'collections', name + '.md');
  const src = path.join(ROOT, 'workspace-template', '.scout', 'collections', name + '.md');
  if (!fs.existsSync(dest) && fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

const minutes = SESSIONS.reduce((a, s) => a + s[2], 0) + 50;
console.log('Seeded ' + items.length + ' work items · ' + Object.keys(logLines).length + ' log days · ~' + (minutes / 60).toFixed(1) + 'h tracked');
console.log('facebook-groups is heavy with ~0 results — the weekly review will flag it.');
console.log('One item has been "running" for 50m on a 20m estimate — the over-estimate nudge will fire.');
