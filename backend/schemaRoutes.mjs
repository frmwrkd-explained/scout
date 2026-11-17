// Changing and retiring a property — the human's door onto `collections.mjs`.
//
// `collections.mjs` is still the only place a field is defined and the only writer of a schema
// file; this module is routes and nothing else. It exists apart from `backend/index.mjs` only so
// the handlers sit together with the one rule they all share:
//
// AN AGENT DOES NOT COME THROUGH HERE. An assistant that wants a field changed proposes it, and
// the change lands as a card in Needs you (docs/02_DATA_MODEL.md §6). `POST …/fields` (adding) has
// always trusted its caller; retyping and removing are the two schema changes that can make a
// collection read differently, so these refuse an agent by name and log the attempt, the same way
// the record gate does.
//
//   GET    /api/field-types                      { types, changes } — what a type may become
//   PATCH  /api/collections/:id/fields/:key      { label?, type?, options?, …, actor? }
//   DELETE /api/collections/:id/fields/:key      { actor? }  (or ?actor=)
//
// Both writes answer with the saved collection, plus `warnings` when something else now dangles
// and — on DELETE — `views`, the number of saved views the key was taken out of.

import { updateField, removeField, FIELD_TYPE_NAMES, TYPE_CHANGES } from './collections.mjs';
import { scrubFieldFromViews } from './views.mjs';
import { isAgentActor, DEFAULT_ACTOR } from './actors.mjs';
import { currentWorkerIdentity } from './workerScope.mjs';
import { logEvent } from './log.mjs';

const targetOf = id => '.scout/collections/' + id + '.md';

function operatorOnly(actor, id, key, verb) {
  if (!currentWorkerIdentity() && !isAgentActor(actor)) return;
  const message = 'An assistant does not ' + verb + ' a property directly — it proposes the change, and the card lands in Needs you.';
  logEvent({ type: 'refused', actor, target: targetOf(id), detail: { field: key, change: verb, error: message } });
  throw Object.assign(new Error(message), { status: 403 });
}

// Remove a field AND take it out of the collection's saved views. The two always travel together:
// a view left naming a field the schema no longer has refuses its next save.
export function retireField(id, key) {
  const collection = removeField(id, key);
  const views = scrubFieldFromViews(id, key);
  return { ...collection, views };
}

export function registerSchemaRoutes(app) {
  const fail = (res, e) => res.status(e.status || 400).json({ error: e.message });

  app.get('/api/field-types', (_req, res) => res.json({ types: FIELD_TYPE_NAMES, changes: TYPE_CHANGES }));

  // `actor` is WHO is making the change, not part of the field — destructured off exactly as the
  // add route does, because validateField rejects any key a type does not allow.
  app.patch('/api/collections/:id/fields/:key', (req, res) => {
    const { actor = DEFAULT_ACTOR, ...patch } = req.body || {};
    const { id, key } = req.params;
    try {
      operatorOnly(actor, id, key, 'change');
      const collection = updateField(id, key, patch);
      const field = (collection.fields || []).find(f => f.key === key) || {};
      logEvent({
        type: 'schema', actor, target: targetOf(id),
        detail: { change: 'field-update', field: key, field_type: field.type, changed: Object.keys(patch) },
      });
      res.json(collection);
    } catch (e) { fail(res, e); }
  });

  app.delete('/api/collections/:id/fields/:key', (req, res) => {
    const actor = (req.body && req.body.actor) || (req.query.actor ? String(req.query.actor) : DEFAULT_ACTOR);
    const { id, key } = req.params;
    try {
      operatorOnly(actor, id, key, 'remove');
      const collection = retireField(id, key);
      logEvent({
        type: 'schema', actor, target: targetOf(id),
        detail: { change: 'field-remove', field: key, views: collection.views },
      });
      res.json(collection);
    } catch (e) { fail(res, e); }
  });
}
