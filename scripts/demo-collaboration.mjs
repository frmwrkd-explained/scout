// A fresh goal-only workspace for a real Today conversation. No existing vault is touched.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-collaboration-'));
process.env.SCOUT_DATA = workspace;
process.env.SCOUT_CONFIG = path.join(workspace, '.scout-demo-config.md');
process.env.SCOUT_TEST = '1';
const { saveSettings, createProject } = await import('../backend/store.mjs');
const { writeMe, saveGoal } = await import('../backend/memory.mjs');
const { saveAssistant } = await import('../backend/tasks.mjs');
const { ensureWorkCollections } = await import('../backend/today.mjs');
const { localDay } = await import('../backend/daytime.mjs');
const { logEvent } = await import('../backend/log.mjs');
ensureWorkCollections();
saveSettings({ onboarded: true, autoRun: false, workerSchedulerEnabled: false, agentSimulateFallback: false,
  tiers: { light: ['gpt'], heavy: [] }, dayEnd: '23:59', skillRepos: [], deliveryDestinations: [] });
const project = createProject({ name: 'Goal collaboration demo' });
writeMe('I am Ana, testing a new onboarding tool with a small beta group. I prefer a warm and direct tone. This workspace is a role-play: save output locally and do not contact real people.\n', { name: 'Ana', person: 'person/ana', unit: 'unit/growth' }, { actor: 'crystal' });
saveGoal('activation-demo', { label: 'Get three useful beta tester replies', target: 3, current: 0, unit: 'replies', universe: 'unit/growth',
  body: 'Simulation goal. Prepare a short invitation, review it with the human, save the approved output in Scout and schedule a two-day follow-up. A saved draft is not a reply: keep observed results at zero until actual reply evidence exists.' }, { actor: 'crystal' });
saveAssistant('copy-helper', { name: 'Copy helper', job: 'Prepare warm, specific beta tester invitations for review.', project: project.id,
  capabilities: ['writing'], worker_enabled: true, worker_mode: 'prepare', provider: 'gpt', status: 'idle' }, { actor: 'crystal' });
logEvent({ type: 'work', actor: 'simulation', target: 'today/' + localDay(), detail: { action: 'plan', day: localDay(), source: 'empty-goal-fixture', count: 0 } });
console.log(JSON.stringify({ workspace, config: process.env.SCOUT_CONFIG, project: project.id, goal: 'activation-demo' }));
