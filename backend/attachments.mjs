// backend/attachments.mjs — the one writer of `<workspace>/files/`.
//
// docs/02_DATA_MODEL.md §2 and §5 have said since M1 that a `file` value is "content-addressed by
// sha256" and that `files/` holds "attachments, sha256-named". Nothing wrote that folder: every
// `file` value in the app so far was a path a person typed. This is the writer the docs describe.
//
// The name IS the content: `files/<sha256><ext>`. Three things follow, and they are the reason to
// do it this way rather than keep the source's filename:
//   · the same bytes arriving twice are one file, so an import is safe to run twice;
//   · a write can never replace different bytes under the same name, so "never overwrite a user
//     file" holds by construction instead of by a check somebody has to remember;
//   · a record's `image: files/ab12….jpg` stays true when the folder is copied to another machine.
//
// Bytes, not documents: `backend/records.mjs` is still the only writer of document files. A record
// points at an attachment through a `file` field; `backend/files.mjs` `rawFile` serves it.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getStorageRoot } from './store.mjs';
import { MEDIA_TYPES } from './files.mjs';

export const ATTACHMENTS_DIR = 'files';

export class AttachmentError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'AttachmentError'; this.status = status; }
}

// mime → extension, derived from the one media table (`files.mjs` MEDIA_TYPES) so an attachment
// stored here is always one `GET /api/files/raw` will serve inline. First extension listed wins
// (`.jpg` before `.jpeg`).
const EXT_BY_TYPE = {};
for (const [ext, type] of Object.entries(MEDIA_TYPES)) if (!EXT_BY_TYPE[type]) EXT_BY_TYPE[type] = ext;

// The extension an attachment is stored under. The declared media type decides; a filename is the
// fallback, and only when it carries an extension the media table knows. Anything else is refused:
// an attachment nobody can render is a download with a hash for a name, which helps no one.
export function attachmentExt({ type = '', name = '' } = {}) {
  const declared = String(type).toLowerCase().split(';')[0].trim();
  const byType = EXT_BY_TYPE[declared];
  if (byType) return byType;
  // A type that was declared and is NOT one we show is refused even if the filename claims
  // otherwise: `text/html` named `shot.png` is not a picture. Only an absent or generic type
  // (what a browser sends for a file it does not recognise) falls back to the name.
  if (declared && declared !== 'application/octet-stream') return null;
  const ext = path.extname(String(name)).toLowerCase();
  if (MEDIA_TYPES[ext]) return ext === '.jpeg' ? '.jpg' : ext;
  return null;
}

export const sha256Of = buf => crypto.createHash('sha256').update(buf).digest('hex');

// → { path, sha256, size, existed }. `path` is workspace-relative with forward slashes on every
// platform — it is written into frontmatter, and a `\` there would not survive a move to a Mac.
export function storeAttachment(buf, { type = '', name = '' } = {}) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new AttachmentError('an attachment needs bytes');
  const ext = attachmentExt({ type, name });
  if (!ext) throw new AttachmentError('unsupported attachment type "' + (type || path.extname(name) || 'unknown') + '"');

  const sha256 = sha256Of(buf);
  const rel = ATTACHMENTS_DIR + '/' + sha256 + ext;
  const abs = path.join(getStorageRoot(), ATTACHMENTS_DIR, sha256 + ext);

  // Same name means same bytes, so an existing file is the answer, not a conflict. The size check
  // catches the one way that can be false: a file truncated by a crash before tmp+rename existed
  // here, or edited by hand. It is reported, never repaired by overwriting.
  if (fs.existsSync(abs)) {
    const size = fs.statSync(abs).size;
    if (size !== buf.length) {
      throw new AttachmentError('files/' + sha256 + ext + ' exists with ' + size + ' bytes, expected ' + buf.length + ' — not overwriting it', 409);
    }
    return { path: rel, sha256, size, existed: true };
  }

  fs.mkdirSync(path.dirname(abs), { recursive: true });
  // tmp + rename, like every other write in this codebase: readers must see the whole file or none.
  const tmp = abs + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, abs);
  return { path: rel, sha256, size: buf.length, existed: false };
}

export default { storeAttachment, attachmentExt, sha256Of, ATTACHMENTS_DIR, AttachmentError };
