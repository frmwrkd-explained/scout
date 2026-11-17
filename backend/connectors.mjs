// backend/connectors.mjs — letting an OUTSIDE agent in.
//
// Scout already has the door: `scripts/scout-mcp.mjs` is an MCP server over stdio, with the same
// gate as every other door (backend/mcp.mjs). What was missing is the last metre — the few lines an
// agent app needs in ITS OWN config file to start that server. Getting those lines right by hand is
// where people give up: the path has a space in it, `node` is not on a desktop app's PATH, and the
// packaged app keeps its script inside an archive plain Node cannot read.
//
// This module does three things and nothing else:
//   1. `connectorConfigs()` — PURE. For each agent app: which file, in which format, and the exact
//      text. Absolute paths everywhere, quoted for JSON, TOML and the shell.
//   2. `connectorStatus()` — READ-ONLY. Is that file there, and is our entry in it. It reports a
//      COUNT of the other servers and never their names, commands or env: those files hold other
//      tools' API keys, and nothing of theirs leaves this function.
//   3. `installConnector()` / `removeConnector()` — the only writers. Person-only, hash-bound to
//      what the screen showed, backup first, tmp + rename, our entry and no other.
//
// THE HOME DIRECTORY IS A PARAMETER. These are the only functions in Scout that write outside the
// workspace, so where "home" is must never be an accident: under `SCOUT_TEST` it is a folder inside
// the temp root, and `assertSafeTarget` refuses any write that would land anywhere else.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getStorageRoot } from './store.mjs';
import { isAgentActor, DEFAULT_ACTOR } from './actors.mjs';
import { currentWorkerIdentity } from './workerScope.mjs';
import { logEvent } from './log.mjs';

export const SERVER_KEY = 'scout';
const MARKER = '# Added by Scout (Settings → Connectors). Remove it there, or delete this block.';

export class ConnectorError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'ConnectorError'; this.status = status; }
}
function fail(message, status = 400) { throw new ConnectorError(message, status); }
// Exactly `referenceImport.mjs` `owner()`: a worker run, or an actor the border rule calls an agent,
// may not change what other programs on this computer load.
function owner(actor) {
  if (currentWorkerIdentity() || isAgentActor(actor)) fail('Only the operator can connect or disconnect an agent.', 403);
}

// ── where things are ────────────────────────────────────────────────────────────────────────────

const UNDER_TEST = () => process.env.SCOUT_TEST === '1';

// The folder config files are looked up under. Under test it is ALWAYS inside the temp root — an
// env override is not honoured there, so a stray variable on a developer machine cannot aim a test
// at the real home directory.
export function connectorHome({ home = null } = {}) {
  // An absolute path in EITHER style is taken as given, so a config for another operating system
  // can be generated (and tested) from this one.
  if (home) return path.posix.isAbsolute(String(home)) || path.win32.isAbsolute(String(home)) ? String(home) : path.resolve(String(home));
  if (UNDER_TEST()) return path.join(getStorageRoot(), '.connector-home');
  return process.env.SCOUT_CONNECTOR_HOME ? path.resolve(process.env.SCOUT_CONNECTOR_HOME) : os.homedir();
}

const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const inside = (child, parent) => { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };

// The second lock on the same door. Under test a write must resolve inside the temp folder or the
// workspace, whatever `home` was computed to be.
function assertSafeTarget(file) {
  if (!UNDER_TEST()) return;
  const target = real(path.dirname(file));
  const allowed = [real(os.tmpdir()), real(getStorageRoot())];
  // The nearest existing ancestor decides: the folder itself may not exist yet.
  let probe = target;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  probe = real(probe);
  if (!allowed.some(root => inside(probe, root))) {
    fail('refusing to write outside the test folder: ' + file, 500);
  }
}

// What runs the server. In the packaged app the backend itself runs inside Electron, the script is
// inside `app.asar`, and plain Node cannot read that archive — but Electron can run as Node
// (`ELECTRON_RUN_AS_NODE=1`), reads the archive, and is on every machine that has Scout. So the
// app's own binary is the runtime and no separate Node install is needed. Outside Electron it is
// the Node that is running this server, by absolute path: a desktop app has no shell PATH.
export function runtime() {
  const electron = !!(process.versions && process.versions.electron);
  return { kind: electron ? 'electron' : 'node', command: process.execPath, env: electron ? { ELECTRON_RUN_AS_NODE: '1' } : {} };
}

export function mcpScriptPath() {
  return fileURLToPath(new URL('../scripts/scout-mcp.mjs', import.meta.url));
}

// ── the targets ─────────────────────────────────────────────────────────────────────────────────

export const TARGETS = [
  { id: 'claude-desktop', label: 'Claude Desktop', format: 'json', actor: 'mcp-claude-desktop',
    docs: 'https://modelcontextprotocol.io/docs/develop/connect-local-servers',
    restart: 'Quit Claude Desktop completely and open it again to load Scout.',
    note: 'Claude Desktop starts Scout\'s connector itself, so it works even when the Scout window is closed.' },
  { id: 'claude-code', label: 'Claude Code', format: 'command', actor: 'mcp-claude-code',
    docs: 'https://code.claude.com/docs/en/mcp',
    restart: 'Start a new Claude Code session; /mcp lists Scout.',
    note: 'Claude Code keeps its servers in a file it manages itself, so Scout gives you the command to run instead of editing that file.' },
  { id: 'codex', label: 'Codex (ChatGPT in the terminal)', format: 'toml', actor: 'mcp-codex',
    docs: 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
    restart: 'Start a new Codex session to load Scout.',
    note: 'This is the GPT route that works on your own computer; ChatGPT in the browser needs a public address instead.' },
  { id: 'gemini-cli', label: 'Gemini CLI', format: 'json', actor: 'mcp-gemini',
    docs: 'https://geminicli.com/docs/tools/mcp-server/',
    restart: 'Start a new Gemini session; /mcp lists Scout.',
    note: 'Google moved free and Google One accounts from Gemini CLI to Antigravity in June 2026 — connect Antigravity too if that is you.' },
  { id: 'antigravity', label: 'Antigravity', format: 'json', actor: 'mcp-antigravity',
    docs: 'https://antigravity.google/docs/mcp',
    restart: 'In Antigravity open the MCP servers list and restart or reload it to load Scout.',
    note: 'Antigravity reads one shared file for the app and its command-line tool.' },
];

// Agents that only run on somebody else's servers. They cannot start a program on this computer
// or reach `127.0.0.1`, so there is nothing to write: they need Scout at a public HTTPS address.
export const REMOTE_ONLY = [
  { id: 'claude-web', label: 'Claude on the web (claude.ai)', state: 'needs-public-address',
    docs: 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp',
    note: 'claude.ai connects from Anthropic\'s servers, which cannot reach a program on your computer — it needs Scout at a public HTTPS address, which Scout does not offer yet.' },
  { id: 'chatgpt', label: 'ChatGPT on the web', state: 'needs-public-address',
    docs: 'https://learn.chatgpt.com/docs/extend/mcp',
    note: 'ChatGPT in the browser connects from OpenAI\'s servers for the same reason — use Codex above for GPT on this computer.' },
];

const P = platform => (platform === 'win32' ? path.win32 : path.posix);

// Where each app keeps the file, per operating system. `env` is only consulted for the two
// variables the apps themselves read; a caller that passes `home` gets paths under that home.
export function configFile(id, { home, platform = process.platform, env = {} } = {}) {
  const p = P(platform);
  switch (id) {
    case 'claude-desktop':
      if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
      if (platform === 'win32') return p.join(env.APPDATA || p.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
      return p.join(home, '.config', 'Claude', 'claude_desktop_config.json');
    case 'claude-code': return p.join(home, '.claude.json');
    case 'codex': return p.join(env.CODEX_HOME || p.join(home, '.codex'), 'config.toml');
    case 'gemini-cli': return p.join(home, '.gemini', 'settings.json');
    case 'antigravity': return p.join(home, '.gemini', 'config', 'mcp_config.json');
    default: return null;
  }
}

// ── quoting ─────────────────────────────────────────────────────────────────────────────────────

// A TOML basic string. JSON's escapes are a subset of TOML's, except that TOML also forbids a raw
// DEL — so JSON.stringify plus that one character is a valid basic string for any path.
export function tomlString(value) {
  return JSON.stringify(String(value)).replace(/\u007f/g, '\\u007F');
}
const tomlKey = key => (/^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key));

export function tomlBlock(entry) {
  const lines = [
    MARKER,
    '[mcp_servers.' + SERVER_KEY + ']',
    'command = ' + tomlString(entry.command),
    'args = [' + entry.args.map(tomlString).join(', ') + ']',
  ];
  const env = Object.entries(entry.env || {});
  if (env.length) {
    lines.push('', '[mcp_servers.' + SERVER_KEY + '.env]');
    for (const [k, v] of env) lines.push(tomlKey(k) + ' = ' + tomlString(v));
  }
  return lines.join('\n') + '\n';
}

// One shell word. POSIX: single quotes, with an embedded quote closed, escaped and reopened.
// Windows (cmd / PowerShell both accept it for these values): double quotes.
export function shellWord(value, platform = process.platform) {
  const s = String(value);
  if (platform === 'win32') return /^[A-Za-z0-9_\-.:\\/=]+$/.test(s) ? s : '"' + s.replace(/"/g, '\\"') + '"';
  return /^[A-Za-z0-9_\-.:/=@%+,]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'";
}

const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// ── 1 · what would be written ───────────────────────────────────────────────────────────────────
//
// PURE: no file is read. → [{ id, label, file, format, snippet, merge, note, … }]
//   format 'json'     `merge` is the object placed under `mcpServers`; `snippet` is it as a file
//   format 'toml'     `snippet` is the block appended to the file
//   format 'command'  `snippet` is the command to run; `alt` is a project `.mcp.json` to paste
export function connectorConfigs({
  workspace = getStorageRoot(), scriptPath = mcpScriptPath(), nodePath = null, actor = null,
  home = null, platform = process.platform, env = null, configPath = process.env.SCOUT_CONFIG || null,
  runtimeEnv = null,
} = {}) {
  const rt = runtime();
  const command = nodePath || rt.command;
  const extraEnv = runtimeEnv || (nodePath ? {} : rt.env);
  const base = connectorHome({ home });
  // The apps' own variables are honoured only for the real home — never when a caller (or a test)
  // has said where home is.
  const appEnv = env || (home || UNDER_TEST() ? {} : { APPDATA: process.env.APPDATA, CODEX_HOME: process.env.CODEX_HOME });

  return TARGETS.map(t => {
    const entry = {
      command,
      args: [scriptPath],
      env: {
        SCOUT_DATA: workspace,
        ...(configPath ? { SCOUT_CONFIG: configPath } : {}),
        SCOUT_MCP_ACTOR: actor || t.actor,
        ...extraEnv,
      },
    };
    const file = configFile(t.id, { home: base, platform, env: appEnv });
    const out = { id: t.id, label: t.label, format: t.format, file, docs: t.docs, note: t.note, restart: t.restart, entry };

    if (t.format === 'json') {
      out.merge = { [SERVER_KEY]: entry };
      out.snippet = JSON.stringify({ mcpServers: out.merge }, null, 2);
    } else if (t.format === 'toml') {
      out.merge = null;
      out.snippet = tomlBlock(entry);
    } else {
      // `--transport stdio` sits between the last `--env` and the name on purpose: the Claude Code
      // docs say a name directly after `--env` is read as another KEY=value pair and rejected.
      const w = v => shellWord(v, platform);
      out.merge = null;
      out.snippet = ['claude mcp add --scope user',
        ...Object.entries(entry.env).map(([k, v]) => '--env ' + w(k + '=' + v)),
        '--transport stdio', SERVER_KEY, '--', w(entry.command), ...entry.args.map(w)].join(' ');
      out.alt = {
        label: 'Or for one project only: save this as .mcp.json in that project\'s folder',
        file: '.mcp.json',
        snippet: JSON.stringify({ mcpServers: { [SERVER_KEY]: entry } }, null, 2),
      };
      out.undo = 'claude mcp remove --scope user ' + SERVER_KEY;
    }
    // What the screen shows is what the click writes: install refuses a hash that no longer matches.
    out.hash = sha({ id: t.id, file, snippet: out.snippet });
    return out;
  });
}

// ── reading the files (never their contents outward) ────────────────────────────────────────────

const isPlain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const sameEntry = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!isPlain(v)) return v;
  return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]));
}

// → { exists, text, json, error }. A file that is only whitespace is an empty config, not a broken one.
function readJsonFile(file) {
  if (!fs.existsSync(file)) return { exists: false, text: '', json: {}, error: null };
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return { exists: true, text, json: {}, error: null };
  let json;
  try { json = JSON.parse(text.replace(/^﻿/, '')); }
  catch (e) { return { exists: true, text, json: null, error: 'it is not valid JSON (' + String(e.message).slice(0, 80) + ')' }; }
  if (!isPlain(json)) return { exists: true, text, json: null, error: 'its top level is not an object' };
  if (json.mcpServers !== undefined && !isPlain(json.mcpServers)) return { exists: true, text, json: null, error: 'its "mcpServers" is not an object' };
  return { exists: true, text, json, error: null };
}

// ── a TOML reader that only has to know where tables start and stop ─────────────────────────────
//
// Scout ships no TOML library, and it does not need one to add or remove ONE table: it needs to
// know, with certainty, where each table begins. So this walks the file line by line, understands
// comments, table headers, `key = value`, multi-line strings and multi-line arrays, and REFUSES
// the file the moment a line is none of those. Refusing is the safe answer — the alternative is
// rewriting a config file on a guess.

// 'a."b c".d' → ['a', 'b c', 'd'], or null when it is not a key.
export function tomlKeyPath(src) {
  const out = [];
  let i = 0;
  const s = String(src).trim();
  if (!s) return null;
  while (i < s.length) {
    while (s[i] === ' ' || s[i] === '\t') i++;
    let seg = '';
    if (s[i] === '"') {
      const m = /^"((?:[^"\\]|\\.)*)"/.exec(s.slice(i));
      if (!m) return null;
      try { seg = JSON.parse('"' + m[1] + '"'); } catch { return null; }
      i += m[0].length;
    } else if (s[i] === "'") {
      const end = s.indexOf("'", i + 1);
      if (end < 0) return null;
      seg = s.slice(i + 1, end); i = end + 1;
    } else {
      const m = /^[A-Za-z0-9_-]+/.exec(s.slice(i));
      if (!m) return null;
      seg = m[0]; i += m[0].length;
    }
    out.push(seg);
    while (s[i] === ' ' || s[i] === '\t') i++;
    if (i >= s.length) break;
    if (s[i] !== '.') return null;
    i++;
    if (i >= s.length) return null;
  }
  return out.length ? out : null;
}

// Walks a value (possibly over several lines) and returns the state after this line:
// { str: null | '"""' | "'''", depth } — or null when the line cannot be TOML.
function scanValue(line, state) {
  let { str, depth } = state;
  let i = 0;
  while (i < line.length) {
    if (str) {
      const end = line.indexOf(str, i);
      if (end < 0) return { str, depth };
      // A basic multi-line string may end in up to two extra quotes that belong to the content.
      i = end + 3; while (line[i] === str[0]) i++;
      str = null; continue;
    }
    const c = line[i];
    if (c === '#') break;
    if (line.startsWith('"""', i) || line.startsWith("'''", i)) { str = line.slice(i, i + 3); i += 3; continue; }
    if (c === '"') {
      const m = /^"(?:[^"\\]|\\.)*"/.exec(line.slice(i));
      if (!m) return null;
      i += m[0].length; continue;
    }
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) return null;
      i = end + 1; continue;
    }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth < 0) return null; }
    i++;
  }
  return { str, depth };
}

// → { ok, reason, tables: [{ path, line, array }], rootKeys: [{ path, line, table }] }
export function scanToml(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const tables = [], keys = [];
  let state = { str: null, depth: 0 };
  let current = [];
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    if (state.str || state.depth > 0) {
      state = scanValue(raw, state);
      if (!state) return { ok: false, reason: 'line ' + (n + 1) + ' is not something Scout can read', tables, keys };
      continue;
    }
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      const m = /^(\[\[?)([^\]]*)(\]\]?)\s*(#.*)?$/.exec(line);
      const keyPath = m && m[1].length === m[3].length ? tomlKeyPath(m[2]) : null;
      if (!keyPath) return { ok: false, reason: 'line ' + (n + 1) + ' is not a table header Scout can read', tables, keys };
      tables.push({ path: keyPath, line: n, array: m[1] === '[[' });
      current = keyPath;
      continue;
    }
    const eq = (() => {
      // The first `=` outside a quoted key segment.
      let q = null;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; continue; }
        if (c === '"' || c === "'") { q = c; continue; }
        if (c === '=') return i;
      }
      return -1;
    })();
    const keyPath = eq > 0 ? tomlKeyPath(line.slice(0, eq)) : null;
    const value = eq > 0 ? line.slice(eq + 1).trim() : '';
    if (!keyPath || !/^["'\[{0-9+\-tfin]/.test(value)) {
      return { ok: false, reason: 'line ' + (n + 1) + ' is not a "key = value" line Scout can read', tables, keys };
    }
    keys.push({ path: [...current, ...keyPath], line: n });
    state = scanValue(line.slice(eq + 1), { str: null, depth: 0 });
    if (!state) return { ok: false, reason: 'line ' + (n + 1) + ' has a value Scout cannot read', tables, keys };
  }
  if (state.str || state.depth > 0) return { ok: false, reason: 'a string or a list is never closed', tables, keys };
  return { ok: true, reason: null, tables, keys, lines };
}

const startsWith = (p, prefix) => prefix.every((seg, i) => p[i] === seg);
const OURS = ['mcp_servers', SERVER_KEY];

// Where our entry is in a scanned file. → { blocks: [[from, to]], foreign, others }
//   blocks   line ranges of `[mcp_servers.scout]` and its sub-tables (with our marker line)
//   foreign  true when `scout` is defined some other way (an inline table, a dotted key) — a form
//            Scout will not edit, because it cannot remove it without rewriting a line it shares
//   others   how many OTHER servers the file defines
function locateToml(scan) {
  const { tables, keys, lines } = scan;
  const blocks = [];
  for (let i = 0; i < tables.length; i++) {
    if (!startsWith(tables[i].path, OURS)) continue;
    let from = tables[i].line;
    const next = tables[i + 1] ? tables[i + 1].line : lines.length;
    // The block ends at its last line of content: comments and blank lines above the NEXT table
    // belong to that table.
    let to = from;
    for (let n = from + 1; n < next; n++) { const t = lines[n].trim(); if (t && !t.startsWith('#')) to = n; }
    if (from > 0 && lines[from - 1].trim() === MARKER) from--;
    blocks.push([from, to]);
  }
  const inTable = new Set(blocks.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => a + k)));
  // `mcp_servers = { … }` on one line is a closed table: TOML forbids adding `[mcp_servers.scout]`
  // beside it, and Scout cannot see inside it.
  const inline = keys.some(k => k.path.length === 1 && k.path[0] === 'mcp_servers');
  const foreign = inline || keys.some(k => !inTable.has(k.line) && startsWith(k.path, OURS));
  const names = new Set();
  for (const t of tables) if (t.path[0] === 'mcp_servers' && t.path[1] && t.path[1] !== SERVER_KEY) names.add(t.path[1]);
  for (const k of keys) if (k.path[0] === 'mcp_servers' && k.path[1] && k.path[1] !== SERVER_KEY) names.add(k.path[1]);
  return { blocks, foreign, inline, others: names.size };
}

// Our own block, read back: enough TOML for `command = "…"`, `args = ["…"]` and string env values —
// which is everything `tomlBlock` writes. Anything else reads as "differs", never as a match.
function readTomlEntry(scan, blocks) {
  const entry = { command: null, args: null, env: {} };
  const str = v => { try { return JSON.parse(v); } catch { return undefined; } };
  for (const [from, to] of blocks) {
    let inEnv = false;
    for (let n = from; n <= to; n++) {
      const line = scan.lines[n].trim();
      if (!line || line.startsWith('#')) continue;
      if (line.startsWith('[')) { inEnv = /\.env\s*\]/.test(line); continue; }
      const eq = line.indexOf('=');
      if (eq < 0) return null;
      const key = (tomlKeyPath(line.slice(0, eq)) || []).join('.'), value = line.slice(eq + 1).trim();
      if (inEnv) { const v = str(value); if (typeof v !== 'string') return null; entry.env[key] = v; }
      else if (key === 'command') { const v = str(value); if (typeof v !== 'string') return null; entry.command = v; }
      else if (key === 'args') { const v = str(value); if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) return null; entry.args = v; }
      else return null;
    }
  }
  return entry.command && entry.args ? entry : null;
}

function readTomlFile(file) {
  if (!fs.existsSync(file)) return { exists: false, text: '', scan: scanToml(''), error: null };
  const text = fs.readFileSync(file, 'utf8');
  const scan = scanToml(text);
  return { exists: true, text, scan, error: scan.ok ? null : scan.reason };
}

// ── 2 · what is there now ───────────────────────────────────────────────────────────────────────

// state: 'not-installed' the app's folder is not on this computer
//        'installed'     the app is here; Scout is not in its config
//        'connected'     our entry is in the config and is exactly what we would write
//        'outdated'      an entry named `scout` is there but differs (an old path, another workspace)
//        'unreadable'    the config file is there and Scout cannot safely read it
//        'manual'        (Claude Code) nothing to detect — run the command
function inspect(config) {
  const appDir = path.dirname(config.file);
  const base = { exists: false, appFound: fs.existsSync(appDir), has: false, matches: false, others: 0, problem: null };

  if (config.format === 'toml') {
    const f = readTomlFile(config.file);
    base.exists = f.exists;
    if (f.error) return { ...base, state: 'unreadable', problem: 'Scout cannot safely edit this file: ' + f.error };
    const where = locateToml(f.scan);
    base.others = where.others;
    if (where.inline) return { ...base, state: 'unreadable', problem: 'This file keeps all its servers on one line (mcp_servers = { … }), which Scout cannot add to. Add Scout by hand' };
    if (where.foreign) return { ...base, has: true, state: 'unreadable', problem: 'A server named "scout" is already defined in this file in a form Scout does not edit. Change it by hand' };
    base.has = where.blocks.length > 0;
    base.matches = base.has && sameEntry(readTomlEntry(f.scan, where.blocks), config.entry);
    return { ...base, state: stateOf(base), _toml: { f, where } };
  }

  const f = readJsonFile(config.file);
  base.exists = f.exists;
  if (f.error) {
    return config.format === 'command'
      ? { ...base, state: 'manual' }
      : { ...base, state: 'unreadable', problem: 'Scout cannot safely edit this file: ' + f.error };
  }
  const servers = isPlain(f.json.mcpServers) ? f.json.mcpServers : {};
  base.has = Object.hasOwn(servers, SERVER_KEY);
  // Claude Code stores what `claude mcp add` was given plus `"type": "stdio"` — the same entry.
  const { type, ...theirs } = isPlain(servers[SERVER_KEY]) ? servers[SERVER_KEY] : {};
  base.matches = base.has && sameEntry(type === undefined || type === 'stdio' ? theirs : servers[SERVER_KEY], config.entry);
  base.others = Object.keys(servers).filter(k => k !== SERVER_KEY).length;
  if (config.format === 'command') return { ...base, state: base.matches ? 'connected' : base.has ? 'outdated' : 'manual' };
  return { ...base, state: stateOf(base), _json: f };
}
const stateOf = b => (b.matches ? 'connected' : b.has ? 'outdated' : b.appFound ? 'installed' : 'not-installed');

const PUBLIC = ({ _toml, _json, ...rest }) => rest;

// Everything the Connectors screen needs, in one read. Nothing of any other server leaves here.
export function connectorStatus(opts = {}) {
  const rt = runtime();
  const script = opts.scriptPath || mcpScriptPath();
  const packaged = /\.asar[\\/]/.test(script);
  const command = opts.nodePath || rt.command;
  const usable = !(packaged && rt.kind === 'node' && !opts.nodePath);
  return {
    workspace: opts.workspace || getStorageRoot(),
    runtime: {
      kind: opts.nodePath ? 'node' : rt.kind, command, script, packaged,
      scriptFound: fs.existsSync(script), ok: usable && fs.existsSync(script),
      note: !usable
        ? 'Scout\'s connector is packed inside the app and can only be started by the Scout app itself. Open the Scout app and use this screen there.'
        : rt.kind === 'electron' && !opts.nodePath
          ? 'Agents start the connector with the Scout app itself — no separate Node.js install is needed. If you move or update Scout, come back here and reconnect.'
          : 'Agents start the connector with the Node.js that is running Scout right now. If you move this folder or change Node versions, come back here and reconnect.',
    },
    connectors: connectorConfigs(opts).map(c => ({ ...c, ...PUBLIC(inspect(c)) })),
    remote: REMOTE_ONLY,
  };
}

// ── 3 · the writers ─────────────────────────────────────────────────────────────────────────────

const stamp = (now = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return now.getFullYear() + p(now.getMonth() + 1) + p(now.getDate()) + '-' + p(now.getHours()) + p(now.getMinutes()) + p(now.getSeconds());
};

// A copy beside the file, never over an older copy.
function backupOf(file, now) {
  let dest = file + '.scout-backup-' + stamp(now);
  for (let i = 2; fs.existsSync(dest); i++) dest = file + '.scout-backup-' + stamp(now) + '-' + i;
  fs.copyFileSync(file, dest, fs.constants.COPYFILE_EXCL);
  return dest;
}

// tmp + rename, like every write in this codebase — and here it matters more, because the reader
// is somebody else's program. The file's own permissions are kept (these files hold API keys and
// are often 0600), and a symlinked config (a dotfiles repo) is written THROUGH, not replaced.
function writeAtomic(file, text) {
  const target = fs.existsSync(file) ? fs.realpathSync(file) : file;
  assertSafeTarget(target);
  let mode = 0o600;
  try { mode = fs.statSync(target).mode & 0o777; } catch { /* a new file */ }
  const tmp = target + '.scout-' + process.pid + '.tmp';
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, target);
  return target;
}

function pick(id, opts) {
  const config = connectorConfigs(opts).find(c => c.id === id);
  if (!config) fail('no connector "' + id + '"', 404);
  return config;
}
function editable(config, verb) {
  if (config.format === 'command') {
    fail(config.label + ' manages its own server list. Run the command shown on this screen' + (verb === 'remove' ? ' to remove it: ' + config.undo : ' instead.'), 400);
  }
}
const indentOf = text => { const m = /\n([ \t]+)"/.exec(text); return m ? m[1] : 2; };
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

// Adds or refreshes OUR entry. `hash` is what the screen showed (connectorConfigs().hash): if what
// would be written has changed since, nothing is written.
export function installConnector(id, { actor = DEFAULT_ACTOR, hash = null, now = new Date(), ...opts } = {}) {
  owner(actor);
  const config = pick(id, opts);
  editable(config, 'install');
  if (!hash || hash !== config.hash) fail('What Scout would write has changed since this screen loaded. Reload it, read the new text, and connect again.', 409);
  const found = inspect(config);
  if (found.state === 'unreadable') fail(found.problem + '. Nothing was changed. You can paste the text into ' + config.file + ' yourself.', 409);
  if (!found.appFound) fail(config.label + ' does not seem to be set up on this computer (there is no folder ' + path.dirname(config.file) + '). Open ' + config.label + ' once, then connect.', 409);
  assertSafeTarget(config.file);

  const result = { id, label: config.label, file: config.file, changed: false, created: !found.exists, backup: null, kept: found.others, restart: config.restart };
  if (found.matches) {
    result.summary = ['Already connected — the entry in ' + config.file + ' is exactly this one. Nothing was written.'];
    return result;
  }

  let next;
  if (config.format === 'toml') {
    const { f, where } = found._toml;
    const lines = f.exists ? [...f.scan.lines] : [];
    // Take our old block out (bottom-up so line numbers hold), then put the new one at the end.
    for (const [from, to] of [...where.blocks].sort((a, b) => b[0] - a[0])) lines.splice(from, to - from + 1);
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    next = (lines.length ? lines.join('\n') + '\n\n' : '') + config.snippet;
  } else {
    const f = found._json;
    const json = { ...f.json, mcpServers: { ...(f.json.mcpServers || {}), [SERVER_KEY]: config.entry } };
    next = JSON.stringify(json, null, indentOf(f.text)) + '\n';
  }

  if (found.exists) result.backup = backupOf(fs.realpathSync(config.file), now);
  writeAtomic(config.file, next);
  result.changed = true;
  result.summary = [
    (found.has ? '~ replaced' : '+ added') + ' the "' + SERVER_KEY + '" server in ' + config.file,
    found.others ? '· ' + plural(found.others, 'other server') + ' left exactly as ' + (found.others === 1 ? 'it was' : 'they were') : '· no other servers in this file',
    result.backup ? '· the file as it was is saved at ' + result.backup : '· the file did not exist before, so there is nothing to back up',
  ];
  logEvent({ type: 'update', actor, target: 'connectors/' + id, detail: { action: found.has ? 'replace' : 'install', file: config.file, backup: result.backup } });
  return result;
}

// Takes OUR entry out and nothing else. The file itself is never deleted.
export function removeConnector(id, { actor = DEFAULT_ACTOR, now = new Date(), ...opts } = {}) {
  owner(actor);
  const config = pick(id, opts);
  editable(config, 'remove');
  const found = inspect(config);
  if (found.state === 'unreadable') fail(found.problem + '. Nothing was changed.', 409);
  const result = { id, label: config.label, file: config.file, changed: false, backup: null, kept: found.others, restart: config.restart };
  if (!found.has) { result.summary = ['Scout is not in ' + config.file + '. Nothing was written.']; return result; }
  assertSafeTarget(config.file);

  let next;
  if (config.format === 'toml') {
    const { f, where } = found._toml;
    const lines = [...f.scan.lines];
    for (const [from, to] of [...where.blocks].sort((a, b) => b[0] - a[0])) {
      lines.splice(from, to - from + 1);
      // Do not leave a double gap where the block was.
      if (from > 0 && from < lines.length && !lines[from - 1].trim() && !lines[from].trim()) lines.splice(from, 1);
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    next = lines.length ? lines.join('\n') + '\n' : '';
  } else {
    const f = found._json;
    const { [SERVER_KEY]: _ours, ...rest } = f.json.mcpServers;
    next = JSON.stringify({ ...f.json, mcpServers: rest }, null, indentOf(f.text)) + '\n';
  }
  result.backup = backupOf(fs.realpathSync(config.file), now);
  writeAtomic(config.file, next);
  result.changed = true;
  result.summary = [
    '- removed the "' + SERVER_KEY + '" server from ' + config.file,
    found.others ? '· ' + plural(found.others, 'other server') + ' left exactly as ' + (found.others === 1 ? 'it was' : 'they were') : '· no other servers in this file',
    '· the file as it was is saved at ' + result.backup,
  ];
  logEvent({ type: 'update', actor, target: 'connectors/' + id, detail: { action: 'remove', file: config.file, backup: result.backup } });
  return result;
}

export default { connectorConfigs, connectorStatus, installConnector, removeConnector, connectorHome, runtime, TARGETS, REMOTE_ONLY };
