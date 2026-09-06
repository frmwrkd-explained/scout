#!/usr/bin/env node
// The executable an MCP host launches. Door 3's front door — `docs/04_AGENT_CONTRACT.md` §1.
//
//   {"command": "node", "args": ["scripts/scout-mcp.mjs"], "env": {"SCOUT_DATA": "…"}}
//
// It speaks newline-delimited JSON-RPC 2.0 on stdin/stdout and NOTHING ELSE goes to stdout.
// Anything else on that stream — a banner, a warning, a stray console.log from a module three
// imports deep — lands mid-frame and the host's parser drops the connection with no explanation.
// So:
//   · every diagnostic goes to stderr, which hosts collect and show;
//   · console.log/info/debug are re-pointed at stderr BEFORE any Scout module is imported, because
//     they are the one thing this file cannot audit; and
//   · an unhandled rejection is reported to stderr and exits non-zero rather than printing a V8
//     stack trace into the frame stream.
//
// The workspace comes from `store.mjs getStorageRoot()` like everything else, so SCOUT_DATA and
// SCOUT_CONFIG in the host's launch config are what pick the vault. No flags, no second mechanism.
//
// The server needs NO HTTP server running: `backend/mcp.mjs` talks to the modules directly.

const OUT = process.stdout;
const say = m => { try { process.stderr.write('[scout-mcp] ' + m + String.fromCharCode(10)); } catch { /* nothing left to report to */ } };

// Before the first import that could print. `console.error`/`warn` already go to stderr.
console.log = (...a) => say(a.map(String).join(' '));
console.info = console.log;
console.debug = console.log;

process.on('uncaughtException', e => { say('uncaught: ' + (e && e.stack || e)); process.exit(1); });
process.on('unhandledRejection', e => { say('unhandled rejection: ' + (e && e.stack || e)); process.exit(1); });

const { start } = await import('../backend/mcp.mjs');

const server = start({ input: process.stdin, output: OUT, log: say });

// stdin closing is the host going away — finish what is in flight, then leave. Nothing here holds
// the loop open by itself, so an empty queue exits on its own.
//
// `server.close()` first, and awaited: the hot cache is regenerated on a 2s DEBOUNCE whose timer is
// `unref`ed, so in a process that lives for four seconds it never fires. The agent's next run then
// asks `GET /api/cache/version`, sees the same integer, and skips re-reading a context that no
// longer describes the workspace — Law 7 broken by an exit rather than by a bug in the render.
process.stdin.on('close', () => {
  Promise.resolve(server.close())
    .catch(e => say('cache did not settle on exit: ' + (e && e.message)))
    .then(() => { setTimeout(() => process.exit(0), 50).unref(); });
});
