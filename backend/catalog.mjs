// Provider model-catalog sync — mirrors the full fal.ai model list locally so Settings
// can offer every endpoint, not just the curated set in frontend/modelCatalog.js.
// Endpoint: GET https://api.fal.ai/v1/models (public; the user's
// key raises rate limits). The mirror lands in the storage root as catalog/fal.md —
// frontmatter carries the sync metadata, the body is the JSON rows (portable, AI-readable).
//
// Kie.ai has NO public model-list API (GET /api/v1/models → 404), and
// Higgsfield/Arcads are CLI/MCP-driven — those three keep the curated list only.
import path from 'path';
import fs from 'fs';
import { getStorageRoot, readMd, writeMd } from './store.mjs';
import { falKey } from './fal.mjs';

const FAL_MODELS_URL = 'https://api.fal.ai/v1/models';
const PAGE_SIZE = 100;
const HARD_CAP = 2000;           // fal has ~700 endpoints; safety stop
const catalogFile = () => path.join(getStorageRoot(), 'catalog', 'fal.md');

// fal `category` → the four purposes the app models (null = not generatable here)
export function falCategoryKind(cat = '') {
  const c = String(cat).toLowerCase();
  if (/video/.test(c)) return 'video';
  if (c === 'image-to-image') return 'edit';
  if (/image/.test(c)) return 'render';   // text-to-image and friends
  return null;                            // audio, llm, training, 3d… — listed but not enable-able
}

export function readFalCatalog() {
  try {
    const { data, content } = readMd(catalogFile());
    return { synced: data.synced || null, count: data.count || 0, models: JSON.parse(content || '[]') };
  } catch { return { synced: null, count: 0, models: [] }; }
}

export async function syncFalCatalog() {
  const key = falKey();
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['Authorization'] = 'Key ' + key;

  const rows = [];
  let cursor = null;
  for (let page = 0; page < 50; page++) {
    const url = new URL(FAL_MODELS_URL);
    url.searchParams.set('limit', String(PAGE_SIZE));
    if (cursor) url.searchParams.set('cursor', cursor);
    let res = await fetch(url, { headers });
    for (let attempt = 1; res.status === 429 && attempt <= 4; attempt++) {   // ride out the public rate limit
      await new Promise(r => setTimeout(r, 2000 * 2 ** (attempt - 1)));
      res = await fetch(url, { headers });
    }
    if (!res.ok) throw new Error('fal model list failed: ' + res.status + ' ' + res.statusText);
    const body = await res.json();
    for (const m of body.models || []) {
      if (!m.endpoint_id) continue;
      const md = m.metadata || {};
      rows.push({
        id: m.endpoint_id,
        label: md.display_name || md.name || m.endpoint_id,
        category: md.category || '',
        kind: falCategoryKind(md.category),
        note: (md.short_description || md.description || '').split('\n')[0].slice(0, 120),
        thumb: md.thumbnail_url || null,
        status: md.status || null
      });
    }
    if (!body.has_more || !body.next_cursor || rows.length >= HARD_CAP) break;
    cursor = body.next_cursor;
  }

  const synced = new Date().toISOString();
  writeMd(catalogFile(), { provider: 'fal', synced, count: rows.length },
    JSON.stringify(rows, null, 1));
  return { synced, count: rows.length, models: rows };
}
