// Routes for the Skills, Plugins and Automations screens. Registered from backend/index.mjs as
// `registerPluginRoutes(app)`; the logic is backend/plugins.mjs and backend/skillRecords.mjs.
//
//   GET  /api/skills/list                                    → { skills }
//   GET  /api/skills/read?id=<source>/<name>                 → the skill, with its SKILL.md body
//   GET  /api/skills/text?id=…&path=<file in the skill>      → { path, content }
//
//   GET  /api/plugins                                        → { plugins, drafts, ai }
//   GET  /api/plugins/actions?collection=<id>                → { actions }   the buttons a record gets
//   GET  /api/plugins/history                                → { runs }      what plugins have written
//   POST /api/plugins/draft        { description | from, name, actor }  → the draft (a model writes it, or a copy)
//   POST /api/plugins/drafts/:id/approve   { actor }         → the installed plugin
//   POST /api/plugins/drafts/:id/discard   { actor }         → { archived }
//   GET  /api/plugins/:id                                    → the plugin, with its template files
//   POST /api/plugins/:id/remove           { reason, actor } → { archived }
//   POST /api/plugins/:id/actions/:action/prepare  { path }            → the form, with starting values
//   POST /api/plugins/:id/actions/:action/preview  { path, input }     → { html, creates, problems }   writes nothing
//   POST /api/plugins/:id/actions/:action/run      { path, input, actor } → { html, record }
//
// `actor` is destructured off every body and is never part of what gets written. Running,
// creating, approving and removing all refuse an agent with 403.

import { DEFAULT_ACTOR } from './actors.mjs';
import {
  listPlugins, listDrafts, getPlugin, actionsFor, pluginHistory, aiStatus,
  prepareAction, previewAction, runAction, draftPlugin, copyPlugin, approveDraft, discardDraft, removePlugin,
} from './plugins.mjs';
import { listSkills, readSkill, readSkillText } from './skillRecords.mjs';
import { registerAutomationRoutes, automationsUsing } from './automations.mjs';

// Each button of a plugin, with the automations that press it (the Plugins screen lists them).
const withAutomations = plugin => {
  const using = automationsUsing(plugin.id);
  return { ...plugin, actions: plugin.actions.map(a => ({ ...a, automations: using[a.id] || [] })) };
};

export function registerPluginRoutes(app) {
  const route = fn => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) { res.status(e.status || 400).json({ error: e.message, ...(e.code ? { code: e.code } : {}), ...(e.problems ? { problems: e.problems } : {}) }); }
  };
  const who = req => ({ actor: String((req.body && req.body.actor) || req.query.actor || DEFAULT_ACTOR) });

  app.get('/api/skills/list', route(() => ({ skills: listSkills() })));
  app.get('/api/skills/read', route(req => readSkill(String(req.query.id || ''))));
  app.get('/api/skills/text', route(req => readSkillText(String(req.query.id || ''), String(req.query.path || ''))));

  // Automations live in backend/automations.mjs; they are registered here because this is the
  // one registration backend/index.mjs already calls for this family of screens.
  registerAutomationRoutes(app);

  app.get('/api/plugins', route(async () => ({ plugins: listPlugins().map(withAutomations), drafts: listDrafts(), ai: await aiStatus() })));
  app.get('/api/plugins/actions', route(req => ({ actions: actionsFor(String(req.query.collection || '')) })));
  app.get('/api/plugins/history', route(req => ({ runs: pluginHistory({ limit: Math.max(1, Math.min(200, Number(req.query.limit) || 30)) }) })));

  app.post('/api/plugins/draft', route(req => {
    const { description, from, name } = req.body || {};
    return from ? copyPlugin({ from: String(from), name, ...who(req) }) : draftPlugin({ description, ...who(req) });
  }));
  app.post('/api/plugins/drafts/:id/approve', route(req => approveDraft(req.params.id, who(req))));
  app.post('/api/plugins/drafts/:id/discard', route(req => discardDraft(req.params.id, who(req))));

  app.get('/api/plugins/:id', route(req => withAutomations(getPlugin(req.params.id))));
  app.post('/api/plugins/:id/remove', route(req => removePlugin(req.params.id, { reason: req.body && req.body.reason, ...who(req) })));

  // A draft can be previewed before it is approved (that is how a person checks it), but never run.
  app.post('/api/plugins/:id/actions/:action/prepare', route(req => prepareAction(req.params.id, req.params.action, req.body && req.body.path, { allowDraft: true })));
  app.post('/api/plugins/:id/actions/:action/preview', route(req => {
    const { path, input } = req.body || {};
    return previewAction(req.params.id, req.params.action, path, input, { allowDraft: true });
  }));
  app.post('/api/plugins/:id/actions/:action/run', route(req => {
    const { path, input } = req.body || {};
    return runAction(req.params.id, req.params.action, path, input, who(req));
  }));
}
