#!/usr/bin/env node
// scripts/seed-crm-demo.mjs — build the CRM showcase workspace.
//
//   node scripts/seed-crm-demo.mjs --workspace <empty folder>      [--today 2026-11-17]
//
// A small studio's sales desk: companies, the people at them, deals moving through a pipeline, the
// messages behind each deal, and the invoices that came out of the wins. Everything is INVENTED —
// the companies and people do not exist, every address is at example.com and every phone number is
// a 555 number. It exists to show what the app does with an ordinary CRM, not to be one.
//
// It writes the way the app writes: schemas through `saveCollection`, views through `saveView`,
// every record through `records.mjs` (so each one carries provenance and none is quarantined), and
// memory through `memory.mjs`. The one thing written directly is the workspace skill's SKILL.md,
// which is a folder of instructions, not a record.
//
// DETERMINISTIC. One seeded generator drives every choice, and "today" is fixed (override it with
// --today), so two runs on the same day produce the same files. The checked-in copy is
// `workspace-crm/`; regenerate it with:
//
//   rm -rf workspace-crm && mkdir workspace-crm && node scripts/seed-crm-demo.mjs --workspace workspace-crm
//
// It refuses a folder that already holds anything: this script creates a workspace, it never
// adds to one.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = name => { const i = process.argv.indexOf('--' + name); return i < 0 ? null : process.argv[i + 1]; };
const workspace = arg('workspace');
const TODAY = arg('today') || '2026-11-17';
const quiet = process.argv.includes('--quiet');

if (!workspace || !/^\d{4}-\d{2}-\d{2}$/.test(TODAY)) {
  console.error('usage: node scripts/seed-crm-demo.mjs --workspace <empty folder> [--today YYYY-MM-DD]');
  process.exit(2);
}
const root = path.resolve(workspace);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error('No such folder: ' + root + '\nCreate it first — this script does not invent one.');
  process.exit(2);
}
const present = fs.readdirSync(root).filter(n => !n.startsWith('._') && n !== '.DS_Store' && n !== '.gitkeep');
if (present.length) {
  console.error('Refusing to seed ' + root + ': it already holds ' + present.slice(0, 4).join(', ') + (present.length > 4 ? '…' : '') + '.\nThis script builds a NEW workspace; give it an empty folder.');
  process.exit(1);
}

// The store resolves its root when first imported, and a config.md pointer beats the env var —
// so both are pinned before the backend loads (same reasoning as scripts/import-references.mjs).
process.env.SCOUT_DATA = root;
process.env.SCOUT_CONFIG = path.join(os.tmpdir(), 'scout-crm-seed-no-pointer-' + process.pid + '.md');
process.env.SCOUT_NO_LISTEN = '1';

// The clock is pinned to --today while the seed runs, advancing one millisecond per reading. Every
// writer stamps what it writes (`created`, `updated`, the event log), and a fixture that changed
// each time it was regenerated would make every regeneration a 400-file diff. Pinned, two runs are
// byte-for-byte the same, log included.
{
  const RealDate = Date;
  const start = RealDate.parse(TODAY + 'T09:00:00.000Z');
  let tick = 0;
  globalThis.Date = class extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(start + tick++); }
    static now() { return start + tick++; }
  };
}

const { getStorageRoot } = await import('../backend/store.mjs');
const { batchUpsert } = await import('../backend/records.mjs');
const { saveCollection } = await import('../backend/collections.mjs');
const { saveView } = await import('../backend/views.mjs');
const { writeMe, saveGoal, savePlaybook, saveLearning, flushCacheRegen } = await import('../backend/memory.mjs');
const { saveAssistant } = await import('../backend/tasks.mjs');
if (path.resolve(getStorageRoot()) !== root) { console.error('Refusing to run: the store resolved ' + getStorageRoot()); process.exit(1); }

// ── the generator ────────────────────────────────────────────────────────────────────────────
let seed = 20261117;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = list => list[Math.floor(rnd() * list.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const chance = p => rnd() < p;
const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const DAY = 86400000;
const base = Date.parse(TODAY + 'T12:00:00Z');
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const daysAgo = n => iso(base - n * DAY);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = d => Number(d.slice(8, 10)) + ' ' + MONTHS[Number(d.slice(5, 7)) - 1];
const quarterOf = d => d.slice(0, 4) + '-Q' + (Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1);
const money = n => Math.round(n / 50) * 50;

// ── who is selling ───────────────────────────────────────────────────────────────────────────
const OWNERS = ['Ines', 'Kofi', 'Mira'];
const STUDIO = { business: 'Lantern Studio', address: '14 Harbour Row, Unit 3, Port Ellery', email: 'hello@lanternstudio.example', phone: '+1 555 0142', tax_id: 'TAX-000-DEMO', payment: 'Bank transfer within the payment terms. Details are on request.' };

// ── companies ────────────────────────────────────────────────────────────────────────────────
// Invented, and meant to read as invented.
const COMPANIES = [
  ['Brightloom Coffee', 'Food & drink', 'Port Ellery'], ['Kestrel & Vine', 'Food & drink', 'Marlow Bay'], ['Northfold Labs', 'Software', 'Eastmere'],
  ['Tidewater Goods', 'Retail', 'Port Ellery'], ['Paperkite Media', 'Media', 'Eastmere'], ['Ostrander Cycles', 'Outdoor gear', 'Hallow Ridge'],
  ['Marrowstone Hotels', 'Hospitality', 'Marlow Bay'], ['Fennick Outdoor', 'Outdoor gear', 'Hallow Ridge'], ['Quillhaven Press', 'Media', 'Eastmere'],
  ['Saltgrass Kitchen', 'Food & drink', 'Port Ellery'], ['Umberfield Architects', 'Architecture', 'Eastmere'], ['Lowlight Records', 'Music', 'Marlow Bay'],
  ['Hollisbrook School', 'Education', 'Hallow Ridge'], ['Verdane Wellness', 'Health & wellness', 'Port Ellery'], ['Copperjay Software', 'Software', 'Eastmere'],
  ['Wrenfield Dairy', 'Food & drink', 'Hallow Ridge'], ['Pallisade Furniture', 'Retail', 'Marlow Bay'], ['Stillwater Yoga', 'Health & wellness', 'Port Ellery'],
  ['Orchardline Cider', 'Food & drink', 'Hallow Ridge'], ['Greywether Travel', 'Hospitality', 'Marlow Bay'], ['Inkberry Books', 'Retail', 'Eastmere'],
  ['Thistledown Foundation', 'Non-profit', 'Port Ellery'], ['Halcyon Robotics', 'Software', 'Eastmere'], ['Emberwick Candles', 'Retail', 'Hallow Ridge'],
  ['Larkspur Clinics', 'Health & wellness', 'Marlow Bay'], ['Dunmarrow Brewing', 'Food & drink', 'Port Ellery'], ['Skylane Academy', 'Education', 'Eastmere'],
  ['Mossgate Gardens', 'Retail', 'Hallow Ridge'], ['Corvane Audio', 'Music', 'Marlow Bay'], ['Bellwether Trust', 'Non-profit', 'Port Ellery'],
];
const SIZES = ['1–10', '11–50', '51–200', '200+'];
const COMPANY_TAGS = ['referral', 'inbound', 'conference', 'repeat', 'local', 'video-first', 'needs-photos', 'seasonal'];
const COMPANY_NOTE = {
  'Food & drink': 'Sells mostly through its own shop and a handful of stockists. Visuals matter more than copy here.',
  Software: 'Product is hard to show. They want people on camera explaining it in plain words.',
  Retail: 'Seasonal business: the autumn range drives most of the year.',
  Media: 'They produce in-house and bring us in for the pieces that need a crew.',
  'Outdoor gear': 'Launches twice a year. Everything is shot on location.',
  Hospitality: 'Several sites, one brand. They care about consistency across them.',
  Architecture: 'Long projects, few of them. A film per finished building.',
  Music: 'Small budgets, fast turnarounds, and they know exactly what they want.',
  Education: 'Decisions are made by a committee that meets once a term.',
  'Health & wellness': 'Careful about claims. Every script is reviewed before it is shot.',
  'Non-profit': 'Grant-funded. Work is planned around the reporting year.',
};

// ── people ───────────────────────────────────────────────────────────────────────────────────
const FIRST = ['Mara', 'Tobias', 'Ilse', 'Desmond', 'Yuki', 'Anouk', 'Caleb', 'Priya', 'Lorcan', 'Sunniva', 'Emeka', 'Rosalind', 'Hadley', 'Joaquin', 'Thea', 'Bram', 'Odalys', 'Kit', 'Nadia', 'Per', 'Zora', 'Felix', 'Imogen', 'Ravi', 'Cleo', 'Anders', 'Solveig', 'Mateo', 'Wren', 'Idris', 'Elodie', 'Gus', 'Marisol', 'Tavish', 'Noor', 'Ezra', 'Linnea', 'Cormac', 'Saoirse', 'Bao'];
const LAST = ['Okafor', 'Lindqvist', 'Marchetti', 'Abara', 'Hollingworth', 'Vasquez', 'Tanaka', 'Brennan', 'Ostrowski', 'Achterberg', 'Nakamura', 'Delacroix', 'Whitlock', 'Adeyemi', 'Sorensen', 'Calloway', 'Iyer', 'Montague', 'Fairweather', 'Zielinski', 'Okonkwo', 'Hargreaves', 'Bellweather', 'Castellanos', 'Thornbury', 'Asante', 'Lindgren', 'Marlowe', 'Petrakis', 'Underhill'];
const ROLES = ['Founder', 'Marketing lead', 'Brand manager', 'Head of content', 'Operations manager', 'Creative director', 'Communications officer', 'Product manager', 'Managing director', 'Events coordinator'];

// ── deals ────────────────────────────────────────────────────────────────────────────────────
const SERVICES = [
  ['Brand film', 9000, [['Pre-production and script', 0.2], ['Two shoot days with crew', 0.45], ['Edit, grade and sound', 0.35]]],
  ['Product launch video', 6500, [['Concept and storyboard', 0.2], ['Studio shoot day', 0.4], ['Edit and motion graphics', 0.4]]],
  ['Social content retainer', 3600, [['Monthly shoot day', 0.5], ['Twelve short edits', 0.4], ['Captions and formats', 0.1]]],
  ['Photo library', 2800, [['Location shoot day', 0.6], ['Retouching, 60 images', 0.4]]],
  ['Explainer series', 7800, [['Scripts for four episodes', 0.25], ['Interview shoot day', 0.35], ['Animation and edit', 0.4]]],
  ['Event recap film', 3200, [['Event coverage, one day', 0.55], ['Edit and delivery in 5 days', 0.45]]],
  ['Website films', 5400, [['Homepage film', 0.5], ['Three team portraits', 0.3], ['Cut-downs for social', 0.2]]],
  ['Training videos', 4800, [['Curriculum and scripts', 0.3], ['Screen and studio recording', 0.4], ['Edit and chapters', 0.3]]],
  ['Podcast season', 4200, [['Eight episodes recorded', 0.5], ['Edit and mix', 0.4], ['Cover art and trailer', 0.1]]],
  ['Campaign ads', 8200, [['Three 30-second spots', 0.6], ['Stills for print', 0.2], ['Versioning and delivery', 0.2]]],
];
const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
const STAGE_PLAN = [['lead', 8], ['qualified', 8], ['proposal', 9], ['negotiation', 6], ['won', 10], ['lost', 4]];
const SOURCES = ['referral', 'inbound', 'conference', 'outreach'];
const PROBABILITY = { lead: 10, qualified: 30, proposal: 55, negotiation: 75, won: 100, lost: 0 };
const LOST_WHY = ['Went with an in-house team.', 'Budget was cut for this year.', 'Timing did not work; they may come back in spring.', 'Chose a cheaper quote.'];

// ── the story of a deal, as messages ─────────────────────────────────────────────────────────
// [channel, direction, subject, body]. `{…}` is filled per deal. Each stage adds to the one before.
const THREAD = {
  lead: [
    ['email', 'outbound', 'Intro: {service} for {company}', 'Hi {first}, I saw the new {industry} work you are doing and think a {service_l} could show it well. Would a short call next week be useful?'],
    ['email', 'inbound', 'Re: Intro: {service} for {company}', 'Thanks for reaching out. We have talked about this internally but have not planned anything yet. Send me a couple of examples?'],
  ],
  qualified: [
    ['call', 'outbound', 'Discovery call with {first}', 'Thirty minutes. They want the {service_l} ready before their next launch. Budget is roughly {amount}. {first} decides together with the managing director.'],
    ['email', 'outbound', 'Examples and next steps for {company}', 'As promised, three pieces close to what we discussed, and a rough timeline. If the dates work I will write up a proposal.'],
  ],
  proposal: [
    ['email', 'outbound', 'Proposal: {service} for {company}', 'Proposal attached: scope, schedule and a fixed price of {amount}. It is valid for 30 days. Happy to walk through it on a call.'],
    ['email', 'inbound', 'Re: Proposal: {service} for {company}', 'Read it with the team. We like the approach. Two questions: can the shoot move a week later, and is music licensing included?'],
  ],
  negotiation: [
    ['meeting', 'outbound', 'Proposal review with {company}', 'Met {first} and their finance lead. They asked for the work in two payments and one fewer deliverable. We agreed to keep the scope and split the invoice 50/50.'],
    ['email', 'inbound', 'Contract comments from {company}', 'Legal has two small changes to the usage terms, marked in the attached copy. Otherwise we are ready to sign.'],
  ],
  won: [
    ['email', 'inbound', 'Signed: {service} for {company}', 'Signed copy attached. Please send the first invoice and the shoot dates. Looking forward to it.'],
    ['email', 'outbound', 'Welcome and kickoff for {company}', 'Thank you. The deposit invoice follows today. Kickoff is booked, and I have shared the pre-production checklist.'],
  ],
  lost: [
    ['email', 'inbound', 'Decision on the {service_l}', 'Thank you for the work on this. {lost_why} I would like to stay in touch.'],
  ],
};
const KEEP = { lead: 1, qualified: 1, proposal: 2, negotiation: 1 };
const stagesUpTo = stage => (stage === 'lost' ? ['lead', 'qualified', 'proposal', 'lost'] : STAGES.slice(0, STAGES.indexOf(stage) + 1).filter(s => s !== 'lost'));
const CHECKINS = [
  ['email', 'outbound', 'Checking in with {company}', 'Hi {first}, it has been a while since the last project. Anything coming up this season that we could help with?'],
  ['email', 'inbound', 'Photos from last year', 'Could you resend the selects from the last shoot? We want to use two of them in the newsletter.'],
  ['call', 'inbound', 'Call from {first} about next year', '{first} called to say next year\'s budget is being set in January and asked for a rough price list.'],
  ['linkedin', 'outbound', 'Congratulations on the opening', 'Sent a short note about the new site. They replied that a film about it is on their list.'],
];

// ── build everything in memory first ─────────────────────────────────────────────────────────
const companies = COMPANIES.map(([name, industry, city], i) => ({
  id: slug(name), name, industry, city, size: SIZES[(i * 7 + 1) % SIZES.length], owner: OWNERS[i % OWNERS.length],
  website: 'https://' + slug(name) + '.example', tags: [COMPANY_TAGS[i % COMPANY_TAGS.length], COMPANY_TAGS[(i * 3 + 2) % COMPANY_TAGS.length]].filter((t, k, a) => a.indexOf(t) === k),
  people: [], deals: [], open_deals: [], messages: [], invoices: [],
}));

const people = [];
const usedNames = new Set();
for (const c of companies) {
  const n = c.size === '1–10' ? 2 : 3;
  for (let k = 0; k < n; k++) {
    let name;
    do { name = pick(FIRST) + ' ' + pick(LAST); } while (usedNames.has(name));
    usedNames.add(name);
    const person = { id: slug(name), name, first: name.split(' ')[0], role: k === 0 ? pick(['Founder', 'Managing director', 'Marketing lead']) : pick(ROLES),
      company: c.id, email: slug(name).replace(/-/g, '.') + '@' + slug(c.name) + '.example', phone: '+1 555 01' + String(10 + people.length).padStart(2, '0'),
      decision_maker: k === 0, messages: [], companyRef: c };
    people.push(person); c.people.push(person);
  }
}

const deals = [];
const stagePool = STAGE_PLAN.flatMap(([s, n]) => Array(n).fill(s));
const usedDeal = new Set();
stagePool.forEach((stage, i) => {
  let c, service;
  do { c = companies[(i * 5 + between(0, 3)) % companies.length]; service = pick(SERVICES); } while (usedDeal.has(service[0] + c.id));
  usedDeal.add(service[0] + c.id);
  const amount = money(service[1] * (0.8 + rnd() * 0.6));
  const person = c.people[0];
  // Open deals close in the coming weeks; finished ones closed in the last two months.
  const close = stage === 'won' || stage === 'lost' ? daysAgo(between(6, 62)) : iso(base + between(5, 70) * DAY);
  const started = between(34, 88);
  const lines = service[2].map(([description, share]) => ({ description, quantity: 1, unit_price: money(amount * share) }));
  lines[lines.length - 1].unit_price += amount - lines.reduce((s, l) => s + l.unit_price, 0);   // lines add up to the deal, exactly
  const deal = { id: slug(service[0]) + '-' + c.id, name: service[0] + ' — ' + c.name, service: service[0],
    stage, amount, close_date: close, quarter: quarterOf(close), company: c.id, person: person.id, owner: c.owner, source: pick(SOURCES),
    probability: PROBABILITY[stage], line_items: lines, started, lost_why: stage === 'lost' ? pick(LOST_WHY) : null, c, p: person, messages: [], invoices: [] };
  deals.push(deal); c.deals.push(deal); if (!['won', 'lost'].includes(stage)) c.open_deals.push(deal);
});

// A company's stage follows from its deals; a few with none stay leads.
for (const c of companies) {
  c.stage = c.deals.some(d => d.stage === 'won') ? 'customer' : c.deals.some(d => !['won', 'lost'].includes(d.stage)) ? 'prospect' : c.deals.length ? 'past' : 'lead';
  c.tier = c.deals.reduce((s, d) => s + (d.stage === 'lost' ? 0 : d.amount), 0) >= 9000 ? 'key' : 'standard';
}

const messages = [];
const usedSubject = new Set();
const fill = (text, d, p) => text.replace(/\{(\w+)\}/g, (_, k) => ({ service: d?.service, service_l: d?.service.toLowerCase(), company: p.companyRef.name, first: p.first,
  industry: p.companyRef.industry.toLowerCase(), amount: d ? '$' + d.amount.toLocaleString('en-US') : '', lost_why: d?.lost_why || '' }[k] ?? ''));
const addMessage = (template, when, person, deal) => {
  const [channel, direction, subject, body] = template;
  // The name is the subject plus who and when: two "Re: Proposal" threads must be two records.
  // A clash moves the message a day earlier rather than adding "(2)" — a name that CONTAINS
  // another reads as the same record to the near-match rule, and the two would be merged.
  let day = Math.max(0, Math.min(89, Math.round(when)));
  const title = n => fill(subject, deal, person) + ' · ' + person.first + ', ' + short(daysAgo(n));
  while (usedSubject.has(title(day))) day = day < 89 ? day + 1 : 0;
  const date = daysAgo(day), name = title(day);
  usedSubject.add(name);
  const m = { id: 'msg-' + String(messages.length + 1).padStart(4, '0'), name, date, channel, direction, person: person.id, company: person.company,
    deal: deal ? deal.id : undefined, body: fill(body, deal, person) };
  messages.push(m); person.messages.push(m); person.companyRef.messages.push(m); if (deal) deal.messages.push(m);
  return m;
};
for (const d of deals) {
  // The stage a deal is in now is told in full; the stages it passed through, in brief.
  const steps = stagesUpTo(d.stage).flatMap(s => (s === d.stage ? THREAD[s] : THREAD[s].slice(0, KEEP[s])));
  const end = ['won', 'lost'].includes(d.stage) ? Math.max(2, Math.round((base - Date.parse(d.close_date + 'T12:00:00Z')) / DAY)) : between(1, 20);
  // Strictly one day apart at least: a reply is never dated the same day as what it answers.
  let prev = 90;
  steps.forEach((t, i) => {
    const when = Math.max(0, Math.min(prev - 1, Math.round(d.started - (d.started - end) * (i / Math.max(1, steps.length - 1)) + (rnd() - 0.5))));
    prev = when; addMessage(t, when, d.p, d);
  });
}
for (let i = 0; messages.length < 220; i++) {
  const c = companies[(i * 11 + 3) % companies.length];
  addMessage(CHECKINS[i % CHECKINS.length], between(1, 88), c.people[(i >> 1) % c.people.length], null);
}

// Who is waiting on us: the last word was theirs, more than 14 days ago.
for (const p of people) {
  const last = [...p.messages].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).at(-1);
  p.follow_up = !!last && last.direction === 'inbound' && last.date < daysAgo(14);
}

const invoices = [];
const addInvoice = (deal, company, label, amount, date, lines) => {
  const n = invoices.length + 1;
  const due = iso(Date.parse(date + 'T12:00:00Z') + 14 * DAY);
  const age = Math.round((base - Date.parse(date + 'T12:00:00Z')) / DAY);
  const status = age < 3 ? 'draft' : age > 30 || chance(0.55) ? 'paid' : due < TODAY ? 'overdue' : 'sent';
  const inv = { id: 'inv-' + TODAY.slice(0, 4) + '-' + String(n).padStart(3, '0'), name: 'INV-' + TODAY.slice(0, 4) + '-' + String(n).padStart(3, '0'), label,
    status, date, due_date: due, amount, company: company.id, deal: deal ? deal.id : undefined, line_items: lines };
  invoices.push(inv); company.invoices.push(inv); if (deal) deal.invoices.push(inv);
};
for (const d of deals.filter(x => x.stage === 'won')) {
  const closed = Math.round((base - Date.parse(d.close_date + 'T12:00:00Z')) / DAY);
  const half = Math.round(d.amount / 2);
  addInvoice(d, d.c, 'Deposit, 50%', half, daysAgo(Math.max(0, closed - 1)), [{ description: d.service + ' — deposit, 50%', quantity: 1, unit_price: half }]);
  if (closed > 18) addInvoice(d, d.c, 'Balance on delivery', d.amount - half, daysAgo(Math.max(0, closed - between(16, 30))), [{ description: d.service + ' — balance on delivery', quantity: 1, unit_price: d.amount - half }]);
}
for (let i = 0; invoices.length < 25; i++) {
  const c = companies.filter(x => x.stage === 'customer')[i % companies.filter(x => x.stage === 'customer').length];
  const month = MONTHS[(Number(TODAY.slice(5, 7)) - 2 - (i % 3) + 12) % 12];
  addInvoice(null, c, 'Retainer, ' + month, 1200, daysAgo(20 + (i % 3) * 30 + between(0, 5)), [{ description: 'Content retainer — ' + month, quantity: 1, unit_price: 1200 }]);
}
invoices.sort((a, b) => a.date.localeCompare(b.date));
invoices.forEach((inv, i) => { const n = String(i + 1).padStart(3, '0'); inv.id = 'inv-' + TODAY.slice(0, 4) + '-' + n; inv.name = 'INV-' + TODAY.slice(0, 4) + '-' + n; });

// To-dos: the next step on a deal. A won deal has its kickoff to book; one in negotiation has a
// contract to send. (The second automation below makes the kickoff one by itself from now on.)
const todos = [];
for (const d of deals) {
  if (d.stage === 'won') {
    const closed = Math.round((base - Date.parse(d.close_date + 'T12:00:00Z')) / DAY);
    todos.push({ name: 'Book the kickoff — ' + d.name, status: closed > 14 ? 'done' : 'todo', due: iso(Date.parse(d.close_date + 'T12:00:00Z') + 7 * DAY), deal: d.id, company: d.company, owner: d.owner });
  } else if (d.stage === 'negotiation') {
    todos.push({ name: 'Send the contract — ' + d.name, status: chance(0.4) ? 'doing' : 'todo', due: iso(base + between(2, 9) * DAY), deal: d.id, company: d.company, owner: d.owner });
  }
}
todos.forEach(t => { t.id = slug(t.name); });

// ── schemas ──────────────────────────────────────────────────────────────────────────────────
// Created in two passes: every collection first (so relations can point at each other), then each
// one's full schema.
const text = key => ({ key, type: 'text' });
// An option is a name, or a name with a colour: `lead:blue`. The colour is one of the app's hue
// or status names (frontend/cells.jsx `optionColour`), never a CSS value.
const option = o => { const [value, colour] = String(o).split(':'); return colour ? { value, colour } : value; };
const select = (key, options, label) => ({ key, type: 'select', options: options.map(option), ...(label ? { label } : {}) });
const rel = (key, target, extra = {}) => ({ key, type: 'relation', target, ...extra });
const SCHEMAS = [
  { id: 'companies', label: 'Companies', colour: 'teal', query: { path: 'data/companies/**' }, default_view: 'cards',
    description: 'Every organisation the studio has worked with or wants to. A company lists its people, its deals, its messages and its invoices.',
    header: ['stage', 'tier', 'owner', 'pipeline_value', 'last_contact'],
    page: { layout: 'stack', width: 'normal', sections: ['properties', 'note', 'children'] },
    subtables: [
      { id: 'people', label: 'People', collection: 'people', bind: { company: '$self' } },
      { id: 'deals', label: 'Deals', collection: 'deals', bind: { company: '$self' } },
      { id: 'messages', label: 'Messages', collection: 'messages', bind: { company: '$self' } },
      { id: 'invoices', label: 'Invoices', collection: 'invoices', bind: { company: '$self' } },
    ],
    fields: [
      { key: 'name', type: 'text', primary: true, required: true },
      select('stage', ['lead:blue', 'prospect:amber', 'customer:ok', 'past']), select('tier', ['key:violet', 'standard']), select('industry', [...new Set(COMPANIES.map(c => c[1]))]),
      select('size', SIZES), select('owner', OWNERS), text('city'), { key: 'website', type: 'url' }, { key: 'tags', type: 'multiselect' },
      rel('deals', 'deals', { many: true, label: 'All deals' }), rel('open_deals', 'deals', { many: true }), rel('messages', 'messages', { many: true }),
      { key: 'deal_count', type: 'rollup', via: 'deals', target_field: 'amount', fn: 'count', label: 'Deals' },
      { key: 'pipeline_value', type: 'rollup', via: 'open_deals', target_field: 'amount', fn: 'sum', label: 'Open pipeline' },
      { key: 'last_contact', type: 'rollup', via: 'messages', target_field: 'date', fn: 'latest' },
    ] },
  { id: 'people', label: 'People', colour: 'blue', query: { path: 'data/people/**' }, default_view: 'by-company',
    description: 'The people at each company. A person belongs to one company and carries the messages exchanged with them.',
    header: ['role', 'company', 'email', 'phone', 'last_message', 'follow_up'],
    page: { layout: 'stack', width: 'normal', sections: ['properties', 'children', 'note'] },
    subtables: [{ id: 'messages', label: 'Messages', collection: 'messages', bind: { person: '$self' } }],
    fields: [
      { key: 'name', type: 'text', primary: true, required: true }, text('role'), rel('company', 'companies'),
      { key: 'email', type: 'email' }, { key: 'phone', type: 'phone' }, { key: 'decision_maker', type: 'checkbox' },
      { key: 'follow_up', type: 'checkbox', label: 'Needs follow-up' }, rel('messages', 'messages', { many: true }),
      { key: 'last_message', type: 'rollup', via: 'messages', target_field: 'date', fn: 'latest' },
    ] },
  { id: 'deals', label: 'Deals', colour: 'amber', query: { path: 'data/deals/**' }, default_view: 'pipeline',
    description: 'Work being sold. A deal moves left to right through the pipeline; its line items are what an invoice is made from.',
    header: ['stage', 'amount', 'close_date', 'company', 'person', 'owner'],
    page: { layout: 'stack', width: 'normal', sections: ['properties', 'note', 'children'] },
    subtables: [
      { id: 'messages', label: 'Messages', collection: 'messages', bind: { deal: '$self' } },
      { id: 'invoices', label: 'Invoices', collection: 'invoices', bind: { deal: '$self' } },
      { id: 'todos', label: 'To-dos', collection: 'todos', bind: { deal: '$self' } },
    ],
    fields: [
      { key: 'name', type: 'text', primary: true, required: true },
      { key: 'stage', type: 'status', options: [
        { value: 'lead', group: 'todo', colour: 'blue' }, { value: 'qualified', group: 'active', colour: 'teal' }, { value: 'proposal', group: 'active', colour: 'amber' },
        { value: 'negotiation', group: 'active', colour: 'orange' }, { value: 'won', group: 'done', colour: 'ok' }, { value: 'lost', group: 'done', colour: 'red' }] },
      { key: 'amount', type: 'number', display: 'currency' }, { key: 'close_date', type: 'date' }, select('quarter', [...new Set(deals.map(d => d.quarter))].sort()),
      rel('company', 'companies'), rel('person', 'people', { label: 'Contact' }), select('owner', OWNERS), select('source', SOURCES),
      { key: 'probability', type: 'number' }, { key: 'line_items', type: 'json' },
    ] },
  { id: 'messages', label: 'Messages', colour: 'violet', query: { path: 'data/messages/**' }, default_view: 'timeline',
    description: 'Every email, call and meeting, one record each. The note is what was said.',
    header: ['date', 'channel', 'direction', 'person', 'company', 'deal'],
    page: { layout: 'stack', width: 'narrow', sections: ['properties', 'note'] },
    fields: [
      { key: 'name', type: 'text', primary: true, required: true, label: 'Subject' }, { key: 'date', type: 'date' },
      select('channel', ['email:blue', 'call:green', 'meeting:violet', 'linkedin:teal']), select('direction', ['inbound:marked', 'outbound']),
      rel('person', 'people'), rel('company', 'companies'), rel('deal', 'deals'),
    ] },
  { id: 'invoices', label: 'Invoices', colour: 'green', query: { path: 'data/invoices/**' }, default_view: 'all',
    description: 'What has been billed. An invoice is made from a deal with the Invoice plugin and can be printed from its own page.',
    header: ['status', 'amount', 'date', 'due_date', 'company', 'deal'],
    page: { layout: 'stack', width: 'normal', sections: ['properties', 'note'] },
    fields: [
      { key: 'name', type: 'text', primary: true, required: true, label: 'Number' },
      { key: 'status', type: 'status', options: [{ value: 'draft', group: 'todo' }, { value: 'sent', group: 'active', colour: 'marked' }, { value: 'overdue', group: 'active', colour: 'warn' }, { value: 'paid', group: 'done', colour: 'ok' }] },
      { key: 'amount', type: 'number', display: 'currency' }, { key: 'date', type: 'date' }, { key: 'due_date', type: 'date' },
      rel('company', 'companies'), rel('deal', 'deals'), text('label'), { key: 'line_items', type: 'json' },
    ] },
  { id: 'todos', label: 'To-dos', colour: 'pink', query: { path: 'data/todos/**' }, default_view: 'open',
    description: 'The next step on a deal. Some are written by hand; the kickoff one is made by an automation when a deal is won.',
    header: ['status', 'due', 'deal', 'company', 'owner'],
    page: { layout: 'stack', width: 'narrow', sections: ['properties', 'note'] },
    fields: [
      { key: 'name', type: 'text', primary: true, required: true },
      { key: 'status', type: 'status', options: [{ value: 'todo', group: 'todo' }, { value: 'doing', group: 'active', colour: 'marked' }, { value: 'done', group: 'done', colour: 'ok' }] },
      { key: 'due', type: 'date' }, rel('deal', 'deals'), rel('company', 'companies'), select('owner', OWNERS),
    ] },
];
for (const s of SCHEMAS) saveCollection({ id: s.id, label: s.label, query: s.query, fields: [s.fields[0]] });
for (const s of SCHEMAS) saveCollection(s);

// ── views — the ones a salesperson would actually keep ───────────────────────────────────────
const view = (id, label, type, extra = {}) => ({ id, label, type, filter: [], sort: [], group: null, size: 'm', ...extra });
const VIEWS = {
  companies: [
    view('cards', 'All companies', 'gallery', { fields: ['stage', 'tier', 'industry', 'city'], summary: true, sort: [{ field: 'name', dir: 'asc' }] }),
    view('key-accounts', 'Key accounts', 'table', { filter: [{ field: 'tier', op: 'is', value: 'key' }], fields: ['stage', 'owner', 'deal_count', 'pipeline_value', 'last_contact', 'tags'], sort: [{ field: 'pipeline_value', dir: 'desc' }] }),
    view('customers', 'Customers', 'list', { filter: [{ field: 'stage', op: 'is', value: 'customer' }], fields: ['industry', 'owner', 'last_contact'], summary: true }),
    view('by-owner', 'By owner', 'table', { group: 'owner', fields: ['stage', 'tier', 'industry', 'city', 'pipeline_value'], sort: [{ field: 'name', dir: 'asc' }] }),
  ],
  people: [
    view('by-company', 'Everyone', 'list', { group: 'company', fields: ['role', 'email', 'last_message'], summary: false, sort: [{ field: 'name', dir: 'asc' }] }),
    view('needs-follow-up', 'No reply in 14 days', 'list', { filter: [{ field: 'follow_up', op: 'is', value: true }], fields: ['role', 'company', 'last_message'], summary: false, sort: [{ field: 'last_message', dir: 'asc' }] }),
    view('decision-makers', 'Decision makers', 'table', { filter: [{ field: 'decision_maker', op: 'is', value: true }], fields: ['role', 'company', 'email', 'phone', 'last_message'] }),
  ],
  deals: [
    view('pipeline', 'Pipeline', 'board', { group: 'stage', fields: ['amount', 'close_date', 'owner'] }),
    view('closing-this-quarter', 'Closing this quarter', 'table', { filter: [{ field: 'quarter', op: 'is', value: quarterOf(TODAY) }, { field: 'stage', op: 'is-not', value: 'won' }, { field: 'stage', op: 'is-not', value: 'lost' }],
      fields: ['stage', 'amount', 'close_date', 'company', 'person', 'owner'], sort: [{ field: 'close_date', dir: 'asc' }] }),
    view('won', 'Won', 'table', { filter: [{ field: 'stage', op: 'is', value: 'won' }], fields: ['amount', 'close_date', 'company', 'owner', 'source'], sort: [{ field: 'close_date', dir: 'desc' }] }),
    view('all', 'All deals', 'table', { fields: ['stage', 'amount', 'close_date', 'company', 'owner', 'probability'], sort: [{ field: 'amount', dir: 'desc' }] }),
  ],
  messages: [
    view('timeline', 'Timeline', 'list', { fields: ['date', 'channel', 'direction'], summary: true, sort: [{ field: 'date', dir: 'desc' }] }),
    view('inbound', 'Inbound', 'list', { filter: [{ field: 'direction', op: 'is', value: 'inbound' }], fields: ['date', 'channel', 'company'], summary: true, sort: [{ field: 'date', dir: 'desc' }] }),
    view('calls-and-meetings', 'Calls and meetings', 'table', { filter: [{ field: 'channel', op: 'is-not', value: 'email' }, { field: 'channel', op: 'is-not', value: 'linkedin' }], fields: ['date', 'channel', 'person', 'company', 'deal'], sort: [{ field: 'date', dir: 'desc' }] }),
  ],
  invoices: [
    view('all', 'All invoices', 'table', { fields: ['status', 'amount', 'date', 'due_date', 'company', 'label'], sort: [{ field: 'date', dir: 'desc' }] }),
    view('by-status', 'By status', 'board', { group: 'status', fields: ['amount', 'due_date', 'label'] }),
    view('unpaid', 'Unpaid', 'table', { filter: [{ field: 'status', op: 'is-not', value: 'paid' }], fields: ['status', 'amount', 'due_date', 'company'], sort: [{ field: 'due_date', dir: 'asc' }] }),
  ],
};
VIEWS.todos = [
  view('open', 'Open', 'list', { filter: [{ field: 'status', op: 'is-not', value: 'done' }], fields: ['status', 'due', 'owner'], summary: false, sort: [{ field: 'due', dir: 'asc' }] }),
  view('by-status', 'By status', 'board', { group: 'status', fields: ['due', 'owner'] }),
  view('all', 'All to-dos', 'table', { fields: ['status', 'due', 'deal', 'company', 'owner'], sort: [{ field: 'due', dir: 'desc' }] }),
];
for (const [id, list] of Object.entries(VIEWS)) for (const v of list) saveView(id, v);

// ── records — every one through the pipeline ─────────────────────────────────────────────────
const linesTable = lines => ['| Item | Qty | Unit price | Amount |', '|---|---:|---:|---:|',
  ...lines.map(l => '| ' + l.description + ' | ' + l.quantity + ' | $' + l.unit_price.toLocaleString('en-US') + ' | $' + (l.quantity * l.unit_price).toLocaleString('en-US') + ' |')].join('\n');
const ids = list => list.map(x => x.id);
const write = (collection, items) => {
  const out = batchUpsert(items.map(item => ({ collection, ...item })), { via: 'crm-seed' });
  const bad = out.results.filter(r => r.verdict !== 'store');
  // A merge would mean two different things were folded into one file. That is a bug in the seed
  // data (two names too alike), and it must fail loudly rather than ship a workspace short a record.
  if (bad.length) { console.error(collection + ': ' + bad.length + ' record(s) did not store cleanly', bad.slice(0, 3)); process.exit(1); }
  return out.results.length;
};
// No name may contain another in the same collection (see addMessage). Checked here, before a
// single file is written, so a bad seed fails with the two names instead of a short workspace.
for (const [label, list] of [['companies', companies], ['people', people], ['deals', deals], ['messages', messages], ['invoices', invoices], ['todos', todos]]) {
  const names = list.map(x => x.name.toLowerCase());
  names.forEach((a, i) => names.forEach((b, j) => { if (i !== j && b.includes(a)) { console.error(label + ': "' + list[j].name + '" contains "' + list[i].name + '"'); process.exit(1); } }));
}
const counts = {};
counts.companies = write('companies', companies.map(c => ({ id: c.id, name: c.name, stage: c.stage, tier: c.tier, industry: c.industry, size: c.size, owner: c.owner,
  city: c.city, website: c.website, tags: c.tags, deals: ids(c.deals), open_deals: ids(c.open_deals), messages: ids(c.messages),
  body: COMPANY_NOTE[c.industry] + (c.deals.length ? '\n\nFirst contact came through ' + c.deals[0].source + '.' : '\n\nNo project yet. On the list to approach this season.') })));
counts.people = write('people', people.map(p => ({ id: p.id, name: p.name, role: p.role, company: p.company, email: p.email, phone: p.phone,
  decision_maker: p.decision_maker, follow_up: p.follow_up, messages: ids(p.messages),
  body: p.decision_maker ? 'Signs off on creative work at ' + p.companyRef.name + '. Prefers a call to a long email.' : 'Day-to-day contact at ' + p.companyRef.name + '.' })));
counts.deals = write('deals', deals.map(d => ({ id: d.id, name: d.name, stage: d.stage, amount: d.amount, close_date: d.close_date, quarter: d.quarter, company: d.company,
  person: d.person, owner: d.owner, source: d.source, probability: d.probability, line_items: d.line_items,
  body: d.service + ' for ' + d.c.name + '.' + (d.lost_why ? ' Lost: ' + d.lost_why : '') + '\n\n## Scope\n\n' + linesTable(d.line_items) + '\n\n**Total: $' + d.amount.toLocaleString('en-US') + '**' })));
counts.messages = write('messages', messages.map(m => ({ id: m.id, name: m.name, date: m.date, channel: m.channel, direction: m.direction, person: m.person, company: m.company,
  ...(m.deal ? { deal: m.deal } : {}), body: m.body })));
counts.invoices = write('invoices', invoices.map(v => ({ id: v.id, name: v.name, status: v.status, amount: v.amount, date: v.date, due_date: v.due_date, company: v.company,
  ...(v.deal ? { deal: v.deal } : {}), label: v.label, line_items: v.line_items,
  body: v.label + '.\n\n## Lines\n\n' + linesTable(v.line_items) + '\n\n**Total: $' + v.amount.toLocaleString('en-US') + '**' })));

counts.todos = write('todos', todos.map(t => ({ ...t })));

// ── memory — who this is, what they are chasing, what has been learned ───────────────────────
writeMe([
  'Crystal — I run sales at Lantern Studio, a small film and photo studio.',
  '',
  '## What I am looking for',
  'Companies with a product or a place worth showing, a real launch date, and someone who can sign off without a committee.',
  '',
  '## Not this',
  'One-off favours, unpaid pitches, anyone who wants the raw footage and nothing else.',
  '',
  '## What a win is',
  'A signed deal with a deposit invoice sent.',
  '',
  '## How I work',
  'One clear next step per deal. I answer inbound the same day. Nothing is sent in my name without my yes.',
].join('\n'), { name: 'Crystal', ...STUDIO });
const won = deals.filter(d => d.stage === 'won');
const firstWon = '[[data/deals/' + won[0].id + ']]', secondWon = '[[data/deals/' + won[1].id + ']]';
saveGoal('win-twelve-deals-this-quarter', { label: 'Win 12 deals this quarter', target: 12, unit: 'deals', deadline: quarterOf(TODAY).slice(0, 4) + '-12-31', created: daysAgo(48),
  count: { path: 'data/deals/**', where: { stage: 'won', quarter: quarterOf(TODAY) } }, body: 'Counted from the deals marked won with a close date in this quarter. Never typed in here.' });
saveGoal('answer-every-inbound-in-a-day', { label: 'Nobody waits more than 14 days', target: 0, unit: 'people waiting', deadline: iso(base + 30 * DAY), created: daysAgo(30),
  count: { path: 'data/people/**', where: { follow_up: true } }, body: 'The count is the people whose last message was theirs and is older than two weeks. The follow-up skill keeps it honest.' });
savePlaybook('split-the-invoice', { title: 'Offer two payments', claim: 'Offering a 50/50 split closes deals that stall on price', evidence: [firstWon, secondWon], wins: 2, verified_at: daysAgo(9),
  body: 'When a proposal comes back with "can it be cheaper", offering the same price in two invoices has closed it without cutting scope.' });
savePlaybook('call-before-proposal', { title: 'Call before the proposal', claim: 'A discovery call before any written proposal doubles the reply rate', evidence: [firstWon], wins: 1, verified_at: daysAgo(21),
  body: 'Proposals sent cold sat unanswered. The ones that followed a call got a reply inside a week.' });
savePlaybook('founders-decide-fast', { title: 'Go to the founder', claim: 'Deals where the first contact is the founder close in half the time', evidence: [secondWon], wins: 1, verified_at: daysAgo(40),
  body: 'Marketing leads need a second sign-off. Founders say yes or no on the call.' });
saveLearning('no-raw-footage', { claim: 'Crystal never includes raw footage in a quote', scope: 'global', status: 'active', evidence: [firstWon],
  body: 'Said on a proposal review: raw footage is a separate line, priced separately, and only when asked for.' });
saveLearning('quotes-are-fixed-price', { claim: 'Quotes are fixed price, valid 30 days', scope: 'global', status: 'active', evidence: [secondWon],
  body: 'Day rates invite haggling. Every proposal names one price and an expiry date.' });

// ── one assistant and the workspace's own skill ──────────────────────────────────────────────
saveAssistant('follow-up', { name: 'Follow-up', job: 'Finds the people who have been waiting for a reply and drafts the next message, for you to approve.',
  scope: { collections: ['people', 'messages', 'deals'], territory: [] }, schedule: 'daily', status: 'idle',
  body: 'Drafts only. A message leaves when you approve its card, never before.' });
const skillDir = path.join(root, 'skills', 'follow-up');
fs.mkdirSync(skillDir, { recursive: true });
const skillFile = path.join(skillDir, 'SKILL.md');
fs.writeFileSync(skillFile + '.tmp', [
  '---',
  'name: follow-up',
  'description: Find the people who are waiting on a reply and draft the next message for approval. Use when asked who needs a follow-up, or on the daily schedule.',
  'reads: [people, messages, deals]',
  'writes: [messages]',
  'schedule: daily',
  'assistant: follow-up',
  '---',
  '',
  '# Follow-up',
  '',
  'Who is waiting, and what should we say next.',
  '',
  '## Where to look',
  '',
  '1. `people` — the view **No reply in 14 days** (`follow_up` is true). These are the people whose last message was theirs.',
  '2. For each person, their `messages` (newest first) and their open `deals`.',
  '3. `playbook/` — what has worked. `learnings/` — how Crystal wants quotes and messages written.',
  '',
  '## What to do',
  '',
  '1. Read the last two messages in the thread. Do not guess what was said.',
  '2. Draft ONE reply: two or three sentences, one clear next step, in Crystal\'s voice.',
  '3. Propose it as an outbound card. Never send. Never mark `follow_up` false yourself.',
  '',
  '## What to write down',
  '',
  '- The draft goes into the proposal card, linked to the person and the deal.',
  '- When Crystal approves it, the message is stored in `messages` and `follow_up` clears.',
  '- If she rewrites your draft, propose a learning with what she changed.',
  '',
].join('\n'));
fs.renameSync(skillFile + '.tmp', skillFile);

// ── two automations, so "when this happens, do that" has something to show ───────────────────
// Imported only now: the module listens to every record write, and the four hundred above are a
// seed, not something that happened.
const { createAutomation } = await import('../backend/automations.mjs');
createAutomation({
  name: 'Invoice when a deal is won', mode: 'ask',
  when: { on: 'field_becomes', collection: 'deals', field: 'stage', value: 'won' },
  do: { run: 'plugin', plugin: 'invoice', action: 'create' },
  note: 'Asks first, because an invoice number is used up the moment it is filed. Yes presses “Create invoice” with its usual values: the next number, today, the whole amount, 14 days.',
}, { actor: 'crystal' });
createAutomation({
  name: 'Kickoff to-do when a deal is won', mode: 'auto',
  when: { on: 'field_becomes', collection: 'deals', field: 'stage', value: 'won' },
  do: { run: 'create_record', collection: 'todos', fields: { name: 'Book the kickoff — {{name}}', status: 'todo', deal: '{{slug}}', company: '{{company}}', owner: '{{owner}}' } },
  note: 'Does it without asking: a to-do is cheap to make and easy to tick off. It is linked to the deal and its company and given to the deal’s owner.',
}, { actor: 'crystal' });

try { flushCacheRegen(); } catch { /* the cache is rebuilt on the first read anyway */ }

if (!quiet) {
  console.log('CRM showcase written to ' + root);
  console.log('  ' + Object.entries(counts).map(([k, n]) => n + ' ' + k).join(' · '));
  console.log('  2 goals · 3 playbook claims · 2 learnings · 1 assistant · 1 skill · 2 automations');
  console.log('  ' + people.filter(p => p.follow_up).length + ' people waiting on a reply · ' + deals.filter(d => !['won', 'lost'].includes(d.stage)).length + ' open deals worth $'
    + deals.filter(d => !['won', 'lost'].includes(d.stage)).reduce((s, d) => s + d.amount, 0).toLocaleString('en-US'));
}
process.exit(0);
