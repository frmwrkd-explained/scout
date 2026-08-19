// Starter quick-snippets — the canned phrases a working director/DP retypes twenty times
// a day, shipped so the /trigger expansion feature has something to expand on day one.
//
// Two shapes live in here and the difference is deliberate:
//   · LOOK FRAGMENTS (group b) end WITHOUT terminal punctuation. They get appended mid-prompt
//     next to other axis fragments, and a stray period breaks the assembler's grammar the same
//     way it does in assemblePrompt() — which is why that function strips trailing periods.
//   · Everything else (re-roll notes, camera moves, continuity anchors, guardrails) is a
//     complete directive instruction that stands alone in a note field, so it keeps its
//     sentences and its full stops.
//
// The look fragments are lifted from the `f` strings in frontend/cinematicOptions.js and the
// camera moves from CAMERA_MOVEMENTS[].promptFragment in frontend/cameraMovements.js, so the
// snippets speak the exact vocabulary the rest of the app already emits — a user who mixes a
// snippet into a builder-assembled prompt gets one consistent voice, not two dialects.
//
// Order matters: the installer derives a stable ordinal filename prefix from array position,
// so re-seeding an existing root is idempotent and the Settings list keeps a curated order
// instead of the arbitrary one Date.now() filenames would produce. Append new entries at the
// end of a group rather than inserting, or existing files orphan under their old ordinal.
export const STARTER_SNIPPETS = [
  // ── re-roll / fix notes: corrective instructions fed to the prompt rewrite ──
  { name: 'Kill The Camera Drift', trigger: 'kill-drift',
    content: 'Lock the camera off completely and kill all drift. Do not pan, tilt, zoom, dolly or reframe — the composition holds from first frame to last, and any motion comes from the subject or the environment only.' },
  { name: 'Halve The Move Speed', trigger: 'half-speed',
    content: 'Halve the speed of the camera move and hold the horizon dead level throughout. The movement should read slow and deliberate, letting the frame breathe instead of racing through it.' },
  { name: 'Change Environment Only', trigger: 'same-subject',
    content: "Keep the subject's face, hair, build and wardrobe identical to the previous version. Change only the environment around them — nothing about the person is up for reinterpretation." },
  { name: 'Strip Text And Signage', trigger: 'clean-plate',
    content: 'Remove all text, watermarks, captions, subtitles, logos and background signage. Signs, screens and packaging stay blank rather than being replaced with invented lettering.' },
  { name: 'Open Up The Shadows', trigger: 'lift-shadows',
    content: 'Open up the shadows and recover detail in the darkest areas without lifting the black point. Contrast and the deepest blacks stay exactly where they are.' },
  { name: 'Reframe Wider With Headroom', trigger: 'more-headroom',
    content: 'Reframe wider and give the subject more headroom. Do not crop the top of the head, the hands or the feet out of frame.' },
  { name: 'Hold Focus On The Subject', trigger: 'hold-focus',
    content: "Hold critical focus on the subject's eyes for the entire take. No focus hunting, no rack to the background, no visible lens breathing." },

  // ── look fragments: appended to a prompt to pin a look, no terminal punctuation ──
  { name: 'Anamorphic Scope', trigger: 'scope',
    content: 'anamorphic lens with horizontal lens flares, oval bokeh and 2.39:1 widescreen characteristics' },
  { name: 'Golden Hour Backlight', trigger: 'golden-hour',
    content: 'golden hour warm sunlight with long shadows and orange glow, backlighting with the source behind the subject rimming every edge' },
  { name: 'Practical Neon In Haze', trigger: 'neon-haze',
    content: 'colorful neon lights with vibrant color casts and urban glow, practical lighting from visible in-scene fixtures, atmospheric fog haze diffusing every source' },
  { name: 'Chiaroscuro Low-Key', trigger: 'low-key',
    content: 'chiaroscuro lighting with strong contrast between light and dark areas, deep unlifted shadows holding most of the frame' },
  { name: 'Hard Rim Light', trigger: 'rim-light',
    content: 'rim lighting creating a hard glowing edge outline and clean separation from the background' },
  { name: 'Overcast Documentary', trigger: 'verite',
    content: 'soft overcast diffused light with even illumination and no harsh shadows, unstyled observational documentary framing' },
  { name: '35mm Grain And Halation', trigger: 'grain',
    content: 'film grain texture, organic analog noise, halation red glow bleeding out of the highlights' },
  { name: 'Macro Tactile Detail', trigger: 'macro',
    content: 'macro lens with extreme close-up detail and shallow depth of field, surface texture readable down to the fibre' },
  { name: 'Vast Negative Space', trigger: 'negative-space',
    content: 'wide shot with vast negative space, subject tiny and isolated against the emptiness' },
  { name: 'God Rays Through Haze', trigger: 'god-rays',
    content: 'god rays, volumetric light beams cutting through atmospheric haze' },

  // ── camera moves: motion instructions written the way video models actually obey them ──
  { name: 'Slow Push In', trigger: 'push-in',
    content: 'Dolly or push the entire camera forward toward the subject. This is physical camera travel, not a zoom — foreground and background shift with natural parallax as the shot tightens. The movement is slow and deliberate.' },
  { name: 'Locked Off Camera', trigger: 'locked-off',
    content: 'Keep the camera completely locked on a tripod or fixed virtual camera. Do not pan, tilt, zoom, dolly, drift, shake or reframe. The composition stays stable from first frame to last.' },
  { name: 'Tracking Alongside Subject', trigger: 'track-with',
    content: 'Move the entire camera laterally on a track, dolly, gimbal or slider, travelling alongside the subject at their pace. This is physical lateral travel, not a pan — foreground and background slide with visible parallax while the subject stays readable.' },
  { name: 'Crane Down To Subject', trigger: 'crane-down',
    content: 'Lower the camera on a crane, jib or boom arm. This is a physical descent through space, not a lens tilt — move from a high wide view down toward subject level and settle on a more intimate final frame.' },
  { name: 'Orbit Around Subject', trigger: 'orbit',
    content: 'Move the camera in a slow arc around the subject. The camera physically changes position on a curved path, keeping the subject as the anchor while the background rotates behind them with clear parallax.' },
  { name: 'Dolly Zoom Vertigo', trigger: 'dolly-zoom',
    content: 'Create a dolly zoom: move the camera physically in one direction while zooming the lens in the opposite direction. Keep the subject nearly the same size in frame while the background stretches and warps behind them.' },

  // ── continuity / identity: the discipline that keeps a character the same person shot to shot ──
  { name: 'Likeness Replication Anchor', trigger: 'likeness',
    content: "LIKENESS REPLICATION: the attached reference image defines this person's face, hair, skin tone, build and wardrobe exactly. Treat it as photographic ground truth, not as loose inspiration — reproduce the same individual, not a similar-looking one. Do not restyle, de-age, slim or reinterpret any feature." },
  { name: 'Same Location Continuity', trigger: 'same-place',
    content: 'Same location as the reference: identical architecture, set dressing, props, wall treatment and flooring. Only the camera position and the action change between shots.' },
  { name: 'Same Wardrobe Continuity', trigger: 'same-fit',
    content: 'Wardrobe is unchanged from the reference — same garments, same colours, same cut, same state of wear. No new layers, accessories or costume changes.' },
  { name: 'Same Time Of Day', trigger: 'same-time',
    content: 'Same time of day and same weather as the reference: identical sun angle, shadow direction, colour temperature and sky condition, so the shots cut together as one continuous scene.' },

  // ── negative guardrails: the failure modes worth naming explicitly every single time ──
  { name: 'No Warped Hands', trigger: 'no-hands',
    content: 'No warped or melted hands, no extra or missing fingers, no fused knuckles. Hands are anatomically correct with exactly five fingers each.' },
  { name: 'No Extra Limbs Or Clones', trigger: 'no-clones',
    content: 'No extra limbs, no duplicated people, no cloned faces in the background, no accidental twin of the main subject.' },
  { name: 'No Flare Into Lens', trigger: 'no-flare',
    content: 'No lens flare pointed into the camera, no starbursts on practicals, no bloom blowing out the highlights.' },
  { name: 'No Motion Blur Smear', trigger: 'no-smear',
    content: "No motion blur smearing across the subject. The subject's edges stay crisp and readable even while the camera or the action moves." },
  { name: 'No Text Or Logos', trigger: 'no-text',
    content: 'No text, captions, subtitles, watermarks, logos or signage anywhere in the frame.' }
];

// Mirror of cleanTrigger() in backend/index.mjs (POST/PATCH /api/snippets) — same charset, same
// case-folding, same 24-char cap. Duplicated rather than imported because index.mjs IS the express
// app: importing it from a seed module would stand up a server as a side effect of seeding.
// If the two ever drift, index.mjs is the original — follow it.
const cleanTrigger = t => String(t || '').toLowerCase().replace(/[^\w-]+/g, '').slice(0, 24);

// Stable ordinal filename: position in the array × 10, zero-padded so the plain lexicographic
// sort GET /api/snippets does keeps the curated order. Re-running the installer therefore hits
// the same filename for the same snippet instead of minting a Date.now() duplicate.
// The trigger is sanitised on the way in even though every literal in STARTER_SNIPPETS already
// matches ^[a-z0-9-]+$: that invariant is held only by the array above, and this value is
// interpolated straight into a filesystem path. Keeping the guard structural means a future
// entry with a slash, a dot or a NUL cannot escape the snippets dir the moment someone appends
// to the list without reading this comment.
export const starterFileName = (i, trigger) =>
  String((i + 1) * 10).padStart(3, '0') + '-' + (cleanTrigger(trigger) || 'snippet') + '.md';
