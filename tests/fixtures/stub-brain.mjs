#!/usr/bin/env node
// Test fixture — stands in for every brain tier when SCOUT_BRAIN_COMMAND names it
// (backend/brain.mjs). A real CLI gets the prompt on `-p`; this one never reads it.
//
// Reply source, first hit wins:
//   SCOUT_BRAIN_REPLY_FILE   a file whose bytes are printed verbatim — tests write one per case,
//                            so a queue of turns (plan, prep, chat, review) can read different
//                            replies by REWRITING it between calls
//   SCOUT_BRAIN_REPLY        a literal string reply
//   otherwise                a minimal valid plan JSON
// SCOUT_BRAIN_CALLS          if set, every invocation appends one line (the argv) — tests count
//                            calls rather than inferring them from side-effects
// SCOUT_BRAIN_FAIL           if set, exit 1 with nothing — a brain that is present but broken
import fs from 'node:fs';

const argv = process.argv.slice(2);
if (process.env.SCOUT_BRAIN_CALLS) {
  try { fs.appendFileSync(process.env.SCOUT_BRAIN_CALLS, JSON.stringify(argv) + '\n'); } catch { /* best effort */ }
}
if (process.env.SCOUT_BRAIN_FAIL) process.exit(1);

let reply = process.env.SCOUT_BRAIN_REPLY;
const f = process.env.SCOUT_BRAIN_REPLY_FILE;
if (f) { try { reply = fs.readFileSync(f, 'utf8'); } catch { /* fall through to the default */ } }
if (reply == null) reply = '{"order":[],"add":[],"message":"stub plan"}';
process.stdout.write(reply + '\n');
