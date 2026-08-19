// Background agent runner — Auto-Claude style execution.
// Two job kinds:
//  · reroll — a triage note on a clip; injects brief.md + context assets + item sidecar,
//    validates output, writes the new version back into the item's .md.
//  · skill  — enhance a skill file; injects the skill markdown + instruction,
//    validates output, writes the improved .md back (with .bak backup).
import { spawn, spawnSync } from 'child_process';
import { planLaunch } from './launch.mjs';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  paths, writeMd, readMd, getItem, patchItem, getSettings,
  appendActivity, bumpHistory, stamp, safe, scanSkillRepos, getStorageRoot,
  contextForAgent, readSkillFile, writeSkillFile
} from './store.mjs';
import { PROVIDERS, DEFAULT_PROVIDER_ID, providerById, providerFor } from './agentProviders.mjs';

const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 180_000;

// Track every live child so a server shutdown doesn't orphan long-running `claude`/`higgsfield`
// processes (sweepOrphans only repairs the records, not the OS processes). Registered once.
const liveChildren = new Set();
function track(child) {
  if (!child) return child;
  liveChildren.add(child);
  const drop = () => liveChildren.delete(child);
  child.on('close', drop);
  child.on('error', drop);
  return child;
}
let cleanupInstalled = false;
function installCleanup() {
  if (cleanupInstalled) return;
  cleanupInstalled = true;
  const killAll = () => { for (const c of liveChildren) { try { c.kill('SIGKILL'); } catch { /* gone */ } } };
  process.on('exit', killAll);
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { killAll(); process.exit(0); });
  }
}
installCleanup();

// Environment for the spawned agent CLI. When Scout itself runs inside a Claude Code /
// IDE-agent session, that session injects proxy + session vars (ANTHROPIC_BASE_URL,
// CLAUDECODE, CLAUDE_CODE_*…) which break the child CLI's own authentication (401 against
// the host session's proxy). Scrub them so the CLI authenticates like a fresh terminal.
export function agentEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^CLAUDE(_CODE)?(_|$)/.test(k) || k === 'CLAUDECODE' || k === 'ANTHROPIC_BASE_URL' || k === 'BAGGAGE' || k === 'AI_AGENT') delete env[k];
  }
  return env;
}

// Generic one-shot command runner (also reused by backend/providers.mjs for the Higgsfield CLI
// and the Claude-driven Arcads adapter). Resolves { code, out, err, enoent }.
// `launchFailed` is separate from `enoent` on purpose. Callers used to read `!enoent` as "the binary
// ran", which is false for every launch error that is not ENOENT — and on Windows the common one is
// EINVAL, thrown SYNCHRONOUSLY by spawn() for a .cmd. localAsr.mjs reported `installed: !r.enoent`,
// so an unrunnable binary came back as installed:true, inverting the probe it exists to perform.
export function runOnce(cmd, args, timeoutMs, cwd, envExtra) {
  return new Promise(resolve => {
    let child;
    try {
      const env = envExtra ? { ...agentEnv(), ...envExtra } : agentEnv();
      // planLaunch is what makes a Windows .cmd shim runnable at all — resolveBin hands us
      // `…\npm\claude.cmd`, and spawn() with shell:false refuses that outright (CVE-2024-27980).
      // Identity on POSIX, so macOS/Linux behaviour is unchanged.
      const plan = planLaunch(cmd, args);
      // A cwd that does not exist makes spawn fail with ENOENT reported against the COMMAND, which
      // reads as "the binary is missing" and is how this cost an afternoon: CI failed with
      // `spawn C:\Windows\system32\cmd.exe ENOENT` while cmd.exe was plainly there. The storage root
      // is gitignored and absent on a fresh checkout — and equally absent on a user's very first
      // run, before anything has written to it. Fall back rather than create: a probe should not
      // have the side effect of materialising the datastore.
      const wd = cwd || getStorageRoot();
      child = track(spawn(plan.file, plan.args, {
        env: plan.env ? { ...env, ...plan.env } : env,
        shell: false, stdio: ['ignore', 'pipe', 'pipe'],
        ...(fs.existsSync(wd) ? { cwd: wd } : {}),
        ...(plan.verbatim ? { windowsVerbatimArguments: true } : {})
      }));
    } catch (e) { return resolve({ code: -1, out: '', err: e.message, enoent: false, launchFailed: true }); }
    let out = '', err = '', settled = false;
    const done = r => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { } done({ code: -1, out, err: 'timed out after ' + timeoutMs / 1000 + 's', enoent: false }); }, timeoutMs);
    child.on('error', e => done({ code: -1, out: '', err: e.message, enoent: e.code === 'ENOENT', launchFailed: true }));
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => done({ code, out, err, enoent: false }));
  });
}

// Resolve ANY CLI binary even when the server's PATH is minimal (double-clicked app, launchd,
// nvm-installed node…). Used for `claude` (agent) and `higgsfield` (provider CLI) alike.
//
// Memoized with a short TTL because this is on the /api/state hot path: providersStatus() calls
// it for higgsfield and (via findAgent) for arcads, so every state fetch was paying two BLOCKING
// spawnSync('which') round-trips (~2ms each) plus, on a miss, a stat of ~12 fallback directories.
// Installing a CLI is a deliberate user action, so freshness is delivered by clearBinCache()
// rather than by re-probing the filesystem on every request.
const BIN_TTL_MS = 5000;
const binCache = new Map(); // cmd → { at, path }
export function clearBinCache() { binCache.clear(); }

// ── Windows lookup ────────────────────────────────────────────────────────────────────────────
// The POSIX path below is `which` + a list of well-known bin dirs. Neither survives on Windows:
// `which` does not exist (spawnSync returns ENOENT), every fallback dir is a POSIX path, and a
// bare `claude` is never a file — it is claude.cmd / node.exe / foo.bat. So resolveBin() returned
// null for EVERYTHING on Windows and the agent/chat feature could not find its CLI at all.
const IS_WIN = process.platform === 'win32';

// process.env is a case-INSENSITIVE view on Windows, but the `{ ...process.env }` spread inside
// agentEnv() is an ordinary object and loses that. The real key is `Path`, not `PATH`, so
// `env.PATH` reads undefined and any PATH walk silently finds nothing. Look names up by fold.
function envGet(env, name) {
  if (env[name] != null) return env[name];
  const want = name.toLowerCase();
  for (const k of Object.keys(env)) if (k.toLowerCase() === want) return env[k];
  return undefined;
}
function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

// PATHEXT is the authoritative list of what counts as executable. Unset → the CreateProcess default.
function winExts(env) {
  return String(envGet(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD')
    .split(';').map(e => e.trim()).filter(Boolean)
    .map(e => (e.startsWith('.') ? e : '.' + e));
}
// `cmd` inside `dir` → the first spelling that exists. An explicit extension is tried verbatim
// first, the way cmd.exe resolves it; otherwise PATHEXT completes the bare name.
function winProbeDir(dir, cmd, exts) {
  if (path.extname(cmd)) { const exact = path.join(dir, cmd); if (isFile(exact)) return exact; }
  for (const e of exts) { const p = path.join(dir, cmd + e); if (isFile(p)) return p; }
  return null;
}
function resolveBinWindows(cmd) {
  const env = agentEnv();
  const exts = winExts(env);
  // Already a path? Both separators are legal here, as is a bare drive prefix. Accept it as
  // written, else let PATHEXT complete it (`C:\tools\claude` → `C:\tools\claude.cmd`).
  if (/[\\/]/.test(cmd) || /^[a-zA-Z]:/.test(cmd)) {
    if (isFile(cmd)) return cmd;
    for (const e of exts) if (isFile(cmd + e)) return cmd + e;
    return null;
  }
  // Walk the REAL PATH, in order — the `which` equivalent, minus the process spawn. Entries may be
  // quoted and duplicated; fold them so a miss does not stat the same directory twice.
  const dirs = [], seen = new Set();
  const add = d => {
    const t = String(d || '').trim().replace(/^"|"$/g, '');
    if (!t) return;
    const key = path.resolve(t).toLowerCase();
    if (!seen.has(key)) { seen.add(key); dirs.push(t); }
  };
  String(envGet(env, 'PATH') || '').split(';').forEach(add);
  // …then the real install locations a minimal PATH misses (double-clicked .exe, Windows service),
  // mirroring what the POSIX list does for launchd. `npm install -g` lands in %APPDATA%\npm.
  const home = os.homedir();
  const appData = envGet(env, 'APPDATA'), localApp = envGet(env, 'LOCALAPPDATA'), progFiles = envGet(env, 'ProgramFiles');
  if (appData) add(path.join(appData, 'npm'));
  if (progFiles) add(path.join(progFiles, 'nodejs'));
  if (localApp) add(path.join(localApp, 'Volta', 'bin'));
  [['.local', 'bin'], ['.claude', 'local'], ['.bun', 'bin'], ['.cargo', 'bin']].forEach(s => add(path.join(home, ...s)));
  for (const d of dirs) {
    const hit = winProbeDir(d, cmd, exts);
    if (hit) return hit;
  }
  // Deliberately NO spawnSync('where') fallback here, though `where` is the usual `which` analogue.
  // Measured on this repo, both reasons matter:
  //  · It cannot find anything this walk cannot. `where` searches cwd + PATH under PATHEXT; we
  //    search PATH under PATHEXT plus the install dirs above, and cwd is excluded on purpose
  //    (POSIX `which` does not search it either, and the server's cwd is user data).
  //  · Its FIRST line can be unexecutable. `where npm` reports `…\nodejs\npm` — the extensionless
  //    MSYS shell script — ahead of `npm.CMD`, and CreateProcess cannot run it.
  // It also costs ~99ms of BLOCKING spawnSync against ~21ms for the whole walk, on the /api/state
  // hot path, at every TTL expiry. That is the exact cost this cache was introduced to delete.
  return null;
}

function resolveBinUncached(cmd) {
  if (IS_WIN) return resolveBinWindows(cmd);
  if (cmd.includes('/')) return fs.existsSync(cmd) ? cmd : null;
  try {
    const w = spawnSync('which', [cmd], { env: agentEnv() });
    const p = String(w.stdout || '').trim();
    if (w.status === 0 && p) return p;
  } catch { /* keep looking */ }
  const home = os.homedir();
  const dirs = [
    '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin',
    path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'),
    path.join(home, '.npm-global', 'bin'), path.join(home, '.volta', 'bin'),
    path.join(home, 'n', 'bin'), path.join(home, '.bun', 'bin'), path.join(home, '.cargo', 'bin')
  ];
  // nvm installs live under versioned dirs — scan them too
  try {
    const nvm = path.join(home, '.nvm', 'versions', 'node');
    if (fs.existsSync(nvm)) fs.readdirSync(nvm).forEach(v => dirs.push(path.join(nvm, v, 'bin')));
  } catch { /* none */ }
  for (const d of dirs) {
    const p = path.join(d, cmd);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
export function resolveBin(cmd) {
  if (!cmd) return null;
  const hit = binCache.get(cmd);
  if (hit && Date.now() - hit.at < BIN_TTL_MS) return hit.path;
  const path_ = resolveBinUncached(cmd);
  binCache.set(cmd, { at: Date.now(), path: path_ }); // misses are cached too — they are the slow case
  return path_;
}
// Find the agent binary the app is currently pointed at. Users never have to type a path.
export function findAgent() { return resolveBin(getSettings().agentCommand || DEFAULT_PROVIDER_ID); }

// Resolve a wizard request onto { provider, bin }. `which` may be an id ('claude', 'codex') or
// undefined, in which case the current settings.agentCommand decides.
function pick(which) {
  if (which) {
    const p = providerById(which);
    if (p) return { provider: p, bin: resolveBin(p.bin) };
  }
  const cmd = getSettings().agentCommand || DEFAULT_PROVIDER_ID;
  const provider = providerFor(cmd);
  return { provider, bin: resolveBin(cmd) };
}

// Full status for ONE provider: installed? which version? signed in? — all from free local probes,
// no paid prompt. `signedIn` is what the wizard polls while the sign-in browser tab is open.
export async function agentStatus(which) {
  const { provider, bin } = pick(which);
  const base = {
    id: provider.id, label: provider.label, command: provider.bin || getSettings().agentCommand,
    platform: process.platform, installed: false, signedIn: false, version: '', detail: ''
  };
  if (!bin) return base;
  const v = await runOnce(bin, provider.versionArgs, 10_000);
  if (v.code !== 0) return { ...base, path: bin, error: 'the command exists but did not start' + (v.err ? ' — ' + v.err.slice(0, 160) : '') };
  const st = { ...base, installed: true, path: bin, version: v.out.trim().split('\n')[0].slice(0, 120) };
  if (!provider.authStatusArgs) return st; // custom CLI — we cannot probe its auth
  const a = await runOnce(bin, provider.authStatusArgs, 20_000);
  const parsed = provider.parseAuth(a) || {};
  return {
    ...st,
    signedIn: !!parsed.signedIn,
    detail: parsed.detail || '',
    ...(parsed.configError ? { error: parsed.configError } : {})
  };
}

// Every provider at once — powers the side-by-side connect cards.
export async function agentProviders() {
  const list = await Promise.all(PROVIDERS.map(p => agentStatus(p.id)));
  return { providers: list, active: getSettings().agentCommand || DEFAULT_PROVIDER_ID };
}

// One-click install of a provider's npm package, with readable failure hints.
export function installAgent(which) {
  const { provider } = pick(which);
  if (!provider.npm) return Promise.resolve({ ok: false, error: 'nothing to install for a custom CLI — put it on your PATH yourself' });
  return new Promise(resolve => {
    let child;
    try {
      // `npm` is npm.cmd on Windows, and spawn() with shell:false refuses a .cmd — so this button
      // could NEVER work there, and the error below then blamed the user for not installing the
      // Node.js they already had. Resolve the real path, then unwrap the shim.
      const npm = resolveBin('npm');
      if (!npm) return resolve({ ok: false, error: 'npm not found — install Node.js from nodejs.org first, then try again' });
      const plan = planLaunch(npm, ['install', '-g', provider.npm]);
      child = track(spawn(plan.file, plan.args, {
        env: plan.env ? { ...agentEnv(), ...plan.env } : agentEnv(),
        shell: false, stdio: ['ignore', 'pipe', 'pipe'],
        ...(plan.verbatim ? { windowsVerbatimArguments: true } : {})
      }));
    } catch (e) { return resolve({ ok: false, error: 'could not start npm (' + e.message + ') — install Node.js from nodejs.org, then try again' }); }
    let out = '', err = '', settled = false;
    const done = r => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { } done({ ok: false, error: 'install timed out after 4 minutes — check your internet connection and try again' }); }, 240_000);
    child.on('error', e => done({ ok: false, error: e.code === 'ENOENT' ? 'npm not found — install Node.js from nodejs.org first, then try again' : e.message }));
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', async code => {
      if (code === 0) {
        clearBinCache(); // a just-installed binary must not be masked by a stale negative lookup
        const st = await agentStatus(provider.id);
        return done(st.installed ? { ok: true, version: st.version, path: st.path } : { ok: false, error: 'install finished but the ' + provider.bin + ' command was not found — restart the app and try again' });
      }
      const all = out + err;
      done({
        ok: false,
        error: /EACCES|permission denied/i.test(all)
          ? 'your system needs administrator rights for global npm installs. Open the Terminal app, paste `sudo npm install -g ' + provider.npm + '`, press Enter and type your Mac password — then come back and click Check again.'
          : 'install failed (exit ' + code + ') — ' + all.slice(-260)
      });
    });
  });
}

// One-click login. Both providers ship a login SUBCOMMAND that opens the browser itself
// (`claude auth login --claudeai`, `codex login`), so the user never sees a TUI, never copies a
// URL and never pastes a code — they just approve in the browser tab that pops up. The terminal
// window is only there to host the process and show progress.
//
// Always the SUBSCRIPTION flow. Never `--console` / `--api-key`.
export function openLogin(which) {
  const { provider, bin } = pick(which);
  const resolved = bin || provider.bin || getSettings().agentCommand;
  if (!provider.loginArgs) return { ok: false, error: 'Open your terminal app and sign ' + resolved + ' in yourself.' };
  const argv = [resolved, ...provider.loginArgs];
  const shellLine = argv.map(a => "'" + String(a).replace(/'/g, "'\\''") + "'").join(' ');
  // spawn() reports a missing binary ASYNCHRONOUSLY via an 'error' event, not by throwing — so a
  // try/catch around it never fires, and an 'error' with no listener is re-thrown by EventEmitter
  // and takes the whole server down. Every launch goes through here: it attaches the mandatory
  // listener and reports launchability from `which`, not from spawn not-throwing.
  const launch = (cmd, args) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: false });
      child.on('error', () => { /* terminal missing/unrunnable — resolveBin already gated this */ });
      child.unref?.();
      return true;
    } catch { return false; } // synchronous failures only (bad arguments)
  };
  if (process.platform === 'darwin') {
    const script = 'tell application "Terminal"\nactivate\ndo script "' + shellLine.replace(/[\\"]/g, m => '\\' + m) + '"\nend tell';
    return launch('osascript', ['-e', script])
      ? { ok: true, opened: 'Terminal', provider: provider.id }
      : { ok: false, error: 'Could not open Terminal. Run this yourself: ' + argv.join(' ') };
  }
  if (process.platform === 'linux') {
    // resolveBin() is the real existence check — the old loop asked spawn() and, because spawn
    // never throws for ENOENT, always "succeeded" on x-terminal-emulator even where it is absent.
    for (const term of ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm']) {
      if (!resolveBin(term)) continue;
      if (launch(term, term === 'gnome-terminal' ? ['--', ...argv] : ['-e', ...argv])) {
        return { ok: true, opened: term, provider: provider.id };
      }
    }
    return { ok: false, error: 'No terminal emulator found. Open one yourself and run: ' + argv.join(' ') };
  }
  if (process.platform === 'win32') {
    return launch('cmd', ['/c', 'start', 'cmd', '/k', argv.join(' ')])
      ? { ok: true, opened: 'cmd', provider: provider.id }
      : { ok: false, error: 'Could not open a command prompt. Run this yourself: ' + argv.join(' ') };
  }
  return { ok: false, error: 'Open your terminal app and run: ' + argv.join(' ') };
}

// Full connection check: 1) --version proves the CLI is installed, 2) the provider's free auth
// probe proves it is signed in, 3) a live one-token prompt proves it actually answers headlessly.
// The wizard reaches step 3 on its own via polling; this route stays for the explicit Re-check.
export async function testAgent(which) {
  // the explicit "Test / Re-check" button — always probe the filesystem for real, so a CLI the
  // user just installed by hand in a terminal is picked up immediately. (agentStatus is NOT
  // busted here: the wizard polls it while the sign-in tab is open, and that is the exact
  // per-request storm the cache exists to absorb.)
  clearBinCache();
  const { provider, bin } = pick(which);
  const cmd = provider.bin || getSettings().agentCommand;
  if (!bin) return { ok: false, command: cmd, error: provider.label + ' is not installed yet — use step 1 above' };
  const st = await agentStatus(provider.id);
  if (!st.installed) return { ok: false, command: cmd, error: st.error || 'the command exists but did not start' };
  if (provider.authStatusArgs && !st.signedIn) {
    return {
      ok: false, command: cmd, path: bin, version: st.version, needsLogin: true,
      error: st.error || 'installed, but not signed in yet — use step 2 above and finish the sign-in in your browser.'
    };
  }
  const p = await runOnce(bin, buildAgentArgs('Reply with exactly: OK', provider), 90_000);
  if (p.code === 0 && p.out.trim()) {
    return { ok: true, command: cmd, path: bin, version: st.version, detail: st.detail, roundTrip: true, provider: provider.id };
  }
  const detail = (p.err || p.out || '').slice(0, 250);
  const authy = /401|auth|credential|log ?in|OAuth/i.test(detail);
  return {
    ok: false, command: cmd, path: bin, version: st.version, needsLogin: authy,
    error: authy
      ? 'installed, but not signed in yet — use step 2 above, finish the sign-in in your browser, then test again.'
      : 'installed but the test prompt failed. (' + detail + ')'
  };
}

// Arguments for a NO-TOOLS prompt-rewrite agent run. Exported + unit-tested so the safety property
// (never --dangerously-skip-permissions; tools disabled) can't silently regress. Flag SHAPE per CLI
// lives in agentProviders.mjs; this wrapper only pins the safety default (empty tool set).
export function buildAgentArgs(prompt, provider) {
  return (provider || providerFor(getSettings().agentCommand || DEFAULT_PROVIDER_ID))
    .promptArgs(prompt, { allowedTools: '' });
}

let seq = 0;
const jobs = []; // in-memory mirror; each job also persisted as jobs/<id>.md

export function listJobs() {
  return jobs.map(j => ({
    id: j.id, kind: j.kind, itemId: j.itemId, proj: j.proj, note: j.note,
    skillFile: j.skillFile, label: j.label,
    status: j.status, mode: j.mode, startedAt: j.startedAt, endedAt: j.endedAt
  }));
}

function push(job) {
  jobs.unshift(job);
  if (jobs.length > 40) jobs.pop();
  persist(job);
  tick();
  return job;
}

// SCOPED (Phase 1C): a reroll job stores BOTH project and item id and only ever resolves the item
// through { proj, itemId } — never a global itemId lookup, which could hit a same-named item in a
// different project.
export function enqueueReroll(pid, itemId, note) {
  const it = getItem(pid, itemId);
  if (!it) return null;
  return push({
    id: 'job-' + Date.now() + '-' + (++seq), kind: 'reroll',
    itemId, proj: it.proj, note, label: it.proj + '/' + itemId,
    status: 'queued', mode: null, log: [], startedAt: null, endedAt: null
  });
}

export function enqueueSkillEnhance(file, instruction) {
  return push({
    id: 'job-' + Date.now() + '-' + (++seq), kind: 'skill',
    skillFile: file, note: instruction, label: path.basename(path.dirname(file)) + '/' + path.basename(file),
    status: 'queued', mode: null, log: [], startedAt: null, endedAt: null
  });
}

function tick() {
  if (process.env.SCOUT_TEST === '1') return; // tests never spawn the agent CLI
  const running = jobs.filter(j => j.status === 'running').length;
  if (running >= MAX_CONCURRENT) return;
  const next = jobs.filter(j => j.status === 'queued').pop(); // oldest queued
  if (next) run(next);
}

function skillsSummary() {
  return scanSkillRepos().filter(r => r.exists)
    .map(r => r.name + ': ' + r.skills.map(s => s.name).join(', ')).join('\n');
}

function buildRerollPrompt(job) {
  let brief = '';
  try { brief = readMd(paths.briefMd(job.proj)).content.trim(); } catch { /* none */ }
  const itemMd = fs.readFileSync(paths.itemMd(job.proj, job.itemId), 'utf8');
  const ctx = contextForAgent(job.proj);
  return [
    'You are the Scout background agent for an AI video production pipeline.',
    'Everything below is local .md context. Do not ask questions; return output only.',
    '',
    '## PROJECT BRIEF (authoritative — the core aesthetic and direction)',
    brief || '(no brief)',
    ctx ? '\n## PROJECT CONTEXT ASSETS\n' + ctx : '',
    '',
    '## ITEM (.md, verbatim)',
    itemMd,
    '',
    '## AVAILABLE SKILL REPOSITORIES',
    skillsSummary() || '(none)',
    '',
    '## USER TRIAGE NOTE (read verbatim)',
    '"' + job.note + '"',
    '',
    '## TASK',
    'Rewrite the generation prompt for the NEXT version of this item so it satisfies the',
    'triage note while strictly honoring the project brief and context. Keep the —style and',
    '—dur suffixes intact. Respond with ONLY the new prompt text on a single line — no',
    'markdown, no explanation.'
  ].join('\n');
}

function buildSkillPrompt(job) {
  const content = readSkillFile(job.skillFile);
  return [
    'You are the Scout skill curator. Below is a Claude skill markdown file.',
    'Improve it according to the instruction while preserving its YAML frontmatter keys,',
    'overall structure, and everything that already works. Tighten prose, fix errors,',
    'add the requested capability. Return the COMPLETE updated markdown file and nothing else.',
    '',
    '## INSTRUCTION',
    job.note,
    '',
    '## FILE: ' + job.skillFile,
    '```markdown',
    content,
    '```',
    '',
    'Respond with ONLY the full updated file content (starting with --- if the original has frontmatter).'
  ].join('\n');
}

function run(job) {
  job.status = 'running';
  job.startedAt = Date.now();
  job.log.push(stamp() + ' — started (' + job.kind + ')');
  persist(job);

  const settings = getSettings();
  const cmd = findAgent() || settings.agentCommand || 'claude';
  let prompt;
  try { prompt = job.kind === 'skill' ? buildSkillPrompt(job) : buildRerollPrompt(job); }
  catch (e) { fail(job, 'context build failed: ' + e.message); return tick(); }
  let out = '', err = '', settled = false, timer = null;

  const finish = (ok, mode, detail) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (ok) { complete(job, mode, detail); tick(); return; }
    if (job.kind === 'reroll' && settings.agentSimulateFallback) {
      job.log.push(stamp() + ' — agent unavailable (' + detail + '), falling back to simulated iteration');
      persist(job);
      setTimeout(() => { complete(job, 'simulated', null); tick(); }, 6000);
    } else { fail(job, detail); tick(); }
  };

  let child;
  try {
    // stdin MUST be 'ignore' — claude -p waits on an open stdin pipe, warns after 3s and
    // exits 1 ("no stdin data received"), which silently forced simulate-fallback forever.
    // agentEnv() scrubs host-session vars so a nested Scout still authenticates cleanly.
    // These jobs only REWRITE TEXT (a prompt, a skill file) — they need no tools, so we do NOT
    // pass --dangerously-skip-permissions (Phase 3E). --allowedTools '' runs the CLI with an empty
    // tool set (nothing to approve, nothing dangerous), and imported project context is untrusted
    // text that never gets tool access. buildAgentArgs is unit-tested to guarantee this.
    // Same unwrap as runOnce: on Windows `cmd` is a .cmd shim that spawn(shell:false) refuses.
    // Note buildAgentArgs passes a multi-line prompt, which is exactly why planLaunch resolves the
    // shim to `node <script>` rather than routing through cmd.exe — cmd.exe would deliver only the
    // first line, silently.
    const plan = planLaunch(cmd, buildAgentArgs(prompt));
    child = track(spawn(plan.file, plan.args, {
      cwd: getStorageRoot(),
      env: plan.env ? { ...agentEnv(), ...plan.env } : agentEnv(),
      shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      ...(plan.verbatim ? { windowsVerbatimArguments: true } : {})
    }));
  } catch (e) { return finish(false, null, 'spawn failed: ' + e.message); }

  timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { } finish(false, null, 'timeout after ' + TIMEOUT_MS / 1000 + 's'); }, TIMEOUT_MS);
  child.on('error', e => finish(false, null, e.message));
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });
  child.on('close', code => {
    const text = out.trim();
    if (job.kind === 'skill') {
      // auto-validate: full markdown doc, plausible size vs original
      const orig = (() => { try { return readSkillFile(job.skillFile); } catch { return ''; } })();
      const valid = code === 0 && text.length > Math.min(400, orig.length * 0.4) && (text.startsWith('---') || text.startsWith('#'));
      if (valid) finish(true, 'claude-code', text);
      else finish(false, null, 'exit ' + code + (err ? ' — ' + err.slice(0, 300) : ' — output failed validation'));
    } else {
      const valid = code === 0 && text.length > 10 && text.length < 3000;
      if (valid) finish(true, 'claude-code', text.split('\n').filter(Boolean).pop().trim());
      else finish(false, null, 'exit ' + code + (err ? ' — ' + err.slice(0, 300) : ' — empty/invalid output'));
    }
  });
}

function complete(job, mode, output) {
  if (job.kind === 'skill') {
    try {
      writeSkillFile(job.skillFile, output.replace(/^```(markdown)?\n?/, '').replace(/\n?```\s*$/, '') + '\n');
    } catch (e) { return fail(job, 'write failed: ' + e.message); }
    job.status = 'done'; job.mode = mode; job.endedAt = Date.now();
    job.log.push(stamp() + ' — validated · improved file written (backup at .bak)');
    persist(job);
    bumpHistory('skills');
    appendActivity({ dot: 'green', t: 'Skill enhanced:', t2: job.label, s: '"' + job.note.slice(0, 70) + '"', kind: 'skills' });
    return;
  }
  const it = getItem(job.proj, job.itemId);
  if (!it || it.fbState !== 'queued') {
    job.status = 'done'; job.mode = mode; job.endedAt = Date.now();
    job.log.push(stamp() + ' — item no longer queued, discarded');
    return persist(job);
  }
  const base = it.versions || [{ v: 'v1', cost: it.cost, date: 'earlier', gradIx: it.gradIx }];
  const nv = 'v' + (base.length + 1);
  const gradIx = (hash(it.id) + base.length + 4) % 14;
  const prompt = output || simulatePrompt(it, job.note);
  patchItem(job.proj, job.itemId, {
    fbState: 'done', justArrivedAt: Date.now(), prompt,
    versions: base.concat([{ v: nv, cost: it.cost, date: 'just now', gradIx, prompt }])
  }, nv + ' created by ' + mode + ' from note: "' + job.note + '"');
  job.status = 'done'; job.mode = mode; job.endedAt = Date.now();
  job.log.push(stamp() + ' — validated · ' + nv + ' written back to ' + safe(job.itemId) + '.md');
  persist(job);
  bumpHistory('rerolls');
  bumpHistory('prompts');
  appendActivity({ dot: 'green', t: 'Re-roll ready:', t2: it.name + ' ' + nv + ' — from your note', s: projName(job.proj) + ' · ' + mode, kind: 'item', ref: it.id, hl: 1 });
}

function fail(job, detail) {
  job.status = 'failed'; job.endedAt = Date.now();
  job.log.push(stamp() + ' — FAILED: ' + detail);
  persist(job);
  if (job.kind === 'reroll') {
    patchItem(job.proj, job.itemId, { fbState: null }, 're-roll failed: ' + detail);
    appendActivity({ dot: 'red', t: 'Re-roll failed', t2: '· ' + job.itemId, s: detail.slice(0, 80), kind: 'item', ref: job.itemId });
  } else {
    appendActivity({ dot: 'red', t: 'Skill enhance failed', t2: '· ' + job.label, s: detail.slice(0, 80), kind: 'skills' });
  }
}

function simulatePrompt(it, note) {
  return (it.prompt || it.label.toLowerCase()) + ' — revised: ' + note.toLowerCase();
}
function projName(pid) {
  try { return readMd(paths.projectMd(pid)).data.name; } catch { return pid; }
}
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
function persist(job) {
  writeMd(path.join(paths.jobsDir(), job.id + '.md'), {
    id: job.id, kind: job.kind, item: job.itemId || null, skillFile: job.skillFile || null,
    project: job.proj || null, note: job.note,
    status: job.status, mode: job.mode, startedAt: job.startedAt, endedAt: job.endedAt
  }, '## Job log\n\n' + job.log.map(l => '- ' + l).join('\n') + '\n');
}
