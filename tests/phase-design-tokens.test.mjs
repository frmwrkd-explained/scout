// Guard: frontend/tokens.js must mirror frontend/styles.css :root exactly.
// styles.css is the source of truth; tokens.js exists only for JS sinks
// (Three.js, canvas) that cannot resolve var(--x).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TOKENS } from '../frontend/tokens.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const css = readFileSync(join(root, 'frontend/styles.css'), 'utf8');

// pull hex declarations out of the :root block
const rootBlock = css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{')));
const cssTokens = {};
for (const m of rootBlock.matchAll(/--([a-z0-9-]+):(#[0-9A-Fa-f]{6})/g)) {
  cssTokens[m[1]] = m[2].toUpperCase();
}

test('every hex token in styles.css :root is mirrored in tokens.js', () => {
  for (const [name, hex] of Object.entries(cssTokens)) {
    assert.equal((TOKENS[name] || '').toUpperCase(), hex, `--${name} drifted: css ${hex} vs tokens.js ${TOKENS[name]}`);
  }
});

test('tokens.js declares nothing styles.css does not', () => {
  for (const name of Object.keys(TOKENS)) {
    assert.ok(cssTokens[name], `tokens.js has "${name}" but styles.css :root does not`);
  }
});

test('accent alpha steps use the accent hue', () => {
  const rgb = TOKENS.accent.slice(1).match(/../g).map(h => parseInt(h, 16)).join(',');
  const steps = [...rootBlock.matchAll(/rgba\((\d+,\d+,\d+),/g)];
  for (const s of steps) {
    assert.equal(s[1], rgb, `alpha step rgba(${s[1]},…) does not match accent ${TOKENS.accent}`);
  }
});
