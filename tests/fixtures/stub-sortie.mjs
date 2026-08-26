#!/usr/bin/env node
// Test fixture — an assistant that ACTUALLY DOES ITS JOB.
//
// stub-agent.mjs proves the runner can spawn a one-shot CLI and read its stdout. This one proves
// the thing that matters for dispatch.mjs: a process Scout spawned reads its brief, finds the API
// base and its own actor id IN that brief, and writes back through door 1 — the same gated,
// deduped, logged pipeline `_inbox/` and MCP go through. Nothing here is privileged; it is curl
// with a different spelling.
//
// It deliberately CLAIMS more than it did ("Found 40 guests"). dispatch.mjs must report 1, because
// the run's figures are counted from the event log and never taken from the agent's word.
//
// Env:
//   STUB_SORTIE_NAME    the guest to store (default "Rosa Delgado")
//   STUB_SORTIE_QUIET   write nothing; only talk. Proves an empty run reads as empty.
//   STUB_SORTIE_SLEEP   ms to linger before replying — used by the stop test.
//   STUB_SORTIE_PROMOTE also try to promote past shortlist, so the gate can be seen holding
//                       against a process the app itself spawned.
//   STUB_SORTIE_BLATHER pad the reply to N characters — an agent that talks past the run summary's
//                       budget, which must be trimmed VISIBLY rather than silently.
const argv = process.argv.slice(2);
const i = argv.indexOf('-p');
const brief = i >= 0 ? String(argv[i + 1] || '') : '';

// Both of these come out of the brief, which is the whole point: the assistant is told where the
// app is and who it is, and nothing else is injected into its environment.
const base = (brief.match(/https?:\/\/127\.0\.0\.1:\d+/) || [])[0] || '';
const actor = (brief.match(/"actor":\s*"([^"]+)"/) || [])[1] || 'unknown';
// Where it may work comes out of the brief too — a stub that hardcoded `guest` would pass against
// an app that ignored scope entirely.
const collection = (brief.match(/^ {2}collections {3}(\S+)/m) || [])[1] || 'guest';
const ground = (brief.match(/^ {2}ground {8}(\S+)/m) || [])[1] || 'nurses-ph';
const name = process.env.STUB_SORTIE_NAME || 'Rosa Delgado';

const post = (p, body) => fetch(base + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then(r => r.json().then(j => ({ status: r.status, body: j })).catch(() => ({ status: r.status, body: null })));

if (process.env.STUB_SORTIE_SLEEP) {
  await new Promise(r => setTimeout(r, Number(process.env.STUB_SORTIE_SLEEP)));
}

let stored = null;
if (base && !process.env.STUB_SORTIE_QUIET) {
  const r = await post('/api/records/upsert', {
    collection, name, handle: '@' + name.toLowerCase().replace(/\W+/g, ''),
    found_in: ground.replace(/,$/, ''), source: 'https://example.test/' + encodeURIComponent(name),
    score: 8, why: 'Cooks on camera, tells her own story.', actor,
  });
  stored = r.body;
  if (process.env.STUB_SORTIE_PROMOTE && stored && stored.path) {
    await fetch(base + '/api/records', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: stored.path, actor, patch: { status: 'won' } }),
    }).catch(() => { /* the refusal is the point; the run continues */ });
  }
}

const lines = [
  'Searched nurses-ph and two neighbouring groups.',
  'Found 40 guests worth a look; ' + name + ' is the strongest.',
  'Nothing needs you yet.',
];
if (process.env.STUB_SORTIE_BLATHER) {
  lines.push('And then it kept talking. '.repeat(Math.ceil(Number(process.env.STUB_SORTIE_BLATHER) / 25)));
}
process.stdout.write(lines.join('\n') + '\n');
