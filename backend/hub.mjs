// The hub link, write side — the NUMBERS PUSH.
//
// OpsGraph (`docs/HUB.md` §10 in that repo) is where several operators' units, flows and SOPs
// live. Scout is one operator's local instrument. The link is deliberately thin and one-way for
// numbers: Scout POSTs what it has ALREADY COUNTED to `POST <hubUrl>/scout/push`, and the hub
// writes those numbers against the ids the frontmatter names.
//
// The rule that makes this safe is the same one dispatch.mjs lives by: **a figure here is counted
// from Scout's own log and records, never typed by an agent.**
//   · goal `current` is `listGoals()`'s rollup (memory.mjs `goalProgress`)
//   · territory finds/wins/hit_rate are territory.mjs's rollups, its sole authorship
//   · a learning only leaves here if a HUMAN made it `active` — an agent may only propose one
//     (memory.mjs `saveLearning`), so an unapproved claim can never become a hub proposal.
//
// Nothing in Scout's hard rules moves for this. The push writes no file, promotes nothing, and
// adds no card to the DECIDE queue — the hub's proposals queue decides SOPs, Scout's queue decides
// findings. Two queues, two subjects.
//
// The bundle half (what Scout READS from the hub) lives in `hubBundle.mjs`, which imports nothing
// but the store, so `memory.mjs` can use it without closing an import cycle through this file.
import { day, getStorageRoot } from './store.mjs';
import { readMe, listGoals, listLearnings } from './memory.mjs';
import { listTerritories } from './territory.mjs';
import { getAssistant } from './tasks.mjs';
import { hubConfig, writeHubCache, readHubBundle, personSlug, mirrorBundlePath } from './hubBundle.mjs';

export {
  hubConfig, readHubBundle, writeHubCache, personSlug, mirrorBundlePath,
  hubCachePath, splitHubSections, composeHub, HUB_DROP_ORDER, HUB_TRIM_LEVELS,
} from './hubBundle.mjs';

// A rate as the hub states it: a fraction, 3 wins of 12 finds → 0.25 (docs/HUB.md §10). Scout's
// own `hit_rate` is the same rollup expressed as a percentage for a human to read; converting at
// the boundary keeps one computation and two honest presentations, rather than two computations.
function hitRateOf(stats) {
  const finds = Number(stats && stats.finds) || 0;
  const wins = Number(stats && stats.wins) || 0;
  return finds ? Math.round((wins / finds) * 10000) / 10000 : 0;
}

// `verified_at || updated || created`, rendered through `day()` — NEVER `String(...)`. A bare YAML
// date parses to a JS Date and stringifies to `Thu Jul 30 2026 02:00:00 GMT+0200`, which has
// already reached a file an agent reads once (HANDOVER §3). It must not reach the hub.
function verifiedAt(data = {}) {
  return day(data.verified_at ?? data.updated ?? data.created) || null;
}

// A learning's step is the hub flow step it came out of: its own `step:` if it declares one, else
// the step of the assistant that wrote it. Absent on both → the key is omitted, never sent null,
// because the contract marks it optional and an explicit null is a claim we cannot support.
function stepFor(data = {}) {
  const own = String(data.step || '').trim();
  if (own) return own;
  const author = String(data.created_by || '').trim();
  if (!author) return '';
  try { return String(getAssistant(author)?.step || '').trim(); } catch { return ''; }
}

// THE PAYLOAD. Pure: it reads the workspace and returns the exact JSON body `pushToHub` posts, so
// a test can assert the body without a server and a person can see it with `--dry-run`.
export function buildPushPayload({ now = Date.now() } = {}) {
  const me = readMe();
  const operator = String(me.data.person || '').trim() || null;

  const goals = listGoals({ now })
    .filter(g => String(g.data.hub_goal || '').trim())
    .map(g => ({
      hubGoal: String(g.data.hub_goal).trim(),
      current: g.current,
      target: g.target,
      verifiedAt: verifiedAt(g.data),
    }));

  // `proposed: true` is ground nobody approved (territory.mjs — an agent proposes ground, it does
  // not write it), so it is not ground here either. The cache holds the same line.
  const territory = listTerritories({ now })
    .filter(t => t.data.proposed !== true)
    .map(t => ({
      slug: t.id,
      finds: t.stats.finds,
      wins: t.stats.wins,
      hitRate: hitRateOf(t.stats),
    }));

  // "verified inside its window" is decay.mjs's one staleness rule (`stale` === at or past the
  // window), not a second date comparison written here. `active` only: a `proposed` learning is a
  // claim an agent made and no human has accepted, and pushing it would launder it into a hub
  // proposal — exactly the promotion the gate exists to stop.
  const learnings = listLearnings({ now })
    .filter(l => l.status === 'active' && !l.stale)
    .map(l => {
      const row = { slug: l.id, text: l.claim, verifiedAt: verifiedAt(l.data) };
      const step = stepFor(l.data);
      if (step) row.step = step;
      return row;
    });

  return { operator, goals, territory, learnings };
}

// POST it. Returns `{ pushed: false, reason }` — never throws — when no hub is configured, so
// every caller (the script, the dispatch hook) can treat "no hub" as the ordinary case it is.
export async function pushToHub({ now = Date.now(), fetchImpl = globalThis.fetch, config = null, payload = null } = {}) {
  const cfg = config || hubConfig();
  if (!cfg.canPush) {
    return { pushed: false, reason: 'no hub configured — set hubUrl and hubToken in settings.md (or HUB_URL and HUB_TOKEN)' };
  }
  const body = payload || buildPushPayload({ now });
  if (!body.operator) {
    return { pushed: false, reason: 'me.md declares no `person:` — the hub cannot match this operator' };
  }
  const res = await fetchImpl(cfg.url + '/scout/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.token },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const e = new Error('hub refused the push: HTTP ' + res.status + (text ? ' — ' + text.slice(0, 300) : ''));
    e.status = res.status;
    throw e;
  }
  return {
    pushed: true,
    payload: body,
    goalsUpdated: json && json.goalsUpdated != null ? json.goalsUpdated : 0,
    proposalsCreated: json && json.proposalsCreated != null ? json.proposalsCreated : [],
  };
}

// Refresh Scout's local copy of the bundle from `GET <hubUrl>/mcp/bundle`. Async, and deliberately
// NOT called by renderCache — see the header of hubBundle.mjs. A mirror folder makes this
// unnecessary; a hub that answers anything but 200 leaves the previous copy exactly where it was,
// because a stale bundle that names its own age beats no bundle at all.
export async function fetchHubBundle({ fetchImpl = globalThis.fetch, config = null } = {}) {
  const cfg = config || hubConfig();
  if (!cfg.canFetch) return { fetched: false, reason: 'no hubUrl + hubToken configured' };
  const res = await fetchImpl(cfg.url + '/mcp/bundle', {
    headers: { authorization: 'Bearer ' + cfg.token, accept: 'text/markdown, text/plain, application/json' },
  });
  if (!res.ok) return { fetched: false, reason: 'hub answered HTTP ' + res.status };
  const raw = await res.text();
  let text = raw;
  // The endpoint may answer `{ body, tokens, dropped }` (docs/HUB.md §7) or the markdown itself.
  try { const j = JSON.parse(raw); if (j && typeof j.body === 'string') text = j.body; } catch { /* markdown */ }
  if (!String(text || '').trim()) return { fetched: false, reason: 'the hub returned an empty bundle' };
  return { fetched: true, path: writeHubCache(text), chars: text.length, root: getStorageRoot() };
}
