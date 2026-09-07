// The first-run interview — T16 step 3, GOAL.md gate 1, Law 9.
//
// "The workspace is built WITH the person, not shipped TO them." (docs/01_CANON.md Law 9.)
// This module is the machine half of that: it holds the questions, it persists each answer the
// MOMENT it is given, and it turns those answers into a proposed collection, a view, an identity
// and a first piece of ground. It decides nothing on the person's behalf that it could ask about,
// and it creates nothing that needs approval.
//
// WHAT IT DOES NOT DO, on purpose:
//   · It never writes a document under `data/`. That is records.mjs's job and nobody else's.
//   · It never calls saveCollection. A collection is a schema change, and every schema change is a
//     proposal (docs/02_DATA_MODEL.md §6) — the card goes to DECIDE and the human approves it there.
//     There is exactly one approval surface in this app and this file does not add a second.
//   · It never asks anybody to pick a view. Views are free and reversible (agent contract §4), so
//     views.mjs infers the type from the shape and it is saved without a card.
//
// WHERE THE ANSWERS LIVE: `.scout/intake.md`. Frontmatter carries the answers, the body carries the
// same thing as a readable transcript (Law 8 — nothing is hidden from a human who wants to look).
// It is written through store.mjs `writeMd`, so it is tmp+rename like every other write here: a
// half-written answer file would not error, it would silently read as an empty interview.
//
// ROUTES: GET /api/intake · POST /api/intake/answer · POST /api/intake/build

import fs from 'node:fs';
import path from 'node:path';
import { getStorageRoot, readMd, writeMd } from './store.mjs';
import { listCollectionIds, getCollection, AUTO_FIELDS } from './collections.mjs';
import { defaultView, saveView } from './views.mjs';
import { readMe, writeMe, saveGoal } from './memory.mjs';
import { saveTerritory } from './territory.mjs';
import { slugify } from './records.mjs';
// tasks.mjs does not import this module, so a static import is safe and there is no cycle.
import { saveAssistant, saveTask } from './tasks.mjs';
import { logEvent as logEventDefault } from './log.mjs';

const R = () => getStorageRoot();
export const intakePath = () => path.join(R(), '.scout', 'intake.md');
export const INTAKE_REL = '.scout/intake.md';

// The log is the DEFAULT, not a requirement — same shape as memory.mjs and territory.mjs, so there
// is one append path (docs/08 §1) and a test can still inject a fake.
const hooks = { logEvent: logEventDefault };
export function setIntakeHooks(next = {}) {
  if (typeof next.logEvent === 'function') hooks.logEvent = next.logEvent;
  return hooks;
}

export class IntakeError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

const nowIso = () => new Date().toISOString();

// ── the questions ──────────────────────────────────────────────────────────────────────────────
//
// They live HERE, on the server, and the screen renders whatever GET /api/intake hands it. Two
// copies of this wording — one in the API and one in the component — is the second implementation
// Law 10 exists to stop, and the wording is the product on this screen.
//
// Every question has an EXAMPLE ANSWER (T16 step 3). Nobody has ever answered "what do you do all
// day?" well without seeing one first, and the example is also how we teach the register: concrete,
// first-person, one sentence. The tone is frontend/Hire.jsx's — a question a person asks a person.
//
//   required   the three answers a workspace cannot be built without. Everything else may be left
//              blank and the person still moves forward: the button never disables on an optional
//              question, so there is exactly ONE way forward on every screen (Law 2, altitude 1).
//   lines      1 → a single-line field. More → a box. Nothing else branches on it.
//   becomes    what this answer turns into, in plain words. Shown as the small print, so nobody is
//              ever answering a question whose purpose is hidden from them.
export const QUESTIONS = [
  {
    key: 'name',
    question: 'First — what should I call you?',
    example: 'Crystal',
    hint: 'Your first name is enough.',
    becomes: 'So I know whose workspace this is.',
    required: true,
    lines: 1,
  },
  {
    key: 'work',
    question: 'What do you actually do all day?',
    example: 'I produce a Philippine podcast about work and family. Most of my week goes on finding people worth interviewing.',
    hint: 'Say it the way you would say it to somebody on their first day.',
    becomes: 'This is the first thing I read every time I wake up.',
    required: true,
    lines: 3,
  },
  {
    key: 'win',
    question: 'How do you know a day went well?',
    example: 'Someone replies and agrees to a call.',
    hint: 'The observable thing. A reply, a booked call, a signed order.',
    becomes: 'So I bring you wins and not activity.',
    required: false,
    lines: 2,
  },
  {
    key: 'chasing',
    question: 'What are you chasing right now, and by when?',
    example: 'Six guests with a hazing story, by the end of August.',
    hint: 'One is enough. You can add more later.',
    becomes: 'So I know what is urgent and what can wait.',
    required: false,
    lines: 2,
  },
  {
    key: 'thing',
    question: 'What do you want me to keep track of for you?',
    example: 'People who might be good guests',
    hint: 'The thing there will be a lot of, that you have to judge one at a time.',
    becomes: 'This becomes your first list.',
    required: true,
    lines: 1,
  },
  {
    key: 'know',
    question: 'What would you want to know about each one?',
    example: 'Their name, where I found them, a way to reach them, and how strong their story is out of ten.',
    hint: 'List them the way they come to you. Commas are fine.',
    becomes: 'These become the columns on that list.',
    required: true,
    lines: 3,
  },
  {
    key: 'where',
    question: 'Where do these usually come from?',
    example: 'Facebook groups for nurses, and groups for overseas workers.',
    hint: 'I will ask you first before I go anywhere you have not named.',
    becomes: 'This becomes the ground I am allowed to work.',
    required: false,
    lines: 2,
  },
];

export const QUESTION_KEYS = QUESTIONS.map(q => q.key);
const questionFor = key => QUESTIONS.find(q => q.key === key) || null;

// ── the plain-language field vocabulary ────────────────────────────────────────────────────────
//
// The labels are frontend/AddField.jsx's KINDS, verbatim. That file is where a person already meets
// this vocabulary ("Words", "A number", "One of a few choices"), and a second wording for the same
// fourteen things would mean the app calls a column two different names on two screens. AddField
// exports only its component, so this is a mirror rather than an import — if KINDS is ever
// exported, delete this and import it.
//
// The `type` on the right comes from docs/02_DATA_MODEL.md §2 via backend/collections.mjs
// FIELD_TYPES, and nowhere else.
export const PLAIN_TYPE = {
  text: 'Words',
  number: 'A number',
  select: 'One of a few choices',
  multiselect: 'Any number of tags',
  status: 'A stage',
  date: 'A date',
  checkbox: 'Yes or no',
  url: 'A link',
  email: 'An email address',
  phone: 'A phone number',
  relation: 'A link to another record',
  file: 'A file',
  actor: 'Who is on it',
};

// ── turning one phrase into one field ──────────────────────────────────────────────────────────
//
// The person answers "their name, where I found them, a way to reach them, how strong their story
// is out of ten" and gets four columns. This is a keyword read of their own words, not an
// inference engine: every rule below is a word a person actually used, and anything unrecognised
// becomes plain `text`, which is the type that is never wrong. The LABEL is always their phrase —
// the machine picks the type, the person keeps the name.
const PHRASE_SPLIT = /\s*(?:[,;•\n]|\band\b|\balso\b|\bplus\b)\s*/i;

const RULES = [
  // `name` first: "their name" is the title of the document, not a column beside it.
  { re: /\b(name|who they are|who it is|title)\b/i, key: 'name', type: 'text' },
  { re: /\be-?mails?\b/i, key: 'email', type: 'email' },
  { re: /\b(phone|mobile|whatsapp|viber|number to call|contact number)\b/i, key: 'phone', type: 'phone' },
  { re: /\b(links?|urls?|web ?sites?|profiles?|pages?|handles?)\b/i, key: 'link', type: 'url' },
  { re: /\b(photos?|pictures?|screenshots?|images?|videos?|files?|pdfs?|cvs?|r[eé]sum[eé]s?|portfolios?|attachments?)\b/i, key: 'files', type: 'file', extra: { many: true } },
  { re: /\b(where|found|from|source|came from|which group|channel|origin)\b/i, key: 'found_in', type: 'text' },
  { re: /\b(scores?|ratings?|out of ten|out of 10|how strong|how good|how likely|how big|how many|counts?|followers?|prices?|costs?|budgets?|amounts?|salary|fee)\b/i, type: 'number' },
  { re: /\b(when|dates?|deadline|due|how long|last|since|posted|expires?)\b/i, type: 'date' },
  { re: /\b(whether|if they|yes or no|on camera|available|willing|agreed|paid|done|replied|confirmed)\b/i, type: 'checkbox' },
];

// Words that carry no meaning in a column name. Stripped from the KEY only — the label keeps them.
const KEY_STOP = new Set([
  'a', 'an', 'the', 'their', 'they', 'them', 'its', 'his', 'her', 'my', 'our', 'i', 'we',
  'is', 'are', 'was', 'be', 'been', 'has', 'have', 'had', 'do', 'does', 'did', 'can', 'could',
  'of', 'to', 'for', 'from', 'with', 'by', 'on', 'in', 'at', 'that', 'this', 'it', 'and', 'or',
  'how', 'what', 'when', 'where', 'who', 'whether', 'if', 'much', 'many', 'good', 'strong', 'out',
]);

// A field key is lower_snake_case starting with a letter (collections.mjs validateField). Three
// significant words at most: a key nobody can read is as bad as a key that collides.
function keyFor(phrase, fallback = 'note') {
  const words = String(phrase || '').toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter(Boolean);
  const kept = words.filter(w => !KEY_STOP.has(w)).slice(0, 3);
  const key = (kept.length ? kept : words.slice(0, 2)).join('_').replace(/^[^a-z]+/, '');
  return /^[a-z][a-z0-9_]*$/.test(key) ? key : fallback;
}

const sentenceCase = s => {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

// One phrase → one field, or null when it folds into the primary field.
function fieldForPhrase(phrase) {
  const text = String(phrase || '').trim().replace(/^(and|also|plus)\s+/i, '');
  if (!text) return null;
  const rule = RULES.find(r => r.re.test(text));
  if (rule && rule.key === 'name') return null;            // that is the document's own title

  const type = (rule && rule.type) || 'text';
  const field = { key: rule && rule.key ? rule.key : keyFor(text), type, label: sentenceCase(text) };

  if (rule && rule.extra) Object.assign(field, rule.extra);
  if (type === 'number') {
    // `display` is why there is no separate "score" or "rating" type (docs/02 §2). A phrase that
    // says "out of ten" is a bar with a stated ceiling; anything else is just a figure.
    const outOf = text.match(/out of\s+(ten|10|five|5|100)/i);
    if (outOf || /\b(scores?|ratings?|how strong|how good|how likely)\b/i.test(text)) {
      field.display = 'bar';
      field.min = 1;
      field.max = outOf ? ({ ten: 10, five: 5 }[outOf[1].toLowerCase()] || Number(outOf[1]) || 10) : 10;
    }
  }
  if (type === 'date') field.display = 'freshness';        // Law 3 — everything shows its age
  return field;
}

// ── the always-fields ──────────────────────────────────────────────────────────────────────────
//
// Three, and each one earns its place:
//   name      every collection has exactly one `primary: true` field — the document's title.
//   status    the gate. `shortlist` MUST be one of the options and MUST sit where an agent may
//             reach it: records.mjs AGENT_MAX_STAGE indexes into this list, and everything after
//             `shortlist` is a stage only a human can move a record to (Law 4).
//             The vocabulary is the seeded workspace's, so there is one stage language in the app.
//   found_in  the ONE field territory.mjs `statsIndex` reads to attribute a find to a place. Drop
//             it and no territory ever scores, which is gate 5. Only added when the person named
//             somewhere for it to point at.
const STATUS_FIELD = {
  key: 'status',
  type: 'status',
  gate: true,
  options: [
    { value: 'needs-review', colour: 'var(--warn)', group: 'todo' },
    { value: 'shortlist', colour: 'var(--ok)', group: 'todo' },
    { value: 'contacted', colour: 'var(--marked)', group: 'active' },
    { value: 'won', colour: 'var(--ok)', group: 'done' },
    { value: 'archived', colour: 'var(--fg-faint)', group: 'done' },
  ],
};

// ── naming the collection ──────────────────────────────────────────────────────────────────────
// "People who might be good guests" → id `guest`, label "People who might be good guests".
// The head noun of an English noun phrase is normally its first significant word — except when
// that word is a container ("people", "things", "a list of"), and then the word that matters is
// the last one. Both cases are common in the answers this question gets.
const LABEL_STOP = new Set([
  'a', 'an', 'the', 'my', 'our', 'all', 'any', 'some', 'every', 'each', 'of', 'for', 'to', 'in',
  'on', 'with', 'that', 'which', 'who', 'whom', 'whose', 'might', 'may', 'could', 'would', 'be',
  'is', 'are', 'was', 'i', 'me', 'we', 'they', 'them', 'and', 'or', 'good', 'new', 'want', 'need',
  'keep', 'track', 'about', 'possible', 'potential',
]);
const GENERIC_HEAD = new Set([
  'people', 'person', 'thing', 'things', 'stuff', 'list', 'lists', 'item', 'items', 'record',
  'records', 'entry', 'entries', 'someone', 'anyone', 'everyone', 'ones', 'one',
]);

function singular(w) {
  if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + 'y';
  if (/(sses|shes|ches|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w) && !/(ss|us|is|as)$/.test(w)) return w.slice(0, -1);
  return w;
}

export function collectionIdFrom(label, taken = []) {
  const words = String(label || '').toLowerCase().replace(/[^a-z0-9\s-]+/g, ' ').split(/\s+/).filter(Boolean);
  const kept = words.filter(w => !LABEL_STOP.has(w));
  let head = kept[0] || words[0] || '';
  if (GENERIC_HEAD.has(head) && kept.length > 1) head = kept[kept.length - 1];
  let id = slugify(singular(head)).slice(0, 32).replace(/^-+|-+$/g, '');
  if (!/^[a-z][a-z0-9-]*$/.test(id)) id = 'record';
  if (!taken.includes(id)) return id;
  for (let n = 2; n < 50; n++) if (!taken.includes(id + '-' + n)) return id + '-' + n;
  return id + '-' + Date.now().toString(36);
}

// ── naming the ground ──────────────────────────────────────────────────────────────────────────
// `kind` is what memory.mjs `handleOf()` renders in the hot cache — `#group/nurses-ph`, `r/nursing`,
// `@handle`. Reading it off the person's own words is what makes the cache read like their world
// instead of like a database.
const KINDS = [
  { re: /\bfacebook\b[^,]*\bgroups?\b|\bfb groups?\b|\bgroups? on facebook\b/i, kind: 'facebook-group', strip: /\b(facebook|fb|groups?|on|for|in|about)\b/gi },
  { re: /\b(subreddits?|reddit)\b/i, kind: 'subreddit', strip: /\b(subreddits?|reddit|on|for|in|about|r\/)\b/gi },
  { re: /\b(hashtags?)\b|#[a-z0-9]/i, kind: 'hashtag', strip: /\b(hashtags?|on|for|in|about)\b|#/gi },
  // No bare `x` alternative: a one-letter word matches far too much English to be worth the one
  // platform it names.
  { re: /\b(instagram|tiktok|twitter|linkedin|youtube)\b|\bx\.com\b|@[a-z0-9._]/i, kind: 'account', strip: /\b(accounts?|profiles?|pages?|on|for|in|about)\b|@/gi },
];
const LEADING_FILLER = /^(?:and|or|also|plus|mostly|mainly|usually|from|in|on|at|the|a|an|some|for)\s+/i;
// "groups for overseas workers" is one place called "overseas workers", not a place called
// "groups". Only applied when no platform matched, so `#group/nurses-ph` keeps its own stripping.
const CONTAINER = /^(?:groups?|pages?|communities|forums?|boards?|sites?|websites?|lists?|channels?)\b\s*(?:for|in|about|of|on)?\s*/i;

export function territoriesFrom(where) {
  const raw = String(where || '').trim();
  if (!raw) return [];
  const out = [];
  for (let phrase of raw.split(/\s*(?:[,;\n]|\band\b)\s*/i)) {
    phrase = String(phrase || '').trim().replace(/\.$/, '');
    while (LEADING_FILLER.test(phrase)) phrase = phrase.replace(LEADING_FILLER, '');
    if (!phrase) continue;
    const hit = KINDS.find(k => k.re.test(phrase));
    let stem = hit ? phrase.replace(hit.strip, ' ') : phrase.replace(CONTAINER, '');
    stem = stem.replace(/\s+/g, ' ').trim();
    while (LEADING_FILLER.test(stem)) stem = stem.replace(LEADING_FILLER, '');
    const id = slugify(stem || phrase).slice(0, 40).replace(/^-+|-+$/g, '');
    if (!id || id === 'untitled') continue;
    if (out.some(t => t.id === id)) continue;
    out.push({
      id,
      label: sentenceCase(phrase),
      // `untried`, always. The person told us where they LOOK; the agent has never worked it and is
      // not a member of anything. It lands in the cache's NEVER TRIED and the agent must ask before
      // it goes there — Law 4, on day one.
      access: 'untried',
      ...(hit ? { kind: hit.kind } : {}),
    });
    if (out.length >= 3) break;
  }
  return out;
}

// ── the first goal ─────────────────────────────────────────────────────────────────────────────
//
// "What are you chasing right now, and by when?" is the one question whose answer contains a
// NUMBER and a DATE, and until 2026-09-06 it only ever became a paragraph in me.md. So the hot
// cache's `## GOALS` section was empty in every workspace this interview has ever built — the one
// memory object with its own clock, the thing that puts a behind-schedule goal at the top of
// TODAY, and it did not exist because nothing in the app could create one.
//
// Everything below is READ OFF HER OWN SENTENCE and nothing is invented. The parsing is
// deliberately conservative: a number it is not sure about is no number, and a date it is not sure
// about is no date. **A goal with a label and no number is better than no goal** — it still names
// what she is chasing in the file her assistants read every morning, and both are one edit away on
// the GOALS screen.

// Spelled-out numbers, because that is how people write this answer: the question's own example is
// "Six guests with a hazing story, by the end of August." A digit-only reader finds nothing in it.
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, twentyfive: 25, thirty: 30, forty: 40, fifty: 50, hundred: 100,
};
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const monthIndex = word => MONTH_NAMES.findIndex(m => m.startsWith(String(word || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 3)));
const iso = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const lastDayOf = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

// The year nobody wrote down. "by the end of August" means the next end of August — this year if
// it has not happened yet, next year if it has. Guessing backwards would ship a goal that is
// already overdue on the day she created it.
function resolveYear(month, day, now) {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const today = Date.UTC(y, d.getUTCMonth(), d.getUTCDate());
  return Date.UTC(y, month, day) >= today ? y : y + 1;
}

// → { deadline, match } · `match` is the exact substring consumed, so the number reader below
// never mistakes the `2026` of a date for the target.
export function deadlineFrom(text, now = Date.now()) {
  const s = String(text || '');
  let m;

  // 1. a written-out ISO date — unambiguous, and what an agent would send
  if ((m = s.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/))) {
    const mo = Number(m[2]) - 1, d = Number(m[3]);
    if (mo >= 0 && mo <= 11 && d >= 1 && d <= 31) return { deadline: iso(Number(m[1]), mo, d), match: m[0] };
  }
  // 2. "the end of August" / "end of Aug 2027"
  if ((m = s.match(new RegExp('\\bend of (?:the )?' + MONTH_RE + '(?:\\s+(\\d{4}))?\\b', 'i')))) {
    const mo = monthIndex(m[1]);
    if (mo >= 0) {
      const y = m[2] ? Number(m[2]) : resolveYear(mo, lastDayOf(new Date(now).getUTCFullYear(), mo), now);
      return { deadline: iso(y, mo, lastDayOf(y, mo)), match: m[0] };
    }
  }
  // 3. "the end of the month" / "the end of the year" — the only two bare ones worth reading
  if ((m = s.match(/\bend of (?:the )?month\b/i))) {
    const d = new Date(now);
    return { deadline: iso(d.getUTCFullYear(), d.getUTCMonth(), lastDayOf(d.getUTCFullYear(), d.getUTCMonth())), match: m[0] };
  }
  if ((m = s.match(/\bend of (?:the )?year\b/i))) {
    return { deadline: iso(new Date(now).getUTCFullYear(), 11, 31), match: m[0] };
  }
  // 4. "30 August" / "30th Aug 2026"
  if ((m = s.match(new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + MONTH_RE + '(?:\\s+(\\d{4}))?\\b', 'i')))) {
    const d = Number(m[1]), mo = monthIndex(m[2]);
    if (mo >= 0 && d >= 1 && d <= lastDayOf(2024, mo)) {
      return { deadline: iso(m[3] ? Number(m[3]) : resolveYear(mo, d, now), mo, d), match: m[0] };
    }
  }
  // 5. "August 30" / "Aug 30th, 2026"
  if ((m = s.match(new RegExp('\\b' + MONTH_RE + '\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b', 'i')))) {
    const mo = monthIndex(m[1]), d = Number(m[2]);
    if (mo >= 0 && d >= 1 && d <= lastDayOf(2024, mo)) {
      return { deadline: iso(m[3] ? Number(m[3]) : resolveYear(mo, d, now), mo, d), match: m[0] };
    }
  }
  return { deadline: null, match: null };
}

// The number she is chasing. 1–3 digits only, so a bare year left over from a date she wrote in
// some form this reader did not recognise can never become a target of 2026.
export function targetFrom(text) {
  const s = String(text || '');
  const digits = s.match(/\b(\d{1,3})\b/);
  if (digits) return Number(digits[1]);
  const words = s.toLowerCase().match(new RegExp('\\b(' + Object.keys(NUMBER_WORDS).join('|') + ')\\b'));
  return words ? NUMBER_WORDS[words[1]] : null;
}

// The rollup this goal counts itself with: the collection's own gate field at its `done` group.
// That is the same declaration the board columns and the promotion gate read (docs/02 §2), so a
// workspace that renames `won` to `signed` moves its goal progress with no code change.
// An archive-shaped done value is skipped — a rejected record is not progress (Law 5 keeps it, it
// does not count it).
function countFor(schema) {
  const gate = (schema.fields || []).find(f => f && f.gate);
  const done = (gate && gate.options || [])
    .filter(o => o && typeof o === 'object' && o.group === 'done')
    .map(o => String(o.value))
    .filter(v => !/^archiv/i.test(v));
  if (!gate || !done.length) return null;
  return { path: (schema.query && schema.query.path) || ('data/' + schema.id + '/**'), where: { [gate.key]: done[0] } };
}

// → { id, patch } for saveGoal, or null when she left the question blank.
export function goalFrom(chasing, schema = null, now = Date.now()) {
  const label = String(chasing || '').trim().replace(/\s+/g, ' ');
  if (!label) return null;
  const id = slugify(label).slice(0, 60) || 'first-goal';

  const { deadline, match } = deadlineFrom(label, now);
  // Read the number from what is LEFT once the date has been taken out of the sentence.
  const target = targetFrom(match ? label.replace(match, ' ') : label);

  const patch = { label: label.replace(/\.$/, '') };
  if (deadline) patch.deadline = deadline;
  if (target != null) patch.target = target;
  const count = schema ? countFor(schema) : null;
  if (count) patch.count = count;
  patch.body = 'From the first-run interview: "' + label + '"\n\n' +
    (count
      ? 'Progress is counted from your records — never typed in here. Change the number or the date and your assistants change what they do next.'
      : 'Set a number and a date on the GOALS screen and your assistants will work the closest deadline first.');
  return { id, patch };
}

// ── me.md, in their own words ──────────────────────────────────────────────────────────────────
//
// Prose, first person, their sentences — not a form dump. docs/03_MEMORY.md §1: identity is
// human-owned and goes into the hot cache IN FULL, so this is the one place in the app where the
// writing itself is the feature. The register is `workspace/me.md`: short paragraphs, concrete,
// nothing hedged.
const period = s => {
  const t = String(s || '').trim();
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : t + '.';
};

export function meFrom(answers = {}) {
  const name = String(answers.name || '').trim();
  const work = String(answers.work || '').trim();
  const win = String(answers.win || '').trim();
  const chasing = String(answers.chasing || '').trim();
  const thing = String(answers.thing || '').trim();
  const know = String(answers.know || '').trim();
  const where = String(answers.where || '').trim();

  const open = [name ? "I'm " + name + '.' : '', period(work)].filter(Boolean).join(' ');
  const parts = [open];

  if (win) parts.push('## What a win is\n\n' + period(win));
  if (chasing) parts.push("## What I'm chasing\n\n" + period(chasing));
  if (thing) {
    const line = know
      ? period(sentenceCase(thing)) + ' For each one I want to know ' + period(know.replace(/^their\s+/i, 'their '))
      : period(sentenceCase(thing));
    parts.push("## What I'm keeping track of\n\n" + line);
  }
  if (where) parts.push('## Where they come from\n\n' + period(where));
  parts.push('## Learned\n\n_Your assistant appends here after each session. Correct anything that is wrong._');

  return {
    // `name` only. NEVER `owner`: memory.mjs `isAgentActor` reads owner → created_by → name in that
    // order, and an `owner` that is not the actor the UI sends would lock the person out of writing
    // their own identity with a 403 the next day. `created_by` is stamped by writeMe from the
    // actor, which is the human default everywhere in the UI.
    data: { name: name || undefined },
    body: parts.filter(Boolean).join('\n\n'),
  };
}

// ── the plan ───────────────────────────────────────────────────────────────────────────────────
//
// PURE. Reads the collection list (to avoid an id clash) and nothing else; writes nothing. That is
// what lets GET /api/intake hand the screen the exact read-back the person is about to approve,
// before a single byte has been written.
export function proposeWorkspace(answers = {}) {
  const thing = String(answers.thing || '').trim();
  if (!thing) throw new IntakeError('there is nothing to keep track of yet — answer "' + questionFor('thing').question + '" first');

  const label = sentenceCase(thing.replace(/\.$/, '')).slice(0, 60);
  const id = collectionIdFrom(label, listCollectionIds());

  const primary = { key: 'name', type: 'text', required: true, primary: true, label: 'Name' };
  const fields = [primary];
  // AUTO_FIELDS are on every document already and collections.mjs refuses a schema that declares
  // one — "when it was created" is a perfectly natural answer to the columns question and it
  // keyifies straight onto `created`, so the collision is reserved away rather than discovered as
  // a 400 on the card the person just approved.
  const seen = new Set(['name', 'status', 'id', 'type', 'slug', 'path', 'body', ...AUTO_FIELDS]);

  for (const phrase of String(answers.know || '').split(PHRASE_SPLIT)) {
    const f = fieldForPhrase(phrase);
    if (!f) continue;
    let key = f.key;
    // A column somebody asked for is never silently dropped for a name clash — it is numbered.
    for (let n = 2; seen.has(key) && n < 20; n++) key = f.key + '_' + n;
    if (seen.has(key)) continue;
    seen.add(key);
    fields.push({ ...f, key });
    if (fields.length >= 8) break;      // the primary plus seven. A first list nobody can read is worse than a short one.
  }

  const territories = territoriesFrom(answers.where);
  if (territories.length && !seen.has('found_in')) {
    seen.add('found_in');
    fields.push({ key: 'found_in', type: 'text', label: 'Where it came from' });
  }
  // A fresh copy every time — the options array is nested, and a module-level object handed out by
  // reference is one careless caller away from every workspace sharing one status vocabulary.
  fields.push({ ...STATUS_FIELD, options: STATUS_FIELD.options.map(o => ({ ...o })) });

  const schema = {
    id,
    label,
    // A collection is a saved query, not a folder (docs/02 §1). The path alone is unambiguous, so
    // no tag is needed — the same reasoning group.md records in the seeded workspace.
    query: { path: 'data/' + id + '/**' },
    // `all` is the id views.mjs `defaultView()` generates, so this resolves whether or not the
    // saved view file has landed yet.
    default_view: 'all',
    fields,
    description: 'Built from the first-run interview on ' + nowIso().slice(0, 10) + '. ' + label + '.',
  };

  // Views are free (agent contract §4) and the type comes off the SHAPE — a new person is never
  // asked to pick one. `defaultView` only reads `fields`, so the proposed schema is a legal input.
  const view = defaultView(schema);

  const quotes = [
    'You said you keep track of: "' + thing + '"',
    answers.know ? 'You said you want to know: "' + String(answers.know).trim() + '"' : null,
    'That is ' + (fields.length - 2) + ' ' + (fields.length - 2 === 1 ? 'thing' : 'things') + ' to keep on each one, plus where it has got to.',
    answers.where ? 'You said they come from: "' + String(answers.where).trim() + '"' : null,
  ].filter(Boolean);

  // The card the human decides on. Its shape is exactly what POST /api/collections/propose builds,
  // because that is the door the screen posts it to — one queue, one accept path (docs/08 §8).
  const card = {
    schema,
    why: 'You told me you keep track of ' + label.toLowerCase().replace(/\.$/, '') +
      ', so this is where they will live — one markdown file each, with a column for everything you said you want to know.',
    evidence: quotes,
  };

  return {
    schema,
    view,
    card,
    territories,
    me: meFrom(answers),
    // The read-back, in the person's own words. `plain` is the AddField vocabulary and is deliberately
    // NOT on the field object — collections.mjs validateField rejects any key it does not know.
    fields: fields.map(f => ({
      key: f.key,
      label: f.label || f.key,
      plain: PLAIN_TYPE[f.type] || 'Words',
      gate: !!f.gate,
    })),
  };
}

// ── the answer file ────────────────────────────────────────────────────────────────────────────

function readIntake() {
  try {
    const { data, content } = readMd(intakePath());
    return { data: data || {}, body: String(content || '') };
  } catch {
    // Readers swallow parse errors by design. An unreadable intake file means "not started" —
    // which is recoverable — rather than an error screen on somebody's first ten seconds.
    return { data: {}, body: '' };
  }
}

// The body is the transcript: the same answers, readable, in the order they were asked (Law 8).
function transcript(answers) {
  const out = [];
  for (const q of QUESTIONS) {
    if (!(q.key in answers)) continue;
    out.push('## ' + q.question);
    out.push(String(answers[q.key] || '').trim() || '_(left blank)_');
  }
  return out.join('\n\n') + '\n';
}

function writeIntake(data, answers) {
  writeMd(intakePath(), { type: 'intake', ...data }, transcript(answers));
}

// ── is this somebody's first run? ──────────────────────────────────────────────────────────────
//
// True when there is no me.md AND no collections. Both halves matter: somebody who already has a
// workspace must never be interviewed again, and somebody who deleted their one collection but
// still has an identity is not starting over either.
//
// "No me.md" includes the workspace TEMPLATE's placeholder, which ships with `name: __NAME__` and a
// body that says "(not set yet — your assistant will ask you)". A file that exists but says nothing
// is not an identity, and treating it as one would mean the template ships an app that never
// interviews anybody.
export function identityWritten() {
  const me = readMe();
  const name = String(me.data.name || '').trim();
  if (name && !name.startsWith('__')) return true;
  const body = String(me.body || '').trim();
  if (!body) return false;
  return !/not set yet/i.test(body);
}

export function isFirstRun() {
  return !identityWritten() && listCollectionIds().length === 0;
}

// ── the view, once the collection exists ───────────────────────────────────────────────────────
//
// A view cannot be saved before its collection is on disk, and the collection only lands when the
// human accepts the card in DECIDE. So `build` records the intent and this flushes it the next time
// anybody asks about the interview. Nothing is broken in between: views.mjs `listViews()` already
// generates the same default view on read for a collection that has none saved — this only makes
// it a file, so it travels with the vault and an agent can read it.
export function settleWorkspace() {
  const { data } = readIntake();
  const pending = data.pending_view;
  const cid = pending && String(pending.collection || '');
  if (!cid) return null;
  const collection = getCollection(cid);
  if (!collection || collection.broken) return null;
  let view = null;
  try {
    view = defaultView(collection);
    saveView(cid, view);
  } catch {
    return null;                      // a view that will not save is still only a view
  }
  writeIntake({ ...data, pending_view: null, view_created: nowIso(), collection: cid }, data.answers || {});
  hooks.logEvent({ type: 'schema', actor: 'scout', target: '.scout/views/' + cid + '.json', detail: { view: view.id, type: view.type, approval: 'not required' } });
  return { collection: cid, view };
}

// ── state ──────────────────────────────────────────────────────────────────────────────────────

export function interviewState() {
  const { data } = readIntake();
  const answers = (data.answers && typeof data.answers === 'object') ? data.answers : {};
  // "Answered" means the key exists, not that it is non-empty — an optional question somebody
  // deliberately left blank must not put them back on it when they reopen the window.
  const step = QUESTIONS.findIndex(q => !(q.key in answers));
  const at = step < 0 ? QUESTIONS.length : step;

  let plan = null;
  let planError = null;
  if (at >= QUESTIONS.length) {
    try { plan = proposeWorkspace(answers); } catch (e) { planError = e.message; }
  }

  return {
    firstRun: isFirstRun(),
    questions: QUESTIONS,
    answers,
    step: at,
    total: QUESTIONS.length,
    complete: at >= QUESTIONS.length,
    built: data.built || null,
    collection: data.collection || (data.pending_view && data.pending_view.collection) || null,
    path: INTAKE_REL,
    plan,
    planError,
    started: data.started || null,
    updated: data.updated || null,
  };
}

// ── one answer, written the moment it is given ─────────────────────────────────────────────────
//
// This is the whole of "nothing is lost". Closing the window between question three and four costs
// nothing: the file on disk already has three answers and GET /api/intake resumes on four.
export function saveAnswer(key, value, { actor = 'crystal' } = {}) {
  const q = questionFor(String(key || ''));
  if (!q) throw new IntakeError('no interview question called "' + key + '". The questions are: ' + QUESTION_KEYS.join(' · '));
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (q.required && !text) throw new IntakeError(q.question + ' — this one I do need an answer to.');

  const { data } = readIntake();
  const answers = { ...(data.answers && typeof data.answers === 'object' ? data.answers : {}), [q.key]: text };
  writeIntake({
    ...data,
    started: data.started || nowIso(),
    updated: nowIso(),
    answered_by: actor,
    answers,
  }, answers);
  hooks.logEvent({ type: 'update', actor, target: INTAKE_REL, detail: { question: q.key } });
  return interviewState();
}

// ── build ──────────────────────────────────────────────────────────────────────────────────────
//
// Writes the two things that need no approval — the identity and the ground — and hands back the
// card for the one thing that does. It does NOT create the collection, and it does not accept
// anything on the person's behalf: the screen posts `card` to POST /api/collections/propose and it
// lands in DECIDE with every other decision in the app.
//
// Idempotent: run it twice and me.md is rewritten with the same words, the territory is upserted,
// and the pending view is flushed if the collection has since been approved.
export function buildWorkspace({ actor = 'crystal' } = {}) {
  const { data } = readIntake();
  const answers = (data.answers && typeof data.answers === 'object') ? data.answers : {};
  for (const q of QUESTIONS) {
    if (q.required && !String(answers[q.key] || '').trim()) {
      throw new IntakeError('I still need one answer: ' + q.question);
    }
  }

  const plan = proposeWorkspace(answers);

  // Identity — through memory.mjs, the only writer of me.md. An agent actor is refused there with a
  // 403 and that refusal is correct: this screen is a human answering questions about themselves.
  const me = writeMe(plan.me.body, plan.me.data, { actor });

  // Ground — through territory.mjs, the only writer of `territory/`. Everything computed
  // (finds/wins/hit_rate) is stripped there; nothing here ever sets a score by hand.
  const territory = plan.territories.map(t => {
    const { id, ...patch } = t;
    return saveTerritory(id, patch, { actor });
  });

  // The first goal, from her answer to "what are you chasing right now, and by when?". Written
  // AFTER writeMe on purpose: memory.mjs decides who is an agent from me.md's owner, so identity
  // has to exist before anything else human-owned is written or the actor cannot be recognised.
  // Never fatal — a goal that will not save costs her a card on the GOALS screen, not the
  // workspace she just built.
  let goal = null;
  const first = goalFrom(answers.chasing, plan.schema);
  if (first) {
    try { goal = saveGoal(first.id, first.patch, { actor }); }
    catch (e) { hooks.logEvent({ type: 'refused', actor, target: 'goals/' + first.id + '.md', detail: { why: e.message } }); }
  }

  writeIntake({
    ...data,
    built: nowIso(),
    built_by: actor,
    pending_view: { collection: plan.schema.id },
    updated: nowIso(),
    answers,
  }, answers);

  hooks.logEvent({
    type: 'store', actor, target: INTAKE_REL,
    detail: { built: plan.schema.id, fields: plan.schema.fields.length, territory: territory.length, goal: goal ? goal.id : null },
  });

  // If the collection somehow already exists (a re-run after approval), the view lands now.
  const settled = settleWorkspace();

  return {
    me,
    territory,
    goal,
    schema: plan.schema,
    view: settled ? settled.view : plan.view,
    card: plan.card,
    fields: plan.fields,
    state: interviewState(),
  };
}

// ── routes ─────────────────────────────────────────────────────────────────────────────────────
// registerIntakeRoutes(app, { logEvent }) — `logEvent` is optional and defaults to the real one.

export function registerIntakeRoutes(app, deps = {}) {
  setIntakeHooks(deps || {});
  const actorOf = req => String((req.body && req.body.actor) || (req.query && req.query.actor) || 'crystal');
  const fail = (res, e) => res.status(e.status || 400).json({ error: e.message });

  app.get('/api/intake', (_req, res) => {
    settleWorkspace();
    res.json(interviewState());
  });

  app.post('/api/intake/answer', (req, res) => {
    try {
      const { key, value } = req.body || {};
      res.json(saveAnswer(key, value, { actor: actorOf(req) }));
    } catch (e) { fail(res, e); }
  });

  app.post('/api/intake/build', (req, res) => {
    try {
      const built = buildWorkspace({ actor: actorOf(req) });
      // The workspace exists; now give it a team of one and something for that team to do, so the
      // screen she lands on has work on it rather than an empty list. Never fatal: a failure here
      // costs her the head start, not the workspace she just built.
      let started = { assistant: null, tasks: [] };
      try { started = startFirstWork(built.state?.answers || {}, { actor: actorOf(req) }); }
      catch (e) { started = { assistant: null, tasks: [], error: e.message }; }
      res.json({ ...built, started });
    } catch (e) { fail(res, e); }
  });
}

// Exported for the same reason store.mjs exports its own helpers: a test that has to reimplement
// where a file lives is testing its own copy of the answer.

// ── the last step: give her a team of one, and something for it to do ─────────────────────────
//
// GOAL.md gate 1 ends "…and produces a first real finding before the session ends". Scout does not
// run agents — that is the design (docs/04_AGENT_CONTRACT.md §1), so this module cannot conjure a
// finding, and a seeded fake one would be worse than an empty list: the first thing she ever
// judged would be a lie.
//
// What it CAN do is make sure the finding has somewhere to arrive from. The interview ends with an
// assistant hired against her own words and one task queued per piece of ground she named — so the
// first screen after the interview has work on it, and the first agent through any of the three
// doors has a queue to claim from. That is the honest half of the gate, and it is the half the app
// owns.
export function startFirstWork(answers = {}, { actor = 'crystal' } = {}) {
  const a = { ...(readIntake().data.answers || {}), ...answers };
  const thing = String(a.thing || 'people worth your time').trim();
  const work = String(a.work || '').trim();
  const territories = territoriesFrom(a.where);
  // `collection` is stamped only when she ACCEPTS the card (settleWorkspace); the id exists from the
  // moment build() proposed it, in `pending_view`. Reading only the accepted one hired her first
  // assistant scoped to NOTHING — its brief read "collections: none named — ask before you write
  // into one", so the very first run of the very first assistant had nowhere to put what it found,
  // and the finding gate 1 asks for could not arrive. interviewState() has always read both (§state);
  // this now does too. If she rejects the card, the scope names a collection that does not exist —
  // which is exactly the case the brief already tells the assistant to ask about.
  const intakeData = readIntake().data;
  const collection = intakeData.collection || (intakeData.pending_view && intakeData.pending_view.collection) || null;

  // One assistant, named for the job rather than the technology — "creating one must feel like
  // hiring, not configuring" (T12 step 6).
  const assistant = saveAssistant('scout', {
    name: 'Scout',
    job: 'Looks for ' + thing.toLowerCase() + ' in the places you named, and writes down why each one is worth your time.',
    scope: { collections: collection ? [collection] : [], territory: territories.map(t => t.id) },
    // The VALUE, not the label. frontend/Assistants.jsx SCHEDULE_OPTIONS is the vocabulary
    // (continuous · daily · weekly · manual) and dispatch.mjs reads it; writing the label here made
    // HIRE render a blank selection over this assistant and left the schedule un-actionable.
    schedule: 'daily',
    status: 'idle',
  }, { actor });

  // One task per piece of ground, in her language, unassigned — whoever is free picks it up.
  const project = 'first-week';
  const tasks = territories.slice(0, 3).map(t => saveTask(project, slugify('sweep ' + t.id), {
    label: 'Look through ' + t.label + ' for ' + thing.toLowerCase(),
    status: 'open',
    territory: t.id,
    needs_human: false,
    note: work ? 'What she does all day: ' + work : '',
  }, { actor }));

  hooks.logEvent({
    type: 'store', actor, target: 'assistants/scout.md',
    detail: { hired: 'scout', tasks: tasks.length },
  });
  return { assistant, tasks, project };
}


export function intakeExists() { return fs.existsSync(intakePath()); }
