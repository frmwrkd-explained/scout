// Connecting an outside agent (backend/connectors.mjs, backend/connectorRoutes.mjs) and the MCP
// door those connections open (backend/mcp.mjs).
//
// The first test is the one everything else stands on: these are the only functions in Scout that
// write outside the workspace, so under test "home" must be a folder in the temp root — always.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { freshRoot, req, server_, fs, path, loadJsx } from './helpers.mjs';
import {
  connectorConfigs, connectorStatus, installConnector, removeConnector, connectorHome,
  scanToml, tomlString, tomlBlock, shellWord, SERVER_KEY,
} from '../backend/connectors.mjs';
import { handleMessage, httpRefusal, TOOLS, MCP_AGENT } from '../backend/mcp.mjs';
import { readEvents } from '../backend/log.mjs';

// A real TOML parser, when this machine has one (Python ≥ 3.11). Scout ships none, so the files it
// writes are checked against somebody else's reading of the format wherever that is possible.
const PY_TOML = spawnSync('python3', ['-c', 'import tomllib']).status === 0;
const parseToml = text => JSON.parse(execFileSync('python3',
  ['-c', 'import tomllib,sys,json; print(json.dumps(tomllib.loads(sys.stdin.read())))'], { input: text, encoding: 'utf8' }));

const SPACED = {
  workspace: '/Volumes/SSD/New Coding Projects/Scout/workspace',
  scriptPath: '/Volumes/SSD/New Coding Projects/Scout/scripts/scout-mcp.mjs',
  nodePath: '/usr/local/bin/node',
  configPath: '/Volumes/SSD/New Coding Projects/Scout/config.md',
  home: '/Users/somebody', platform: 'darwin',
};
const by = (list, id) => list.find(c => c.id === id);

// A home inside the temp root with every agent app "installed" (its config folder exists).
function homeWithApps() {
  const root = freshRoot();
  const home = connectorHome();
  for (const dir of ['Library/Application Support/Claude', '.config/Claude', '.codex', '.gemini/config']) {
    fs.mkdirSync(path.join(home, dir), { recursive: true });
  }
  return { root, home };
}
const current = id => by(connectorConfigs(), id);
const backupsOf = file => fs.readdirSync(path.dirname(file)).filter(f => f.startsWith(path.basename(file) + '.scout-backup-'));

// ── 0 · where "home" is ─────────────────────────────────────────────────────────────────────────

test('under test, home and every config file are inside the temp root — whatever the environment says', () => {
  const root = freshRoot();
  const before = process.env.SCOUT_CONNECTOR_HOME;
  process.env.SCOUT_CONNECTOR_HOME = os.homedir();   // a stray variable must not aim a test at the real home
  process.env.CODEX_HOME = path.join(os.homedir(), '.codex');
  try {
    assert.equal(connectorHome(), path.join(root, '.connector-home'));
    for (const c of connectorConfigs()) {
      assert.ok(c.file.startsWith(root + path.sep), c.id + ' would be written at ' + c.file);
      assert.ok(!c.file.startsWith(os.homedir() + path.sep), c.id + ' points into the real home');
    }
  } finally {
    if (before === undefined) delete process.env.SCOUT_CONNECTOR_HOME; else process.env.SCOUT_CONNECTOR_HOME = before;
    delete process.env.CODEX_HOME;
  }
});

test('a write aimed outside the temp folder is refused even when a caller passes that home', () => {
  freshRoot();
  const outside = path.join(os.homedir(), '.scout-test-must-never-exist-' + process.pid);
  const c = by(connectorConfigs({ home: outside }), 'gemini-cli');
  assert.throws(() => installConnector('gemini-cli', { home: outside, hash: c.hash }), /does not seem to be set up|refusing to write outside/);
  assert.equal(fs.existsSync(outside), false, 'nothing was created in the real home');
});

// ── 1 · what would be written ───────────────────────────────────────────────────────────────────

test('every agent gets absolute paths, and a path with spaces survives JSON, TOML and the shell', () => {
  const configs = connectorConfigs(SPACED);
  assert.deepEqual(configs.map(c => c.id), ['claude-desktop', 'claude-code', 'codex', 'gemini-cli', 'antigravity']);
  assert.deepEqual(configs.map(c => c.format), ['json', 'command', 'toml', 'json', 'json']);

  for (const c of configs) {
    assert.equal(c.entry.command, '/usr/local/bin/node');
    assert.deepEqual(c.entry.args, [SPACED.scriptPath]);
    assert.equal(c.entry.env.SCOUT_DATA, SPACED.workspace);
    assert.equal(c.entry.env.SCOUT_CONFIG, SPACED.configPath);
    assert.ok(path.posix.isAbsolute(c.file), c.id + ' file is not absolute: ' + c.file);
    assert.ok(c.docs.startsWith('https://'), c.id + ' has no official page to point at');
    assert.match(c.hash, /^[0-9a-f]{64}$/);
  }

  // JSON: what a person would paste parses back to exactly the entry.
  for (const id of ['claude-desktop', 'gemini-cli', 'antigravity']) {
    const c = by(configs, id);
    assert.deepEqual(JSON.parse(c.snippet), { mcpServers: { scout: c.entry } });
    assert.deepEqual(c.merge, { scout: c.entry });
    assert.ok(c.snippet.includes('"/Volumes/SSD/New Coding Projects/Scout/scripts/scout-mcp.mjs"'));
  }

  // TOML: Scout's own reader accepts it, and so does a real parser.
  const codex = by(configs, 'codex');
  assert.equal(scanToml(codex.snippet).ok, true);
  assert.ok(codex.snippet.includes('args = ["/Volumes/SSD/New Coding Projects/Scout/scripts/scout-mcp.mjs"]'));
  if (PY_TOML) assert.deepEqual(parseToml(codex.snippet), { mcp_servers: { scout: codex.entry } });

  // Shell: run the words through a real /bin/sh and read back what each argument became.
  const code = by(configs, 'claude-code');
  assert.ok(code.snippet.startsWith('claude mcp add --scope user --env '));
  // The Claude Code docs: a name straight after --env is read as another pair, so an option sits between.
  assert.match(code.snippet, /--transport stdio scout -- /);
  const words = execFileSync('/bin/sh', ['-c', code.snippet.replace(/^claude mcp add/, "printf '%s\\n'")], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(words.includes('SCOUT_DATA=' + SPACED.workspace), 'the workspace did not stay one argument');
  assert.deepEqual(words.slice(-3), ['--', '/usr/local/bin/node', SPACED.scriptPath]);
  assert.deepEqual(JSON.parse(code.alt.snippet), { mcpServers: { scout: code.entry } });
});

test('each operating system gets the file its app actually reads', () => {
  const file = (id, platform, extra = {}) => by(connectorConfigs({ ...SPACED, platform, ...extra }), id).file;
  assert.equal(file('claude-desktop', 'darwin'), '/Users/somebody/Library/Application Support/Claude/claude_desktop_config.json');
  assert.equal(file('claude-desktop', 'linux'), '/Users/somebody/.config/Claude/claude_desktop_config.json');
  assert.equal(file('claude-desktop', 'win32', { home: 'C:\\Users\\Jo Smith' }), 'C:\\Users\\Jo Smith\\AppData\\Roaming\\Claude\\claude_desktop_config.json');
  assert.equal(file('claude-desktop', 'win32', { home: 'C:\\Users\\Jo Smith', env: { APPDATA: 'D:\\Roam' } }), 'D:\\Roam\\Claude\\claude_desktop_config.json');
  assert.equal(file('codex', 'darwin'), '/Users/somebody/.codex/config.toml');
  assert.equal(file('codex', 'darwin', { env: { CODEX_HOME: '/opt/codex home' } }), '/opt/codex home/config.toml');
  assert.equal(file('gemini-cli', 'darwin'), '/Users/somebody/.gemini/settings.json');
  assert.equal(file('antigravity', 'darwin'), '/Users/somebody/.gemini/config/mcp_config.json');
});

test('Windows backslashes and quotes in a path are escaped, not lost', () => {
  const win = { workspace: 'C:\\Users\\Jo Smith\\Scout data', scriptPath: 'C:\\Program Files\\Scout\\resources\\app.asar\\scripts\\scout-mcp.mjs',
    nodePath: 'C:\\Program Files\\Scout\\Scout.exe', runtimeEnv: { ELECTRON_RUN_AS_NODE: '1' }, home: 'C:\\Users\\Jo Smith', platform: 'win32' };
  const configs = connectorConfigs(win);
  assert.equal(JSON.parse(by(configs, 'claude-desktop').snippet).mcpServers.scout.args[0], win.scriptPath);
  assert.equal(by(configs, 'claude-desktop').entry.env.ELECTRON_RUN_AS_NODE, '1');
  if (PY_TOML) assert.deepEqual(parseToml(by(configs, 'codex').snippet).mcp_servers.scout, by(configs, 'codex').entry);

  const odd = 'it\'s a "strange" folder\\name\twith a tab';
  assert.equal(JSON.parse(tomlString(odd)), odd);
  if (PY_TOML) assert.equal(parseToml('v = ' + tomlString(odd) + '\n').v, odd);
  assert.equal(execFileSync('/bin/sh', ['-c', "printf '%s' " + shellWord(odd, 'darwin')], { encoding: 'utf8' }), odd);
  if (PY_TOML) assert.deepEqual(parseToml(tomlBlock({ command: odd, args: [odd], env: { 'A KEY': odd } })).mcp_servers.scout, { command: odd, args: [odd], env: { 'A KEY': odd } });
});

// ── 2 · reading what is there ───────────────────────────────────────────────────────────────────

test('status tells apart not installed, installed, connected and outdated', () => {
  freshRoot();
  let status = connectorStatus();
  assert.equal(by(status.connectors, 'claude-desktop').state, 'not-installed');
  assert.equal(by(status.connectors, 'claude-code').state, 'manual');
  assert.equal(status.remote.every(r => r.state === 'needs-public-address'), true);
  assert.equal(status.runtime.ok, true);
  assert.equal(status.runtime.kind, 'node');

  homeWithApps();
  assert.equal(by(connectorStatus().connectors, 'claude-desktop').state, 'installed');
  installConnector('claude-desktop', { hash: current('claude-desktop').hash });
  assert.equal(by(connectorStatus().connectors, 'claude-desktop').state, 'connected');

  // The same entry pointing at another workspace is ours, but not what we would write now.
  const c = current('claude-desktop');
  const json = JSON.parse(fs.readFileSync(c.file, 'utf8'));
  json.mcpServers.scout.env.SCOUT_DATA = '/somewhere/else';
  fs.writeFileSync(c.file, JSON.stringify(json));
  assert.equal(by(connectorStatus().connectors, 'claude-desktop').state, 'outdated');
});

test('status never repeats another server\'s name, command or secrets', () => {
  homeWithApps();
  const secret = 'sk-live-DO-NOT-LEAK-0123456789';
  fs.writeFileSync(current('claude-desktop').file, JSON.stringify({ mcpServers: {
    'private-crm-tool': { command: '/opt/crm/bin', args: ['--token', secret], env: { CRM_API_KEY: secret } } }, apiKey: secret }));
  fs.writeFileSync(current('codex').file, 'model = "gpt"\n\n[mcp_servers.private-crm-tool]\ncommand = "/opt/crm/bin"\n\n[mcp_servers.private-crm-tool.env]\nCRM_API_KEY = "' + secret + '"\n');
  const out = JSON.stringify(connectorStatus());
  for (const leak of [secret, 'private-crm-tool', '/opt/crm/bin', 'CRM_API_KEY']) assert.ok(!out.includes(leak), 'status leaked "' + leak + '"');
  const status = connectorStatus();
  assert.equal(by(status.connectors, 'claude-desktop').others, 1);
  assert.equal(by(status.connectors, 'codex').others, 1);
});

// ── 3 · install ─────────────────────────────────────────────────────────────────────────────────

test('install merges our entry into JSON, leaves every other key alone, and backs the file up first', () => {
  homeWithApps();
  const c = current('claude-desktop');
  const original = JSON.stringify({
    globalShortcut: 'Alt+Space',
    mcpServers: { filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/x/Desktop'], env: { TOKEN: 'abc' } } },
    preferences: { nested: [1, 2, { deep: true }] },
  }, null, 4);
  fs.writeFileSync(c.file, original, { mode: 0o600 });

  const result = installConnector('claude-desktop', { hash: c.hash });
  assert.equal(result.changed, true);
  assert.equal(result.created, false);
  assert.equal(result.kept, 1);
  assert.ok(result.summary.join('\n').includes('1 other server left exactly as it was'));
  assert.match(result.restart, /Claude Desktop/);

  const after = JSON.parse(fs.readFileSync(c.file, 'utf8'));
  const before = JSON.parse(original);
  assert.deepEqual(after.mcpServers.scout, c.entry);
  assert.deepEqual(after.mcpServers.filesystem, before.mcpServers.filesystem);
  assert.deepEqual({ ...after, mcpServers: undefined }, { ...before, mcpServers: undefined });
  assert.ok(fs.readFileSync(c.file, 'utf8').includes('\n    "globalShortcut"'), 'the file\'s own indentation was kept');
  assert.equal(fs.statSync(c.file).mode & 0o777, 0o600, 'a private file stayed private');

  // The backup is beside the file and is the file as it was, byte for byte.
  assert.equal(path.dirname(result.backup), fs.realpathSync(path.dirname(c.file)));
  assert.equal(fs.readFileSync(result.backup, 'utf8'), original);
  assert.equal(fs.readdirSync(path.dirname(c.file)).some(f => f.endsWith('.tmp')), false, 'no temp file left behind');

  // …and it is in the activity log, attributed to the person.
  const ev = readEvents({ target: 'connectors/claude-desktop' })[0];
  assert.equal(ev.detail.action, 'install');
  assert.equal(ev.detail.backup, result.backup);
});

test('install is idempotent: a second click writes nothing and makes no second backup', () => {
  homeWithApps();
  const c = current('gemini-cli');
  fs.writeFileSync(c.file, '{"theme":"dark"}');
  assert.equal(installConnector('gemini-cli', { hash: c.hash }).changed, true);
  const bytes = fs.readFileSync(c.file, 'utf8'), mtime = fs.statSync(c.file).mtimeMs;
  const again = installConnector('gemini-cli', { hash: c.hash });
  assert.equal(again.changed, false);
  assert.equal(again.backup, null);
  assert.equal(fs.readFileSync(c.file, 'utf8'), bytes);
  assert.equal(fs.statSync(c.file).mtimeMs, mtime);
  assert.equal(backupsOf(c.file).length, 1);
});

test('install creates the file when the app is there but has no config yet', () => {
  homeWithApps();
  const c = current('antigravity');
  const result = installConnector('antigravity', { hash: c.hash });
  assert.equal(result.created, true);
  assert.equal(result.backup, null);
  assert.deepEqual(JSON.parse(fs.readFileSync(c.file, 'utf8')), { mcpServers: { scout: c.entry } });
});

test('install refuses a file it cannot read safely, and changes nothing', () => {
  homeWithApps();
  const cases = [
    ['claude-desktop', '{ "mcpServers": { "a": {} }, }  // trailing comma and a comment'],
    ['claude-desktop', '[1, 2, 3]'],
    ['gemini-cli', '{"mcpServers": ["not", "an", "object"]}'],
    ['codex', 'model = "gpt"\nnotes = """\nnever closed\n'],
    ['codex', 'this line is not toml at all\n'],
    ['codex', 'mcp_servers = { other = { command = "x" } }\n'],
    ['codex', '[mcp_servers]\nscout = { command = "old" }\n'],
  ];
  for (const [id, text] of cases) {
    const c = current(id);
    fs.writeFileSync(c.file, text);
    assert.throws(() => installConnector(id, { hash: c.hash }), e => e.status === 409 && /Nothing was changed/.test(e.message), id + ' accepted: ' + text);
    assert.equal(fs.readFileSync(c.file, 'utf8'), text, id + ' was rewritten');
    assert.equal(backupsOf(c.file).length, 0);
    assert.equal(by(connectorStatus().connectors, id).state, 'unreadable');
    fs.rmSync(c.file);
  }
});

test('install refuses an agent, a stale screen, an app that is not there, and Claude Code', () => {
  homeWithApps();
  const c = current('claude-desktop');
  fs.writeFileSync(c.file, '{}');

  assert.throws(() => installConnector('claude-desktop', { hash: c.hash, actor: 'scout-fb' }), e => e.status === 403 && /Only the operator/.test(e.message));
  assert.throws(() => installConnector('claude-desktop', { hash: c.hash, actor: '' }), e => e.status === 403);
  assert.throws(() => removeConnector('claude-desktop', { actor: 'scout-fb' }), e => e.status === 403);
  assert.throws(() => installConnector('claude-desktop', {}), e => e.status === 409 && /changed since this screen loaded/.test(e.message));
  assert.throws(() => installConnector('claude-desktop', { hash: 'f'.repeat(64) }), e => e.status === 409);
  assert.equal(fs.readFileSync(c.file, 'utf8'), '{}');

  assert.throws(() => installConnector('claude-code', { hash: current('claude-code').hash }), e => e.status === 400 && /Run the command/.test(e.message));
  assert.throws(() => installConnector('nope', { hash: 'x' }), e => e.status === 404);

  freshRoot();   // a home with no apps at all
  assert.throws(() => installConnector('codex', { hash: current('codex').hash }), e => e.status === 409 && /does not seem to be set up/.test(e.message));
  assert.equal(fs.existsSync(path.dirname(current('codex').file)), false, 'no folder was created for an app that is not installed');
});

test('a symlinked config is written through, not replaced', () => {
  const { home } = homeWithApps();
  const c = current('gemini-cli');
  const dotfiles = path.join(home, 'dotfiles');
  fs.mkdirSync(dotfiles);
  fs.writeFileSync(path.join(dotfiles, 'gemini-settings.json'), '{"theme":"dark"}');
  fs.symlinkSync(path.join(dotfiles, 'gemini-settings.json'), c.file);

  const result = installConnector('gemini-cli', { hash: c.hash });
  assert.equal(fs.lstatSync(c.file).isSymbolicLink(), true, 'the link was replaced by a file');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dotfiles, 'gemini-settings.json'), 'utf8')).mcpServers.scout, c.entry);
  assert.equal(fs.realpathSync(path.dirname(result.backup)), fs.realpathSync(dotfiles));
});

test('TOML: our table is appended, replaced and removed without touching one byte of anything else', () => {
  homeWithApps();
  const c = current('codex');
  const original = [
    '# my codex config', 'model = "gpt-6"', 'approval_policy = "on-request"', '',
    '[mcp_servers.context7]', 'command = "npx"', 'args = [', '  "-y",', '  "@upstash/context7-mcp",   # a comment with a ] in it', ']', '',
    '[mcp_servers.context7.env]', 'MY_ENV_VAR = "a value with [brackets] and = signs"', '',
    '[profiles.deep]', 'model = "gpt-6-pro"', '',
  ].join('\n');
  fs.writeFileSync(c.file, original);

  const result = installConnector('codex', { hash: c.hash });
  assert.equal(result.kept, 1);
  const installed = fs.readFileSync(c.file, 'utf8');
  assert.ok(installed.startsWith(original.trimEnd() + '\n\n'), 'the existing text is still there, unchanged, in front');
  assert.ok(installed.endsWith(c.snippet));
  assert.equal(fs.readFileSync(result.backup, 'utf8'), original);
  assert.equal(by(connectorStatus().connectors, 'codex').state, 'connected');
  if (PY_TOML) {
    const parsed = parseToml(installed);
    assert.deepEqual(parsed.mcp_servers.scout, c.entry);
    assert.deepEqual({ ...parsed, mcp_servers: { context7: parsed.mcp_servers.context7 } }, parseToml(original));
  }
  assert.equal(installConnector('codex', { hash: c.hash }).changed, false);

  // An older entry of ours in the MIDDLE of the file is replaced, and the table after it survives.
  const older = original.replace('[profiles.deep]', '[mcp_servers.scout]\ncommand = "/old/node"\nargs = ["/old/scout-mcp.mjs"]\n\n[mcp_servers.scout.env]\nSCOUT_DATA = "/old"\n\n# about the profile\n[profiles.deep]');
  fs.writeFileSync(c.file, older);
  assert.equal(by(connectorStatus().connectors, 'codex').state, 'outdated');
  installConnector('codex', { hash: c.hash });
  const replaced = fs.readFileSync(c.file, 'utf8');
  assert.ok(!replaced.includes('/old/node'));
  assert.ok(replaced.includes('# about the profile\n[profiles.deep]\nmodel = "gpt-6-pro"'), 'the next table and its comment were kept');
  assert.equal((replaced.match(/\[mcp_servers\.scout\]/g) || []).length, 1);
  if (PY_TOML) assert.deepEqual(parseToml(replaced).mcp_servers.scout, c.entry);

  // Remove takes out exactly what install put in.
  fs.writeFileSync(c.file, original);
  installConnector('codex', { hash: c.hash });
  const removed = removeConnector('codex');
  assert.equal(removed.changed, true);
  assert.equal(fs.readFileSync(c.file, 'utf8'), original.trimEnd() + '\n');
  assert.equal(fs.readFileSync(removed.backup, 'utf8'), installed);
  assert.equal(by(connectorStatus().connectors, 'codex').state, 'installed');
});

// ── 4 · remove ──────────────────────────────────────────────────────────────────────────────────

test('remove takes out only our entry, backs up first, and is a no-op when we are not there', () => {
  homeWithApps();
  const c = current('claude-desktop');
  const others = { filesystem: { command: 'npx', args: ['x'] }, notes: { command: '/bin/notes', env: { K: 'v' } } };
  fs.writeFileSync(c.file, JSON.stringify({ theme: 'dark', mcpServers: others }, null, 2));

  const nothing = removeConnector('claude-desktop');
  assert.equal(nothing.changed, false);
  assert.equal(nothing.backup, null);
  assert.equal(backupsOf(c.file).length, 0);

  installConnector('claude-desktop', { hash: c.hash });
  const withUs = fs.readFileSync(c.file, 'utf8');
  const result = removeConnector('claude-desktop');
  assert.equal(result.changed, true);
  assert.equal(result.kept, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(c.file, 'utf8')), { theme: 'dark', mcpServers: others });
  assert.equal(fs.readFileSync(result.backup, 'utf8'), withUs);
  assert.equal(fs.existsSync(c.file), true, 'the file itself is never deleted');
});

// ── 5 · the routes ──────────────────────────────────────────────────────────────────────────────

test('the routes: read, connect with what the screen showed, refuse an agent, disconnect', async () => {
  homeWithApps();
  const list = await req('GET', '/api/connectors');
  assert.equal(list.status, 200);
  assert.equal(list.body.connectors.length, 5);
  const gemini = by(list.body.connectors, 'gemini-cli');
  assert.equal(gemini.state, 'installed');
  assert.ok(gemini.snippet && gemini.file && gemini.hash);

  const agent = await req('POST', '/api/connectors/gemini-cli/install', { hash: gemini.hash, actor: 'scout-fb' });
  assert.equal(agent.status, 403);
  const stale = await req('POST', '/api/connectors/gemini-cli/install', { hash: 'nope' });
  assert.equal(stale.status, 409);
  assert.equal(fs.existsSync(gemini.file), false);

  const done = await req('POST', '/api/connectors/gemini-cli/install', { hash: gemini.hash });
  assert.equal(done.status, 200);
  assert.equal(done.body.changed, true);
  assert.equal(by((await req('GET', '/api/connectors')).body.connectors, 'gemini-cli').state, 'connected');

  const gone = await req('POST', '/api/connectors/gemini-cli/remove', {});
  assert.equal(gone.status, 200);
  assert.equal(by((await req('GET', '/api/connectors')).body.connectors, 'gemini-cli').state, 'installed');
  assert.equal((await req('POST', '/api/connectors/claude-code/install', { hash: by(list.body.connectors, 'claude-code').hash })).status, 400);
});

// ── 6 · the door those connections open ─────────────────────────────────────────────────────────

let n = 0;
const rpc = (method, params) => handleMessage({ jsonrpc: '2.0', id: ++n, method, params });
const call = (name, args = {}) => rpc('tools/call', { name, arguments: args });

test('every Index capability is a working tool — none answers "not bound"', async () => {
  freshRoot();
  assert.deepEqual(TOOLS.filter(t => !t.bound).map(t => t.route), []);
  for (const name of ['scout_get_conductor', 'scout_get_workers', 'scout_get_paperclip']) {
    const res = await call(name);
    assert.equal(res.error, undefined, name + ': ' + (res.error && res.error.message));
    assert.equal(typeof JSON.parse(res.result.content[0].text), 'object');
  }
  // The two proposing tools reach the real functions: their refusals are the functions' sentences.
  const widget = await call('scout_post_widgets_propose', { widget: { id: 'x', type: 'goal_progress', title: 'Goals' }, evidence: [] });
  assert.match(widget.error.message, /evidence/i);
  const delivery = await call('scout_post_deliveries_preview', { workId: 'no-such-work', message: 'hello' });
  assert.match(delivery.error.message, /no record at data\/work\/no-such-work\.md/);
  assert.equal(delivery.error.data.status, 404);
});

test('an MCP client cannot become the person by typing the person\'s name', async () => {
  const root = freshRoot();
  for (const actor of [undefined, 'crystal', 'scout-fb']) {
    const res = await call('scout_post_goals', { label: 'Book 20 guests', target: 20, by: '2027-01-31', ...(actor ? { actor } : {}) });
    assert.ok(res.error, 'a goal was created through the agent door as "' + actor + '"');
    assert.equal(res.error.data.status, 403);
    assert.match(res.error.message, /human-owned/);
  }
  assert.equal(fs.existsSync(path.join(root, 'goals', 'book-20-guests.md')), false);
  const refused = readEvents({ type: 'refused' }).map(e => e.actor);
  assert.ok(refused.includes(MCP_AGENT), 'the person\'s name was replaced by the MCP agent id');
  assert.ok(!refused.includes('crystal'));
});

test('MCP over HTTP: same tools, local callers only, no stream', async () => {
  freshRoot();
  const base = await server_();
  const post = (body, headers = {}) => fetch(base + '/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });

  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  assert.equal(init.status, 200);
  assert.equal((await init.json()).result.serverInfo.name, 'scout');

  const note = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(note.status, 202);
  assert.equal(await note.text(), '');

  const tools = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'MCP-Protocol-Version': '2025-06-18' })).json();
  assert.equal(tools.result.tools.length, TOOLS.length);

  // The gate is the same gate: a goal is still refused, with the sentence.
  const goal = await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'scout_post_goals', arguments: { label: 'Over HTTP', actor: 'crystal' } } })).json();
  assert.equal(goal.error.data.status, 403);

  assert.equal((await post({ jsonrpc: '2.0', id: 4, method: 'ping' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post({ jsonrpc: '2.0', id: 5, method: 'ping' }, { 'MCP-Protocol-Version': '1999-01-01' })).status, 400);
  assert.equal((await post('just a string')).status, 400);
  const get = await fetch(base + '/api/mcp');
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');

  // The header rules as a function — the cases a test cannot fake over a real loopback socket.
  const ok = { method: 'POST', host: '127.0.0.1:5177', remoteAddress: '127.0.0.1' };
  assert.equal(httpRefusal(ok), null);
  assert.equal(httpRefusal({ ...ok, origin: 'http://localhost:5178' }), null);
  assert.equal(httpRefusal({ ...ok, remoteAddress: '192.168.1.20' }).status, 403);
  assert.equal(httpRefusal({ ...ok, host: 'scout.evil.example' }).status, 403);          // DNS rebinding
  assert.equal(httpRefusal({ ...ok, origin: 'null' }).status, 403);
  assert.equal(httpRefusal({ ...ok, origin: 'https://127.0.0.1.evil.example' }).status, 403);
});

test('the server key is one word with no underscore (Gemini CLI splits tool names on underscores)', () => {
  assert.equal(SERVER_KEY, 'scout');
});

// ── the screen's wording ────────────────────────────────────────────────────────────────────────

test('every state the server can report has a label, and the card says what the click will do', async () => {
  const { STATE_LABEL, whereLine } = await loadJsx('frontend/Connectors.jsx');
  homeWithApps();
  const status = connectorStatus();
  for (const c of [...status.connectors, ...status.remote]) assert.ok(STATE_LABEL[c.state], 'no label for the state "' + c.state + '"');
  for (const state of ['not-installed', 'installed', 'connected', 'outdated', 'unreadable', 'manual', 'needs-public-address']) assert.ok(STATE_LABEL[state], state);
  assert.equal(STATE_LABEL.connected, 'Connected in config');

  assert.equal(whereLine({ format: 'json', state: 'installed', exists: false }), 'Scout will create');
  assert.equal(whereLine({ format: 'json', state: 'installed', exists: true }), 'Scout will add this entry to');
  assert.equal(whereLine({ format: 'toml', state: 'installed', exists: true }), 'Scout will add these lines to the end of');
  assert.equal(whereLine({ format: 'toml', state: 'outdated', exists: true }), 'Scout will replace its entry in');
  assert.equal(whereLine({ format: 'json', state: 'connected', exists: true }), 'This is in');
  assert.equal(whereLine({ format: 'command', state: 'manual' }), 'Run this once in a terminal:');
});

// ── what Connect writes actually starts the server ──────────────────────────────────────────────

test('the entry Scout writes starts the connector: an agent app that runs it gets the tools', async () => {
  const root = freshRoot();
  const { entry } = by(connectorConfigs(), 'claude-desktop');
  assert.ok(path.isAbsolute(entry.command) && path.isAbsolute(entry.args[0]));
  // Started exactly as a host would: that command, those arguments, that env — and no shell.
  const child = spawn(entry.command, entry.args, { env: { PATH: process.env.PATH, ...entry.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', errText = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { errText += d; });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  child.stdin.end();
  const code = await new Promise(resolve => child.on('close', resolve));
  assert.equal(code, 0, errText.slice(-400));
  const frames = out.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(frames[0].result.serverInfo.name, 'scout');
  assert.equal(frames[1].result.tools.length, TOOLS.length);
  assert.ok(errText.includes('workspace ' + root), 'the connector opened a different workspace: ' + errText.slice(0, 300));
});

test('Claude Code\'s own copy of the entry (with "type": "stdio") counts as connected', () => {
  freshRoot();
  const c = current('claude-code');
  fs.mkdirSync(path.dirname(c.file), { recursive: true });
  fs.writeFileSync(c.file, JSON.stringify({ numStartups: 3, mcpServers: { scout: { type: 'stdio', ...c.entry } } }));
  assert.equal(by(connectorStatus().connectors, 'claude-code').state, 'connected');
});
