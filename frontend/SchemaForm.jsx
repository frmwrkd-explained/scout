// SchemaForm — a spec-driven settings form (ticket 05). Given a model id it fetches the NORMALIZED
// per-model schema (backend/modelSchemas.mjs, ticket 04, via api.modelSchema) and materializes one
// control per field: enum → chip row or select, integer/number → stepper (with a slider when the
// range is bounded), boolean → toggle, image/video/audio reference → an attachment slot, string →
// text box. There is NO per-model branching anywhere: the shape of the form is read entirely from
// the schema, so switching models re-renders the settings without a line of model-specific code.
//
// When the schema route reports `fallback:true` (a non-FAL provider, a custom id, or a FAL endpoint
// with no fetchable Input schema) — or while the schema is still loading and nothing is cached — the
// form does NOT dead-end: it renders the generic FormatControls (ticket 03) from the `format` prop
// instead. That is the same aspect/resolution surface the composer has always shown.
//
// CONTROLLED, exactly like FormatControls: `value` is the params object keyed by field name and
// `onChange(next)` receives the FULL merged object. Defaults from the schema are applied once per
// model, through onChange, so a freshly-picked model arrives with its spec defaults already set.
// The parent forwards `value` straight into the generation payload (`params`) — the UI never has to
// know what a given model's fields mean.
//
// Consumed first by the Quick Generate FORMAT popover (ProjectGenerate.jsx) and next by chat manual
// mode (ticket 19), which mounts this with its own `value`/`onChange`/`format`.
import React, { useEffect, useRef, useState } from 'react';
import { sx } from './sx';
import { api } from './api';
import { FormatControls, VariantChips } from './GenerationControls';
import { MONO } from './tokens';
import { Chip } from './ui';


// Module-level cache: modelId → resolved schema. Dedupes the fetch across every popover reopen and
// makes a model→model switch instant after the first look, so the form never re-flashes "loading".
const SCHEMA_CACHE = new Map();

// Fields the composer already owns on its own surfaces — never re-render them here. `prompt` is the
// main textarea; the reference inputs below still render (the spec asks for attachment slots), but
// the freeform `prompt`/`negative`-style text lives with the composer, not in the settings popover.
const OWNED = new Set(['prompt']);

// ── presentational atoms (kept local — these are pure chrome, not catalog data) ────────────────
const Head = ({ children, hint }) => (
  <div style={sx('display:flex;align-items:baseline;gap:7px;padding:9px 13px 5px')}>
    <span style={sx('font-size:9px;font-weight:800;letter-spacing:.14em;color:var(--fg-faint)')}>{children}</span>
    {hint ? <span style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-faint)' }}>{hint}</span> : null}
  </div>
);
// "Selected" is state, not the primary action — so this is the app's neutral raised chip exactly as
// DESIGN.md defines it: --raise bed, --fg text, --border-3 edge. Never the solid accent fill, and
// never the flat var(--fg) white it once was.
const numFmt = n => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4))));
const clamp = (n, min, max) => {
  if (min !== undefined && n < min) n = min;
  if (max !== undefined && n > max) n = max;
  return n;
};

// ── one field → one control ────────────────────────────────────────────────────────────────────
function Field({ field, value, set }) {
  const { name, label, type, required } = field;
  const cur = value[name];

  // ENUM — a chip row when the choice list is short, a native select when it is long.
  if (type === 'enum') {
    const opts = field.options || [];
    const active = cur ?? field.default;
    if (opts.length > 6) {
      return (
        <Row label={label} required={required} desc={field.description}>
          <select value={active ?? ''} onChange={e => set(name, e.target.value)}
            onKeyDown={e => e.stopPropagation()}
            style={{ ...sx('background:var(--ink);border:1px solid var(--border-2);border-radius:7px;color:var(--fg);padding:5px 9px;max-width:260px'), fontFamily: MONO, fontSize: 10 }}>
            {active === undefined && <option value="">—</option>}
            {opts.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </Row>
      );
    }
    return (
      <Row label={label} required={required} desc={field.description}>
        <div style={sx('display:flex;gap:5px;flex-wrap:wrap')}>
          {opts.map(o => <Chip key={o} label={o} on={active === o} onClick={() => set(name, o)} />)}
        </div>
      </Row>
    );
  }

  // INTEGER / NUMBER — stepper (with a slider when both bounds are known).
  if (type === 'integer' || type === 'number') {
    const isInt = type === 'integer';
    const step = field.step ?? (isInt ? 1 : 0.1);
    const active = cur ?? field.default ?? field.min ?? 0;
    const bounded = field.min !== undefined && field.max !== undefined;
    const bump = d => {
      let n = Number(active) + d * step;
      n = clamp(n, field.min, field.max);
      set(name, isInt ? Math.round(n) : Number(n.toFixed(4)));
    };
    return (
      <Row label={label} required={required} desc={field.description}
        hint={(field.min !== undefined || field.max !== undefined) ? (numFmt(field.min ?? 0) + '–' + (field.max !== undefined ? numFmt(field.max) : '∞')) : ''}>
        <div style={sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
          <span onClick={() => bump(-1)} className="hBd" style={stepBtn}>−</span>
          <input value={active} inputMode="decimal"
            onChange={e => {
              const raw = e.target.value.replace(isInt ? /[^\d-]/g : /[^\d.\-]/g, '');
              if (raw === '' || raw === '-') { set(name, raw); return; }
              const n = isInt ? parseInt(raw, 10) : parseFloat(raw);
              set(name, Number.isNaN(n) ? raw : n);
            }}
            onBlur={e => {
              const n = isInt ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
              if (!Number.isNaN(n)) set(name, isInt ? Math.round(clamp(n, field.min, field.max)) : Number(clamp(n, field.min, field.max).toFixed(4)));
            }}
            onKeyDown={e => e.stopPropagation()}
            style={{ ...sx('background:var(--ink);border:1px solid var(--border-2);border-radius:7px;color:var(--fg);padding:5px 9px;width:76px'), fontFamily: MONO, fontSize: 10, fontVariantNumeric: 'tabular-nums' }} />
          <span onClick={() => bump(1)} className="hBd" style={stepBtn}>+</span>
          {bounded && (
            <input type="range" min={field.min} max={field.max} step={step} value={Number(active) || field.min}
              onChange={e => set(name, isInt ? Math.round(Number(e.target.value)) : Number(Number(e.target.value).toFixed(4)))}
              style={sx('flex:1;min-width:90px;accent-color:var(--accent)')} />
          )}
        </div>
      </Row>
    );
  }

  // BOOLEAN — a toggle.
  if (type === 'boolean') {
    const on = cur ?? field.default ?? false;
    return (
      <Row label={label} required={required} desc={field.description} inline>
        <span onClick={() => set(name, !on)}
          style={{ ...sx('position:relative;width:34px;height:18px;border-radius:99px;cursor:pointer;flex:none;transition:background .12s'), background: on ? 'var(--accent)' : 'var(--border-2)' }}>
          <span style={{ ...sx('position:absolute;top:2px;width:14px;height:14px;border-radius:99px;transition:left .12s'), left: on ? 18 : 2, background: on ? 'var(--on-accent)' : 'var(--fg-muted)' }} />
        </span>
      </Row>
    );
  }

  // REFERENCE MEDIA (image | video | audio) — an attachment slot. The composer's own "+ Reference"
  // control is the primary path for image i2i; this slot accepts a direct URL so a model that names
  // an explicit reference field (start_image_url, audio_url, …) is still fillable from here.
  if (type === 'image' || type === 'video' || type === 'audio') {
    const filled = cur != null && cur !== '';
    return (
      <Row label={label} required={required} desc={field.description}>
        <div style={{ ...sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-radius:8px;padding:8px 10px'), border: '1px dashed ' + (filled ? 'var(--accent)' : 'var(--border-2)'), background: 'var(--sunk)' }}>
          <span style={{ fontSize: 13, flex: 'none' }}>{type === 'video' ? '▶' : type === 'audio' ? '♪' : '▣'}</span>
          <input value={filled ? cur : ''} placeholder={'paste a ' + type + ' URL'}
            onChange={e => set(name, e.target.value)} onKeyDown={e => e.stopPropagation()}
            style={{ ...sx('flex:1;min-width:120px;background:transparent;border:none;color:var(--fg)'), fontFamily: MONO, fontSize: 10 }} />
          {filled && <span onClick={() => set(name, '')} className="hFg" style={{ ...sx('cursor:pointer'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>clear</span>}
        </div>
      </Row>
    );
  }

  // STRING (fallthrough) — a text box.
  if (type === 'string') {
    return (
      <Row label={label} required={required} desc={field.description}>
        <input value={cur ?? field.default ?? ''} placeholder={field.default != null ? String(field.default) : ''}
          onChange={e => set(name, e.target.value)} onKeyDown={e => e.stopPropagation()}
          style={{ ...sx('width:100%;box-sizing:border-box;background:var(--ink);border:1px solid var(--border-2);border-radius:7px;color:var(--fg);padding:5px 9px'), fontFamily: MONO, fontSize: 10 }} />
      </Row>
    );
  }

  // array / object — no first-class editor yet; surfaced (never silently dropped) as read-only.
  return (
    <Row label={label} required={required} desc={field.description}>
      <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>advanced ({type}) — not editable here</span>
    </Row>
  );
}

const stepBtn = { ...sx('display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;cursor:pointer;flex:none;border:1px solid var(--border-2);color:var(--fg-soft)'), fontFamily: MONO, fontSize: 13, lineHeight: 1 };

// A labelled field row — eyebrow + required dot + control, with an optional one-line description.
// The spec's `description` for every field used to render as a permanent block under each control.
// Nine of those stacked made the explanations outweigh the controls and pushed the panel several
// screens tall — and it was truncated at 120 chars, so it was noisy AND too clipped to answer the
// question. It is reference material: available on the label (dotted underline = "there's more
// here"), not occupying the column. Full text, untruncated, on hover and focus.
function Row({ label, required, desc, hint, inline, children }) {
  return (
    <div style={sx('padding:2px 13px 9px')}>
      <div style={sx(inline ? 'display:flex;align-items:center;gap:10px' : 'display:block')}>
        <div style={sx('display:flex;align-items:baseline;gap:6px;margin-bottom:' + (inline ? '0' : '5px'))}>
          <span title={desc || ''} tabIndex={desc ? 0 : undefined}
            style={{ ...sx('font-size:9px;font-weight:800;letter-spacing:.12em;color:var(--fg-muted)'), cursor: desc ? 'help' : 'default', borderBottom: desc ? '1px dotted var(--border-3)' : 'none' }}>{label}</span>
          {required ? <span title="required" style={{ color: 'var(--accent)', fontSize: 9 }}>•</span> : null}
          {hint ? <span style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-faint)' }}>{hint}</span> : null}
        </div>
        {/* Inline rows (booleans) used to push the control with margin-left:auto, stranding a 34px
            toggle at the far right of a wide panel with ~400px of dead space between it and its
            own label — the row read as empty. The control now sits directly after the label. */}
        <div>{children}</div>
      </div>
    </div>
  );
}

// ── the form ────────────────────────────────────────────────────────────────────────────────────
// Props:
//   modelId    the model id to render settings for; refetches when it changes
//   value      controlled params object, keyed by field name
//   onChange   (nextValue) => void — the FULL merged object (same idiom as FormatControls)
//   format     props forwarded to the fallback FormatControls (its own value/onChange/aspects/…),
//              rendered when the schema is a fallback marker or hasn't loaded and nothing is cached.
//              `showVariants` is the one piece that ALSO renders on the synced-spec path — see the
//              VariantChips note at the bottom of this file (DEV-125).
//   onSchema   optional (schema) => void — fires when a schema resolves (lets a parent adapt, e.g.
//              stop sending aspect/resolution once a real spec is in play)
export default function SchemaForm({ modelId, value, onChange, format, onSchema }) {
  const [schema, setSchema] = useState(() => (modelId ? SCHEMA_CACHE.get(modelId) : null) || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [advOpen, setAdvOpen] = useState(false);
  const v = value || {};
  const appliedFor = useRef(null); // modelId whose defaults we've already applied — apply once each
  const onSchemaRef = useRef(onSchema);
  onSchemaRef.current = onSchema;

  // Fetch (or serve from cache) whenever the model changes. Aborts stale responses via a token so a
  // fast model→model switch can never paint the previous model's fields.
  useEffect(() => {
    let live = true;
    setError(null);
    if (!modelId) { setSchema(null); return; }
    const cached = SCHEMA_CACHE.get(modelId);
    if (cached) {
      setSchema(cached);
      if (onSchemaRef.current) onSchemaRef.current(cached);
      return;
    }
    setSchema(null);
    setLoading(true);
    api.modelSchema(modelId)
      .then(s => {
        if (!live) return;
        SCHEMA_CACHE.set(modelId, s);
        setSchema(s);
        if (onSchemaRef.current) onSchemaRef.current(s);
      })
      .catch(e => { if (live) setError(e); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [modelId]);

  // Pre-apply spec defaults once per model, through onChange — a freshly-picked model arrives with
  // its documented defaults already set, and we never clobber a value the user has already touched.
  useEffect(() => {
    if (!schema || schema.fallback || appliedFor.current === modelId) return;
    const patch = {};
    for (const f of schema.fields || []) {
      if (OWNED.has(f.name)) continue;
      if (f.default !== undefined && v[f.name] === undefined) patch[f.name] = f.default;
    }
    appliedFor.current = modelId;
    if (Object.keys(patch).length && onChange) onChange({ ...v, ...patch });
  }, [schema, modelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (name, val) => onChange && onChange({ ...v, [name]: val });

  // FALLBACK — no schema, still loading with nothing cached, an error, or the documented
  // `fallback:true` marker: render the generic FormatControls so the surface never dead-ends.
  if (!schema || schema.fallback || error) {
    return (
      <div>
        {loading && (
          <div style={{ ...sx('display:flex;align-items:center;gap:7px;padding:9px 13px 3px'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)' }}>
            <span style={sx('display:inline-block;width:7px;height:7px;border-radius:99px;background:var(--accent);animation:dl-pulse 1.2s infinite')} />
            reading model settings…
          </div>
        )}
        <FormatControls {...(format || {})} />
      </div>
    );
  }

  const fields = (schema.fields || []).filter(f => !OWNED.has(f.name));
  // Nine parameters at identical visual weight is a wall, not a form. Split on a rule the spec
  // already gives us rather than a hand-maintained list: a field is "shown" if it is required, if
  // the user has already set it, or if it shapes the output people actually reach for (the size /
  // count / format axis). Everything else is a documented default that is safe to ignore, so it
  // waits behind one disclosure with a count. Nothing is hidden — it is one click, and any field
  // the user touches stays visible from then on.
  const PROMINENT = /^(aspect_ratio|aspectRatio|resolution|image_size|imageSize|num_images|numImages|output_format|outputFormat|duration|size)$/;
  // NB: spec defaults are pre-applied into `v` above, so "has a value" is true for every field and
  // is useless as a signal. The test for "the user actually touched this" is a value that DIFFERS
  // from the documented default.
  const isShown = f => f.required || PROMINENT.test(f.name) || (v[f.name] !== undefined && v[f.name] !== f.default);
  const shown = fields.filter(isShown);
  const advanced = fields.filter(f => !isShown(f));
  return (
    <div style={sx('padding-bottom:8px')}>
      <Head hint={schema.source === 'fal-openapi' ? (schema.stale ? 'synced spec · stale' : 'synced spec') : schema.source}>
        {(schema.modelId || '').split('/').pop() || 'MODEL'} SETTINGS
      </Head>
      {fields.length ? (
        <>
          {shown.map(f => <Field key={f.name} field={f} value={v} set={set} />)}
          {advanced.length > 0 && (
            <>
              <div onClick={() => setAdvOpen(o => !o)} className="hFg"
                style={{ ...sx('display:flex;align-items:center;gap:7px;margin:2px 13px 0;padding:6px 0;cursor:pointer;border-top:1px solid var(--line)'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-muted)' }}>
                <span style={{ ...sx('display:inline-block;transition:transform .12s'), transform: advOpen ? 'rotate(90deg)' : 'none' }}>›</span>
                <span style={sx('font-weight:700;letter-spacing:.12em')}>ADVANCED</span>
                <span style={sx('color:var(--fg-faint)')}>{advanced.length}</span>
              </div>
              {advOpen && advanced.map(f => <Field key={f.name} field={f} value={v} set={set} />)}
            </>
          )}
        </>
      ) : <div style={{ ...sx('padding:2px 13px 12px;color:var(--fg-faint);line-height:1.5'), fontFamily: MONO, fontSize: 9.5 }}>This model takes no extra settings.</div>}
      {/* DEV-125 — variantCount is NOT a spec field (no fal spec declares it; the server loops one
          generation per variant). Dropping the whole `format` prop on this path therefore removed a
          FrameForge-level control, not a model one, and "give me 12 of these" was unreachable for
          every model that HAS a synced spec — i.e. most of the ones people shoot with. Only the
          variant axis is re-rendered here; aspect/resolution stay owned by the spec above, so this
          is not the fallback FormatControls creeping back in. */}
      {format && format.showVariants && (
        <div style={sx('border-top:1px solid var(--line);padding-bottom:11px')}>
          <VariantChips
            value={(format.value || {}).variantCount}
            options={format.variantOptions}
            onChange={n => format.onChange && format.onChange({ ...(format.value || {}), variantCount: n })} />
        </div>
      )}
    </div>
  );
}
