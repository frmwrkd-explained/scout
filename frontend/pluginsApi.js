// frontend/pluginsApi.js — the calls behind the Skills and Plugins screens and a record's plugin
// buttons (backend/pluginRoutes.mjs). Kept beside the components that use it, like
// collectionsApi.js. Errors carry the server's own sentence, plus its `code` and `problems`.

const read = async response => {
  let body = null;
  try { body = await response.json(); } catch { /* an empty or non-JSON body */ }
  if (!response.ok) {
    const error = new Error((body && body.error) || 'api ' + response.status);
    error.status = response.status;
    error.code = body && body.code;
    error.problems = (body && body.problems) || null;
    throw error;
  }
  return body;
};
const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const q = encodeURIComponent;
const action = (plugin, id) => '/api/plugins/' + q(plugin) + '/actions/' + q(id);

export const skillsApi = {
  list: () => fetch('/api/skills/list').then(read),
  read: id => fetch('/api/skills/read?id=' + q(id)).then(read),
  text: (id, path) => fetch('/api/skills/text?id=' + q(id) + '&path=' + q(path)).then(read),
};

export const pluginsApi = {
  list: () => fetch('/api/plugins').then(read),
  get: id => fetch('/api/plugins/' + q(id)).then(read),
  // The buttons the records of one collection get.
  actionsFor: collection => fetch('/api/plugins/actions?collection=' + q(collection)).then(read),
  history: () => fetch('/api/plugins/history').then(read),
  prepare: (plugin, id, path) => fetch(action(plugin, id) + '/prepare', json({ path })).then(read),
  preview: (plugin, id, path, input) => fetch(action(plugin, id) + '/preview', json({ path, input })).then(read),
  run: (plugin, id, path, input, actor) => fetch(action(plugin, id) + '/run', json({ path, input, actor })).then(read),
  // `{ description }` asks a model to write one; `{ from, name }` copies an installed plugin.
  draft: (what, actor) => fetch('/api/plugins/draft', json({ ...what, actor })).then(read),
  approve: (id, actor) => fetch('/api/plugins/drafts/' + q(id) + '/approve', json({ actor })).then(read),
  discard: (id, actor) => fetch('/api/plugins/drafts/' + q(id) + '/discard', json({ actor })).then(read),
  remove: (id, reason, actor) => fetch('/api/plugins/' + q(id) + '/remove', json({ reason, actor })).then(read),
};

const patch = body => ({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const automationsApi = {
  // → { automations, options } — `options` is what the sentence builder may offer.
  list: () => fetch('/api/automations').then(read),
  create: (rule, actor) => fetch('/api/automations', json({ ...rule, actor })).then(read),
  update: (id, change, actor) => fetch('/api/automations/' + q(id), patch({ ...change, actor })).then(read),
  archive: (id, reason, actor) => fetch('/api/automations/' + q(id) + '/archive', json({ reason, actor })).then(read),
};
