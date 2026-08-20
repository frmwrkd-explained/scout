// The event log — docs/08_MODULE_CONTRACTS.md §1.
//
// Two things are being asserted and they pull in opposite directions: the line must PARSE (we read
// it back for Activity and for the inspector's HISTORY) and it must be GREPPABLE BY A HUMAN with no
// tooling at all (Law 8). The second is the one that quietly breaks — `docs/decisions.md` records a
// single control byte making `documents.mjs` invisible to grep, silently, exit 1. In a log file
// that would be the same bug in the one file whose entire job is being searchable, so the byte-level
// check here is not paranoia, it is the regression that already happened once in this repo.

import '../tests/_env.mjs'; // first — sets the storage root before store.mjs captures it
import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { freshRoot, getStorageRoot, writeMd, fs, path } from './helpers.mjs';
import { logEvent, readEvents, eventsFor, EVENT_TYPES, logDir, logFileFor, formatEvent, parseEvent } from '../backend/log.mjs';

const today = () => new Date().toISOString().slice(0, 10);
const readLog = (day = today()) => fs.readFileSync(logFileFor(day), 'utf8');

// The exact shape §1 documents, as a regex. If this fails, a human's `grep` still works but every
// parser in the app has to be rewritten — which is why the format is pinned rather than described.
const LINE = /^- (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) · ([^\n]+?) · ([a-z]+) · ([^\n]+?) · (\{.*\})$/;

test('an event lands in log/<today>.md in the documented line format', () => {
  freshRoot();
  const ev = logEvent({ type: 'store', actor: 'scout-fb', target: 'data/guests/maria-santos.md', detail: { confidence: 0 } });

  assert.equal(ev.type, 'store');
  assert.equal(ev.actor, 'scout-fb');
  assert.ok(fs.existsSync(logFileFor(today())), 'the day file exists at log/<YYYY-MM-DD>.md');

  const lines = readLog().split('\n').filter(l => l.startsWith('- '));
  assert.equal(lines.length, 1);
  const m = lines[0].match(LINE);
  assert.ok(m, 'line does not match the documented format: ' + lines[0]);
  assert.equal(m[2], 'scout-fb');
  assert.equal(m[3], 'store');
  assert.equal(m[4], 'data/guests/maria-santos.md');
  assert.deepEqual(JSON.parse(m[5]), { confidence: 0 });
});

test('the day file is a real .md with frontmatter, so the log opens in Obsidian like everything else', () => {
  freshRoot();
  logEvent({ type: 'store', actor: 'crystal', target: 'data/guests/a.md' });
  const raw = readLog();
  assert.ok(raw.startsWith('---\n'), 'no frontmatter: ' + raw.slice(0, 40));
  assert.match(raw, /^date: /m);
});

test('a human can grep the log — it is text, not data', () => {
  freshRoot();
  logEvent({ type: 'store', actor: 'scout-fb', target: 'data/guests/maria-santos.md', detail: { confidence: 0 } });
  logEvent({ type: 'skip', actor: 'scout-fb', target: 'data/guests/jun-cruz.md' });
  const file = logFileFor(today());

  // The trap: a control byte makes grep classify the file as binary and skip it — silently.
  const kind = execFileSync('file', ['-b', file]).toString().trim();
  assert.ok(!/^data\b/.test(kind), 'the log reads as ' + kind + ' — grep will not search it');
  const bytes = fs.readFileSync(file);
  const control = [...bytes].filter(b => b < 0x09 || (b > 0x0d && b < 0x20) || b === 0x7f);
  assert.equal(control.length, 0, 'raw control byte in the log');

  // And the search a person would actually type.
  assert.equal(execFileSync('grep', ['-c', 'maria-santos', file]).toString().trim(), '1');
  assert.equal(execFileSync('grep', ['-c', 'scout-fb', file]).toString().trim(), '2');
});

test('readEvents comes back newest first and honours limit, type, target and since', async () => {
  freshRoot();
  const a = logEvent({ type: 'store', actor: 'scout-fb', target: 'data/guests/a.md' });
  await new Promise(r => setTimeout(r, 5));
  logEvent({ type: 'skip', actor: 'scout-fb', target: 'data/guests/b.md' });
  await new Promise(r => setTimeout(r, 5));
  logEvent({ type: 'refused', actor: 'scout-fb', target: 'data/guests/a.md', detail: { to: 'contacted' } });

  const all = readEvents({});
  assert.deepEqual(all.map(e => e.type), ['refused', 'skip', 'store']);

  assert.equal(readEvents({ limit: 2 }).length, 2);
  assert.deepEqual(readEvents({ type: 'skip' }).map(e => e.target), ['data/guests/b.md']);
  assert.deepEqual(readEvents({ target: 'data/guests/a.md' }).map(e => e.type), ['refused', 'store']);
  // `limit` means "this many MATCHING events" — the filter runs first, or a filtered view of a busy
  // day silently returns nothing.
  assert.equal(readEvents({ target: 'data/guests/a.md', limit: 1 }).length, 1);
  assert.deepEqual(readEvents({ since: a.ts }).map(e => e.type), ['refused', 'skip']);
});

test('eventsFor is one file\'s history and nobody else\'s', () => {
  freshRoot();
  logEvent({ type: 'store', actor: 'scout-fb', target: 'data/guests/a.md' });
  logEvent({ type: 'store', actor: 'scout-fb', target: 'data/guests/b.md' });
  logEvent({ type: 'move', actor: 'crystal', target: 'data/guests/a.md', detail: { to: 'shortlist' } });
  const h = eventsFor('data/guests/a.md');
  assert.deepEqual(h.map(e => e.type), ['move', 'store']);
  assert.ok(h.every(e => e.target === 'data/guests/a.md'));
});

test('a second day is a second file, and the two read back newest-day-first', () => {
  const root = freshRoot();
  logEvent({ type: 'store', actor: 'crystal', target: 'data/guests/today.md' });
  // Seed yesterday through the store's own writer — the same shape logEvent produces.
  const yday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  writeMd(path.join(root, 'log', yday + '.md'), { type: 'log', date: yday },
    '# Activity · ' + yday + '\n\n- ' + yday + 'T09:00:00.000Z · scout-fb · store · data/guests/yesterday.md · {}\n');

  assert.equal(fs.readdirSync(logDir()).filter(f => f.endsWith('.md')).length, 2);
  assert.deepEqual(readEvents({}).map(e => e.target), ['data/guests/today.md', 'data/guests/yesterday.md']);
});

test('an actor is never blank, and nothing a caller sends can break the line', () => {
  freshRoot();
  const blank = logEvent({ type: 'store', actor: '', target: 'data/guests/a.md' });
  assert.equal(blank.actor, 'unknown', '§1: actor is never blank');

  // A newline or the separator inside a field would forge a second event on read.
  const nasty = logEvent({ type: 'move', actor: 'crys\ntal · fake', target: 'data/guests/b.md', detail: { reason: 'off · target' } });
  const lines = readLog().split('\n').filter(l => l.startsWith('- '));
  assert.equal(lines.length, 2, 'a field forged an extra line');
  assert.ok(lines.every(l => LINE.test(l)));
  // The separator inside the JSON tail survives, because the tail is re-joined and not split.
  assert.equal(readEvents({ target: 'data/guests/b.md' })[0].detail.reason, 'off · target');
  assert.ok(!nasty.actor.includes('\n'));
});

test('a torn last line costs one line, and the next append repairs the file', () => {
  freshRoot();
  logEvent({ type: 'store', actor: 'crystal', target: 'data/guests/a.md' });
  // Simulate a process killed mid-append: a line with no terminating newline.
  fs.appendFileSync(logFileFor(today()), '- 2026-08-19T09:00:00.000Z · scout-fb · store · data/guests/torn.md');
  logEvent({ type: 'store', actor: 'crystal', target: 'data/guests/c.md' });

  const lines = readLog().split('\n').filter(l => l.startsWith('- '));
  assert.equal(lines.length, 3, 'the repair fused two entries into one line');
  // The torn one is unparseable and dropped; the two real ones are intact.
  assert.deepEqual(readEvents({}).map(e => e.target), ['data/guests/c.md', 'data/guests/a.md']);
});

test('EVENT_TYPES is the documented vocabulary, and format/parse round-trip', () => {
  for (const t of ['store', 'update', 'merge', 'skip', 'move', 'archive', 'refused',
    'quarantine', 'accept', 'propose', 'decide', 'cache', 'claim', 'inbox', 'schema']) {
    assert.ok(EVENT_TYPES.includes(t), 'missing event type ' + t);
  }
  const ev = { ts: '2026-08-19T09:04:12.331Z', actor: 'scout-fb', type: 'store', target: 'data/guests/maria-santos.md', detail: { confidence: 0 } };
  assert.equal(formatEvent(ev), '- 2026-08-19T09:04:12.331Z · scout-fb · store · data/guests/maria-santos.md · {"confidence":0}');
  assert.deepEqual(parseEvent(formatEvent(ev)), ev);
  assert.equal(parseEvent('some prose a human typed into the log'), null);
});
