// Actor identity — WHO is asking, and is that a person or an agent.
//
// THE ONLY PLACE THIS QUESTION IS ANSWERED. It used to be answered twice — `records.mjs` and
// `memory.mjs` each carried an `isAgentActor`, and they disagreed on both of the cases that
// matter:
//
//   · an EMPTY actor      · records.mjs said agent ("unattributed is untrusted"),
//                           memory.mjs said human ("the UI's default").
//   · WHERE the human is  · records.mjs read me.md `id` → slugify(`name`),
//     declared              memory.mjs read `owner` → `created_by` → `name`.
//
// The second one was live: a workspace whose me.md carries `name: Theo` had `theo` accepted as a
// human by the record pipeline and refused as an AGENT by the memory layer, so the person could
// promote a record but not correct their own identity. Law 4 ("agents propose, humans dispose")
// cannot mean two different things in two files — it is one rule, so it is one function.
//
// The reconciliation keeps records.mjs's reading, because it is the stricter of the two at the
// border (least privilege on an unknown actor) and the more generous of the two about the person
// (their declared name is a human, not an agent).
//
// WHAT THIS IS NOT: authentication. There is no server and no session (GOAL.md §7) — the actor is
// a string the caller sends. This decides POLICY, not identity, and the gate it feeds is a safety
// rail against an agent's mistake, not a boundary against a hostile one. HANDOVER §4 states the
// same limit from the other side: you cannot stop an agent with folder access from writing, only
// make the write have no effect and be visible.

import fs from 'node:fs';
import path from 'node:path';
import { getStorageRoot, readMd, safe, slugify } from './store.mjs';

const R = () => getStorageRoot();

// §3: a UI call with no actor is the human. Kept as the app's default actor rather than inlined,
// because six route modules fall back to it and a second literal would drift.
export const DEFAULT_ACTOR = 'crystal';

// A human is: named in `.scout/actors.md` `humans:`, or the identity in `me.md`, or — when neither
// file exists yet — the app's default actor. An id with `assistants/<id>.md` on disk is always an
// agent (M4's canonical home), whatever else it claims.
// `__NAME__` is the workspace-template placeholder: it declares NOBODY. Tested on the RAW value,
// before slugify() — slugify eats the underscores and hands back `name`, which is indistinguishable
// from a real one. Not hypothetical: it declared a phantom human on every fresh workspace, which
// flipped `declared` true and locked the person out of writing their own me.md on day one.
function declares(raw) {
  const s = String(raw ?? '').trim();
  return s && !s.startsWith('__') ? s : null;
}

// `conductor` is the Today loop's agent (backend/today.mjs): it writes planned items, prepared
// material and review narratives, and every one of those is an agent write — proposed, never
// promoted (a learning it files lands `proposed` through the same gate as every other agent's).
// It is built in because it exists on every workspace whether or not `.scout/actors.md` or an
// `assistants/conductor.md` ever does — it is part of the app, not a hire.
const BUILTIN_AGENTS = ['conductor'];

export function actorRegistry() {
  const reg = { humans: new Set([DEFAULT_ACTOR]), agents: new Set(BUILTIN_AGENTS), declared: false };
  try {
    const { data } = readMd(path.join(R(), '.scout', 'actors.md'));
    for (const h of [].concat(data.humans || [])) { reg.humans.add(String(h)); reg.declared = true; }
    for (const a of [].concat(data.agents || [])) { reg.agents.add(String(a)); reg.declared = true; }
  } catch { /* no registry — me.md and the default carry it */ }
  try {
    const { data } = readMd(path.join(R(), 'me.md'));
    // `id`, then the slug of `name`, then `owner`. `owner` is read LAST and only as a fallback:
    // intake.mjs deliberately never writes it (see its comment at the me.md builder), but a
    // hand-written or ported me.md may carry one, and the person who wrote their own name into
    // their own identity file is not an agent.
    const [id, name, owner] = [data.id, data.name, data.owner].map(declares);
    for (const who of [id, name ? slugify(name) : null, owner]) {
      if (who) { reg.humans.add(who); reg.declared = true; }
    }
  } catch { /* no me.md yet — first run */ }
  return reg;
}

// THE BORDER RULE. Used by the record pipeline, the gate, quarantine and the learning gate.
// An unknown actor is an AGENT: least privilege at the border. The opposite default would mean an
// agent that invents an actor id (`sweeper-2`) walks straight through Law 4, and the gate would
// only ever catch the honest.
export function isAgentActor(actor) {
  const id = String(actor || '').trim();
  if (!id) return true;                       // unattributed is untrusted
  const reg = actorRegistry();
  if (reg.agents.has(id)) return true;        // explicit beats everything
  if (hasAssistantFile(id)) return true;      // assistants/<id>.md is M4's canonical home
  return !reg.humans.has(id);
}

// THE OWNED-MEMORY RULE. Used ONLY for the files that are the PERSON's rather than the record
// store's — `me.md` and `goals/` (memory.mjs `refuseAgent`).
//
// It differs from the border rule in exactly one case, deliberately: on a workspace that has
// declared NOBODY yet, an unrecognised actor is the person, not an agent. A brand-new workspace
// ships a placeholder me.md and no assistants, and a rule that locked the person out of writing
// their own identity on day one would fail the gate that matters more (GOAL.md §4.1 — productive
// in 15 minutes). An actor with an `assistants/<id>.md` is still an agent from the very first run.
//
// These two questions used to share one NAME in two files, which is how the difference stayed
// invisible: whichever module you were reading, you could not tell which rule you were getting.
// One module, two names, and the divergence is the documented point rather than an accident.
export function isAgentForOwnedMemory(actor) {
  const id = String(actor || '').trim();
  if (!id) return false;                      // no actor at all → the UI's human default
  const reg = actorRegistry();
  if (reg.agents.has(id)) return true;
  if (hasAssistantFile(id)) return true;
  if (reg.humans.has(id)) return false;
  return reg.declared;                        // nothing declared yet → the person
}

// `safe()` because this string arrives from a client and is about to become a path segment.
function hasAssistantFile(id) {
  try { return fs.existsSync(path.join(R(), 'assistants', safe(id) + '.md')); } catch { return false; }
}
