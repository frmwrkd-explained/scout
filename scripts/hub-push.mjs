#!/usr/bin/env node
// npm run hub:push — send the counted numbers to OpsGraph.
//
//   npm run hub:push              push
//   npm run hub:push -- --dry-run print the exact body and post nothing
//   npm run hub:push -- --bundle  also refresh the local copy of the hub bundle
//
// Every figure in the body is one Scout has ALREADY COUNTED from its own log and records — a goal
// rollup, a territory rollup, a learning a human accepted. Nothing here is a number an agent typed.
// See backend/hub.mjs.
//
// With no hub configured this prints one line saying so and exits 0. That is the ordinary state of
// a Scout on somebody's laptop, not an error, and a non-zero exit would turn it into one.
import { hubConfig, buildPushPayload, pushToHub, fetchHubBundle } from '../backend/hub.mjs';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run') || args.includes('-n');
const alsoBundle = args.includes('--bundle');

const cfg = hubConfig();

if (!cfg.canPush) {
  console.log('No hub configured — nothing was sent. Set `hubUrl` and `hubToken` in settings.md '
    + '(or pass HUB_URL and HUB_TOKEN), then run this again.');
  process.exit(0);
}

const payload = buildPushPayload({});

if (!payload.operator) {
  console.log('me.md declares no `person:` — the hub has nothing to match this operator to. '
    + 'Add `person: person/<you>` to me.md, then run this again. Nothing was sent.');
  process.exit(0);
}

if (dry) {
  console.log(JSON.stringify(payload, null, 2));
  console.log('\n--dry-run: nothing was sent.');
  process.exit(0);
}

try {
  const res = await pushToHub({ payload, config: cfg });
  const created = [].concat(res.proposalsCreated || []);
  console.log('goalsUpdated ' + res.goalsUpdated + ' · proposalsCreated ' + created.length
    + (created.length ? ' (' + created.join(', ') + ')' : ''));
  console.log('  sent: ' + payload.goals.length + ' goals · ' + payload.territory.length
    + ' territory · ' + payload.learnings.length + ' learnings  ·  as ' + payload.operator);
  if (alsoBundle) {
    const b = await fetchHubBundle({ config: cfg });
    console.log(b.fetched ? '  bundle refreshed → ' + b.path : '  bundle not refreshed: ' + b.reason);
  }
} catch (e) {
  console.error(String(e && e.message || e));
  process.exit(1);
}
