// Light/dark — the acceptance criterion for docs/05_UI_SPEC.md §4.
//
// "Every pair must clear 4.5:1; a test asserts it." This is that test. It reads the two token
// blocks OUT OF styles.css (not out of a copy in this file — a test that asserts against its own
// constants proves nothing), composites the accent alpha steps over each ground the way a browser
// does, and computes WCAG 2.x relative luminance properly. No eyeballing, no hard-coded ratios.
//
// It also guards the two ways this can rot:
//   · a token that exists in dark and not in light, which would fall back to the dark value on a
//     white page and be invisible;
//   · frontend/tokens.js LIGHT drifting from the block it mirrors (the dark half of that guard is
//     tests/phase-design-tokens.test.mjs; this is the other half).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TOKENS, LIGHT } from '../frontend/tokens.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const css = readFileSync(join(root, 'frontend/styles.css'), 'utf8');

// ── read the two blocks out of the stylesheet ───────────────────────────────────────────────
// Neither block nests braces, so the first '}' after the selector closes it. If that ever stops
// being true this throws rather than silently reading half a block.
function block(selector) {
  const i = css.indexOf(selector);
  assert.ok(i >= 0, `styles.css has no "${selector}" block`);
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  assert.ok(open > 0 && close > open, `"${selector}" block is malformed`);
  const body = css.slice(open + 1, close);
  assert.ok(!body.includes('{'), `"${selector}" block contains a nested rule — the parser here assumes it does not`);
  return body;
}

function parse(body) {
  const out = {};
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6}|rgba?\([^)]*\))/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

const DARK = parse(block(':root{'));
const LIGHT_CSS = parse(block(':root[data-theme="light"]'));

// ── colour maths — WCAG 2.x, sRGB ───────────────────────────────────────────────────────────
function toRgb(value) {
  const v = String(value).trim();
  if (v.startsWith('#')) {
    const n = v.slice(1);
    return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16));
  }
  const m = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]*)\s*)?\)$/);
  assert.ok(m, `cannot parse colour "${v}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function alphaOf(value) {
  const m = String(value).match(/^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]*)\s*\)$/);
  return m ? Number(m[1]) : 1;
}
// Source-over compositing, exactly what the browser does when a translucent bed sits on a ground.
function over(fg, alpha, bg) { return fg.map((c, i) => alpha * c + (1 - alpha) * bg[i]); }

// WCAG 2.x relative luminance. The 0.03928 knee and the 2.4 exponent are the specified values —
// do not "simplify" this to (c/255)^2.2, which passes pairs that fail in a browser.
function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance([r, g, b]) { return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b); }
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

// Sanity: the maths itself, against the two ratios everybody knows.
test('the luminance implementation is the WCAG one', () => {
  assert.equal(Math.round(contrast([0, 0, 0], [255, 255, 255]) * 100) / 100, 21);
  assert.equal(contrast([255, 255, 255], [255, 255, 255]), 1);
  // #767676 on white is the canonical 4.54:1 example from the WCAG techniques
  assert.ok(Math.abs(contrast(toRgb('#767676'), toRgb('#FFFFFF')) - 4.54) < 0.02);
});

// ── the pair table ──────────────────────────────────────────────────────────────────────────
// Roles, not a cartesian product of everything — a pair is here because the app actually renders
// it (docs/DESIGN.md "Tokens" + frontend/ui.jsx's variants are the source):
//   · any text register on any surface step;
//   · accent / fg / fg-soft on the two accent WASH steps, composited over each surface — the
//     `--accent-12` chip bed with accent text is Btn's busy state, `--accent-05` its secondary;
//   · --on-accent on each of the three solid accent steps (Btn primary, its hover, its pressed).
// --accent-35 / --accent-60 are BORDER steps, never a text bed, so they are not pairs. Neither
// theme's border steps clear 4.5:1 against their ground and they are not required to — asserting
// it would be asserting something false about both.
const GROUNDS = ['ink', 'surface', 'surface-2', 'raise', 'sunk', 'void'];
const TEXTS = ['fg', 'fg-soft', 'fg-muted', 'fg-faint', 'sand', 'accent', 'accent-hover', 'accent-deep', 'ok', 'warn', 'danger', 'marked'];
const WASHES = ['accent-05', 'accent-12'];
const ON_WASH = ['accent', 'fg', 'fg-soft'];
const FILLS = ['accent', 'accent-hover', 'accent-deep'];
const AA = 4.5;

function pairs(tok) {
  const c = k => { assert.ok(tok[k], `missing token --${k}`); return toRgb(tok[k]); };
  const out = [];
  for (const bg of GROUNDS) for (const fg of TEXTS) out.push([`${fg} on ${bg}`, c(fg), c(bg)]);
  for (const bg of GROUNDS) {
    for (const wash of WASHES) {
      const bed = over(c(wash), alphaOf(tok[wash]), c(bg));
      for (const fg of ON_WASH) out.push([`${fg} on ${wash} over ${bg}`, c(fg), bed]);
    }
  }
  for (const fill of FILLS) out.push([`on-accent on ${fill}`, c('on-accent'), c(fill)]);
  return out;
}

function assertAA(name, tok) {
  const rows = pairs(tok).map(([label, fg, bg]) => [label, contrast(fg, bg)]);
  const failures = rows.filter(([, r]) => r < AA)
    .map(([label, r]) => `  ${r.toFixed(2)}:1  ${label}`);
  assert.equal(
    failures.length, 0,
    `${name}: ${failures.length} of ${rows.length} pairs are below ${AA}:1 —\n${failures.join('\n')}`
  );
  return rows.sort((a, b) => a[1] - b[1])[0]; // the worst pair, for the message below
}

test('every foreground/background pair clears 4.5:1 — DARK', () => {
  const [label, ratio] = assertAA('dark', DARK);
  assert.ok(ratio >= AA, `${label} ${ratio}`);
  // Recorded, not asserted tightly: --fg-faint on --raise is the designed floor (docs/DESIGN.md
  // says so in as many words). If this drops it is a real regression, not a rounding change.
  assert.ok(ratio < 5, `the dark floor moved — worst pair is now ${label} at ${ratio.toFixed(2)}:1, which is suspiciously comfortable; check nothing was dropped from the pair table`);
});

test('every foreground/background pair clears 4.5:1 — LIGHT', () => {
  const [label, ratio] = assertAA('light', LIGHT_CSS);
  assert.ok(ratio >= AA, `${label} ${ratio}`);
});

// ── structure ───────────────────────────────────────────────────────────────────────────────

test('light declares every token dark declares — no silent fallback to a dark value', () => {
  const missing = Object.keys(DARK).filter(k => !LIGHT_CSS[k]);
  assert.deepEqual(missing, [], `these tokens have no light value and would render their DARK value on a white page: ${missing.join(', ')}`);
  const extra = Object.keys(LIGHT_CSS).filter(k => !DARK[k]);
  assert.deepEqual(extra, [], `light declares tokens dark does not: ${extra.join(', ')}`);
});

test('light has four accent alpha steps and only four, all on the light accent hue', () => {
  const steps = Object.keys(LIGHT_CSS).filter(k => /^accent-\d+$/.test(k)).sort();
  assert.deepEqual(steps, ['accent-05', 'accent-12', 'accent-35', 'accent-60']);
  const hue = toRgb(LIGHT_CSS.accent).join(',');
  for (const s of steps) {
    assert.equal(toRgb(LIGHT_CSS[s]).join(','), hue, `--${s} is not the light accent ${LIGHT_CSS.accent}`);
    assert.equal(alphaOf(LIGHT_CSS[s]), Number('0.' + s.slice(-2)), `--${s} is not at the alpha its name claims`);
  }
  // the same four steps as dark, so the two themes stay one design and not two
  assert.deepEqual(steps, Object.keys(DARK).filter(k => /^accent-\d+$/.test(k)).sort());
});

test('the light accent is a deep olive with pale accent text on it, not acid green on white', () => {
  const accent = toRgb(LIGHT_CSS.accent);
  const white = toRgb(LIGHT_CSS.surface);
  assert.ok(luminance(accent) < 0.12, 'the light accent must be dark enough to carry pale text');
  assert.ok(contrast(accent, white) >= AA, 'the light accent must also work as text on the page');
  assert.ok(luminance(toRgb(LIGHT_CSS['on-accent'])) > 0.7, '--on-accent must be the pale half of the pair');
  // and it must be the SAME role re-tinted, not a second brand: the acid accent's hue angle
  // survives — green channel highest, blue channel lowest, in both themes.
  for (const tok of [DARK.accent, LIGHT_CSS.accent]) {
    const [r, g, b] = toRgb(tok);
    assert.ok(g > r && r > b, `${tok} is off the accent hue axis`);
  }
});

test('frontend/tokens.js LIGHT mirrors the stylesheet', () => {
  for (const [name, value] of Object.entries(LIGHT_CSS)) {
    if (!value.startsWith('#')) continue; // the alpha steps are derived, not mirrored
    assert.equal((LIGHT[name] || '').toUpperCase(), value.toUpperCase(), `--${name} drifted: css ${value} vs tokens.js ${LIGHT[name]}`);
  }
  for (const name of Object.keys(LIGHT)) {
    assert.ok(LIGHT_CSS[name], `tokens.js LIGHT has "${name}" but the light block does not`);
  }
  // and the dark half is still the dark half — a copy/paste of LIGHT over TOKENS would otherwise
  // pass tests/phase-design-tokens.test.mjs's name check and silently ship a white app.
  assert.notEqual(TOKENS.ink, LIGHT.ink);
});

// ── the switch itself ───────────────────────────────────────────────────────────────────────
// §4's other three requirements: follows the OS by default, ⌥⌘L toggles, the choice persists.
// theme.js touches nothing at import time, so the shims below are enough to run it for real —
// no jsdom, and no second implementation of it here to assert against.
test('theme.js follows the OS by default, toggles, and persists the choice', async () => {
  const attrs = {}, style = {};
  const mem = {};
  let osLight = true;
  globalThis.document = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: k => attrs[k] ?? null, style } };
  globalThis.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  globalThis.window = { matchMedia: () => ({ matches: osLight, addEventListener() {} }), addEventListener() {} };

  const t = await import('../frontend/theme.js');

  assert.equal(t.getTheme(), 'system', 'the default preference is to follow the OS');
  assert.equal(t.applyTheme(), 'light', 'a light machine gets a light app with no configuration');
  assert.equal(attrs['data-theme'], 'light', 'the resolved theme is stamped on <html> — never left absent');
  assert.equal(style.colorScheme, 'light', 'color-scheme is set, or the scrollbars stay dark on a white page');

  assert.equal(t.toggleTheme(), 'dark', '⌥⌘L flips what is on screen');
  assert.equal(t.getTheme(), 'dark', 'and commits it as an explicit preference');
  // the persistence case, and the reason applyTheme() defaults to the STORED preference rather
  // than to 'system': a boot that resets to system silently discards the person's choice
  assert.equal(t.applyTheme(), 'dark', 'a later boot re-applies the stored choice');

  osLight = false;
  assert.equal(t.resolveTheme('light'), 'light', 'an explicit choice ignores the OS');
  assert.equal(t.applyTheme('system'), 'dark', 'going back to system follows the OS again');
  assert.equal(t.applyTheme('nonsense'), 'dark', 'a junk stored value degrades to system, never throws');

  delete globalThis.document; delete globalThis.localStorage; delete globalThis.window;
});

// Comments are not code. A file that EXPLAINS why it must not ask the OS — which is exactly the
// note you want at the one call site that could get this wrong — was failing this guard for
// containing the words. Strip comments first: the rule is about what the bundle does, and a guard
// that punishes its own documentation gets deleted rather than obeyed.
function codeOnly(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');  // line comments, leaving `https://` alone
}

test('no component branches on theme — the attribute is the only switch', () => {
  const files = ['frontend/ui.jsx', 'frontend/cells.jsx', 'frontend/TableView.jsx', 'frontend/Inspector.jsx',
    'frontend/Rail.jsx', 'frontend/App.jsx', 'frontend/Files.jsx', 'frontend/Markdown.jsx'];
  for (const f of files) {
    let src;
    try { src = codeOnly(readFileSync(join(root, f), 'utf8')); } catch { continue; }
    assert.ok(!/\b(?:theme|isDark|isLight|darkMode)\b\s*===?\s*['"](?:light|dark)['"]/.test(src),
      `${f} branches on the theme — add a token instead (docs/05_UI_SPEC.md §4)`);
    assert.ok(!/prefers-color-scheme/.test(src), `${f} asks the OS directly — frontend/theme.js is the only place that does`);
  }
});
