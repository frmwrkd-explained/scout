// The connector and Ask AI routes (backend/connectorRoutes.mjs). Kept apart from api.js the same
// way collectionsApi.js is: one small file per surface, owned with the screen that uses it.

const read = async response => {
  let body = null;
  try { body = await response.json(); } catch { /* an empty body */ }
  if (!response.ok) {
    const error = new Error((body && body.error) || 'api ' + response.status);
    error.status = response.status;
    if (body && body.budget) error.budget = body.budget;
    throw error;
  }
  return body;
};
const json = body => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const at = (id, verb) => '/api/connectors/' + encodeURIComponent(id) + '/' + verb;

export const connectorsApi = {
  // → { workspace, runtime, connectors: [{ id, label, state, file, format, snippet, hash, … }], remote }
  list: () => fetch('/api/connectors').then(read),
  // `hash` is the one the list returned: the server writes only what this screen showed.
  install: (id, hash) => fetch(at(id, 'install'), { method: 'POST', ...json({ hash }) }).then(read),
  remove: id => fetch(at(id, 'remove'), { method: 'POST', ...json({}) }).then(read),
  // → { answer } or { proposal: { fields, body_append? }, dropped } — with provider, attempts_left, budget.
  ask: ({ path, question, mode, field }) => fetch('/api/ai/ask', { method: 'POST', ...json({ path, question, mode, field }) }).then(read),
};

export default connectorsApi;
