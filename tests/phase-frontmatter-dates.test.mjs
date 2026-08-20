// gray-matter parses a BARE YAML date into a `Date` and a QUOTED one into a string. The same key
// is therefore two different types depending on how the file happened to be written, and every
// module that stringifies or `localeCompare`s one is silently wrong.
//
// This is not hypothetical. Two live bugs, both of which read correctly in review:
//   · `String(created).localeCompare(...)` sorted the DECIDE queue by WEEKDAY NAME.
//   · the hot cache printed "rejected Thu Jul 30 2026 02:00:00 GMT+0200 (Central European
//     Summer Time)" into the file an agent reads on wake.
//
// Both were caught by looking at real output, not by a test. This file is the test.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { day, dayMs, byDate } from '../backend/store.mjs';

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'backend');

// The keys that carry a date in this app. Anything sorted or printed from one of these is suspect.
const DATE_KEYS = [
  'created', 'updated', 'verified_at', 'access_changed', 'last_swept', 'deadline',
  'found', 'claimed_at', 'archived_at', 'done_at', 'approved_at', 'generated',
];

test('day() renders the calendar day whatever type the frontmatter produced', () => {
  // the three shapes that actually reach us
  assert.equal(day(new Date('2026-07-30T00:00:00.000Z')), '2026-07-30');  // bare YAML → Date
  assert.equal(day('2026-07-30'), '2026-07-30');                          // quoted YAML → string
  assert.equal(day('2026-07-30T14:22:01.000Z'), '2026-07-30');            // a full timestamp
  assert.equal(day(Date.parse('2026-07-30T00:00:00Z')), '2026-07-30');    // epoch ms
  assert.equal(day(null), '');
  assert.equal(day(''), '');
  assert.equal(day('not a date'), '');
});

test('day() never leaks a JS Date toString into anything a person or an agent reads', () => {
  const out = day(new Date('2026-07-30T00:00:00.000Z'));
  assert.doesNotMatch(out, /GMT/);
  assert.doesNotMatch(out, /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/);
  assert.doesNotMatch(out, /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/);
});

test('day() reports the same calendar day the file says, in any timezone', () => {
  // A bare YAML date parses as UTC midnight. Read back with local getDate() west of UTC it is the
  // day before — which would misfile every record in a list view grouped by day.
  assert.equal(day(new Date('2026-01-01T00:00:00.000Z')), '2026-01-01');
  assert.equal(day(new Date('2026-12-31T00:00:00.000Z')), '2026-12-31');
});

test('byDate sorts oldest first across MIXED Date and string values', () => {
  // exactly the mix a real workspace has, because two people wrote the files
  const rows = [
    { id: 'c', created: '2026-08-19' },
    { id: 'a', created: new Date('2026-08-16T00:00:00.000Z') },
    { id: 'd', created: null },
    { id: 'b', created: '2026-08-17' },
  ];
  assert.deepEqual(rows.slice().sort(byDate('created')).map(r => r.id), ['a', 'b', 'c', 'd']);

  // and the specific failure this replaces: localeCompare on the same input sorts by weekday name
  const wrong = rows.filter(r => r.created)
    .sort((x, y) => String(x.created).localeCompare(String(y.created))).map(r => r.id);
  assert.notDeepEqual(wrong, ['a', 'b', 'c'], 'the old comparison would have to be broken for this guard to mean anything');
});

test('an object with no date sorts LAST, not first', () => {
  // "we know nothing about this" is not the same as "this is the oldest thing in the queue" — at
  // the top of a DECIDE queue it would be the first card she sees every morning, forever.
  const rows = [{ id: 'none' }, { id: 'old', created: '2020-01-01' }];
  assert.deepEqual(rows.sort(byDate('created')).map(r => r.id), ['old', 'none']);
});

test('no backend module localeCompares a frontmatter date', () => {
  // Look at what is INSIDE the call — its receiver and its argument — not merely at what else
  // shares the line. `byDate('created')(a, b) || a.id.localeCompare(b.id)` is correct code: the
  // date sort is real and the localeCompare is only the id tiebreaker. A line-level match calls
  // that a bug, and a guard that cries wolf on correct code gets switched off.
  // Two rules, because either alone is wrong:
  //   · a date key must not appear in the 60 characters feeding a `.localeCompare(` — that window
  //     catches both `a.created.localeCompare(…)` and `String(a.created || '').localeCompare(…)`;
  //   · unless the line routes its dates through the sanctioned helper, in which case the
  //     localeCompare is the id tiebreaker beside a correct date sort.
  const SANCTIONED = /\bbyDate\(|\bdayMs\(|\bday\(|\bparseDate\(/;
  const offenders = [];
  for (const f of fs.readdirSync(BACKEND).filter(n => n.endsWith('.mjs'))) {
    const src = fs.readFileSync(path.join(BACKEND, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;  // a comment about the bug is fine
      if (SANCTIONED.test(line)) return;
      for (const m of line.matchAll(/\.localeCompare\(([^)]*)\)/g)) {
        const window = line.slice(Math.max(0, m.index - 60), m.index) + ' ' + m[1];
        if (DATE_KEYS.some(k => new RegExp('\\b' + k + '\\b').test(window))) {
          offenders.push(`${f}:${i + 1}  ${trimmed}`);
        }
      }
    });
  }
  assert.deepEqual(offenders, [], 'localeCompare on a date sorts by weekday name — use byDate() from store.mjs');
});

test('no backend module interpolates a raw frontmatter date into a template string', () => {
  // `${t.access_changed}` and `String(d.created)` both produce the GMT string. day() is the fix.
  const offenders = [];
  const bad = new RegExp(
    '(\\$\\{[^}]*\\b(' + DATE_KEYS.join('|') + ')\\b[^}]*\\}'          // `${x.last_swept}`
    + '|String\\([^)]*\\b(' + DATE_KEYS.join('|') + ')\\b[^)]*\\))',   // String(x.created)
  );
  for (const f of fs.readdirSync(BACKEND).filter(n => n.endsWith('.mjs'))) {
    const src = fs.readFileSync(path.join(BACKEND, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      // day()/dayMs() ARE the sanctioned wrappers, and a comparison is not a render
      if (/\bday\(|\bdayMs\(|\bbyDate\(|\bparseDate\(|\bstaleness\(|\bageDays\(/.test(line)) return;
      if (bad.test(line)) offenders.push(`${f}:${i + 1}  ${trimmed}`);
    });
  }
  assert.deepEqual(offenders, [], 'wrap frontmatter dates in day() from store.mjs before rendering them');
});

test('dayMs accepts everything readMd can hand it and rejects everything else', () => {
  assert.equal(typeof dayMs(new Date()), 'number');
  assert.equal(typeof dayMs('2026-08-19'), 'number');
  assert.equal(dayMs(undefined), null);
  assert.equal(dayMs({}), null);
  assert.equal(dayMs('tomorrow'), null);
});
