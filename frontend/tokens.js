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
};

export const ACCENT = TOKENS.accent;
export const MONO = "'Spline Sans Mono',monospace";
