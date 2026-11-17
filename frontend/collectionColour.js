// frontend/collectionColour.js — the colour a collection is known by. PURE.
//
// A collection is identified by a coloured dot beside its name (the sidebar, and anywhere else
// that needs to say "this is a People thing"). The colour is the schema's own `colour` key when it
// names one of the eight hues; otherwise it is picked from the collection's id, so every
// collection has a stable colour from the moment it exists and nobody has to choose one.
//
// The eight hues are tokens (`--hue-*` in styles.css, both themes). This returns the CSS variable,
// never a hex — a component that needs the pixels of it is a JS sink and reads tokens.js.

import { HUES } from '../shared/collectionShape.mjs';

export { HUES };

// djb2 — small, stable, good enough to spread a dozen ids over eight hues.
function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h;
}

// The hue NAME: the chosen one, else the automatic one.
export function hueOf(collection) {
  const chosen = collection && collection.colour;
  if (HUES.includes(chosen)) return chosen;
  return HUES[hash(String((collection && collection.id) || '')) % HUES.length];
}

export const hueVar = name => 'var(--hue-' + name + ')';

export function colourOf(collection) { return hueVar(hueOf(collection)); }

// What a person calls a collection: its label, else its id. Never `#id`.
export const collectionLabel = collection => (collection && (collection.label || collection.id)) || '';

// A relation chip knows only the ID of the collection it points at, not the schema — so the app
// hands the loaded collections here once per render and a chip asks by id. This is what keeps a
// chip's dot the same colour as that collection's row in the sidebar, including a colour somebody
// chose by hand. Unknown id → the automatic colour, which is what the sidebar would show too.
let known = new Map();
export function rememberCollections(collections) { known = new Map((collections || []).map(c => [c.id, c])); }
export const collectionById = id => known.get(id) || { id };
export const colourOfId = id => colourOf(collectionById(id));
export const labelOfId = id => collectionLabel(collectionById(id));
