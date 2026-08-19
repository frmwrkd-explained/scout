// Per-model input-schema sync — turns FAL's published per-endpoint OpenAPI schema into a
// small NORMALIZED settings schema the UI can render a form from, so Manual mode follows the
// model spec instead of hand-written per-model branches (spec §Backend "Model spec sync").
//
// FAL publishes an OpenAPI doc per endpoint at
//   https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<queue path>
// (public; no key needed). We fetch it, pick out the request-body Input schema, flatten each
// property to { name, label, type, options, min, max, step, default, ref, required } and cache
// the result as a markdown record under the storage root: catalog/schemas/<safe id>.md
// (frontmatter carries the staleness stamp, the body is the normalized JSON).
//
// Non-FAL providers (Kie/Higgsfield/Arcads) have no fetchable per-model spec, and custom/unknown
// ids likewise — those return a minimal catalog-derived schema flagged `fallback:true`, the
// documented marker telling the client to use the generic FormatControls instead.
import path from 'path';
import { getStorageRoot, readMd, writeMd, safe } from './store.mjs';
import { modelById, providerOfModel, modelKind } from '../frontend/modelCatalog.js';

// A cached schema older than this is refreshed on the next lazy GET (offline still serves it).
export const SCHEMA_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FAL_OPENAPI = 'https://fal.ai/api/openapi/queue/openapi.json';

export const falOpenapiUrl = id => FAL_OPENAPI + '?endpoint_id=' + encodeURIComponent(id);
const cacheFile = id => path.join(getStorageRoot(), 'catalog', 'schemas', safe(id) + '.md');

// ── normalization (pure — no fetch, no clock; unit-testable on a raw OpenAPI doc) ──────────────

// snake_case / kebab → "Title Case" when the spec gives no title.
function humanLabel(name, title) {
  if (title) return String(title);
  return String(name).replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// FAL reference-media inputs are consistently named `*_url` / `*_urls`. Classify by the medium
// mentioned so the UI can render an asset picker instead of a text box.
function referenceKind(name) {
  const n = String(name).toLowerCase();
  if (!/url/.test(n)) return null;
  if (/video/.test(n)) return 'video';
  if (/audio|voice|music/.test(n)) return 'audio';
  if (/image|img|mask|reference|photo|frame|start|end/.test(n)) return 'image';
  return null;
}

// #/components/schemas/Foo → the resolved schema object (one level; enough for FAL Input bodies).
function deref(openapi, ref) {
  if (!ref) return null;
  const name = String(ref).split('/').pop();
  return openapi?.components?.schemas?.[name] || null;
}

// Find the request-body Input schema: the POST op on the plain endpoint path (no {request_id}).
function inputSchemaOf(openapi, modelId) {
  const paths = openapi?.paths || {};
  let post = paths['/' + modelId]?.post;
  if (!post) {
    for (const [p, ops] of Object.entries(paths)) {
      if (!/\{request_id\}/.test(p) && ops?.post?.requestBody) { post = ops.post; break; }
    }
  }
  const rb = post?.requestBody;
  const ref = rb?.$ref || rb?.content?.['application/json']?.schema?.$ref;
  let schema = ref ? deref(openapi, ref) : rb?.content?.['application/json']?.schema;
  if (!schema?.properties) {
    // last resort: any component schema whose name ends in "Input"
    const key = Object.keys(openapi?.components?.schemas || {}).find(k => /Input$/.test(k));
    if (key) schema = openapi.components.schemas[key];
  }
  return schema && schema.properties ? schema : null;
}

// Collapse anyOf (FAL uses it for "value | null" and for "structured | enum shorthand").
function pickVariant(prop) {
  if (!Array.isArray(prop.anyOf)) return { chosen: prop, nullable: false };
  const nullable = prop.anyOf.some(v => v.type === 'null');
  const variants = prop.anyOf.filter(v => v.type !== 'null');
  const chosen = variants.find(v => Array.isArray(v.enum)) ||
                 variants.find(v => v.type || v.$ref) || variants[0] || {};
  return { chosen, nullable };
}

function normalizeField(name, prop, required) {
  const { chosen, nullable } = pickVariant(prop);
  const options = chosen.enum || prop.enum || null;
  const base = chosen.type || (chosen.$ref ? 'object' : prop.type);
  const min = chosen.minimum ?? prop.minimum;
  const max = chosen.maximum ?? prop.maximum;
  const step = chosen.multipleOf ?? prop.multipleOf;
  const ref = referenceKind(name);

  let type;
  if (ref) type = ref;                       // image | video | audio reference input
  else if (options && options.length) type = 'enum';
  else if (base === 'integer') type = 'integer';
  else if (base === 'number') type = 'number';
  else if (base === 'boolean') type = 'boolean';
  else if (base === 'array') type = 'array';
  else if (base === 'object') type = 'object';
  else type = 'string';

  const field = {
    name,
    label: humanLabel(name, prop.title || chosen.title),
    type,
    required: required.includes(name)
  };
  if (ref) field.ref = ref;
  if (type === 'enum') field.options = options.map(String);
  if (min !== undefined) field.min = min;
  if (max !== undefined) field.max = max;
  if (step !== undefined) field.step = step;
  if (prop.default !== undefined) field.default = prop.default;
  if (nullable) field.nullable = true;
  const desc = (prop.description || chosen.description || '').trim();
  if (desc) field.description = desc.slice(0, 300);
  return field;
}

// Raw FAL OpenAPI doc → normalized schema. Pure and deterministic (no timestamp — the caller
// stamps `synced` when it caches). Returns a fallback marker if no Input schema can be found.
export function normalizeFalOpenapi(openapi, modelId) {
  const input = inputSchemaOf(openapi, modelId);
  if (!input) return fallbackSchema(modelId, 'fal', 'no-input-schema');
  const required = Array.isArray(input.required) ? input.required : [];
  const fields = Object.entries(input.properties).map(([n, p]) => normalizeField(n, p, required));
  const category = openapi?.info?.['x-fal-metadata']?.category;
  return {
    ok: true,
    modelId,
    provider: 'fal',
    source: 'fal-openapi',
    fallback: false,
    ...(category ? { category } : {}),
    required,
    fields
  };
}

// The documented fallback marker: `fallback:true` tells the client to render generic
// FormatControls. `fields` still carries a best-effort minimal schema so a form is never empty.
export function fallbackSchema(modelId, provider, reason) {
  const kind = modelKind(modelId);
  const fields = [{ name: 'prompt', label: 'Prompt', type: 'string', required: true }];
  if (kind === 'edit' || kind === 'video') {
    fields.push({ name: 'image_url', label: 'Reference Image', type: 'image', ref: 'image', required: kind === 'video' });
  }
  const m = modelById(modelId);
  return {
    ok: true,
    modelId,
    provider,
    source: 'catalog',
    fallback: true,
    reason,
    ...(m?.label ? { label: m.label } : {}),
    kind,
    required: fields.filter(f => f.required).map(f => f.name),
    fields
  };
}

// ── cache (markdown record under the storage root, staleness in frontmatter) ──────────────────

export function readSchemaCache(id) {
  try {
    const { data, content } = readMd(cacheFile(id));
    const schema = JSON.parse(content || 'null');
    if (!schema) return null;
    const synced = data.synced || null;
    const age = synced ? Date.now() - Date.parse(synced) : Infinity;
    return { schema, synced, stale: !(age >= 0 && age < SCHEMA_TTL_MS) };
  } catch { return null; }
}

export function writeSchemaCache(id, schema) {
  const synced = new Date().toISOString();
  const withStamp = { ...schema, synced };
  writeMd(cacheFile(id), { provider: schema.provider || providerOfModel(id), modelId: id, synced, fallback: !!schema.fallback },
    JSON.stringify(withStamp, null, 1));
  return withStamp;
}

// ── fetch + orchestrate ───────────────────────────────────────────────────────────────────────

// Fetch and normalize one FAL model's OpenAPI schema. Uses the global fetch (tests mock it).
export async function fetchFalSchema(id) {
  const res = await fetch(falOpenapiUrl(id), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('fal openapi ' + res.status + ' ' + res.statusText);
  const openapi = await res.json();
  return normalizeFalOpenapi(openapi, id);
}

// Main entry: return a normalized schema for any model id.
//   FAL      → serve fresh cache; lazily fetch when missing/stale; on fetch error serve stale
//              cache (offline) or, if none, the fallback marker. `force` bypasses freshness.
//   non-FAL  → the catalog-derived fallback marker (no fetchable spec).
export async function getModelSchema(id, { force = false } = {}) {
  if (!id) return fallbackSchema('', 'fal', 'no-id');
  const provider = providerOfModel(id);
  if (provider !== 'fal') return fallbackSchema(id, provider, 'no-openapi-for-provider');

  const cached = readSchemaCache(id);
  const needFetch = force || !cached || cached.stale;
  if (!needFetch) return cached.schema;

  try {
    const schema = await fetchFalSchema(id);
    return writeSchemaCache(id, schema);
  } catch (e) {
    if (cached) return { ...cached.schema, stale: true, offline: true }; // offline → serve cache
    return fallbackSchema(id, 'fal', 'fetch-failed: ' + e.message);       // no cache → fallback
  }
}
