// Export FrameForge's prompt vocabularies as one JSON file, for the standalone prompt-builder app.
//
// WHY THIS EXISTS. The companion app's agent needs the same angles, camera moves, style axes and
// look presets this app already has — 12 + 20 + 245 + 7 entries, each with its prompt fragment and,
// where one exists, its thumbnail. Retyping any of that into a second codebase would create exactly
// the second source of truth CLAUDE.md forbids, and it would be stale within a week. So the other
// app consumes a GENERATED artifact and this script is the generator.
//
// Nothing here declares a token. Every value is read from the module that already owns it:
//   angles       frontend/models.js         AXES, key 'framing'
//   style axes   frontend/models.js         AXES, everything else
//   look presets frontend/models.js         PRESETS
//   moves        frontend/cameraMovements.js
//   quick sets   frontend/sequence.js       QUICK_ANGLES / QUICK_MOVES
//   rules        frontend/sequence.js       words-per-second, cut budget, micro-behaviour
//
// Run:  node scripts/export-prompt-catalog.mjs
// Out:  docs/specs/prompt-builder-standalone/catalog.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AXES, PRESETS } from '../frontend/models.js';
import { CAMERA_MOVEMENTS, MOVE_SPEEDS, MOVE_STABILIZATIONS, MOVE_CATEGORIES } from '../frontend/cameraMovements.js';
import { QUICK_ANGLES, QUICK_MOVES, WORDS_PER_SECOND, CUT_BUDGET_SOFT, MICRO_BEHAVIOUR } from '../frontend/sequence.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'docs/specs/prompt-builder-standalone/catalog.json');

const angleAxis = AXES.find(a => a.key === 'framing') || { tokens: [] };

const catalog = {
  _: 'Generated from FrameForge source. Do NOT hand-edit — regenerate with scripts/export-prompt-catalog.mjs.',
  generated_from: {
    angles: 'frontend/models.js AXES.framing',
    moves: 'frontend/cameraMovements.js',
    looks: 'frontend/models.js PRESETS',
    style_axes: 'frontend/models.js AXES (all but framing)'
  },
  // Thumbnails are served as static files by this app. The companion app can hotlink them rather
  // than shipping its own copies — 245 style tokens' worth of images is not worth duplicating.
  thumbnail_base: 'https://<frameforge-host>/axis-options/',

  angles: angleAxis.tokens.map(t => ({ name: t.t, fragment: t.f, description: t.d || null, thumb: t.img })),
  quick_angles: QUICK_ANGLES,

  moves: CAMERA_MOVEMENTS.map(m => ({
    id: m.id, name: m.name, category: m.category,
    // `direction` is the SHORT form a per-shot CAMERA line uses; `fragment` is the full paragraph,
    // correct for a clip-level move and far too long to repeat per shot.
    direction: m.directionLabel, description: m.description, fragment: m.promptFragment
  })),
  quick_moves: QUICK_MOVES,
  move_categories: MOVE_CATEGORIES,
  move_speeds: MOVE_SPEEDS,
  move_stabilizations: MOVE_STABILIZATIONS,

  look_presets: PRESETS.map(p => ({ id: p.id, name: p.name, picks: p.pick })),
  style_axes: AXES.filter(a => a.key !== 'framing').map(a => ({
    key: a.key, name: a.name, max: a.max,
    tokens: a.tokens.map(t => ({ name: t.t, fragment: t.f, thumb: t.img || null }))
  })),

  rules: {
    words_per_second: WORDS_PER_SECOND,
    soft_cut_budget: CUT_BUDGET_SOFT,
    micro_behaviour_block: MICRO_BEHAVIOUR,
    authoring_fps: 24
  }
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2) + '\n');

const styleTokens = catalog.style_axes.reduce((a, x) => a + x.tokens.length, 0);
console.log(
  `[export-prompt-catalog] ${catalog.angles.length} angles · ${catalog.moves.length} moves · `
  + `${styleTokens} style tokens across ${catalog.style_axes.length} axes · ${catalog.look_presets.length} look presets`
);
console.log('→ ' + path.relative(root, OUT));
