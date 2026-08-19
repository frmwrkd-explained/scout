// Shared generation controls — the ONE ModelPicker and the ONE FormatControls, consolidated from
// the four surfaces that each grew their own (the Quick Generate console, the Prompt Builder's
// target-model select, the Style Lab, and the Model Catalog card). Everything provider-, price- and
// pixel-aware about picking a model or a frame shape lives here exactly once.
//
// Both components are pure and CONTROLLED — they own no fetching and no persistence, they read a
// `value` and call `onChange`. That is the contract later surfaces depend on: chat manual mode
// (mounts ModelPicker + FormatControls directly) and the SchemaForm renderer (wraps FormatControls
// as its fallback when a model's synced spec is missing). Keep them controlled — no internal state
// may shadow or override `value`.
//
// ModelPicker holds exactly one piece of local state — the search query (DEV-125). That is
// EPHEMERAL VIEW state in the same class as FragmentsPopoverBody's `allLooks` or StyleLab's
// `expanded`: it filters what is drawn, it is thrown away when the popover closes, and it can
// neither change nor contradict the selection. The rule above is about `value`; do not use this as
// licence to move the selection in here.
//
// SOURCE OF TRUTH: every catalog fact — which models exist, which are enabled, custom models,
// provider labels, cost, the resolution tiers, and the aspect→pixels snap-to-16 — comes from
// frontend/models.js (the facade over frontend/modelCatalog.js). This file adds NO catalog data;
// it only renders. The aspect list below is presentation order for the chips, not a catalog.
import React from 'react';
import { sx } from './sx';
import { enabledCatalog, providerDef, modelById, estCost, RESOLUTIONS, DEFAULT_RESOLUTION, pixelSize, fmtSize } from './models';
import { MONO } from './tokens';
import { Chip } from './ui';


// The five frame shapes the composer offers, in chip order. A UI list (not catalog data): the real
// pixel math for any of them is pixelSize() in the model catalog, which is what actually gets sent.
export const ASPECTS = ['16:9', '2.39:1', '9:16', '1:1', '4:5'];

// Human name for a model id — falls back to the id tail for a custom/legacy id the catalog has
// never heard of, which is the only case where the tail is the best available name.
export const modelName = id => (modelById(id) || {}).label || String(id || '').split('/').pop() || id;

// section eyebrow inside a popover body — matches the toolkit's popHead exactly
const Head = ({ children }) => (
  <div style={sx('font-size:9px;font-weight:800;letter-spacing:.14em;color:var(--fg-faint);padding:9px 13px 5px')}>{children}</div>
);
// the selected-chip language used across the app — DESIGN.md's neutral raised chip (--raise bed,
// --fg text, --border-3 edge; selected is state, not action). Byte-matches SchemaForm's Chip so the
// spec-driven form and its FormatControls fallback speak one language.

// ── ModelPicker ────────────────────────────────────────────────────────────
// The provider/price-aware model list — replaces every hand-rolled <select> and popover. Fed by the
// ENABLED catalog (custom models included, disabled models filtered out), grouped by kind. Renders
// the popover BODY only; the caller supplies the shell/anchor (a pill popover in the console, a
// dropdown in the prompt builder). This keeps one list renderer while each surface keeps its trigger.
//
// Props:
//   settings   the app settings object — drives enabledCatalog (disabled + custom models)
//   value      selected model id; '' (or falsy) selects the optional default row
//   onChange   (id) => void — '' when the default row is chosen
//   video      true → VIDEO models only · false → non-VIDEO only · null/undefined → every group
//   kinds      optional array of catalog kind keys (preview|render|edit|video|music|voice|sfx) to
//              whitelist. ADDITIVE — when omitted, behaviour is exactly as before. This is what the
//              composer's OUTPUT filter passes (via OUTPUT_KINDS[].kinds), and it is the reason the
//              chat composer no longer needs its own forked model list: `video` alone could not
//              isolate a single kind or the audio kinds, which was the stated excuse for the fork.
//              When both are given, `kinds` wins — it is the more specific statement.
//   defaultRow null | { label, sub, note, cost } — an optional top row that calls onChange('')
//   heading    optional override for the auto image/video section head
//   maxHeight  scroll cap (px), default 360
//   search     false disables the type-to-filter field (default true). The field lives HERE, once,
//              so every surface that mounts a ModelPicker gets it — do not add one per surface.
export function ModelPicker({ settings, value, onChange, video = null, kinds = null, defaultRow = null, heading, maxHeight = 360, search = true }) {
  const [q, setQ] = React.useState('');
  const [cursor, setCursor] = React.useState(-1);   // -1 = nothing highlighted; keyboard only
  const groups = enabledCatalog(settings || {}).filter(g =>
    Array.isArray(kinds) && kinds.length ? kinds.includes(g.kind)
      : video == null ? true : (g.group.startsWith('VIDEO') === !!video));

  // DEV-125 — match the things a user actually types: the human label, the id (people paste
  // "nano-banana-pro"), the provider name, and the caption. Every term must hit, so "fal video"
  // narrows rather than widens. Whitespace-split, case-insensitive, no fuzzy matching: a picker
  // that guesses is worse than one that says "nothing matched".
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = m => {
    if (!terms.length) return true;
    const hay = [m.label, m.id, (providerDef(m.provider) || {}).label || m.provider, m.note]
      .filter(Boolean).join(' ').toLowerCase();
    return terms.every(t => hay.includes(t));
  };
  const shown = groups
    .map(g => ({ ...g, models: g.models.filter(matches) }))
    .filter(g => g.models.length);

  // The keyboard walks the FLAT visible list, so ↓ crosses a group boundary the way the eye does.
  const flat = shown.flatMap(g => g.models);
  const commit = m => { if (m) { onChange(m.id); } };
  const onKey = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      setCursor(c => {
        const next = e.key === 'ArrowDown' ? c + 1 : c - 1;
        return (next + flat.length) % flat.length;   // wrap, so the list has no dead ends
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();   // never let a bare Enter reach a surface's submit while picking
      commit(cursor >= 0 ? flat[cursor] : flat[0]);
    } else if (e.key === 'Escape' && q) {
      // first Escape clears the filter, so it doesn't close the popover out from under a typo
      e.preventDefault(); e.stopPropagation(); setQ(''); setCursor(-1);
    }
  };

  const row = (id, label, prov, note, c, on, fn, cursored) => (
    <div key={id} onClick={fn} className="hRow"
      ref={cursored ? el => el && el.scrollIntoView({ block: 'nearest' }) : undefined}
      style={{
        ...sx('display:flex;align-items:center;gap:9px;padding:7px 13px;cursor:pointer'),
        background: on ? 'var(--accent-05)' : cursored ? 'var(--raise)' : 'transparent',
        // the keyboard cursor must be legible on top of the selected row's tint, so it is an edge
        boxShadow: cursored ? 'inset 2px 0 0 var(--accent)' : 'none'
      }}>
      <span style={{ flex: 'none', width: 10, color: 'var(--accent)', fontSize: 10 }}>{on ? '✓' : ''}</span>
      <span style={sx('min-width:0;flex:1')}>
        <span style={{ ...sx('display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontSize: 11.5, color: on ? 'var(--accent)' : 'var(--fg)' }}>{label}</span>
        <span style={{ ...sx('display:block;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)' }}>{prov}{note ? ' · ' + note : ''}</span>
      </span>
      <span style={{ flex: 'none', fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>{c == null ? '' : '$' + Number(c).toFixed(3)}</span>
    </div>
  );
  const autoHead = heading || (video == null ? 'MODELS' : video ? 'VIDEO MODELS' : 'IMAGE MODELS');
  let ix = -1;   // running index into `flat`, so each row knows whether it is the cursored one
  return (
    <div>
      {search && (
        // Sits OUTSIDE the scroll area: with 30+ models the field would otherwise scroll away
        // exactly when it is being used.
        <div style={sx('padding:9px 13px 7px;border-bottom:1px solid var(--line)')}>
          <input
            autoFocus value={q} onKeyDown={onKey}
            onChange={e => { setQ(e.target.value); setCursor(-1); }}
            placeholder="Filter models…  ↑↓ ⏎"
            style={{
              ...sx('width:100%;border-radius:6px;padding:5px 8px;outline:none'),
              fontFamily: MONO, fontSize: 10.5, color: 'var(--fg)',
              background: 'var(--sunk)', border: '1px solid var(--border-2)'
            }} />
        </div>
      )}
      <div style={{ ...sx('overflow-y:auto'), maxHeight }}>
        {!terms.length && <Head>{autoHead}</Head>}
        {/* the default row is a mode, not a model — hide it while filtering, where every visible
            row should be something the query actually matched */}
        {defaultRow && !terms.length && row('__default', defaultRow.label, defaultRow.sub, defaultRow.note, defaultRow.cost, !value, () => onChange(''))}
        {shown.map(g => (
          <div key={g.group} style={sx('border-top:1px solid var(--line)')}>
            <Head>{g.group}</Head>
            {g.models.map(m => { ix++; return row(m.id, m.label, (providerDef(m.provider) || {}).label || m.provider, m.note, m.cost, value === m.id, () => onChange(m.id), ix === cursor); })}
          </div>
        ))}
        {!shown.length && (
          <div style={{ ...sx('padding:16px 13px;text-align:center'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}>
            No model matches “{q.trim()}”
          </div>
        )}
      </div>
    </div>
  );
}

// ── VariantChips ─────────────────────────────────────────────────────────────
// "how many of this shall I make" — the ONE control for it (DEV-125).
//
// This is deliberately NOT inside FormatControls only, because variantCount is not a model setting:
// no fal spec declares it, and the server implements it by issuing one whole generation per variant
// (backend/batches.mjs) rather than by asking a provider for num_images. It is a FrameForge concept
// that sits ABOVE the model. SchemaForm therefore renders it on BOTH of its paths — the generic
// fallback (via FormatControls) and the synced-spec path — because otherwise "give me 12 of these"
// silently disappeared for exactly the models that have a spec, which is most of the good ones.
//
// Do not confuse it with a spec's own `num_images`: that asks ONE call for several images and is
// capped by the provider (often 4). Both can be set; they multiply.
export function VariantChips({ value, onChange, options = [1, 2, 4, 8, 12, 16] }) {
  return (
    <>
      <Head>VARIANTS</Head>
      <div style={sx('display:flex;gap:5px;flex-wrap:wrap;padding:9px 13px 0')}>
        {options.map(n => (
          <Chip key={n} label={n + '×'} on={(value || 1) === n} onClick={() => onChange(n)}
            title={n === 1 ? 'Single generate' : n + ' separate generations — one provider call each'} />
        ))}
      </div>
    </>
  );
}

// ── FormatControls ───────────────────────────────────────────────────────────
// Aspect chips + resolution tiers with a live pixel readout, plus the optional per-generation
// numbers (seed, variant count, duration). The pixel size comes straight from pixelSize() in the
// model catalog — snap-to-16 is NOT reimplemented here, only read — so every surface asks for
// identical dimensions from the same aspect+resolution.
//
// CONTROLLED: value is { aspect, resolution, seed, variantCount, duration }; onChange receives the
// FULL next object (merged), so a consumer can `onChange={v => this.setState(v)}` or diff it. Each
// optional field renders only when its show* flag is set, so the console can take just aspect +
// resolution while manual mode / the SchemaForm fallback take the whole set.
//
// Props:
//   value          { aspect, resolution, seed, variantCount, duration }
//   onChange       (nextValue) => void — the whole merged object
//   aspects        chip list (default ASPECTS)
//   resolutions    tier list (default RESOLUTIONS from the catalog)
//   showSeed       render the SEED input (default false)
//   showVariants   render the VARIANTS chips (default false)
//   variantOptions variant counts (default [1, 2, 4, 8, 12, 16]). 16 is not an arbitrary stop: it
//                  is the server's own ceiling (backend/batches.mjs:41 clamps variantCount to
//                  1..16), and the batch runner already issues ONE generation per variant rather
//                  than a provider-native num_images, so a provider capping at 4 is irrelevant
//                  here. Raising the top of this list means raising that clamp first (DEV-125).
//   showDuration   render the DURATION chips (default false)
//   durations      duration-in-seconds chip list (required when showDuration)
export function FormatControls({
  value, onChange,
  aspects = ASPECTS, resolutions = RESOLUTIONS,
  showSeed = false, showVariants = false, variantOptions = [1, 2, 4, 8, 12, 16],
  showDuration = false, durations = [5]
}) {
  const v = value || {};
  const aspect = v.aspect || '16:9';
  const resolution = v.resolution || DEFAULT_RESOLUTION;
  const px = pixelSize(aspect, resolution);
  const set = patch => onChange({ ...v, ...patch });
  return (
    <div style={sx('padding-bottom:11px')}>
      <Head>ASPECT</Head>
      <div style={sx('display:flex;gap:5px;flex-wrap:wrap;padding:0 13px 9px')}>
        {aspects.map(a => <Chip key={a} label={a} on={aspect === a} onClick={() => set({ aspect: a })} />)}
      </div>

      <Head>RESOLUTION — LONG EDGE</Head>
      <div style={sx('display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding:0 13px')}>
        {resolutions.map(r => {
          const d = pixelSize(aspect, r.id);
          return <Chip key={r.id} label={r.label} on={resolution === r.id} onClick={() => set({ resolution: r.id })} title={r.note + ' · ' + fmtSize(d.width, d.height)} />;
        })}
        {/* the request, not the delivery — a finished card badges what actually came back */}
        <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)', marginLeft: 3, fontVariantNumeric: 'tabular-nums' }}>{fmtSize(px.width, px.height)}</span>
      </div>

      {showDuration && (
        <>
          <Head>DURATION — SECONDS</Head>
          <div style={sx('display:flex;gap:5px;flex-wrap:wrap;padding:9px 13px 0')}>
            {durations.map(d => <Chip key={d} label={d + 's'} on={(v.duration ?? durations[0]) === d} onClick={() => set({ duration: d })} />)}
          </div>
        </>
      )}

      {showVariants && <VariantChips value={v.variantCount} onChange={n => set({ variantCount: n })} options={variantOptions} />}

      {showSeed && (
        <>
          <Head>SEED</Head>
          <div style={sx('display:flex;align-items:center;gap:8px;padding:9px 13px 0')}>
            <input value={v.seed ?? ''} onChange={e => set({ seed: e.target.value.replace(/\D/g, '') })} placeholder="random"
              onKeyDown={e => e.stopPropagation()}
              style={{ ...sx('background:var(--ink);border:1px solid var(--border-2);border-radius:7px;color:var(--fg);padding:5px 9px;width:92px'), fontFamily: MONO, fontSize: 10, fontVariantNumeric: 'tabular-nums' }} />
            <span onClick={() => set({ seed: String(Math.floor(Math.random() * 999999)) })} className="hAccent" style={{ ...sx('cursor:pointer;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }} title="Roll a seed">roll</span>
            {(v.seed ?? '') !== '' && <span onClick={() => set({ seed: '' })} className="hFg" style={{ ...sx('cursor:pointer'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>clear</span>}
          </div>
        </>
      )}
    </div>
  );
}
