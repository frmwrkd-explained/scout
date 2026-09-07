// frontend/DecideCards.jsx — one renderer per card kind, dispatched from a table (T13).
//
// PROPS
//   <CardBody card={NormalisedCard} onOpenPath={fn(path)} answer onAnswer onSubmit />
//   `card` is ALWAYS the output of `normalizeCard()`, never a raw API row — Decide.jsx normalises
//   once on load and nothing downstream touches frontmatter shapes. The last three props are the
//   answer channel; only a kind whose table row says `needsAnswer` uses them.
//
// WHY A TABLE AND NOT A SWITCH
// T13 lists six kinds and says a seventh must cost one line. `KIND` at the bottom is that line:
// label, chip word, accept/reject verbs, the sentence saying what accepting DOES, whether the card
// needs an answer typed, and the body renderer. `Decide.jsx` reads only from this table and
// branches on nothing — an `if (card.kind === …)` in Decide.jsx is the bug this shape prevents.
//
// THE ALTITUDES (Law 2) SPLIT ACROSS TWO FILES ON PURPOSE
//   altitude 1  this file — the one line and the yes/no. Every body renderer stops here.
//   altitude 2  Decide.jsx's WHY panel                                    (one click / W)
//   altitude 3  Decide.jsx's EVIDENCE grid, nested INSIDE the WHY panel   (two clicks / E)
// A body renderer that prints reasoning is a bug: reasoning is altitude 2 and belongs to the
// shared panel, or the card no longer opens at altitude 1.
//
// TWO KINDS CARRY A RULE FROM THE DOCS AND SHOW IT ON THE CARD:
//   `outbound` — accepting approves the EXACT WORDING, so the wording is on the card at full size.
//                None attached ⇒ a warn band, because "approve" with nothing to approve is the
//                worst failure this screen can have.
//   `schema`   — 02_DATA_MODEL.md §6 / 04_AGENT_CONTRACT.md §4: a schema proposal carries EVIDENCE
//                ("14 of your last 20 shortlists post video"), never an opinion. backend/
//                proposals.mjs already refuses one without `evidence[]`; this renders what was
//                counted at altitude 1, so she never has to open WHY to find out.
//
// SHAPE: backend/proposals.mjs `getProposal()` returns FLAT frontmatter plus `{ id, kind, status,
// title, why, evidence, created, created_by, path, body }`. `path` is the CARD's own file;
// the thing it is about is `record` (findings) or `subject`. `target` is NOT the subject — on a
// question card it is the literal 'me', routing the answer to me.md. Those three collisions are
// why this normaliser exists and why nothing downstream reads frontmatter directly.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Eyebrow, Input } from './ui';

// ── the two fixed vocabularies (mirrors backend/proposals.mjs) ────────────────────────────────
export const CARD_KINDS = ['finding', 'outbound', 'territory', 'learning', 'schema', 'question'];

// Law 5: the reason is the only labelled data this system ever gets, so it is mandatory and it is
// ONE KEYSTROKE. Five, fixed, numbered 1–5 — the order IS the keymap, and it is the same list as
// records.mjs ARCHIVE_REASONS because rejecting a finding archives the record with this reason.
export const REJECT_REASONS = [
  { key: '1', id: 'off-target', label: 'Off target' },
  { key: '2', id: 'bad-data', label: 'Bad data' },
  { key: '3', id: 'duplicate', label: 'Duplicate' },
  { key: '4', id: 'wrong-tone', label: 'Wrong tone' },
  { key: '5', id: 'already-contacted', label: 'Already contacted' },
];

// ── shape helpers ─────────────────────────────────────────────────────────────────────────────
const mono = (extra = '') => ({ ...sx('font-variant-numeric:tabular-nums;' + extra), fontFamily: MONO });

const first = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '');

const num = v => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// A route may answer `[…]`, `{ proposals: […] }`, `{ goals: […] }`, `{ events: […] }`. One
// unwrapper, used by Decide.jsx and Today.jsx, so neither invents its own guesswork.
export function unwrap(payload, ...keys) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const k of [...keys, 'items', 'rows', 'results']) {
    if (Array.isArray(payload[k])) return payload[k];
  }
  return [];
}

// Data may name a colour. Only a token reference is allowed through — a raw hex out of a markdown
// file would put a colour in the app that no token owns (CLAUDE.md, and the design-token test).
const TONE = { warn: 'var(--warn)', ok: 'var(--ok)', danger: 'var(--danger)', marked: 'var(--marked)', muted: 'var(--fg-muted)' };
function toneColour(t) {
  if (!t) return null;
  if (TONE[t]) return TONE[t];
  return /^var\(--[a-z0-9-]+\)$/.test(String(t)) ? String(t) : null;
}

// `[[data/guests/maria-santos]]` → `data/guests/maria-santos.md`. Evidence in the seeded cards is
// a list of wikilinks to real documents, which is the best kind of evidence there is: altitude 3
// becomes the documents themselves rather than a paraphrase of them.
const WIKI = /^\[\[([^\]]+)\]\]$/;
function refPath(s) {
  const m = WIKI.exec(String(s).trim());
  const raw = (m ? m[1] : String(s)).split('|')[0].trim();
  return /\.[a-z0-9]{1,5}$/i.test(raw) ? raw : raw + '.md';
}
const looksLikeRef = s => WIKI.test(String(s).trim()) || /^[\w.\-/]+\/[\w.\-/]+$/.test(String(s).trim());

// `[[data/guests/maria-santos]]`, `[[data/guests/maria-santos|Maria Santos]]`, or a bare
// `data/guests/maria-santos` → `data/guests/maria-santos.md`; anything that does not look like a
// reference at all → `null`. This is `refPath` + `looksLikeRef` above as ONE public answer, so a
// second surface that needs to turn wikilink-shaped text into an openable path (Inspector's LINKS
// section — docs/05_UI_SPEC.md §1, design/EXTRACT.md §2 — renders prose mentions RefList never
// sees) calls this instead of writing its own predicate and its own `|label` stripping, which is
// exactly how two resolvers start disagreeing about what counts as a link (item 7).
export function resolveWikilink(text) {
  const s = String(text ?? '').trim();
  if (!s || !looksLikeRef(s)) return null;
  return refPath(s);
}

// Evidence arrives as counted rows ({ k, v } / { label, value }), as document references
// (wikilinks), or as both. They render differently, so they are separated once, here.
function normalizeEvidence(ev) {
  const rows = [];
  const refs = [];
  const push = e => {
    if (e === null || e === undefined || e === '') return;
    if (typeof e !== 'object') {
      const s = String(e);
      if (looksLikeRef(s)) refs.push(refPath(s));
      else rows.push({ k: '', v: s });
      return;
    }
    const v = first(e.v, e.value, e.text, e.detail);
    rows.push({ k: String(first(e.k, e.key, e.label, e.name) || ''), v: Array.isArray(v) ? v.join(', ') : String(v ?? '') });
  };
  if (Array.isArray(ev)) ev.forEach(push);
  else if (ev && typeof ev === 'object') Object.entries(ev).forEach(([k, v]) => rows.push({ k, v: Array.isArray(v) ? v.join(', ') : String(v) }));
  else if (ev) push(ev);
  return { rows: rows.filter(r => r.k || r.v), refs };
}

function normalizeFacts(list) {
  return [].concat(list ?? [])
    .filter(f => f !== null && f !== undefined && f !== '')
    .map(f => (typeof f === 'object'
      ? { v: String(first(f.v, f.value, f.label, f.text, f.id) ?? ''), tone: toneColour(f.tone || f.fg) }
      : { v: String(f), tone: null }))
    .filter(f => f.v);
}

// The card body is `intro` then `## Notes`. The intro is the line under the headline; the notes are
// the caveat the agent wants read before a yes — altitude 2, next to the reasoning.
function splitBody(text) {
  const s = String(text || '').trim();
  if (!s) return { intro: '', notes: '' };
  const i = s.search(/^#{1,6}\s/m);
  if (i < 0) return { intro: s, notes: '' };
  return { intro: s.slice(0, i).trim(), notes: s.slice(i).replace(/^#{1,6}\s*\w[\w\s]*\n/, '').trim() };
}

const firstPara = s => String(s || '').split(/\n\s*\n/)[0].trim();

// The one place a proposal file becomes a card.
export function normalizeCard(raw) {
  if (!raw) return null;
  const d = raw.data && typeof raw.data === 'object' ? raw.data : raw;
  const kindRaw = String(first(d.kind, raw.kind, '') || '').toLowerCase().trim();
  const kind = CARD_KINDS.includes(kindRaw) ? kindRaw : 'unknown';
  const { intro, notes } = splitBody(first(raw.body, raw.content, d.body));
  const title = String(first(d.title, d.head, d.headline, d.question, d.summary, d.claim, d.name) || '');
  // `summary` and `title` are the same sentence on every seeded card, so a naive fallback prints
  // the headline twice. The supporting line is the body's first paragraph when that happens.
  const lineRaw = String(first(d.line, d.subtitle, d.one_liner, d.summary) || '');
  const line = lineRaw && lineRaw.trim() !== title.trim() ? lineRaw : firstPara(intro);
  const { rows, refs } = normalizeEvidence(first(d.evidence, raw.evidence));

  // schema: `field` may be a string key or the `{ key, type, options }` object the route builds.
  const fieldObj = d.field && typeof d.field === 'object' ? d.field : null;

  return {
    raw,
    id: String(first(raw.id, d.id, raw.slug, d.slug) || ''),
    kind,
    kindRaw,
    status: String(first(d.status, raw.status, 'open')),
    // altitude 1 — the decision itself
    title,
    line,
    facts: normalizeFacts(first(d.facts, d.sub, d.signals)),
    score: num(first(d.score, d.confidence)),
    // altitude 2 — reasoning, and the caveat that came with it
    why: String(first(d.why, d.reasoning, d.because) || ''),
    notes,
    // altitude 3 — what was counted, the documents behind it, and the way down to the file
    evidence: rows,
    evidenceRefs: refs,
    // `subject` is the thing the card is ABOUT. Never `target`: on a question card `target` is the
    // literal 'me', which routes the answer to me.md (backend/proposals.mjs effectFor).
    subject: first(d.record, d.subject, d.path_to) || null,
    // `file` is the CARD's own markdown. backend/proposals.mjs always sets `path` to it.
    file: first(raw.path, d.card_path) || null,
    sourceUrl: first(d.source_url, d.url, d.link) || null,
    // provenance + age — every card says who proposed it and how old it is
    proposedBy: String(first(d.proposed_by, d.actor, d.agent, d.assistant, d.created_by, raw.created_by) || 'unknown'),
    at: first(d.created, d.proposed_at, d.at, raw.created) || null,
    // kind-specific, all optional
    message: first(d.message, d.wording, d.draft, d.post) || null,
    channel: first(d.channel, d.to, d.destination) || null,
    collection: first(d.collection, d.for) || null,
    change: first(d.change) || null,
    field: fieldObj ? String(first(fieldObj.key, fieldObj.id, fieldObj.name) || '') : (first(d.field, d.key) || null),
    fieldType: fieldObj ? String(first(fieldObj.type, fieldObj.field_type) || '') : (first(d.field_type, d.type_of) || null),
    options: [].concat(first(fieldObj && fieldObj.options, d.options, d.choices) ?? []).filter(Boolean).map(o => String(typeof o === 'object' ? first(o.value, o.label, o.id) : o)),
    territory: first(d.territory, d.ground, d.group) || null,
    members: num(first(d.members, d.size, d.member_count)),
    access: first(d.access, d.privacy, d.visibility) || null,
    moderators: num(d.moderators),
    claim: first(d.claim, d.learning_claim, d.statement) || null,
    scope: first(d.scope) || null,
    window: num(first(d.sweep_interval_days, d.window_days, d.review_days)),
    question: first(d.question) || null,
    answer: first(d.answer, d.proposed_answer, d.default_answer) || '',
    // where an accepted answer lands. 'me' → me.md, anything else → learnings/.
    answerTo: String(first(d.target, '') || '') === 'me' ? 'me.md' : 'learnings/',
  };
}

// ── card-internal primitives ──────────────────────────────────────────────────────────────────
// These are DECIDE-card parts, not app primitives. The app registry (frontend/ui.jsx) is imported
// where it fits — Eyebrow and Input here, Btn/Chip/Empty in Decide.jsx. The decision card is the
// one place docs/05_UI_SPEC.md §6 relaxes density, so its geometry is deliberately unlike Card's.
//
// Measurements are design/Decide.dc.html verbatim (EXTRACT.md §3.2: 800px column, 36/40px
// padding, 34px/27px headline, 17px line). Do not "improve" them while porting.
function Region({ score, children }) {
  return (
    <div style={sx('display:flex;gap:32px;padding:36px 40px 28px')}>
      {score === null || score === undefined ? null : <Score value={score} />}
      <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:14px')}>{children}</div>
    </div>
  );
}

function Score({ value }) {
  const filled = Math.max(0, Math.min(10, Math.round(value)));
  return (
    <div style={sx('flex:none;width:92px;display:flex;flex-direction:column;gap:10px')}>
      <Eyebrow style={sx('font-size:9px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>SCORE</Eyebrow>
      <div style={sx('display:flex;align-items:baseline;gap:4px')}>
        <span style={{ ...mono('font-size:46px;font-weight:600;line-height:.9;color:var(--fg)') }}>{value}</span>
        <span style={{ ...mono('font-size:12px;font-weight:500;color:var(--fg-faint)') }}>/10</span>
      </div>
      <div style={sx('display:flex;gap:2px;height:6px')}>
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} style={{ ...sx('flex:1;border-radius:1px'), background: i < filled ? 'var(--fg-soft)' : 'var(--border-2)' }} />
        ))}
      </div>
    </div>
  );
}

// 34px when the headline is a NAME, 27px when it is a sentence or a question. The design uses
// exactly these two sizes; the switch is length, because a name is short and a question is not.
function Head({ children }) {
  const text = String(children || '');
  return (
    <h1 style={{ ...sx('margin:0;font-weight:500;letter-spacing:-.015em;line-height:1.2;color:var(--fg);text-wrap:pretty'), fontSize: text.length <= 32 ? 34 : 27 }}>
      {text}
    </h1>
  );
}

function Line({ children }) {
  if (!children) return null;
  return <p style={sx('margin:0;max-width:58ch;font-size:17px;font-weight:400;line-height:1.55;color:var(--fg-soft);text-wrap:pretty')}>{children}</p>;
}

function Facts({ items }) {
  if (!items || !items.length) return null;
  return (
    <div style={{ ...sx('display:flex;flex-wrap:wrap;align-items:center;gap:9px;font-size:11px;font-weight:500;color:var(--fg-muted)'), fontFamily: MONO }}>
      {items.map((f, i) => (
        <span key={i} style={{ color: f.tone || 'var(--fg-muted)' }}>{(i > 0 ? '· ' : '') + f.v}</span>
      ))}
    </div>
  );
}

// The sunk slab: the exact wording, the field spec, the answer that will be written. Anything she
// is being asked to approve LITERALLY goes in one of these, never paraphrased into prose.
function Slab({ label, right, tone, children }) {
  const edge = toneColour(tone);
  return (
    <div style={sx('padding:0 40px 28px')}>
      <div style={{ ...sx('padding:20px 22px;background:var(--sunk);border-radius:6px;display:flex;flex-direction:column;gap:12px'), border: '1px solid ' + (edge || 'var(--border)') }}>
        <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:12px')}>
          <span style={{ ...mono('font-size:9.5px;font-weight:700;letter-spacing:.14em'), color: edge || 'var(--fg-faint)' }}>{label}</span>
          {right ? <span style={{ ...mono('font-size:9.5px;font-weight:500;color:var(--fg-faint)') }}>{right}</span> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

function SlabProse({ children }) {
  return <p style={sx('margin:0;font-size:14.5px;line-height:1.7;color:var(--fg-soft);text-wrap:pretty;white-space:pre-wrap')}>{children}</p>;
}

// A counted row: LABEL … value. The schema card is made of these, because a count is the only
// thing a schema proposal is allowed to argue with.
export function CountRows({ items }) {
  return (
    <div style={sx('display:flex;flex-direction:column;gap:9px')}>
      {items.map((e, i) => (
        <div key={i} style={sx('display:flex;gap:12px;align-items:baseline')}>
          <span style={{ ...mono('font-size:9.5px;font-weight:700;letter-spacing:.1em;color:var(--fg-faint)'), flex: 'none', width: 96 }}>{e.k}</span>
          <span style={{ ...mono('font-size:11px;font-weight:500;line-height:1.55;color:var(--fg-soft)'), flex: 1, minWidth: 0 }}>{e.v}</span>
        </div>
      ))}
    </div>
  );
}

// The documents behind a claim. Law 8 — each one is a real file and each one opens.
export function RefList({ refs, onOpenPath }) {
  if (!refs || !refs.length) return null;
  return (
    <div style={sx('display:flex;flex-direction:column;gap:6px')}>
      {refs.map(p => (onOpenPath
        ? <button key={p} type="button" onClick={() => onOpenPath(p)} className="hAccent"
            style={{ ...mono('font-size:10.5px;font-weight:500;color:var(--accent);text-align:left;background:none;border:none;padding:0;cursor:pointer;width:fit-content') }}>{p}</button>
        : <span key={p} style={{ ...mono('font-size:10.5px;font-weight:500;color:var(--fg-muted)') }}>{p}</span>
      ))}
    </div>
  );
}

// ── the six bodies ────────────────────────────────────────────────────────────────────────────
// Each stops at altitude 1: what it is, one line, the facts that qualify it, and — where she is
// approving something literal — the literal thing.

function FindingBody({ card }) {
  const facts = card.facts.length ? card.facts : normalizeFacts([
    card.collection ? '#' + card.collection : null,
    card.territory,
    card.subject,
  ]);
  return (
    <Region score={card.score}>
      <Head>{card.title || 'Someone was found'}</Head>
      <Line>{card.line}</Line>
      <Facts items={facts} />
    </Region>
  );
}

function OutboundBody({ card }) {
  const words = card.message;
  const hasLink = !!words && /https?:\/\//i.test(words);
  const meta = words ? [words.trim().length + ' CHARS', hasLink ? 'CONTAINS A LINK' : 'NO LINKS'].join(' / ') : null;
  return (
    <>
      <Region>
        <Head>{card.title || 'Send this?'}</Head>
        <Line>{card.line}</Line>
        <Facts items={card.facts.length ? card.facts : normalizeFacts([card.channel, card.subject])} />
      </Region>
      {words ? (
        // Accepting approves THESE WORDS. Full size, unabridged, above the buttons — there is no
        // reading of an outbound card that does not include the wording.
        <Slab label={'THE EXACT WORDING THAT WILL BE SENT' + (card.channel ? ' / ' + String(card.channel).toUpperCase() : '')} right={meta}>
          <SlabProse>{String(words).trim()}</SlabProse>
        </Slab>
      ) : (
        <Slab label="NO WORDING ATTACHED — THERE IS NOTHING TO APPROVE" tone="warn">
          <SlabProse>Accepting an outbound card approves the exact words that get sent. This card carries none, so reject it and let the assistant write the message first.</SlabProse>
        </Slab>
      )}
    </>
  );
}

function TerritoryBody({ card }) {
  const facts = card.facts.length ? card.facts : normalizeFacts([
    card.territory,
    card.access ? String(card.access).toUpperCase() : null,
    card.members === null ? null : card.members.toLocaleString() + ' MEMBERS',
    card.moderators === null ? null : card.moderators + ' MODERATORS',
  ]);
  return (
    <Region>
      <Head>{card.title || 'Ask to join new ground?'}</Head>
      <Line>{card.line}</Line>
      <Facts items={facts} />
      {/* `requested`, not joined: accepting means the agent MAY ASK. Saying that here stops the
          card promising something the group's moderators actually decide. */}
      <span style={{ ...mono('font-size:10px;font-weight:600;letter-spacing:.12em;color:var(--fg-faint)') }}>
        A YES LETS THE ASSISTANT ASK — JOINING IS STILL THEIR DECISION
      </span>
    </Region>
  );
}

function LearningBody({ card }) {
  const facts = card.facts.length ? card.facts : normalizeFacts([
    'PLAYBOOK',
    card.scope ? String(card.scope).toUpperCase() : null,
    card.window === null ? null : { v: 'REVIEW IN ' + card.window + 'D' },
    { v: 'NEW CLAIM', tone: 'marked' },
  ]);
  return (
    <>
      <Region>
        <Head>{card.title || 'Save this to memory?'}</Head>
        <Line>{card.line}</Line>
        <Facts items={facts} />
      </Region>
      {card.claim ? (
        // Law 7: what enters the cache is what every assistant reads on every wake. She approves
        // the sentence, not a summary of the sentence.
        <Slab label="ENTERS MEMORY, AND THE HOT CACHE, AS THIS" right={card.window === null ? null : 'DECAYS IN ' + card.window + 'D'}>
          <SlabProse>{card.claim}</SlabProse>
        </Slab>
      ) : null}
    </>
  );
}

function SchemaBody({ card, onOpenPath }) {
  const spec = [
    card.collection ? { k: 'COLLECTION', v: '#' + card.collection } : null,
    card.change ? { k: 'CHANGE', v: String(card.change) } : null,
    card.field ? { k: 'FIELD', v: String(card.field) } : null,
    card.fieldType ? { k: 'TYPE', v: String(card.fieldType) } : null,
    card.options.length ? { k: 'OPTIONS', v: card.options.join(' · ') } : null,
  ].filter(Boolean);
  const head = card.title || (card.field && card.collection
    ? 'New field · #' + card.collection + ' → ' + card.field + (card.fieldType ? ' (' + card.fieldType + ')' : '')
    : 'Change the database?');
  const hasEvidence = card.evidence.length || card.evidenceRefs.length;
  return (
    <>
      <Region>
        <Head>{head}</Head>
        <Line>{card.line}</Line>
        <Facts items={card.facts} />
      </Region>
      {/* 02_DATA_MODEL.md §6 / 04_AGENT_CONTRACT.md §4 — a database change arrives with counts from
          her own records, never a preference. Shown at altitude 1 so she never has to open WHY to
          find out what was actually measured. */}
      {hasEvidence ? (
        <Slab label="WHAT THE AGENT COUNTED" right={card.evidenceRefs.length ? card.evidenceRefs.length + ' DOCUMENTS' : 'NOT AN OPINION'}>
          {card.evidence.length ? <CountRows items={card.evidence} /> : null}
          <RefList refs={card.evidenceRefs} onOpenPath={onOpenPath} />
        </Slab>
      ) : (
        <Slab label="NO EVIDENCE ATTACHED" tone="warn">
          <SlabProse>A database change must arrive with counts from your own records — “14 of your last 20 shortlists post video” — never a preference. This card has none.</SlabProse>
        </Slab>
      )}
      {spec.length ? (
        <Slab label="WHAT GETS CREATED" right="NOTHING ALREADY WRITTEN CHANGES">
          <CountRows items={spec} />
        </Slab>
      ) : null}
    </>
  );
}

// The one kind that needs a word back. GOAL §3: "One assistant is blocked and asks a question in
// plain language. She answers in a word." backend/proposals.mjs refuses to accept a question card
// without `answer`, so the box is not decoration — it is the accept payload.
// ui.jsx's Input is a plain function component and does not forward a ref (and ui.jsx is owned by
// someone else). The answer box therefore carries a stable id and Decide.jsx focuses it by id —
// one input on one screen, so the id is unambiguous. Reuse beats a second Input.
export const ANSWER_INPUT_ID = 'decide-answer';

function QuestionBody({ card, answer, onAnswer, onSubmit }) {
  return (
    <>
      <Region>
        <Head>{card.question || card.title || 'A question'}</Head>
        <Line>{card.line}</Line>
        {/* No path fact here on purpose: a question is a sentence, and the record it came from is
            already in the footer and one keystroke away in EVIDENCE. */}
        <Facts items={card.facts} />
      </Region>
      <Slab label={'YOUR ANSWER IS WRITTEN INTO ' + card.answerTo.toUpperCase()} right="ONE WORD IS ENOUGH">
        <Input
          id={ANSWER_INPUT_ID}
          value={answer ?? ''}
          onChange={e => onAnswer && onAnswer(e.target.value)}
          placeholder="follow up"
          aria-label="Your answer"
          onKeyDown={e => {
            // Enter commits from inside the box; Escape hands the keys back to the queue. Both
            // stop here so the queue's own A/R/J/K never fire while she is typing.
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); onSubmit && onSubmit(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.target.blur(); }
          }}
          style={sx('width:100%;height:44px;font-size:14px;border-radius:6px;padding:0 14px')}
        />
        <span style={{ ...mono('font-size:9.5px;font-weight:500;letter-spacing:.08em;color:var(--fg-faint)') }}>
          ENTER FROM THE QUEUE PUTS THE CARET HERE · ENTER AGAIN ANSWERS · ESC GIVES THE KEYS BACK
        </span>
      </Slab>
    </>
  );
}

function UnknownBody({ card }) {
  return (
    <>
      <Region score={card.score}>
        <Head>{card.title || 'A proposal'}</Head>
        <Line>{card.line}</Line>
        <Facts items={card.facts} />
      </Region>
      <Slab label={'UNKNOWN CARD KIND — ' + (card.kindRaw || 'MISSING').toUpperCase()} tone="warn">
        <SlabProse>Scout has no renderer for this kind, so the card is shown plainly rather than hidden. Nothing is lost — the file is on disk and the decision still records.</SlabProse>
      </Slab>
    </>
  );
}

// ── the dispatch table ────────────────────────────────────────────────────────────────────────
// ONE line per kind. `effect` is printed under the buttons in mono uppercase, so "what does
// accepting mean" is answered on the card rather than in a doc — T13's table, rendered.
export const KIND = {
  finding: {
    label: 'SOMEONE FOUND', chip: { one: 'person', many: 'people' },
    yes: 'Shortlist', no: 'Reject', effect: 'MOVES THE RECORD TO SHORTLIST',
    Body: FindingBody,
  },
  outbound: {
    label: 'DRAFT TO SEND', chip: { one: 'draft', many: 'drafts' },
    yes: 'Approve these words', no: 'Reject', effect: 'APPROVES THE EXACT WORDING FOR SENDING',
    Body: OutboundBody,
  },
  territory: {
    label: 'NEW GROUND', chip: { one: 'new group', many: 'new groups' },
    yes: 'Request to join', no: 'Reject', effect: 'THE ASSISTANT MAY ASK TO JOIN',
    Body: TerritoryBody,
  },
  learning: {
    label: 'MEMORY UPDATE', chip: { one: 'memory', many: 'memory' },
    yes: 'Save to memory', no: 'Reject', effect: 'ENTERS MEMORY AND THE HOT CACHE',
    Body: LearningBody,
  },
  schema: {
    label: 'DATABASE CHANGE', chip: { one: 'database', many: 'database' },
    yes: 'Add it', no: 'Reject', effect: 'CREATES IT IN THE COLLECTION',
    Body: SchemaBody,
  },
  question: {
    label: 'A QUESTION FOR YOU', chip: { one: 'question', many: 'questions' },
    yes: 'Answer it', no: 'No', effect: 'WRITES YOUR ANSWER INTO MEMORY',
    needsAnswer: true, Body: QuestionBody,
  },
  unknown: {
    label: 'PROPOSAL', chip: { one: 'other', many: 'other' },
    yes: 'Accept', no: 'Reject', effect: 'RECORDS YOUR DECISION',
    Body: UnknownBody,
  },
};

export const kindOf = card => KIND[card && card.kind] || KIND.unknown;

export function CardBody({ card, onOpenPath, answer, onAnswer, onSubmit }) {
  if (!card) return null;
  const { Body } = kindOf(card);
  return <Body card={card} onOpenPath={onOpenPath} answer={answer} onAnswer={onAnswer} onSubmit={onSubmit} />;
}

export default CardBody;
