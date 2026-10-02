// Make a NEW disposable demo workspace. Never seed or overwrite the person's working vault.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-goal-loop-'));
fs.cpSync(path.join(repository, 'workspace-demo'), workspace, { recursive: true, filter: source => !path.basename(source).startsWith('._') });
process.env.SCOUT_DATA = workspace;
process.env.SCOUT_CONFIG = path.join(workspace, '.scout-demo-config.md');
process.env.SCOUT_TEST = '1'; // Provider calls are disabled in this fixture, including on first open.
const { saveSettings } = await import('../backend/store.mjs');
const { ensureWorkCollections } = await import('../backend/today.mjs');
const { upsertRecord } = await import('../backend/records.mjs');
const { localDay } = await import('../backend/daytime.mjs');
const { saveGoal } = await import('../backend/memory.mjs');
ensureWorkCollections();
saveSettings({ autoRun: false, agentSimulateFallback: false });
const goal = saveGoal('improve-onboarding', { label: 'Improve onboarding activation', target: 10, current: 0, unit: 'activated users', body: 'Demo goal. Follow the approved campaign through implementation and measured results.' });
const common = { goal_id: goal?.id || '', key_result: 'Measure replies from the onboarding campaign', bucket: 'email', status: 'planned', day: localDay(), prep: false };
upsertRecord({ collection: 'work', id: 'approve-onboarding', title: 'Approve the onboarding sequence', ...common,
  order: 1, estimate_min: 15, destination: 'Onboarding campaign · copy review', done_when: 'Record the owner’s approval',
  body: 'Review the sequence with the owner. Approval unlocks the implementation packet.\n' }, { actor: 'crystal', via: 'goal-loop-demo' });
upsertRecord({ collection: 'work', id: 'install-onboarding', title: 'Install the approved campaign', ...common,
  order: 2, estimate_min: 30, depends_on: ['approve-onboarding'], destination: 'Email platform · onboarding campaign',
  done_when: 'Record the installed campaign link and successful test delivery', follow_up_days: 14, follow_up_title: 'Measure onboarding replies',
  body: 'Use the approved copy in the campaign destination. Send a test through the platform and record its link. Completion creates a 14-day measurement follow-up.\n' }, { actor: 'crystal', via: 'goal-loop-demo' });
upsertRecord({ collection: 'work', id: 'source-preservation', title: 'Markdown preservation check', bucket: 'admin', status: 'planned', estimate_min: 30,
  body: '# Source preservation\n\n![Campaign diagram](files/campaign.png)\n\nInline HTML: <span data-review="owner">Approved</span>\n\n```js\nconst template = `first\n\n\n\nlast`;\n```\n' }, { actor: 'crystal', via: 'goal-loop-demo' });
console.log(JSON.stringify({ workspace, config: process.env.SCOUT_CONFIG, goal: goal?.id || null }));
