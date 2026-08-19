// bench-store.mjs — synthetic-corpus benchmark for the markdown datastore.
//
// Why this exists: `docs/specs/derived-index/` optimises the read paths, and without a committed
// baseline the next session cannot tell an improvement from a regression. See
// `docs/specs/derived-index/issues/01-bench-harness.md`.
//
//   node scripts/bench-store.mjs                  # all tiers, compare against the baseline
//   node scripts/bench-store.mjs --tier=small     # one tier
//   node scripts/bench-store.mjs --json           # machine-readable results on stdout
//   node scripts/bench-store.mjs --write-baseline # overwrite scripts/bench-baseline.json
//
// Zero deps, plain ESM, node builtins only — same shape as the other one-offs in scripts/.
// `scripts/` is excluded from the electron-builder `files` list, so none of this ships to users.
//
// ── the corpus is synthetic, and `workspace/` is never touched ──
// Benching the live workspace is not reproducible (gitignored, different on every machine, holds
// live API keys). Everything below runs against an mkdtemp root that is removed on exit.
//
// ── cold vs warm ──
// COLD is a genuinely fresh process: the parent seeds the tier roots once, then re-spawns itself
// per (tier, metric, sample) so the first call in that child has no module state and no cache
// behind it. WARM is the same call again, in the same child. Today the two columns are identical
// because nothing in `backend/` caches reads; that is the point. After ticket 05 lands, warm should
// collapse while cold stays flat, and that gap is the only proof the cache did anything.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const SELF = fileURLToPath(import.meta.url);
const BASELINE_FILE = path.join(path.dirname(SELF), 'bench-baseline.json');

// ── args ──
const ARGV = process.argv.slice(2);
const flag = name => ARGV.includes('--' + name);
const opt = name => {
  const hit = ARGV.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : null;
};

const TIERS = {
  //         projects  shots  gens  items  library assets
  small:  { projects: 3,  shots: 20,  gens: 40,  items: 20,  assets: 50 },
  medium: { projects: 10, shots: 60,  gens: 200, items: 60,  assets: 500 },
  large:  { projects: 25, shots: 120, gens: 600, items: 150, assets: 2000 }
};
// Median of N per metric per column. The ticket specifies 5 and then says to raise it if two runs
// back to back don't land within the band — they didn't at 5 (small/listProjects swung +56%), so
// this is 9. Runtime is linear in it: a full three-tier run is ~3 min at 9.
const SAMPLES = 9;
// Regressions smaller than this in absolute terms never fail the run. Every cold sample is the
// first call in a brand-new process, so it carries V8's lazy-compile cost and a first-touch page
// cache; on a ~3 ms metric that jitter alone is worth ±50%, and a benchmark that fails randomly
// gets ignored inside a week. This is why the tier ladder exists: a real regression in listProjects
// or listItems shows up at medium/large, where the absolute numbers are big enough to gate on.
const MIN_ABS_MS = 3;
const REGRESSION_PCT = 15;

// ── metric registry ──
// Each entry gets `ctx` (the imported backend namespaces + a few pre-resolved ids) and runs ONE
// invocation. The harness calls it twice per child: first = cold, second = warm.
const METRICS = {
  listProjects:      ctx => ctx.store.listProjects(),
  listItems:         ctx => ctx.store.listItems(),
  listAllShots:      ctx => ctx.story.listAllShots(),
  listAssets:        ctx => ctx.library.listAssets('library'),
  getShot:           ctx => ctx.story.getShot(ctx.pid, ctx.shotId),
  // Full reverse of one project's shots. Reversing changes EVERY shot's `no`, so every one is
  // rewritten — deterministic worst case. It is also self-inverting, so repeated samples all cost
  // the same and the corpus never drifts.
  reorderShots:      ctx => ctx.story.reorderShots(ctx.pid, ctx.story.listShots(ctx.pid).map(s => s.id).reverse()),
  searchText:        ctx => ctx.search.search('drone'),
  searchFiltered:    ctx => ctx.search.search('p:' + ctx.pid + ' rating:>=4'),
  apiState:          ctx => apiStatePayload(ctx),
  appendActivity100: ctx => { for (let i = 0; i < 100; i++) ctx.store.appendActivity({ dot: 'green', t: 'bench', t2: '#' + i, kind: 'bench' }); },
  ledger100:         ctx => { for (let i = 0; i < 100; i++) ctx.ledger.ledger({ service: 'fal', op: 'image', model: 'fal-ai/flux/schnell', units: '1', cost: 0.003, ref: 'bench-' + i }); }
};
const METRIC_NAMES = Object.keys(METRICS);

// Mirrors the GET /api/state handler body (`backend/index.mjs:284-324`) — the projects map at
// :291-296 plus the res.json payload at :297-323. The HTTP server is deliberately NOT booted: an
// in-process express round trip would add noise this benchmark is not trying to measure.
// NB `providersStatus()` reaches `resolveBin()` (`backend/jobs.mjs:77-102`), which shells out to
// `which` twice per call with no memoisation. That is genuinely what the route does, so it stays
// in — but it contributes a machine-dependent constant of a few ms that does not scale with tier.
function apiStatePayload(ctx) {
  const { store, story, library, generate, ledger, jobs, batches, sessions, indexer, agentHome, providers, groq, fal, integrations } = ctx;
  const projects = store.listProjects().map(p => ({
    ...p,
    context: library.listAssets(p.id),
    gens: generate.listGenerations(p.id),
    story: story.getStory(p.id).content ? true : false
  }));
  return {
    revision: indexer.currentRevision(),
    storageRoot: store.getStorageRoot(),
    settings: store.publicSettings(),
    integrations: integrations.INTEGRATIONS,
    modules: integrations.resolveModules(store.getSettings()),
    projects,
    items: store.listItems(),
    shots: story.listAllShots(),
    library: library.listAssets('library'),
    activity: store.getActivity(),
    history: store.getHistory(),
    skillRepos: store.scanSkillRepos(),
    chatSkills: agentHome.chatSkillsSurface(),
    ledger: ledger.getLedger(),
    ledgerRollup: ledger.getLedgerRollup(),
    jobs: jobs.listJobs(),
    batches: batches.listBatches(),
    reviewSessions: sessions.listSessions(),
    groqReady: !!groq.groqKey(),
    falReady: !!fal.falKey(),
    kieReady: !!providers.kieKey(),
    providers: providers.providersStatus()
  };
}

// ── backend loader ──
// store.mjs captures CONFIG_MD / DEFAULT_ROOT at MODULE LOAD (`backend/store.mjs:18-19`), so the
// storage-root env has to be set before the import is evaluated. Static imports hoist above all
// top-level code, hence dynamic import. `tests/_env.mjs` documents the same trap and solves it with
// a separate first-imported module; a single-file script has to do it this way.
async function loadBackend(dataRoot, configFile) {
  process.env.FRFG_CONFIG = configFile;
  process.env.FRFG_DATA = dataRoot;
  // Same hermetic switch the tests use: gates only startGeneration's queue runner and the agent CLI
  // spawn, neither of which is on a measured path. Keeps a stray subprocess out of the numbers.
  process.env.FRFG_TEST = '1';
  const [store, story, library, generate, ledger, jobs, batches, sessions, search, indexer, agentHome, providers, groq, fal, integrations] = await Promise.all([
    import('../backend/store.mjs'), import('../backend/story.mjs'), import('../backend/library.mjs'),
    import('../backend/generate.mjs'), import('../backend/ledger.mjs'), import('../backend/jobs.mjs'),
    import('../backend/batches.mjs'), import('../backend/sessions.mjs'), import('../backend/search.mjs'),
    import('../backend/indexer.mjs'), import('../backend/agentHome.mjs'), import('../backend/providers.mjs'),
    import('../backend/groq.mjs'), import('../backend/fal.mjs'), import('../shared/integrations.mjs')
  ]);
  return { store, story, library, generate, ledger, jobs, batches, sessions, search, indexer, agentHome, providers, groq, fal, integrations };
}

// ── seeding ──
// Frontmatter shapes are COPIED from tests/helpers.mjs (seedProject / seedShot / seedGen / seedItem)
// rather than imported: that helper pulls in backend/index.mjs, which builds the whole express app
// and every route module, so importing it would make this benchmark measure module load.
const projectId = i => 'bench-p' + String(i).padStart(2, '0');
const shotIdOf = n => 'SH' + String(n * 10).padStart(3, '0');
// One in five records carries the free-text needle, so `search('drone')` matches a realistic slice
// instead of everything or nothing.
const needle = i => (i % 5 === 0 ? ' drone ' : ' handheld ');

function seedTier(ctx, root, cfg) {
  const { store, story, library } = ctx;
  fs.mkdirSync(path.join(root, 'projects'), { recursive: true });
  store.setStorageRoot(root);
  const { paths, writeMd } = store;

  // Empty skillRepos: the default (`store.mjs:85-87`) points at ~/.claude/skills, and both
  // scanSkillRepos() and agentHome's pack scan would then walk the real user home — not synthetic,
  // not reproducible, and wildly variable between machines.
  store.saveSettings({ skillRepos: [], onboarded: true, budget: 60 });

  for (let p = 0; p < cfg.projects; p++) {
    const pid = projectId(p);
    writeMd(paths.projectMd(pid), { name: 'Bench project ' + p, order: p + 1, sub: 'synthetic corpus', gradIx: p % 6 }, '');
    writeMd(paths.briefMd(pid), { project: pid, updated: 'Jan 1, 00:00' }, 'Synthetic brief for ' + pid + '.\n');
    writeMd(path.join(paths.projectDir(pid), 'story.md'), { project: pid, updated: 'Jan 1, 00:00' },
      'Synthetic story body for ' + pid + '.' + needle(p) + 'Repeated prose so the haystack has real length.\n');
    fs.mkdirSync(paths.itemsDir(pid), { recursive: true });

    for (let s = 1; s <= cfg.shots; s++) {
      const id = shotIdOf(s);
      writeMd(path.join(paths.projectDir(pid), 'shots', id + '.md'), {
        id, no: s, title: 'Shot ' + s, type: 'Medium', dur: 4, status: s % 3 === 0 ? 'done' : 'todo',
        prompt: 'A cinematic plate,' + needle(s) + 'shot on 35mm.', desc: 'Synthetic shot description ' + s + '.',
        tags: ['bench', 'tier'], assets: [], created: 'Jan 1, 00:00', updated: 'Jan 1, 00:00'
      }, '## Shot log\n');
    }
    for (let g = 0; g < cfg.gens; g++) {
      const id = 'gen-' + String(g).padStart(4, '0');
      writeMd(path.join(paths.projectDir(pid), 'generations', id + '.md'), {
        id, status: 'done', model: 'fal-ai/flux/schnell', prompt: 'Generated frame' + needle(g) + 'with grain.',
        cost: 0.003, started: 1700000000000 + g * 1000, shot: shotIdOf((g % cfg.shots) + 1),
        rating: g % 6, final: g % 11 === 0, file: g % 4 === 0 ? id + '.mp4' : id + '.png'
      }, 'Generation record\n');
    }
    for (let it = 0; it < cfg.items; it++) {
      const id = 'item-' + String(it).padStart(4, '0');
      writeMd(paths.itemMd(pid, id), {
        id, name: 'Item ' + it, label: 'Item ' + it, type: 'img', st: 'new', rating: it % 6,
        fin: false, trashed: false, tl: it, prompt: 'Triage candidate' + needle(it) + 'plate.'
      }, '## Item log\n');
    }
  }

  // Library assets — real files plus a .meta.md sidecar each. The sidecar read is half the cost of
  // listAssets (`backend/library.mjs:74`), so a corpus without them measures the wrong thing.
  const libDir = path.join(library.libraryDir(), 'plates');
  fs.mkdirSync(libDir, { recursive: true });
  for (let a = 0; a < cfg.assets; a++) {
    const name = 'plate-' + String(a).padStart(5, '0') + '.jpg';
    const abs = path.join(libDir, name);
    fs.writeFileSync(abs, Buffer.alloc(64, a % 256));
    library.writeMeta(abs, {
      description: 'Synthetic plate ' + a + needle(a) + 'reference frame.',
      tags: ['bench', a % 2 ? 'wide' : 'close'], palette: ['#101010', '#e3ff32'],
      mood: a % 3 ? 'cool' : 'warm', kind: 'location'
    });
  }

  // Skill history — /api/state calls getHistory(), which reads skills/history/*.md.
  for (let d = 0; d < 30; d++) {
    const day = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
    writeMd(path.join(paths.historyDir(), day + '.md'),
      { date: day, triage: d, rerolls: d * 2, briefs: 1, prompts: d }, '- seeded\n');
  }

  // Pre-fill the two append-only files to the caps their writers enforce (activity 60 events at
  // `store.mjs:350`, ledger 500 rows at `ledger.mjs:32`). The appendActivity/ledger metrics then
  // measure steady state from the first sample instead of drifting up toward it across samples,
  // which is what would otherwise blow the run-to-run stability the ticket asks for.
  const events = Array.from({ length: 60 }, (_, i) => ({ ts: 1700000000000 + i, dot: 'green', t: 'seeded', t2: '#' + i, kind: 'bench' }));
  writeMd(paths.activityMd(), { events }, 'Recent activity, newest first.\n');
  const entries = Array.from({ length: 500 }, (_, i) => ({
    ts: 1700000000000 + i, at: 'Jan 1, 00:00', service: 'fal', op: 'image',
    model: 'fal-ai/flux/schnell', units: '1', cost: 0.003, ref: 'seed-' + i
  }));
  writeMd(path.join(root, 'costs.md'), {
    entries,
    rollup: { '2026-01': { total: 1.5, count: 500, byService: { fal: 1.5 }, byOp: { image: 1.5 } } }
  }, 'FrameForge cost ledger.\n');
}

// ── timing ──
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[(s.length - 1) >> 1]; };
function timeOnce(fn) {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

// ── child mode: one (tier, metric) sample in a genuinely fresh process ──
async function runChild() {
  const root = opt('root');
  const metric = opt('metric');
  const run = METRICS[metric];
  if (!root || !run) { process.stderr.write('bench child: bad --root/--metric\n'); process.exit(2); }
  // No FRFG_CONFIG file is ever written in child mode, so getStorageRoot() falls through to
  // DEFAULT_ROOT = FRFG_DATA = the tier root. Nothing here can reach the parent's config pointer.
  const ctx = await loadBackend(root, path.join(root, '.bench-child-config.md'));
  const pid = projectId(0);
  ctx.pid = pid;
  ctx.shotId = shotIdOf(1);
  const cold = timeOnce(() => run(ctx));
  const warm = timeOnce(() => run(ctx));
  process.stdout.write(JSON.stringify({ cold, warm }) + '\n');
}

// ── parent mode ──
function sampleChild(root, metric) {
  const r = spawnSync(process.execPath, [SELF, '--child', '--root=' + root, '--metric=' + metric], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024
  });
  if (r.error) throw new Error('bench child could not start (' + metric + '): ' + r.error.message);
  // Ctrl-C reaches the whole process group, so the child dies by signal while the parent is still
  // blocked inside this spawnSync — and a blocked thread cannot run its own JS signal handler, so
  // process.on('SIGINT') would not fire until the tier's sampling loop finished (measured: ~36 s
  // later). Treating a signalled child as "the user interrupted us" makes Ctrl-C stop now; the
  // exit handler still does the cleanup.
  if (r.signal) { process.stderr.write('\ninterrupted (' + r.signal + ')\n'); process.exit(130); }
  if (r.status !== 0) throw new Error('bench child failed (' + metric + '): ' + (r.stderr || '').trim().slice(0, 600));
  const line = String(r.stdout).trim().split('\n').filter(Boolean).pop();
  return JSON.parse(line);
}

function fmt(ms) { return ms >= 100 ? ms.toFixed(0) : ms >= 10 ? ms.toFixed(1) : ms.toFixed(2); }
function pad(s, w, right = false) { s = String(s); return right ? s.padStart(w) : s.padEnd(w); }

function printTable(tier, rows, baseline) {
  const base = baseline?.tiers?.[tier];
  const w = Math.max(18, ...METRIC_NAMES.map(m => m.length));
  const head = pad('metric', w) + ' ' + pad('cold ms', 10, true) + ' ' + pad('warm ms', 10, true) +
    (base ? ' ' + pad('Δcold', 10, true) + ' ' + pad('Δwarm', 10, true) : '');
  process.stdout.write('\n' + tier + '\n' + head + '\n' + '-'.repeat(head.length) + '\n');
  for (const m of METRIC_NAMES) {
    const r = rows[m];
    let line = pad(m, w) + ' ' + pad(fmt(r.cold), 10, true) + ' ' + pad(fmt(r.warm), 10, true);
    if (base?.[m]) {
      const d = (k) => { const b = base[m][k]; return b > 0 ? ((r[k] - b) / b * 100) : 0; };
      const s = (k) => (d(k) >= 0 ? '+' : '') + d(k).toFixed(0) + '%';
      line += ' ' + pad(s('cold'), 10, true) + ' ' + pad(s('warm'), 10, true);
    }
    process.stdout.write(line + '\n');
  }
}

// A metric regresses when it is BOTH worse than the percentage band and worse by a meaningful
// absolute amount — see MIN_ABS_MS.
function regressions(results, baseline) {
  const out = [];
  for (const [tier, rows] of Object.entries(results)) {
    const base = baseline?.tiers?.[tier];
    if (!base) continue;
    for (const m of METRIC_NAMES) {
      if (!base[m] || !rows[m]) continue;
      for (const k of ['cold', 'warm']) {
        const b = base[m][k], now = rows[m][k];
        if (!(b > 0)) continue;
        const pct = (now - b) / b * 100;
        if (pct > REGRESSION_PCT && (now - b) >= MIN_ABS_MS) out.push({ tier, metric: m, kind: k, base: b, now, pct });
      }
    }
  }
  return out;
}

async function runParent() {
  const only = opt('tier');
  if (only && !TIERS[only]) { process.stderr.write('unknown tier: ' + only + ' (small|medium|large)\n'); process.exit(2); }
  const tiers = only ? [only] : Object.keys(TIERS);

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'frameforge-bench-'));
  // Removed on a clean exit, on SIGINT, and on a thrown error — the temp corpus is up to ~26k files
  // at the large tier and must never be left behind.
  let cleaned = false;
  const cleanup = () => { if (cleaned) return; cleaned = true; try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ } };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  const ctx = await loadBackend(path.join(base, 'data'), path.join(base, 'config.md'));
  const results = {};
  for (const tier of tiers) {
    const root = path.join(base, tier);
    process.stderr.write('seeding ' + tier + '…\n');
    const t0 = performance.now();
    seedTier(ctx, root, TIERS[tier]);
    process.stderr.write('  seeded in ' + (performance.now() - t0).toFixed(0) + ' ms\n');
    // ROUND-ROBIN, not metric-by-metric. Sampling all 9 of one metric back to back concentrates any
    // transient machine load into that one metric, and the median cannot save a value when most of
    // its samples are polluted. Cycling metric-by-metric within each sample pass spreads a spike
    // across one sample of every metric instead, which is exactly what a median discards. This was
    // not a theoretical worry: metric-major ordering failed the ticket's own run-to-run stability
    // criterion, with every offender in whichever tier happened to run while the machine was busy.
    const raw = {};
    for (const m of METRIC_NAMES) raw[m] = { cold: [], warm: [] };
    for (let i = 0; i < SAMPLES; i++) {
      process.stderr.write('  ' + tier + ' pass ' + (i + 1) + '/' + SAMPLES + ' ');
      for (const m of METRIC_NAMES) {
        const s = sampleChild(root, m);
        raw[m].cold.push(s.cold); raw[m].warm.push(s.warm);
        process.stderr.write('.');
      }
      process.stderr.write('\n');
    }
    results[tier] = {};
    for (const m of METRIC_NAMES) {
      results[tier][m] = { cold: median(raw[m].cold), warm: median(raw[m].warm) };
      process.stderr.write('  ' + tier + '/' + m + ' → ' + fmt(results[tier][m].cold) + ' / ' + fmt(results[tier][m].warm) + ' ms\n');
    }
  }

  if (flag('write-baseline')) {
    // Deliberately an UNCONDITIONAL overwrite, in both directions. This is not the design-lint
    // ratchet: tickets 03/04 change what is being measured (activity.md and costs.md stop being
    // YAML arrays), so a baseline that could only ever move down would be wrong. Do not "fix" this
    // into a one-way ratchet.
    const payload = { node: process.version, samples: SAMPLES, tiers: results };
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(payload, null, 2) + '\n');
    process.stderr.write('\nwrote ' + path.relative(process.cwd(), BASELINE_FILE) + '\n');
    if (flag('json')) process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    else for (const tier of tiers) printTable(tier, results[tier], null);
    return 0;
  }

  let baseline = null;
  try { baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')); } catch { /* none yet */ }

  if (flag('json')) {
    process.stdout.write(JSON.stringify({ node: process.version, samples: SAMPLES, tiers: results }, null, 2) + '\n');
  } else {
    for (const tier of tiers) printTable(tier, results[tier], baseline);
    if (!baseline) process.stdout.write('\nno baseline yet — run with --write-baseline\n');
    else if (baseline.node !== process.version) {
      process.stdout.write('\nnote: baseline was recorded on node ' + baseline.node + ', this is ' + process.version + '\n');
    }
  }

  const bad = regressions(results, baseline);
  if (bad.length) {
    process.stdout.write('\nREGRESSED (worse than +' + REGRESSION_PCT + '% and by at least ' + MIN_ABS_MS + ' ms):\n');
    for (const b of bad) {
      process.stdout.write('  ' + b.tier + '/' + b.metric + ' ' + b.kind + ': ' +
        fmt(b.base) + ' → ' + fmt(b.now) + ' ms (+' + b.pct.toFixed(0) + '%)\n');
    }
    return 1;
  }
  if (baseline) process.stdout.write('\nOK — every metric within +' + REGRESSION_PCT + '% of baseline\n');
  return 0;
}

if (flag('child')) {
  await runChild();
} else {
  process.exit(await runParent());
}
