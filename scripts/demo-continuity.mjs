// Continue the local email role-play into a real, provider-backed team workflow.
// All product and participant facts here are explicit simulation fixtures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const requested = process.argv[2];
const workspace = requested ? path.resolve(requested) : fs.mkdtempSync(path.join(os.tmpdir(), 'scout-continuity-'));
if (requested && ![path.resolve(os.tmpdir()), '/private/tmp'].some(root => workspace.startsWith(root + path.sep))) {
  throw new Error('This demonstration only extends a temporary test workspace');
}
if (requested) {
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-before-continuity-'));
  fs.cpSync(workspace, path.join(backup, 'workspace'), { recursive: true });
  console.log(JSON.stringify({ backup }));
}
process.env.SCOUT_DATA = workspace;
process.env.SCOUT_CONFIG = path.join(workspace, '.scout-demo-config.md');
process.env.SCOUT_TEST = '1';
const { saveSettings, createProject, listProjects } = await import('../backend/store.mjs');
const { writeMe, saveGoal, getGoal } = await import('../backend/memory.mjs');
const { upsertRecord } = await import('../backend/records.mjs');
const { ensureWorkCollections } = await import('../backend/today.mjs');
const { ensureArtifactCollection, configureConductor } = await import('../backend/conductor.mjs');
const { setupTeam } = await import('../backend/team.mjs');
ensureWorkCollections(); ensureArtifactCollection();
saveSettings({ onboarded: true, autoRun: false, workerSchedulerEnabled: false, agentSimulateFallback: false,
  tiers: { light: ['gpt'], heavy: [] }, dayEnd: '23:59', skillRepos: [], deliveryDestinations: [] });
const project = listProjects().find(p => p.id === 'goal-collaboration-demo') || createProject({ name: 'Goal collaboration demo' });
if (!getGoal('activation-demo')) writeMe('I am Ana. I am improving first-run setup for a beta invoicing tool used by busy freelancers. This is a local simulation; do not contact people or publish anything.\n',
  { name: 'Ana', person: 'person/ana', unit: 'unit/growth' }, { actor: 'crystal' });
saveGoal('activation-demo', { label: 'Get three useful beta tester replies', target: 3, current: 0, unit: 'replies', universe: 'unit/growth',
  body: 'Local role-play: improve beta onboarding and obtain three useful setup observations. The invitation is only one packet. Continue useful work after it: examine the supplied first-run flow and session notes, choose a friction to fix with Ana, produce a concrete revised setup guide, have another specialist review it, ask Ana to try it, and adapt to her evidence. Prepare a feedback capture sheet and the next experiment while the dated reply check waits. Read the beta product brief and simulated session notes in the artifact collection. Use named specialists with actual result handoffs. When Ana approves one useful change, carry it into the next draft and review round; do not ask her to invent your next task or say the day is finished. Keep the real customer-reply metric at zero: fixtures and saved drafts are not real replies. All artifacts stay local; sending and publishing need separate human approval.' }, { actor: 'crystal' });
const facts = [
  ['beta-product-brief', 'Beta product brief · simulation', '# Beta invoicing tool\n\n**Simulation fixture, not customer research.** Ana is testing a tool that helps freelancers produce their first invoice. The current setup asks for a business name, tax ID and a CSV of clients before showing any invoice preview. Tax ID is optional in the actual product but the interface does not say so. Busy testers want to see value within two minutes.\n\n## Current first-run flow\n1. Create account.\n2. Enter business details; tax ID appears mandatory.\n3. Upload a client CSV; a plain Upload button gives no sample or field mapping explanation.\n4. Configure payment details.\n5. Finally see a draft invoice.\n\nThe tool can create a sample invoice without CSV or payment details. Our team can prepare a revised quick-start guide and test it locally; no live product access is available in this workspace. The approved invitation asks: “Was there a moment during setup when you nearly stopped?”\n'],
  ['beta-session-notes', 'First-run session notes · simulation', '# First-run notes\n\n**Invented observations for the collaboration test; zero real customer replies.**\n\n- Tester A, freelance designer: “I didn’t have a tax ID handy, so I closed the page before I saw what the tool did.”\n- Tester B, writer: “I don’t have a CSV. Can I just try it with one client?”\n- Tester C, developer: “I will not enter payment details until I know the invoice looks right.”\n\n## Working constraints\nAna has another 45 minutes today. Start with a change she can evaluate locally. Do not invent deployed changes or contacted testers. Prefer a sample-invoice-first path, make the optional fields explicit, and show one small decision at a time. When Ana gives new feedback, revise the actual draft and let Check review that revision.\n'],
];
for (const [id, title, body] of facts) upsertRecord({ collection: 'artifact', id, title, status: 'draft',
  assistant: 'simulation-fixture', project: project.id, goal_id: 'activation-demo', universe: 'unit/growth', body },
{ actor: 'crystal', via: 'continuity-demo-fixture' });
const team = await setupTeam({ goal_id: 'activation-demo', project: project.id });
configureConductor({ min_cycle_minutes: 1, max_parallel: 2, max_tasks_per_cycle: 3 }, { actor: 'crystal' });
console.log(JSON.stringify({ workspace, config: process.env.SCOUT_CONFIG, project: project.id, goal: 'activation-demo', coordinator: team.coordinator, agents: team.agents }));
