// Cinematic prompt tokens (distilled from the prompt builder and shot-prompter
// 8-axis system) + the shared, provider-aware model catalog.
//
// The model catalog and its helpers now live in ./modelCatalog — a PURE module the Express
// server imports too (provider routing needs one source of truth). Everything is re-exported
// here so every existing `import { MODEL_CATALOG | enabledCatalog | isModelEnabled | … }
// from './models'` keeps working unchanged.
export * from './modelCatalog.js';

// Axis system: pick tokens per axis, the fragments are concatenated with grammar rules.
// t = display name, f = prompt fragment. Image-backed axes pull their tokens from the
// cinematic option catalog (synced from Airtable, thumbnails bundled under axis-options/).
import { optionsOfType } from './cinematicOptions.js';
const catTokens = type => optionsOfType(type).map(o => ({ t: o.name, f: o.f, d: o.d, img: o.img }));

export const ENVIRONMENTS = optionsOfType('Environment');

export const AXES = [
  { key: 'style', name: 'Style', max: 2, tokens: catTokens('Style') },
  // Framing is the one axis defined inline rather than synced from the catalog, so it also had to
  // carry its own `img` — and never did, which is why it rendered as bare text tiles while every
  // strip below it showed pictures. The thumbnails run the same character through the same plaza
  // as Focal Length and Lens Type (see scripts/axis-prompts.mjs): shot size is the only variable,
  // and the three camera axes read as one system instead of three unrelated grids.
  { key: 'framing', name: 'Framing', max: 1, tokens: [
    { t: 'Extreme wide', f: 'extreme wide establishing shot, subject small in the frame', img: '/axis-options/framing--extreme-wide.jpg' },
    { t: 'Wide', f: 'wide shot with full environment context', img: '/axis-options/framing--wide.jpg' },
    { t: 'Medium', f: 'medium shot, waist up', img: '/axis-options/framing--medium.jpg' },
    { t: 'Close-up', f: 'tight close-up on the face, emotional detail', img: '/axis-options/framing--close-up.jpg' },
    { t: 'Macro detail', f: 'macro detail shot of the smallest meaningful part, blurred context', img: '/axis-options/framing--macro-detail.jpg' },
    { t: 'Over-shoulder', f: 'over-the-shoulder shot, classic dialogue angle', img: '/axis-options/framing--over-shoulder.jpg' },
    { t: 'Low-angle power', f: 'low-angle shot from below eye-line, heroic scale', img: '/axis-options/framing--low-angle-power.jpg' },
    { t: 'Top-down geometry', f: 'pure overhead top-down shot, graphic shapes', img: '/axis-options/framing--top-down-geometry.jpg' },
    { t: 'Dutch tilt', f: 'dutch tilt, tension in the tilted frame', img: '/axis-options/framing--dutch-tilt.jpg' },
    { t: 'Negative-space wide', f: 'wide shot with vast negative space, subject tiny and isolated', img: '/axis-options/framing--negative-space-wide.jpg' },
    { t: 'Through obstruction', f: 'shot through a foreground obstruction, voyeuristic candid layer', img: '/axis-options/framing--through-obstruction.jpg' },
    { t: 'Tracking', f: 'dynamic tracking shot alongside the subject', img: '/axis-options/framing--tracking.jpg' }
  ]},
  { key: 'camera', name: 'Camera Body', max: 1, tokens: catTokens('Camera Body') },
  { key: 'focal', name: 'Focal Length', max: 1, tokens: catTokens('Focal Length') },
  { key: 'lenstype', name: 'Lens Type', max: 1, tokens: catTokens('Lens Type') },
  { key: 'filmstock', name: 'Film Stock', max: 1, tokens: catTokens('Film Stock') },
  { key: 'lightsource', name: 'Light Source', max: 2, tokens: catTokens('Lighting Source') },
  { key: 'lightstyle', name: 'Light Style', max: 1, tokens: catTokens('Lighting Style') },
  { key: 'atmosphere', name: 'Atmosphere', max: 2, tokens: catTokens('Atmosphere') },
  { key: 'look', name: 'Look & Feel', max: 1, tokens: catTokens('Look & Feel') },
  { key: 'filter', name: 'Filter / Effect', max: 2, tokens: catTokens('Filter / Effect') },
  { key: 'aspect', name: 'Aspect Ratio', max: 1, tokens: catTokens('Aspect Ratio') }
];

export const PRESETS = [
  { id: 'br2049', name: 'Blade Runner 2049', pick: { style: ['Cinematic', 'Photorealistic'], framing: ['Extreme wide'], camera: ['ARRI ALEXA 65'], lenstype: ['Anamorphic Cinema Lens'], lightsource: ['Neon Lights'], lightstyle: ['Low Key'], atmosphere: ['Moody'], look: ['Blade Runner 2049'], filter: ['Fog/Haze'], aspect: ['2.39:1 Anamorphic'] } },
  { id: 'goldenhour', name: 'Golden Hour Portrait', pick: { style: ['Cinematic', 'Photorealistic'], framing: ['Close-up'], focal: ['85mm Portrait Lens'], filmstock: ['Kodak Portra 400'], lightsource: ['Golden Hour'], lightstyle: ['Backlighting'], atmosphere: ['Romantic'], look: ['The Revenant'], filter: ['Halation'], aspect: ['16:9 HD'] } },
  { id: 'noir', name: 'Film Noir', pick: { style: ['Cinematic'], framing: ['Dutch tilt'], camera: ['35mm Film Camera'], filmstock: ['Ilford HP5 Plus'], lightsource: ['Practical Lights'], lightstyle: ['Chiaroscuro'], atmosphere: ['Mysterious'], look: ['Classic Film Noir'], filter: ['Heavy Film Grain'], aspect: ['4:3 Academy'] } },
  { id: 'cyberpunk', name: 'Cyberpunk Neon', pick: { style: ['Cinematic', 'Photorealistic'], framing: ['Tracking'], lenstype: ['Panavision C-Series Anamorphic'], filmstock: ['CineStill 800T'], lightsource: ['Neon Lights'], lightstyle: ['Rim / Edge Light'], atmosphere: ['Energetic'], look: ['Neon Noir'], filter: ['Rain Drops on Lens'], aspect: ['2.39:1 Anamorphic'] } },
  { id: 'verite', name: 'Documentary Vérité', pick: { style: ['Photorealistic'], framing: ['Through obstruction'], camera: ['16mm Film Camera'], focal: ['50mm Normal'], lightsource: ['Overcast Diffused'], lightstyle: ['Motivated Lighting'], atmosphere: ['Gritty'], filter: ['Film Grain'], aspect: ['16:9 HD'] } },
  { id: 'anderson', name: 'Wes Anderson', pick: { style: ['Cinematic'], framing: ['Medium'], focal: ['40mm Standard'], filmstock: ['Kodak Portra 160'], lightsource: ['Window Light'], lightstyle: ['High Key'], atmosphere: ['Whimsical'], look: ['Wes Anderson'], aspect: ['4:3 Academy'] } },
  { id: 'mythic', name: 'Mythic Firelight', pick: { style: ['Oil Painting'], framing: ['Over-shoulder'], lenstype: ['Anamorphic Cinema Lens'], lightsource: ['Firelight', 'Torchlight'], lightstyle: ['Chiaroscuro'], atmosphere: ['Epic'], look: ['Dune'], filter: ['God Rays'], aspect: ['2.39:1 Anamorphic'] } }
];

// formula assembly — grammar-based, no AI.
// overrides: per-axis fragment text edited in the SECTIONS view, wins over the formula.
export function assemblePrompt(subject, environment, picks, overrides = {}) {
  const frag = key => {
    let f;
    if (overrides[key] != null) f = overrides[key].trim();
    else {
      const ax = AXES.find(a => a.key === key);
      const sel = picks[key] || [];
      f = sel.map(t => (ax.tokens.find(x => x.t === t) || {}).f).filter(Boolean).join(', ');
    }
    // strip any trailing period: the assembler supplies its own grammar ('. ', ', ', final '.').
    // A fragment ending in '.' otherwise produced "…vertical lines. of a woman walking".
    return f.replace(/[.\s]+$/, '');
  };
  let p = frag('style') ? capitalize(frag('style')) + ' of ' + (subject || 'the subject') : 'Create an image of ' + (subject || 'the subject');
  if (environment && environment.trim()) p += ', set in ' + environment.trim();
  if (frag('framing')) p += '. ' + capitalize(frag('framing'));
  if (frag('camera')) p += '. ' + capitalize(frag('camera'));
  if (frag('focal')) p += ', ' + frag('focal');
  if (frag('lenstype')) p += ', ' + frag('lenstype');
  if (frag('filmstock')) p += '. ' + capitalize(frag('filmstock'));
  if (frag('lightsource')) p += '. ' + capitalize(frag('lightsource'));
  if (frag('lightstyle')) p += ', ' + frag('lightstyle');
  if (frag('atmosphere')) p += '. ' + capitalize(frag('atmosphere'));
  if (frag('look')) p += '. ' + capitalize(frag('look'));
  if (frag('filter')) p += '. ' + capitalize(frag('filter'));
  if (frag('aspect')) p += '. ' + capitalize(frag('aspect'));
  return p.replace(/\s+/g, ' ').replace(/\.\s*\./g, '.').trim() + '.';
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// entity types for asset management — stored as meta.kind in the .meta.md sidecar
// design law: kinds are monochrome — the icon differentiates, the neon accent marks the active one
export const ASSET_KINDS = [
  { id: 'reference', label: 'Reference', icon: '◈', color: 'var(--fg-soft)' },
  { id: 'talent', label: 'Talent', icon: '👤', color: 'var(--fg-soft)' },
  { id: 'location', label: 'Location', icon: '⌖', color: 'var(--fg-soft)' },
  { id: 'prop', label: 'Prop', icon: '◻', color: 'var(--fg-soft)' },
  { id: 'wardrobe', label: 'Wardrobe', icon: '⧉', color: 'var(--fg-soft)' },
  { id: 'style', label: 'Style', icon: '✦', color: 'var(--fg-soft)' }
];
export const kindDef = id => ASSET_KINDS.find(k => k.id === id) || null;

// Labels are LOWERCASE because the handover design writes them that way — "done", "generating",
// "review" — and the status pill is the one chip in the list that is NOT a shouted label. Do not
// re-uppercase them; the design frame is the source of truth here.
export const SHOT_STATUS = {
  todo: { label: 'to do', fg: 'var(--fg-muted)', bd: 'var(--border-2)' },
  generating: { label: 'generating', fg: 'var(--accent)', bd: 'var(--accent-35)' },
  review: { label: 'review', fg: 'var(--fg)', bd: 'color-mix(in srgb, var(--fg) 40%, transparent)' },
  done: { label: 'done', fg: 'var(--ok)', bd: 'color-mix(in srgb, var(--ok) 45%, transparent)' }
};
export const SHOT_TYPES = ['Wide', 'Medium', 'CU', 'OTS', 'Insert', 'Tracking', 'Drone', 'Macro'];
// stable shade per skill name — neutrals + the neon accent only (strict palette)
const SKILL_HUES = ['var(--accent)', 'var(--fg-soft)', 'var(--fg-muted)'];
export function skillColor(name) {
  if (!name) return 'var(--fg-faint)';
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return SKILL_HUES[Math.abs(h) % SKILL_HUES.length];
}
