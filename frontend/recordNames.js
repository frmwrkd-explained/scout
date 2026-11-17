// recordNames — one answer to "what is the record behind this link called?".
//
// A relation stores a SLUG (`company: bellwether-trust`) — that is the right thing on disk, it is
// what an agent reads and what survives a rename of the title. It is the wrong thing on screen:
// nobody knows their client as `bellwether-trust`. Every place that shows a link — a cell, a chip
// on a record, a group heading, the picker — asks here and prints the record's name.
//
// One cache per collection, filled once from the same route the collection screen uses, shared by
// every cell on the page. While it loads, a link shows the slug as a name (relationNames.js) so
// nothing flashes. After a write the cache is marked stale and refilled in the background; the old
// names stay on screen until the new ones are here.

import React from 'react';
import { api } from './api';
import { nameFromSlug } from './relationNames';

const cache = new Map();      // collection id → { list, map, loading, stale }
const listeners = new Set();
const announce = () => { for (const l of [...listeners]) l(); };
const EMPTY = { list: null, map: null };

function fill(id, entry) {
  entry.loading = true; entry.stale = false;
  api.allDocuments(id).then(r => {
    const list = (r.rows || []).map(x => ({ slug: String(x.slug), title: x.title || nameFromSlug(x.slug), path: x.path }));
    entry.list = list; entry.map = new Map(list.map(x => [x.slug, x]));
  }).catch(() => { if (!entry.list) cache.delete(id); }).finally(() => { entry.loading = false; announce(); });
}
function entryFor(id) {
  let entry = cache.get(id);
  if (!entry) { entry = { list: null, map: null, loading: false, stale: false }; cache.set(id, entry); fill(id, entry); }
  else if (entry.stale && !entry.loading) fill(id, entry);
  return entry;
}

// → { list, map } for a collection (both null until loaded). Call it with null to ask for nothing.
export function useRecordNames(collectionId) {
  const [, tick] = React.useReducer(n => n + 1, 0);
  React.useEffect(() => { listeners.add(tick); return () => { listeners.delete(tick); }; }, []);
  return collectionId ? entryFor(collectionId) : EMPTY;
}

// The name to print for a slug. `known` is false only when the names ARE loaded and the slug is
// not among them — a link to something that does not exist, which the cell shows as such.
export function nameOf(names, slug) {
  const hit = names && names.map ? names.map.get(String(slug)) : null;
  return { title: hit ? hit.title : nameFromSlug(slug), path: hit ? hit.path : null, known: !names || !names.map || !!hit };
}

// Something was written. Old names stay until the refill lands.
export function refreshRecordNames(collectionId) {
  if (collectionId) { const e = cache.get(collectionId); if (e) e.stale = true; }
  else for (const e of cache.values()) e.stale = true;
  announce();
}
// One record was renamed on this page — no need to ask the server.
export function renameRecord(collectionId, slug, title) {
  const e = cache.get(collectionId);
  const hit = e && e.map && e.map.get(String(slug));
  if (!hit || !title || hit.title === title) return;
  hit.title = title; announce();
}
