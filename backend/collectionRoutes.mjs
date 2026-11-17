// Routes for making and shaping collections by hand. Registered from backend/index.mjs as
// `registerCollectionRoutes(app)`; the logic is backend/subcollections.mjs.
//
//   POST   /api/collections/create                    { label, actor }              → the new collection
//   PATCH  /api/collections/:id/meta                  { label?, colour?, header?, page?, actor } → the collection
//   POST   /api/collections/:id/subcollections        { label | collection, actor } → { parent, child, key, created, linked }
//   DELETE /api/collections/:id/subcollections/:child { actor }                     → the parent
//
// `actor` is destructured off every body and is never part of what gets written — CLAUDE.md: a
// field a route does not destructure does not exist. All four refuse an agent with 403.

import express from 'express';
import { storeAttachment } from './attachments.mjs';
import { isAgentActor } from './actors.mjs';
import { currentWorkerIdentity } from './workerScope.mjs';
import { logEvent } from './log.mjs';
import { createCollection, setCollectionMeta, addSubcollection, removeSubcollection } from './subcollections.mjs';
import { DEFAULT_ACTOR } from './actors.mjs';

export function registerCollectionRoutes(app) {
  const route = fn => (req, res) => {
    try { res.json(fn(req)); }
    catch (e) { res.status(e.status || 400).json({ error: e.message }); }
  };
  const who = req => ({ actor: String((req.body && req.body.actor) || req.query.actor || DEFAULT_ACTOR) });

  // A picture (or video, audio, PDF) dropped onto a record. The bytes go to `files/<sha256>.<ext>`
  // through the one attachment writer and the route answers with that path; the RECORD is then
  // changed by the ordinary record route, so this never writes a document. Only media types the
  // app can show are accepted (attachments.mjs), and only from the person — an agent that wants to
  // attach something proposes it.
  app.post('/api/files/attach', express.raw({ type: '*/*', limit: '80mb' }), (req, res) => {
    const actor = String(req.query.actor || DEFAULT_ACTOR);
    try {
      if (currentWorkerIdentity() || isAgentActor(actor)) throw Object.assign(new Error('Only the operator can attach files.'), { status: 403 });
      const saved = storeAttachment(req.body, { type: String(req.headers['content-type'] || ''), name: String(req.query.name || '') });
      logEvent({ type: 'store', actor, target: saved.path, detail: { attachment: true, name: String(req.query.name || ''), size: saved.size, existed: saved.existed } });
      res.json(saved);
    } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
  });

  app.post('/api/collections/create', route(req => createCollection({ label: req.body && req.body.label }, who(req))));

  app.patch('/api/collections/:id/meta', route(req => {
    const { label, colour, header, page } = req.body || {};
    return setCollectionMeta(req.params.id, { label, colour, header, page }, who(req));
  }));

  app.post('/api/collections/:id/subcollections', route(req => {
    const { label, collection } = req.body || {};
    return addSubcollection(req.params.id, { label, collection }, who(req));
  }));

  app.delete('/api/collections/:id/subcollections/:child', route(req => removeSubcollection(req.params.id, req.params.child, who(req))));
}
