// Design tokens for JS sinks that cannot resolve CSS variables —
// Three.js materials, canvas drawing, exported palette swatches.
// frontend/styles.css :root is the source of truth; this file mirrors it.
// Change both in the same commit — tests/phase-design-tokens.test.mjs
// fails if they drift. Everything else should use var(--x) instead.
export const TOKENS = {
  ink: '#0D0E11',
  surface: '#101115',
  'surface-2': '#14161B',
  raise: '#1C1F26',
  sunk: '#0A0B0E',
  void: '#0B0C0E',
  line: '#1B1E24',
  border: '#22252C',
  'border-2': '#2A2E36',
  'border-3': '#3A3F49',
  fg: '#ECEEF2',
  'fg-soft': '#C9CFD8',
  'fg-muted': '#9AA3AF',
  'fg-faint': '#7B8797',
  accent: '#E3FF32',
  'accent-hover': '#EEFF66',
  'accent-deep': '#B8CC28',
  'on-accent': '#141519',
  sand: '#C9CFD8',
  ok: '#3FCF8E',
  warn: '#F0B23A',
  danger: '#F05B54',
  // the running/marked blue — see the note in styles.css :root
  marked: '#5B9DFF',
  // which collection a thing belongs to — see the `--hue-*` note in styles.css :root
  'hue-red': '#FF7B72',
  'hue-orange': '#FF9A5C',
  'hue-amber': '#E8C547',
  'hue-green': '#8FD460',
  'hue-teal': '#3CCFCF',
  'hue-blue': '#8AA4FF',
  'hue-violet': '#B197FC',
  'hue-pink': '#F58BC0',
};

// The light set — mirrors `:root[data-theme="light"]` in styles.css, same rule, same commit.
// tests/phase-theme-contrast.test.mjs fails if these drift, and asserts every foreground /
// background pair here clears 4.5:1.
//
// TOKENS above stays the DARK set on purpose: it is what the existing JS sinks already read,
// and tests/phase-design-tokens.test.mjs asserts it mirrors the bare `:root` block name-for-name.
// A sink that needs the live theme should read the CSS variable, or `themeTokens()` below —
// never branch on the theme itself (docs/05_UI_SPEC.md §4).
export const LIGHT = {
  ink: '#FBFBFA',
  surface: '#FFFFFF',
  'surface-2': '#F6F6F4',
  raise: '#EFEFEC',
  sunk: '#F2F2EF',
  void: '#F4F4F1',
  line: '#E8E8E4',
  border: '#DEDEDA',
  'border-2': '#D1D1CC',
  'border-3': '#C4C4BE',
  fg: '#1A1B1E',
  'fg-soft': '#3C3F45',
  'fg-muted': '#565A61',
  'fg-faint': '#676C75',
  accent: '#3D4A00',
  'accent-hover': '#2E3800',
  'accent-deep': '#55671A',
  'on-accent': '#F4FFC0',
  sand: '#3C3F45',
  ok: '#127C4F',
  warn: '#916200',
  danger: '#B3322C',
  marked: '#2E5FCC',
  'hue-red': '#B4321F',
  'hue-orange': '#A34A00',
  'hue-amber': '#7A5C00',
  'hue-green': '#3A7212',
  'hue-teal': '#0B7273',
  'hue-blue': '#2B5FC7',
  'hue-violet': '#6B46C1',
  'hue-pink': '#B02A72',
};

// The dark set under its own name, so a reader of this file does not have to know that the
// unqualified `TOKENS` means "dark". TOKENS is kept as the export everything already imports.
export const DARK = TOKENS;

// For the few JS sinks that paint their own pixels (canvas, Three.js, an exported swatch) and
// therefore cannot resolve var(--x). Pass the resolved theme from `theme.js` — do not sniff it.
export function themeTokens(theme) { return theme === 'light' ? LIGHT : DARK; }

export const ACCENT = TOKENS.accent;
export const MONO = "'Spline Sans Mono',monospace";
