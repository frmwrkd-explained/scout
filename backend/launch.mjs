// How to start a CLI, on any platform. A LEAF module: it imports fs and path and nothing else,
// which is the whole point — backend/jobs.mjs needs this rule too, and jobs.mjs is what
// agentRunner.mjs imports resolveBin from. Leaving planLaunch in agentRunner meant jobs.mjs could
// not reach it without an ESM cycle (jobs -> agentRunner -> jobs), so every other spawn site in
// the app launched raw and failed on Windows exactly the way agent chat used to.
//
// Lifted here on 2026-08-10 — the move agentRunner.mjs's own header asked for: "Import it — or
// lift it into a module both can import — but do not write a second copy of this reasoning; the
// failure it prevents is invisible until it has already truncated somebody's prompt."
// agentRunner.mjs re-exports all three names, so its importers and tests are unaffected.

import fs from 'fs';
import path from 'path';

// ── launching a CLI on Windows ──
//
// POSIX can spawn the resolved bin directly and always could: a `claude` on PATH is either a real
// executable or a script whose `#!` line the kernel honours. Windows has neither rule, and spawning
// the bin the way POSIX does fails BEFORE the process exists, so agent chat could not start a turn
// at all there:
//  · npm installs every CLI as a `.cmd` shim, and since Node 18.20 (the CVE-2024-27980 fix)
//    spawn() with shell:false REFUSES a .cmd/.bat outright — a synchronous EINVAL. `claude`,
//    `codex`, `gemini`: all of them, for every Windows user of agent mode.
//  · a script path (…/foo.mjs, which `agentCommand` accepts and which works on macOS via its
//    shebang) is not executable on Windows either — spawn() dies with UNKNOWN.
//
// The obvious repair — `shell: true`, i.e. hand the whole line to cmd.exe — is wrong here, and not
// merely on injection grounds (prompts are user text). It is MEASURABLY lossy: cmd.exe ends its
// command line at the first newline and caps it at 8191 characters, while every claude turn passes
// a multi-line `--append-system-prompt` of ~1.3KB plus the user's prose. Routed through cmd.exe the
// CLI receives the first line of the system prompt and nothing else — silently.
//
// So user text never reaches a command interpreter. We resolve what the shim would have run and
// spawn THAT through CreateProcess, where Node does the quoting:
//   · .cmd/.bat     → read the npm shim, recover the `node <script>` it wraps, spawn node + script
//   · .js/.mjs/.cjs → spawn the current Node runtime + the script (what `#!` does on POSIX)
//   · anything else → unchanged: spawn it directly (.exe, .com, extensionless)
// An unparseable .cmd falls back to cmd.exe with qntm-style escaping, and REFUSES (a descriptive
// error the turn surfaces) rather than silently truncating when an argument carries a newline or
// the line would blow the 8191 cap.
//
// On every non-Windows platform planLaunch() returns the bin and args untouched and the spawn
// options are the same object shape as before, so macOS/Linux behaviour is unchanged.
//
// planLaunch() is THE rule for "how do we start an agent CLI". Every other spawn of a user-chosen
// binary needs it too (backend/jobs.mjs runs the same CLIs for background jobs, the installer and
// the connection test). Import it — or lift it into a module both can import — but do not write a
// second copy of this reasoning; the failure it prevents is invisible until it has already
// truncated somebody's prompt.

// What an npm `cmd-shim` actually invokes, relative to the shim's own dir.
//
// A shim wraps EITHER a node script or a native executable, and both are common — Claude Code
// switched to a native binary, so its shim reads:
//     "%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"   %*
// while a classic npm package still reads:
//     … "%_prog%"  "%dp0%\node_modules\pkg\cli.js" %*
// Recovering only the `.js` form left the native one unparseable, so planLaunch fell through to
// cmd.exe and then correctly refused a multi-line prompt — a real user hit exactly that:
//     "claude.CMD is a batch wrapper this build cannot unwrap"
//
// Read the target off the INVOCATION line — the one carrying `%*` — rather than the first
// `%dp0%`-rooted path in the file. The script shim mentions `"%dp0%\node.exe"` several lines
// earlier when it probes for a sibling runtime, and taking the first match would return that
// instead of the script. Both shim generations spell the root the same way: `%dp0%` (current)
// and `%~dp0` (pre-2021).
// Takes the LAST %dp0%-rooted path on that line, not the first. The pre-2021 shim names the
// runtime and the script on the SAME line — `"%dp0%\node.exe"  "%dp0%\..\pkg\cli.js" %*` — and the
// target always follows the interpreter, so first-match returns node.exe and silently runs the
// wrong program with the right arguments.
export function cmdShimTarget(text) {
  const src = String(text || '');
  const line = src.split(/\r?\n/).find(l => l.includes('%*'));
  const hits = [...String(line || '').matchAll(/"%(?:~dp0|dp0%)\\?([^"]+)"/gi)];
  return hits.length ? hits[hits.length - 1][1] : null;
}

// Back-compat: the .js-only question, still asked by tests written before native shims existed.
export function cmdShimScript(text) {
  const t = cmdShimTarget(text);
  return t && NODE_SCRIPT_EXT.has(path.win32.extname(t).toLowerCase()) ? t : null;
}

// Quote one argument for a cmd.exe command line (the qntm.org/cmd algorithm, as used by
// cross-spawn): CRT quoting first so the child's own parser recovers the argument, then caret
// escaping so cmd.exe hands those bytes through instead of interpreting them.
const CMD_META = /([()[\]{}%!^"`<>&|;, *?=])/g;
export function cmdEscape(arg) {
  let a = String(arg);
  a = a.replace(/(\\*)"/g, '$1$1\\"'); // backslashes before a quote double; the quote is escaped
  a = a.replace(/(\\*)$/, '$1$1');     // trailing backslashes double so they can't eat the closer
  return ('"' + a + '"').replace(CMD_META, '^$1');
}

const NODE_SCRIPT_EXT = new Set(['.js', '.mjs', '.cjs']);
const CMD_SCRIPT_EXT = new Set(['.cmd', '.bat']);
const CMD_LINE_MAX = 8000; // cmd.exe's own limit is 8191; leave room for `/d /s /c ` and the spaces

// bin + args → what to actually hand child_process.spawn(). Returns
// { file, args, env, verbatim }: `env` is a patch to merge (null = nothing to add) and `verbatim`
// asks for windowsVerbatimArguments. Throws with a user-readable reason when a launch route exists
// but cannot carry these arguments intact — better a visible failure than a truncated prompt.
// `opts` exists so the platform-specific branches are unit-testable from macOS/Linux.
export function planLaunch(bin, args = [], opts = {}) {
  const platform = opts.platform || process.platform;
  if (platform !== 'win32') return { file: bin, args, env: null, verbatim: false };

  const exists = opts.exists || (p => { try { return fs.existsSync(p); } catch { return false; } });
  const read = opts.readFile || (p => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } });
  // Under Electron process.execPath is electron.exe, which runs a script as Node only with this
  // flag set; under plain node it is inert. Either way the child is the runtime already running us.
  const viaNode = (nodeBin, argv) => ({ file: nodeBin, args: argv, env: { ELECTRON_RUN_AS_NODE: '1' }, verbatim: false });
  const node = opts.execPath || process.execPath;
  const ext = path.win32.extname(String(bin)).toLowerCase();

  if (NODE_SCRIPT_EXT.has(ext)) return viaNode(node, [String(bin), ...args]);

  if (CMD_SCRIPT_EXT.has(ext)) {
    const dir = path.win32.dirname(String(bin));
    const rel = cmdShimTarget(read(String(bin)));
    if (rel) {
      const target = path.win32.resolve(dir, rel);
      const targetExt = path.win32.extname(rel).toLowerCase();
      // A shim around a NATIVE binary: spawn it directly. No node, no cmd.exe, and CreateProcess
      // does the quoting — so a multi-line prompt survives exactly as it does on POSIX.
      if (!NODE_SCRIPT_EXT.has(targetExt)) return { file: target, args, env: null, verbatim: false };
      // the shim prefers a node.exe sitting next to it (npm prefix installs) — mirror that choice
      const sibling = path.win32.join(dir, 'node.exe');
      return viaNode(exists(sibling) ? sibling : node, [target, ...args]);
    }
    const all = [String(bin), ...args];
    if (all.some(a => /[\r\n]/.test(String(a))))
      throw new Error(bin + ' is a batch wrapper this build cannot unwrap, and cmd.exe cannot carry a '
        + 'multi-line argument — install the CLI as a native executable, or point Settings → Agent at one');
    const line = all.map(cmdEscape).join(' ');
    if (line.length > CMD_LINE_MAX)
      throw new Error(bin + ' is a batch wrapper this build cannot unwrap, and the command line is '
        + line.length + ' characters — over cmd.exe\'s 8191 limit');
    return { file: opts.comspec || process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', line], env: null, verbatim: true };
  }

  return { file: bin, args, env: null, verbatim: false };
}
