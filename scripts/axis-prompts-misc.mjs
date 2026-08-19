// Repairs for thumbnails that were provably wrong — not a redesign of the axes that already work.
//
// HOW THESE WERE FOUND: md5 over public/axis-options/ turned up 23 groups of byte-identical
// files reused across unrelated axes (focal-length--85mm WAS atmosphere--lonely; style--3d-render
// WAS aspect-ratio--9-16). A sync had duplicated one file into several tokens. For each collision
// the copy that matches its own axis's established pattern is kept and the impostor is rebuilt
// here; a handful of visually off-pattern strays found by eye are included too.
//
// Every prompt below reproduces the pattern its axis ALREADY uses, because those patterns are
// good — one subject, one variable. The point is to make the broken tiles rejoin their axis, not
// to invent a new look for them.

const REALISM = 'photorealistic, no text, no watermark, no border, no split-screen, single frame';

// ── the per-axis constants, transcribed from the surviving tiles ─────────────

// Style: a still life on a windowsill — red apple, small white ceramic camera, potted plant.
const STILL_LIFE =
  'a still life on a bright windowsill: a red apple, a small white ceramic camera, and a potted ' +
  'green plant in a pale ceramic pot, teal and cream colour accents, soft daylight from the window';

// Look & Feel / Filter / Aspect: a photographer in silhouette behind a tripod on a rooftop.
const SILHOUETTE =
  'the dark silhouette of a photographer standing behind a tripod-mounted camera on a rooftop, ' +
  'seen from behind, looking out over a distant city skyline at dusk';

// Atmosphere: a lone figure in a red raincoat, back to camera, above a city.
const RED_COAT =
  'a lone figure in a red raincoat seen from behind, standing on a wet rooftop parapet ' +
  'overlooking a wide city skyline';

// Lighting Style: a young man beside a tripod-mounted camera in a dark studio.
const OPERATOR =
  'a young man in a plain t-shirt standing beside a tripod-mounted cinema camera in a dark studio, ' +
  'medium shot, resting one arm on the camera, calm neutral expression';

// Film Stock: the physical roll, canister plus unspooled strip, on a dark reflective surface.
const CANISTER = (colour, frames) => ({
  axis: 'film-stock',
  prompt:
    `${REALISM}. Product photograph of a single 35mm film canister standing upright with its ` +
    `unspooled film strip curling around it on a dark reflective surface, studio lit, dark ` +
    `background. The canister label is ${colour}. The visible frames on the strip show ${frames}. ` +
    `Centred, clean, catalogue product shot.`
});

// Lighting Source: the light-emitting object itself, alone in a dark room.
const SOURCE = (what) => ({
  axis: 'lighting-source',
  prompt:
    `${REALISM}. ${what} Alone in a dark empty room, the light source itself is the subject and is ` +
    `clearly visible, dramatic dark background, no people.`
});

const style = (look) => ({ axis: 'style', prompt: `${REALISM}. ${STILL_LIFE}, rendered as ${look}` });
const look = (grade) => ({ axis: 'look-and-feel', prompt: `${REALISM}. ${SILHOUETTE}. Colour grade and mood: ${grade}` });
const atmo = (mood) => ({ axis: 'atmosphere', prompt: `${REALISM}. ${RED_COAT}. The mood is ${mood}` });
const lightStyle = (scheme) => ({ axis: 'lighting-style', prompt: `${REALISM}. ${OPERATOR}. Lighting scheme: ${scheme}` });
const filter = (fx) => ({ axis: 'filter-effect', prompt: `${REALISM}. ${SILHOUETTE}. The image visibly exhibits this effect: ${fx}` });

export const MISC = {
  // ── Style — were: a leaked portrait and an off-pattern city scene ──────────
  '3D Render': style('a polished 3D CGI render — smooth subdivided surfaces, perfect ambient occlusion, volumetric studio lighting, Octane raytraced look, slightly hyperreal plastic materials.'),
  'Photorealistic': style('a straight photorealistic photograph — natural light, true colour, fine surface texture in the apple skin and ceramic glaze, shallow depth of field, no stylisation whatsoever.'),

  // ── Look & Feel — were: a lens barrel, two leaked portraits, a beach, lasers ──
  'Her': look('warm blush and coral tones, soft hazy diffusion, gentle low-contrast pastel warmth, intimate and tender, red and cream dominant.'),
  'Interstellar': look('desaturated cool naturalism, dusty greys and pale blues, enormous scale, quiet awe, soft natural light, muted earthy palette.'),
  'Sicario': look('arid dusk over a desert horizon, harsh amber and deep teal shadows, dust in the air, tense and ominous, high contrast silhouettes against a bruised sky.'),
  'The Dark Knight': look('cold steel blue and sodium orange city night, hard clean contrast, sober and severe, glassy modern skyline, no warmth in the shadows.'),
  'Joker': look('sickly green and warm amber, grimy urban decay, heavy grain, unstable and unsettling, 1980s city rot.'),
  'Amelie': look('saturated emerald green and rich golden red, warm nostalgic storybook glow, slightly heightened and whimsical, deep greens in the shadows.'),

  // ── Atmosphere — were: two lens barrels and a leaked portrait ──────────────
  'Lonely': atmo('lonely and isolated — vast empty grey space around a very small figure, flat cold overcast light, muted desaturated palette, profound emptiness.'),
  'Ominous': atmo('ominous and threatening — heavy black storm clouds massing over the skyline, sickly dark green-grey light, deep shadow, a sense of dread approaching.'),
  'Romantic': atmo('romantic and tender — warm golden dusk light, soft pink and amber sky, gentle haze, glowing window lights, intimate and hopeful.'),

  // ── Film Stock — were: a living room, a city scene, a blank white panel ────
  'AGFA Vista 200': CANISTER('red and white AGFA Vista 200 branding', 'punchy saturated everyday snapshots with strong reds and cool blue skies'),
  'Fuji Acros 100': CANISTER('black and white FUJIFILM ACROS 100 branding', 'fine-grained black and white frames with deep blacks and smooth clean greys'),
  'Kodak T-MAX 400': CANISTER('black and yellow KODAK T-MAX 400 branding', 'sharp black and white frames with crisp neutral tonality and fine grain'),

  // ── Lighting Source — were: a city scene, two leaked portraits, a canister ──
  'Candlelight': SOURCE('A cluster of lit candles on a dark wooden table, warm flickering orange flames, soft pooled glow falling off fast into blackness.'),
  'Fluorescent': SOURCE('A bank of bare fluorescent tube lights mounted on a ceiling, cold green-cyan flat institutional light, faint flicker.'),
  'Harsh Midday Sun': SOURCE('A blazing white midday sun high in a cloudless sky above a bare sunlit concrete wall, throwing a hard black razor-edged shadow.'),
  'Studio Softbox': SOURCE('A large rectangular studio softbox on a light stand, glowing an even soft white, its diffusion panel facing the camera.'),

  // ── Lighting Style — were: a lens barrel and a bare torch ──────────────────
  'Backlighting': lightStyle('strong backlight placed directly behind him, his figure rimmed in bright light and rendered nearly as a silhouette, glowing halo through his hair, face in shadow.'),
  'Broad Lighting': lightStyle('broad lighting — the key light falls on the side of his face turned toward camera, making the lit cheek wide and dominant, shadow falling on the far side.'),

  // ── Filter / Effect — were: two city scenes and a pastel building ──────────
  'Lens Flare': filter('bright streaking lens flare — polygonal ghosts and a long horizontal streak lancing across the frame from a light source at the edge, veiling glare.'),
  'Film Grain': filter('visible photochemical film grain across the whole frame, fine texture in the sky and shadows, organic analogue emulsion look.'),
  'Black Pro Mist': filter('a Black Pro Mist diffusion filter — highlights bloom into soft haloes, blacks lifted and milky, gentle overall glow while detail stays sharp.')
};

// Aspect Ratio is handled by gen-aspect.mjs, not here: one generated scene, deterministically
// cropped to each ratio and padded into the square tile. Asking a diffusion model to draw exact
// letterbox bars is a coin flip; ffmpeg gets the geometry right every time, and the pixels inside
// the bars are still a real generated photograph.
export const ASPECT_SCENE =
  `${REALISM}. ${SILHOUETTE}, dramatic orange and deep blue dusk sky, still water reflecting the ` +
  `skyline, wide cinematic composition, the figure and tripod centred.`;

export const ASPECT_RATIOS = {
  '1:1 Square': 1,
  '1.66:1 European': 1.66,
  '9:16 Vertical': 9 / 16
};
