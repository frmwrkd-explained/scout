#!/usr/bin/env node
// Test fixture — emulates a GENERIC one-shot CLI (Codex/Gemini-style): accepts `-p <prompt>` and
// prints one whole message on stdout, no streaming, no resume. Echoes whether the prompt carried a
// transcript tail (the fallback runner's "## Conversation so far" prefix) so a test can prove
// stateless CLIs still get conversational context.
//
// Env:
//   STUB_SILENT  exit 0 having written nothing at all — the quietest failure a CLI has, and the one
//                the runner used to report as a successful turn with an empty assistant bubble
if (process.env.STUB_SILENT) process.exit(0);

const argv = process.argv.slice(2);
const i = argv.indexOf('-p');
const prompt = i >= 0 ? String(argv[i + 1] || '') : '';
const sawTail = /Conversation so far/.test(prompt);
process.stdout.write('oneshot-reply tail=' + (sawTail ? 'yes' : 'no') + ' len=' + prompt.length + '\n');
