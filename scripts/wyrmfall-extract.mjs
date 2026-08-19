/* Extract the WYRMFALL bible out of the Greenlight showcase seed script.

   Source (read-only, another repo):
     ../Higgsfield App/greenlight-studio/app/scripts/showcase-wyrmfall.ts

   That file is the canonical definition of the project: 13 assets (5 cast, 4
   locations, 3 props… plus the Hall of Oaths), 34 shots, and the "Ash & Frost"
   style picks. Every shot description in it already carries the app's own
   @character: / @location: / @prop: mentions — which is exactly the thing the
   landing page was failing to show. There is no reason to invent titles or
   action lines when a fully-specified 34-shot breakdown already exists.

   ── Why parse rather than import ────────────────────────────────────────────
   The .ts file imports compileStyleFromPicks(), AssetKind and the shot-type
   library from that app's own lib/ — none of which resolve from here, and none
   of which are needed. The three things wanted (SHOWCASE_ASSETS, SHOWCASE_SHOTS,
   STYLE_*) are pure data literals, so each is sliced out by brace-matching and
   evaluated on its own. Brace-matching rather than a regex because the shot
   descriptions contain braces and quotes of their own.

   Output: scripts/.wyrmfall.json — consumed by seed-wyrmfall.mjs. Regenerate
   rather than hand-editing; this is derived data. */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const SRC = path.resolve(REPO, '..', 'Higgsfield App', 'greenlight-studio', 'app', 'scripts', 'showcase-wyrmfall.ts');
const OUT = path.join(HERE, '.wyrmfall.json');

if (!fs.existsSync(SRC)) {
  console.error(`\n  ✗ showcase-wyrmfall.ts not found at\n      ${SRC}\n`);
  process.exit(1);
}
const src = fs.readFileSync(SRC, 'utf8');

/* Slice the literal that follows `name` up to its matching close bracket.
   String-aware, so a `]` or `}` inside a description cannot end the slice. */
function literalAfter(name, open, close) {
  /* Anchor on the `=`, not on the name. `export const SHOWCASE_ASSETS:
     ShowcaseAsset[] = [...]` has a `[` inside the TYPE ANNOTATION, and scanning
     from the name found that `[]` first — an empty, perfectly balanced array.
     The extractor reported "0 assets, 0 shots" and was believed once. */
  const at = src.indexOf('export const ' + name);
  if (at < 0) throw new Error('not found: ' + name);
  const eq = src.indexOf('=', at);
  if (eq < 0) throw new Error('no assignment for ' + name);
  const start = src.indexOf(open, eq);
  if (start < 0) throw new Error('no ' + open + ' after ' + name);

  let depth = 0, quote = null, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (quote) {
      if (c === '\\') esc = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + open + ' for ' + name);
}

/* TS → JS: drop the type annotation on the declaration itself. The literals
   contain none, so nothing inside needs stripping. */
/* The literals reference a couple of module-level consts from the source file
   (`const RENDER = "cinematic-film"`). Rather than inline them here — which
   would be a second copy that silently goes stale — the small `const NAME =
   "value"` declarations are lifted straight out of the file and evaluated in
   the same scope as the literal. */
const consts = [...src.matchAll(/^const\s+([A-Z_][A-Z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*")\s*;?$/gm)]
  .map(m => `const ${m[1]} = ${m[2]};`).join('\n');

const evalLiteral = (name, open = '[', close = ']') =>
  new Function(consts + '\nreturn ' + literalAfter(name, open, close))();

const assets = evalLiteral('SHOWCASE_ASSETS');
const shots = evalLiteral('SHOWCASE_SHOTS');
const stylePicks = evalLiteral('STYLE_PICKS', '{', '}');

const str = name => {
  const m = new RegExp(name + '\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|`(?:[^`\\\\]|\\\\.)*`)', 's').exec(src);
  return m ? new Function('return ' + m[1])() : '';
};

/* every @mention used anywhere, so the seeder can prove each one resolves to a
   real asset instead of leaving a dangling tag in a prompt */
const mentions = new Set();
shots.forEach(s => {
  (String(s.description).match(/@(?:character|location|prop):[A-Za-z0-9_]+/g) || [])
    .forEach(m => mentions.add(m));
});

const slug = n => String(n).replace(/\s+/g, '_');
const known = new Set(assets.map(a => '@' + (a.assetKind === 'character' ? 'character' : a.assetKind) + ':' + slug(a.name)));
const dangling = [...mentions].filter(m => !known.has(m));

const out = {
  generated: new Date().toISOString().slice(0, 10),
  source: path.relative(path.resolve(REPO, '..'), SRC),
  style: {
    name: str('STYLE_NAME'),
    aspect: str('STYLE_ASPECT'),
    notes: str('STYLE_EXTRA_NOTES'),
    picks: stylePicks,
  },
  assets: assets.map(a => ({ id: a.id, name: a.name, kind: a.assetKind, description: a.description })),
  shots: shots.map(s => ({
    code: s.code, scene: s.scene, sceneTitle: s.sceneTitle, title: s.title,
    shotTypeId: s.shotTypeId, shotType: s.shotType,
    description: s.description, durationSeconds: s.durationSeconds,
    motion: s.motion || null,
  })),
  mentions: [...mentions].sort(),
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 1));

const byKind = out.assets.reduce((a, x) => ((a[x.kind] = (a[x.kind] || 0) + 1), a), {});
const scenes = [...new Set(out.shots.map(s => s.scene))];

console.log(`
  WYRMFALL bible extracted

    style      ${out.style.name}  ·  ${out.style.aspect}
    assets     ${out.assets.length}  (${Object.entries(byKind).map(([k, n]) => n + ' ' + k).join(' · ')})
    shots      ${out.shots.length}  across ${scenes.length} scenes
    with video ${out.shots.filter(s => s.motion).length}
    mentions   ${out.mentions.length} distinct${dangling.length ? `  ⚠ ${dangling.length} dangling: ` + dangling.join(', ') : '  — all resolve'}
    →          ${path.relative(REPO, OUT)}
`);
