// frontend/schemaApi.js — changing and retiring a property (backend/schemaRoutes.mjs).
//
// Adding a property and creating a record are already in ./api (`api.addField`, `api.upsert`);
// these are the two calls that file does not have. `actor` rides BESIDE the change and the route
// destructures it off — it is who is changing the property, never part of it.

// Same contract as api.js `j`: the server always answers with a sentence in `error`, and that
// sentence is what the person should read.
async function j(response) {
  let body = null;
  try { body = await response.json(); } catch { /* non-JSON body */ }
  if (!response.ok) {
    const err = new Error((body && body.error) || 'api ' + response.status);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}
const json = body => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const url = (collectionId, key) => '/api/collections/' + encodeURIComponent(collectionId) + '/fields/' + encodeURIComponent(key);

// `patch` holds only what changes: { label, type, options, multiline, primary_media, … }.
// `null` clears an optional key. The field's key itself never changes.
export const updateField = (collectionId, key, patch, actor) =>
  fetch(url(collectionId, key), { method: 'PATCH', ...json({ ...patch, ...(actor ? { actor } : {}) }) }).then(j);

// Removes the property from the collection and from its saved views. Values already saved in the
// record files are kept. Answers the collection plus `views` (how many views it was taken out of)
// and `warnings` (anything else that still points at it).
export const removeField = (collectionId, key, actor) =>
  fetch(url(collectionId, key), { method: 'DELETE', ...json(actor ? { actor } : {}) }).then(j);

// { types: [...], changes: { text: ['select', …], … } } — what a property of one type may become.
// Asked once per page load: it is a constant of the backend, and the picker must offer exactly
// what the server will accept.
let cached = null;
export const fieldTypes = () => (cached || (cached = fetch('/api/field-types').then(j).catch(e => { cached = null; throw e; })));
