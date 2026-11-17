// frontend/media.js — a `file` value → something the browser can show.
//
// Moved out of GalleryView.jsx unchanged so the property rows can show the same picture the
// gallery tile does. Both read THESE two functions; GalleryView re-exports them, so nothing that
// imported them from there has to change. PURE — no React, no fetch.

// A `file` value names a file in the workspace (docs/02_DATA_MODEL.md §5). `GET /api/files/raw`
// serves those bytes — read-only, containment-checked, and inert for anything that is not media —
// so a photo the person dropped in their own folder finally renders.
//
// Everything is handed to the route EXCEPT what the browser can already fetch itself; a path that
// escapes the workspace is refused there with a 400 rather than being guessed at here, and the tile
// falls back to its named plate on the error. The frontend does not know where the vault is, and
// should not: containment is one rule, in one place (backend/files.mjs `resolveRel`).
export function mediaSrc(value) {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) return null;
  const s = String(typeof first === 'object' ? (first.src || first.url || first.path || first.name || '') : first).trim();
  if (!s) return null;
  if (/^(https?:|data:|blob:)/.test(s)) return s;
  return '/api/files/raw?path=' + encodeURIComponent(s.replace(/^file:\/\//, ''));
}

export function mediaName(value) {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) return null;
  const s = typeof first === 'object' ? (first.name || first.path || first.src || '') : String(first);
  return String(s).split('/').pop() || null;
}

// The name a person can read. A content-addressed attachment is `files/<64 hex>.jpg`
// (backend/attachments.mjs), and sixty-four hex characters wrapped over three lines is noise, not
// a name: the first eight identify it as well as all of them do. Anything else prints as written.
export function mediaLabel(value) {
  const name = mediaName(value);
  if (!name) return null;
  const hashed = /^([0-9a-f]{8})[0-9a-f]{56}(\.[a-z0-9]+)?$/i.exec(name);
  return hashed ? hashed[1] + '…' + (hashed[2] || '') : name;
}

// The workspace-relative PATH of a file value. A stored attachment already is one
// (`files/<sha256>.jpg`); a bare name typed by hand (`photo.jpg`) means "under files/", which is
// where attachments live. URLs pass through. One rule, so the editor and the page agree.
export function mediaPath(value) {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) return null;
  const s = String(typeof first === 'object' ? (first.path || first.src || first.url || first.name || '') : first).trim().replace(/^file:\/\//, '');
  if (!s) return null;
  if (/^(https?:|data:|blob:)/.test(s)) return s;
  return s.includes('/') ? s : 'files/' + s;
}

export const isImagePath = value => /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(String(mediaName(value) || ''));
