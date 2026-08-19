// First-run seeding: writes the prototype dataset into the storage root as .md files.
import fs from 'fs';
import path from 'path';
import { paths, writeMd, readMd, getStorageRoot, saveSettings, stamp } from './store.mjs';
import { STARTER_SNIPPETS, starterFileName } from './snippetSeeds.mjs';

const PROJECTS = {
  neon: { order: 0, name: 'Neon Harvest', sub: 'Brand film', scenes: 'S01–S05', when: 'last activity 8 min ago', gradIx: 0, model: 'Veo 3.1 · fal.ai', style: 'neon-harvest-v3' },
  orb: { order: 1, name: 'Orbital Coffee', sub: 'Launch teaser', scenes: 'S01–S03', when: 'last activity 1 h ago', gradIx: 12, model: 'Veo 3.1 · fal.ai', style: 'orbital-v2' },
  fn: { order: 2, name: 'Field Notes S2', sub: 'Title sequence', scenes: 'S01–S03', when: 'tracked yesterday', gradIx: 13, model: 'Kling 2.5 · fal.ai', style: 'field-notes-v1' }
};

const BRIEFS = {
  neon: `# Neon Harvest — project brief

90-second brand film. Scenes S01–S05 cut against a voice-over.

**Core aesthetic:** 35mm anamorphic, shallow depth of field, heavy film grain,
amber rim light against cold teal shadows. Dusk-to-night palette; neon should
bloom, never strobe.

**Camera language:** slow, deliberate moves — dollies and cranes, no handheld.
Lock the horizon. If a move drifts, kill it.

**Do not:** whip pans, lens flares pointed at camera, daylight looks, fast cuts.

Every re-roll reads this block verbatim before touching the prompt.`,
  orb: `# Orbital Coffee — project brief

Launch teaser, 30s. Macro-first: beans, pours, steam. Warm espresso browns
against matte black. Product hero must stay tack-sharp; motion is slow-mo only.`,
  fn: `# Field Notes S2 — project brief

Title sequence. Natural light, fog, topographic textures. Muted earth tones,
no saturation pushes. Documentary stillness — static frames or 2s drifts max.`
};

// [proj, scene, name, label, type, durS, cost, gradIx, status, rating, extras, created]
const ROWS = [
  ['neon','S01','S01_T01_sunrise-wide','SUNRISE OVER FIELDS — WIDE','clip',6,0.52,6,'kept',4,{},'Jul 3, 09:12'],
  ['neon','S01','S01_T02_sunrise-drone','SUNRISE — DRONE PUSH','clip',8,0.68,1,'killed',0,{},'Jul 3, 09:14'],
  ['neon','S01','S01_T03_field-macro','DEW ON LEAVES — MACRO','clip',4,0.41,10,'kept',3,{},'Jul 3, 09:20'],
  ['neon','S02','S02_T02_market-dolly','MARKET — DOLLY THROUGH','clip',5,0.44,5,'kept',4,{fin:1},'Jul 4, 11:02'],
  ['neon','S02','S02_T05_market-steadicam','MARKET — STEADICAM','clip',6,0.52,3,'killed',0,{},'Jul 4, 11:10'],
  ['neon','S03','S03_T04_dolly-in_v3','DAWN OVER THE GRID — DOLLY IN','clip',6,0.48,2,'kept',4,{fb:1,fbState:'done',note:'camera drifts left — lock it off'},'Jul 6, 14:22'],
  ['neon','S03','S03_T07_grid-flyover','THE GRID — FLYOVER','clip',7,0.58,7,'kept',2,{fb:1,fbState:'queued',note:'too fast — half the speed, hold the horizon',flag:1,prio:'P1'},'Jul 6, 14:40'],
  ['neon','S04','S04_T07_rooftop-dusk','ROOFTOP AT DUSK','clip',7,0.58,9,'kept',5,{fin:1},'Jul 5, 16:05'],
  ['neon','S04','S04_T02_alley-track','ALLEY — TRACKING SHOT','clip',6,1.44,11,'kept',3,{flag:1},'Jul 5, 16:22'],
  ['neon','S04','hero_frame_012.png','HERO FRAME','img',0,0.06,8,'kept',3,{},'Jul 5, 17:01'],
  ['neon','S04','hero_frame_017.png','HERO FRAME ALT','img',0,0.06,5,'killed',0,{},'Jul 5, 17:03'],
  ['neon','S00','style_lock_v3.png','STYLE LOCK v3','style',0,0.08,8,'kept',0,{fin:1},'Jul 2, 10:00'],
  ['neon','S00','master_cut_v1.mp4','MASTER CUT v1','render',92,2.10,0,'new',0,{prio:'P1'},'Jul 6, 18:30'],
  ['neon','S05','S05_T01_wide-establish','NIGHT MARKET — WIDE','clip',6,0.52,0,'new',0,{},'Jul 6, 21:04'],
  ['neon','S05','S05_T02_crane-down','CRANE DOWN TO STALLS','clip',8,0.68,1,'new',0,{},'Jul 6, 21:06'],
  ['neon','S05','S05_T03_vendor-cu','VENDOR CLOSE-UP','clip',4,0.41,3,'new',0,{},'Jul 6, 21:09'],
  ['neon','S05','S05_T04_steam-macro','STEAM MACRO','clip',5,0.44,3,'new',0,{},'Jul 6, 21:11'],
  ['neon','S05','S05_T05_neon-sign','NEON SIGN FLICKER','clip',4,0.41,4,'new',0,{},'Jul 6, 21:13'],
  ['neon','S05','S05_T06_crowd-pan','CROWD PAN LEFT','clip',7,0.58,5,'new',0,{},'Jul 6, 21:15'],
  ['neon','S05','S05_T07_lantern-rise','LANTERNS RISE','clip',6,0.52,6,'new',0,{},'Jul 6, 21:18'],
  ['neon','S05','S05_T08_rain-slowmo','RAIN SLOW-MO','clip',5,0.61,7,'new',0,{},'Jul 6, 21:20'],
  ['neon','S05','S05_T09_hero-drink','HERO PRODUCT SHOT','clip',6,0.52,8,'new',0,{},'Jul 6, 21:22'],
  ['neon','S05','S05_T10_pullback-end','FINAL PULL-BACK','clip',8,0.68,9,'new',0,{},'Jul 6, 21:25'],
  ['orb','S01','OC_T01_bean-macro','COFFEE BEAN — MACRO','clip',5,0.44,12,'kept',4,{fin:1},'Jul 1, 12:10'],
  ['orb','S01','OC_T04_pour-slowmo','POUR — SLOW-MO','clip',6,0.52,2,'kept',5,{fin:1},'Jul 1, 12:30'],
  ['orb','S02','OC_T07_steam-rise','STEAM RISE','clip',4,0.41,3,'killed',0,{},'Jul 1, 13:02'],
  ['orb','S02','OC_logo_lockup.png','LOGO LOCKUP','img',0,0.06,12,'kept',4,{},'Jul 1, 14:00'],
  ['orb','S00','oc_style_v2.png','STYLE LOCK v2','style',0,0.08,12,'kept',0,{fin:1},'Jun 30, 09:00'],
  ['orb','S03','master_v2.mp4','MASTER v2','render',45,1.20,12,'kept',5,{fin:1},'Jul 6, 17:00'],
  ['fn','S01','FN_T01_ridge-fog','RIDGE IN FOG','clip',6,0.52,13,'new',0,{},'Jul 6, 08:00'],
  ['fn','S01','FN_T02_river-pan','RIVER PAN','clip',7,0.58,10,'new',0,{},'Jul 6, 08:04'],
  ['fn','S02','FN_T03_tent-lantern','TENT LANTERN — NIGHT','clip',5,0.44,6,'new',0,{},'Jul 6, 08:08'],
  ['fn','S02','FN_T04_map-macro','MAP — MACRO','clip',4,0.41,11,'new',0,{},'Jul 6, 08:11'],
  ['fn','S03','FN_T05_summit-drone','SUMMIT — DRONE ORBIT','clip',8,0.68,7,'new',0,{},'Jul 6, 08:15'],
  ['fn','S03','FN_T06_campfire-cu','CAMPFIRE CLOSE-UP','clip',6,0.52,8,'new',0,{},'Jul 6, 08:18']
];

const SEED_ACTIVITY = [
  { dot: 'amber', t: '10 new clips landed', t2: '· Neon Harvest / S05', s: 'from batch “night-market takes” · 8 min ago', kind: 'proj', ref: 'neon' },
  { dot: 'green', t: 'Re-roll ready:', t2: 'S03_T04 v3 — from your note “camera drifts left”', s: 'Neon Harvest · 24 min ago', kind: 'item', ref: 'S03_T04_dolly-in_v3', hl: 1 },
  { dot: 'grey', t: 'Render finished', t2: '· master_cut_v1.mp4', s: 'Neon Harvest · 1 h ago', kind: 'item', ref: 'master_cut_v1.mp4' },
  { dot: 'green', t: 'Queue cleared', t2: '— 6 of 6 reviewed', s: 'Orbital Coffee · yesterday · 5 kept, 1 killed', kind: 'proj', ref: 'orb' },
  { dot: 'grey', t: '6 new clips tracked', t2: '· Field Notes S2', s: 'yesterday', kind: 'proj', ref: 'fn' }
];

const CONTEXT_SEEDS = {
  neon: [
    ['visual-references.md', '# Visual references\n\nBlade Runner 2049 market scenes — sodium vapor against teal.\nWong Kar-wai neon bloom, never strobe.\nKodak 500T halation on practicals.\n\nPull stills into this folder; the agent reads everything here.'],
    ['vo-script.txt', 'VO DRAFT v3 — 90s\n\n[S01] Before the city wakes, the fields are already working.\n[S02] Every stall, every hand, every trade — powered by the harvest.\n[S03] Dawn over the grid. This is where it all connects.\n[S04] From rooftop to alley, the city runs on what we grow.\n[S05] Neon Harvest. The night market never sleeps.'],
    ['client-notes.md', '# Client notes — kickoff call Jul 2\n\n- Logo appears ONLY in the final pull-back (S05_T10)\n- No faces recognizable (rights)\n- Deliverables: 90s hero + 15s cutdowns, 16:9 + 9:16\n- Hard deadline: Jul 18']
  ],
  orb: [
    ['product-specs.md', '# Product — Orbital Coffee\n\nMatte black 250g bag, copper foil lockup.\nHero angle: 3/4 front, low.\nBrand browns: #3E2A1E / #C87A3B. Never pure black backgrounds — use #0F0C0A.']
  ],
  fn: [
    ['episode-outline.md', '# S2 title sequence — outline\n\n6 shots, 22s total. Fog → river → tent → map → summit → fire.\nType plates land on shots 2, 4, 6. Natural light only.']
  ]
};

function promptOf(row, proj) {
  const [, , , label, type, durS] = row;
  return label.toLowerCase() + ', 35mm anamorphic, shallow depth, film grain, amber rim light —style ' + proj.style + (type === 'clip' ? ' —dur ' + durS + 's' : '');
}

export function seedIfEmpty() {
  const root = getStorageRoot();
  if (fs.existsSync(paths.settings())) return false;
  fs.mkdirSync(root, { recursive: true });
  saveSettings({});

  for (const [pid, p] of Object.entries(PROJECTS)) {
    writeMd(paths.projectMd(pid), { ...p }, 'Project metadata for ' + p.name + '.\n');
    writeMd(paths.briefMd(pid), { project: pid, updated: 'Jul 6, 18:00' }, BRIEFS[pid] + '\n');
  }

  ROWS.forEach((r, i) => {
    const [proj, scene, name, label, type, durS, cost, gradIx, st, rating, ex, created] = r;
    const data = {
      id: name, scene, name, label, type, durS, cost, gradIx,
      st, rating, fin: !!ex.fin, flag: !!ex.flag, prio: ex.prio || '',
      fb: !!ex.fb, fbState: ex.fbState || null, note: ex.note || '',
      created, trashed: false, tl: i, versions: null, justArrivedAt: 0,
      prompt: promptOf(r, PROJECTS[proj])
    };
    if (name === 'S03_T04_dolly-in_v3') {
      data.versions = [
        { v: 'v1', cost: 0.44, date: 'Jul 4', gradIx: -1, grad: 'linear-gradient(120deg,#0d1f2e,#2a3f4c 60%,#8a7a5a)' },
        { v: 'v2', cost: 0.44, date: 'Jul 5', gradIx: -1, grad: 'linear-gradient(120deg,#0d1f2e,#1f4a5c 55%,#c98a5a)' },
        { v: 'v3', cost: 0.48, date: 'today', gradIx: 2 }
      ];
    }
    writeMd(paths.itemMd(proj, name), data,
      ex.note ? '## Feedback log\n\n- ' + created + ' — note: "' + ex.note + '"' : '## Feedback log');
  });

  writeMd(paths.activityMd(), { events: SEED_ACTIVITY.map((e, i) => ({ ts: Date.now() - i * 3.6e6, ...e })) },
    'Recent activity, newest first. Rendered on the FrameForge home page.\n');

  // skill history starts empty — bumpHistory() logs real usage from day one; nothing is fabricated.

  // starter context assets per project
  seedContext(root);
  installStarterSnippets(root);
  return true;
}

// Installs the curated starter snippets, skipping any trigger the user already owns.
// Runs on first-run seeding and again on demand from POST /api/snippets/seed, which is how
// storage roots created before this pack existed catch up. Matching is by trigger rather than
// filename because the trigger is what the user types — a hand-written /grain must win over
// ours even if it lives in a differently-named file.
// Nothing here ever overwrites, and that takes BOTH gates below: the trigger set covers snippets
// that live under a name we'd never pick, while the existsSync on the target path covers the case
// the trigger set structurally cannot see — PATCH /api/snippets/:file rewrites a snippet's trigger
// without renaming its file, so after `PATCH 130-grain.md {trigger:'filmgrain'}` the trigger
// `grain` is no longer taken while 130-grain.md is very much the user's file.
export function installStarterSnippets(root) {
  const dir = path.join(root, 'snippets');
  fs.mkdirSync(dir, { recursive: true });
  const taken = new Set();
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('.'))) {
    // read the frontmatter rather than trusting the filename: PATCH can retrigger a snippet
    // without renaming its file, so the file's name is not a reliable trigger.
    try { const t = readMd(path.join(dir, f)).data.trigger; if (t) taken.add(String(t)); }
    catch { /* unparseable file — leave it alone, but do not let it block the install */ }
  }
  let added = 0, skipped = 0;
  STARTER_SNIPPETS.forEach((s, i) => {
    if (taken.has(s.trigger)) { skipped++; return; }
    const file = path.join(dir, starterFileName(i, s.trigger));
    // never write over an existing path, whatever its frontmatter now says — see the note above
    if (fs.existsSync(file)) { skipped++; return; }
    writeMd(file, { name: s.name, trigger: s.trigger, created: stamp() }, s.content + '\n');
    added++;
  });
  return { added, skipped };
}

export function seedContext(root) {
  for (const [pid, files] of Object.entries(CONTEXT_SEEDS)) {
    const dir = path.join(root, 'projects', pid, 'context');
    if (fs.existsSync(dir)) continue;
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of files) fs.writeFileSync(path.join(dir, name), content + '\n');
  }
  // demo moodboard folder (generated frames) so the mosaic grid has something to show
  const mb = path.join(root, 'projects', 'neon', 'context', 'moodboard');
  if (fs.existsSync(path.join(root, 'projects', 'neon')) && !fs.existsSync(mb)) {
    fs.mkdirSync(mb, { recursive: true });
    const frame = (w, h, c1, c2, c3, label) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${c1}"/><stop offset=".55" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/>` +
      `</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>` +
      `<rect width="100%" height="100%" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="12"/>` +
      `<text x="28" y="${h - 28}" font-family="ui-monospace,monospace" font-size="${Math.round(w / 34)}" fill="rgba(255,255,255,.8)" letter-spacing="6">${label}</text></svg>`;
    const frames = [
      ['mb-01_night-wide.svg', 1280, 800, '#0e1a2e', '#24456b', '#e89a4a', 'NIGHT MARKET'],
      ['mb-02_neon-portrait.svg', 800, 1120, '#1f1424', '#45204d', '#e85a8a', 'NEON PORTRAIT'],
      ['mb-03_amber-rim.svg', 1280, 720, '#140f0a', '#3d2410', '#f0a542', 'AMBER RIM'],
      ['mb-04_teal-alley.svg', 960, 960, '#0a1420', '#14304d', '#6ab4e8', 'TEAL ALLEY'],
      ['mb-05_grain-macro.svg', 1280, 560, '#1a0f14', '#4d1f2e', '#e8a33d', 'FILM GRAIN'],
      ['mb-06_dusk-grid.svg', 800, 1000, '#0d1f2e', '#1f4a5c', '#e8a06a', 'DUSK GRID'],
      ['mb-07_lantern.svg', 1280, 760, '#231d10', '#4d3a12', '#93a75c', 'LANTERNS'],
      ['mb-08_rain-slow.svg', 900, 700, '#0d0e1a', '#2e2456', '#e86a5a', 'RAIN SLOW-MO']
    ];
    for (const [name, w, h, c1, c2, c3, label] of frames)
      fs.writeFileSync(path.join(mb, name), frame(w, h, c1, c2, c3, label));
  }
}
