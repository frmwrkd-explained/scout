// frontend/collectionsApi.js — the calls behind making and shaping collections by hand
// (backend/collectionRoutes.mjs), and reading a record's sub-collection rows.
//
// Kept beside the components that use it rather than added to api.js so the two can change
// together. Errors carry the server's own sentence, like api.js's do.

const read = async response => {
  let body = null;
  try { body = await response.json(); } catch { /* an empty or non-JSON body */ }
  if (!response.ok) {
    const error = new Error((body && body.error) || 'api ' + response.status);
    error.status = response.status;
    throw error;
  }
  return body;
};
const json = body => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const at = id => '/api/collections/' + encodeURIComponent(id);

export const collectionsApi = {
  create: (label, actor) => fetch('/api/collections/create', { method: 'POST', ...json({ label, actor }) }).then(read),
  setMeta: (id, patch, actor) => fetch(at(id) + '/meta', { method: 'PATCH', ...json({ ...patch, actor }) }).then(read),
  // `{ label }` makes a new sub-collection; `{ collection }` nests one that already exists.
  addSub: (parent, what, actor) => fetch(at(parent) + '/subcollections', { method: 'POST', ...json({ ...what, actor }) }).then(read),
  removeSub: (parent, child, actor) => fetch(at(parent) + '/subcollections/' + encodeURIComponent(child), { method: 'DELETE', ...json({ actor }) }).then(read),

  // The records of `collection` that belong to one parent record. `all=1` drops the child
  // collection's own default-view filter: a company's people are ALL its people, whatever the
  // People collection happens to open on.
  children: (collection, bind) => fetch(at(collection) + '/documents?all=1&bind=' + encodeURIComponent(JSON.stringify(bind))).then(read),
};
