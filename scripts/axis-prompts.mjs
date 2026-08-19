// Prompt table for the axis-option thumbnails.
//
// DESIGN LAW — one variable per axis. A thumbnail's job is to teach the difference between
// its token and its neighbours, so everything except that token must be held constant. The
// catalog already proved this works: Look & Feel runs one photographer-on-a-rooftop silhouette
// across all 49 grades and you can read the grade instantly. Focal Length shipped 20 product
// shots of black lens barrels instead and taught nothing — a focal length is not a lens, it is
// what the lens does to a face.
//
// So Framing, Focal Length and Lens Type all share ONE character (generated once, then passed
// as a reference image to every call) in ONE location. Across an axis the only thing that moves
// is that axis's variable.

// The anchor. Deliberately plain — a neutral subject reads as a control, and any wardrobe or
// styling flourish would compete with the variable we are trying to show.
export const CHARACTER =
  'a woman in her late twenties, shoulder-length dark brown hair tucked behind one ear, ' +
  'plain heather-grey crew-neck t-shirt, calm neutral expression, minimal makeup, ' +
  'light olive skin, dark brown eyes';

export const LOCATION =
  'standing in the centre of a wide empty concrete civic plaza, low modern buildings and a row ' +
  'of bare trees far behind her, flat soft overcast midday daylight, muted desaturated palette';

export const CHARACTER_REF_PROMPT =
  `Neutral reference photograph of ${CHARACTER}. Head-and-shoulders, facing camera straight on, ` +
  `even soft frontal light, plain mid-grey seamless backdrop, sharp focus, no styling, ` +
  `documentary casting-call reference photo, shot on 50mm at f/5.6, natural undistorted proportions.`;

const REALISM = 'photorealistic, sharp, natural colour, no text, no watermark, no border, no split-screen, single frame';

// ── Focal Length ────────────────────────────────────────────────────────────
// Subject size is held ROUGHLY CONSTANT (head-and-shoulders) and the photographer walks
// backwards as the lens gets longer. That is the only comparison that isolates the two things a
// focal length actually changes: how the face is shaped, and how much world sits behind it.
// Short = bulging features + a vast deep background. Long = flattened features + a thin,
// dissolved background.
// Subject scale is stated as a hard, absolute crop rather than a relative "same portion of
// frame" — the first pass used the relative phrasing and the model drifted her between a small
// distant figure and a tight head shot, which destroys the comparison. If subject size is free
// to move, the viewer reads the size change and never notices the perspective change, which is
// the only thing the tile exists to teach.
const SCALE =
  'IDENTICAL TIGHT FRAMING IN EVERY VERSION: her head and shoulders fill the frame, the top of ' +
  'her head just below the top edge, her shoulders cropped by the bottom edge, eyes on the ' +
  'upper third. She is always this same size — only the lens changes.';

const focal = (mm, face, bg) => ({
  axis: 'focal-length',
  prompt:
    `${REALISM}. Portrait of ${CHARACTER}, ${LOCATION}. ${SCALE} ` +
    `Shot on a ${mm} lens from the distance that framing requires: ${face} ${bg} ` +
    `The ONLY difference from other focal lengths must be the ${mm} perspective rendering — ` +
    `face shape and how much background sits behind her — never her size in frame.`
});

export const FOCAL_LENGTH = {
  '8mm Ultra Wide': focal('8mm ultra-wide rectilinear',
    'extreme barrel distortion — the nose and forehead balloon enormously toward the lens, cheeks stretch outward, ears shrink and rake far back, the head is dramatically egg-shaped;',
    'the entire plaza, both distant building rows and a huge sweep of sky curve around her, everything sharp from her skin to the horizon.'),
  '12mm Ultra Wide': focal('12mm ultra-wide',
    'severe wide-angle distortion — nose and brow pushed markedly forward and enlarged, face noticeably stretched, ears pulled back;',
    'nearly the whole plaza and a broad band of sky visible behind her, deep sharpness throughout.'),
  '14mm Ultra Wide': focal('14mm ultra-wide',
    'strong wide-angle distortion, central features exaggerated forward, the head elongated;',
    'a very broad sweep of plaza and buildings behind her, everything in focus.'),
  '16mm Wide': focal('16mm wide',
    'clear wide-angle stretching of the face, nose enlarged relative to the ears;',
    'a broad environment behind her, both tree rows visible, deep focus.'),
  '18mm Wide Lens': focal('18mm wide',
    'mild facial elongation, nose still noticeably forward of the cheeks;',
    'a generous amount of plaza and building line behind her, near-total sharpness.'),
  '21mm Wide': focal('21mm wide',
    'slight nose enlargement, face only gently stretched;',
    'a wide slice of plaza behind her, background still crisp.'),
  '24mm Wide': focal('24mm wide',
    'faint wide-angle distortion, proportions close to natural but the nose still leads;',
    'a wide background context, buildings clearly legible, mostly sharp.'),
  '28mm Wide Lens': focal('28mm',
    'nearly natural facial proportions with only a trace of forward emphasis;',
    'plenty of plaza behind her, background sharp but starting to soften at the edges.'),
  '32mm Standard Lens': focal('32mm',
    'natural facial proportions, no visible distortion;',
    'a moderately wide background, buildings still readable, gentle falloff.'),
  '35mm Standard Lens': focal('35mm',
    'natural, true facial proportions — the documentary standard;',
    'a moderate slice of plaza behind her, background softening slightly.'),
  '40mm Standard': focal('40mm',
    'natural proportions matching human vision, neither stretched nor compressed;',
    'a balanced background, buildings soft but identifiable.'),
  '50mm Normal': focal('50mm normal',
    'perfectly neutral, true-to-life facial proportions — the reference standard;',
    'the background begins to narrow and blur gently, trees becoming soft shapes.'),
  '65mm Portrait Lens': focal('65mm',
    'features beginning to flatten pleasantly, face slightly broader and calmer;',
    'a narrower background slice, buildings dissolving into soft tone.'),
  '85mm Portrait Lens': focal('85mm portrait',
    'classic flattering portrait compression — features gently flattened, nose and ears on one visual plane;',
    'a narrow background slice rendered as creamy blur, trees now soft blobs.'),
  '100mm Portrait Lens': focal('100mm',
    'stronger compression, the face noticeably flat and broad, very flattering;',
    'a tight slice of background reduced to smooth blur, buildings unrecognisable.'),
  '135mm Telephoto': focal('135mm telephoto',
    'strong compression, facial planes pressed flat;',
    'the background collapsed into a soft wash of muted tone, no legible detail.'),
  '200mm Telephoto': focal('200mm telephoto',
    'heavy compression, the face rendered very flat and wide, depth almost gone from the features;',
    'the background an abstract blur of grey and green, entirely dissolved.'),
  '300mm Super Telephoto': focal('300mm super-telephoto',
    'extreme compression, facial depth flattened almost to a plane;',
    'the background a smooth featureless gradient, all structure gone.'),
  '400mm Super Telephoto': focal('400mm super-telephoto',
    'extreme compression with the face pressed completely flat;',
    'the background a totally abstract creamy wash of colour, plus faint atmospheric haze.'),
  '600mm Ultra Telephoto': focal('600mm ultra-telephoto',
    'maximum compression, the face flat and broad, stacked against the background with no sense of depth;',
    'the background a single smooth field of colour with visible heat shimmer and atmospheric haze.')
};

// ── Lens Type ───────────────────────────────────────────────────────────────
// Same subject again, but here the variable is the glass's OPTICAL SIGNATURE — flare shape,
// bokeh character, distortion, focus falloff. Not the barrel it is ground into.
// NOT the flat overcast plaza the other two axes use. The first pass put these on it and every
// tile came back identical, because optical character has nothing to act on without specular
// highlights: no point sources means no bokeh shape, no flare, no swirl, no glow. So Lens Type
// keeps the character and moves her to a night street full of small bright lights — the standard
// test scene for exactly this reason. The subject is still the constant; the glass is the variable.
const LENS_SCENE =
  'at night on a city street, a dense field of small bright out-of-focus point lights behind her — ' +
  'street lamps, shop signs, headlights, neon — wet asphalt reflecting them, dark surroundings';

const lens = (signature, framing = 'Medium close-up, she is sharp and centred.') => ({
  axis: 'lens-type',
  prompt:
    `${REALISM}. Portrait of ${CHARACTER}, ${LENS_SCENE}. ${framing} ` +
    `THE DEFINING FEATURE OF THIS IMAGE IS THE LENS'S OPTICAL SIGNATURE, rendered strongly and ` +
    `unmistakably: ${signature} ` +
    `Exaggerate this optical character so it is obvious at thumbnail size. ` +
    `Show what the glass DOES to the image — never the lens hardware itself.`
});

export const LENS_TYPE = {
  'Anamorphic Cinema Lens': lens('horizontal blue streak flares lancing across the frame, oval stretched bokeh, gentle edge squeeze, wide 2.39:1 cinematic rendering.'),
  'Cooke S4/i': lens('the warm gentle "Cooke look" — creamy forgiving skin rendering, soft rolloff into the background, smooth round bokeh, low contrast in the shadows.'),
  'Cooke Anamorphic/i': lens('warm skin tones combined with oval anamorphic bokeh and soft amber horizontal flare, gentle vintage anamorphic falloff.'),
  'Zeiss Master Prime': lens('clinical modern sharpness — extremely crisp micro-detail in skin and hair, very high contrast, neutral colour, perfectly round neutral bokeh.'),
  'Zeiss Supreme Prime': lens('clean modern sharpness with slightly warmer, softer skin rendering than clinical glass, smooth neutral bokeh, high but not harsh contrast.'),
  'Panavision Primo': lens('rich saturated cinema rendering, very even sharpness across the frame, neutral round bokeh, classic Hollywood polish.'),
  'Panavision C-Series Anamorphic': lens('vintage anamorphic character — pronounced blue horizontal flare, strongly oval bokeh, noticeable edge softness and barrel breathing, lower contrast.'),
  'Helios 44-2 Swirly Bokeh': lens('dramatic swirling bokeh spiralling around the subject at the frame edges, soft glowing low contrast, vintage Soviet rendering.'),
  'Canon K35': lens('warm golden vintage rendering, soft amber flare blooming from highlights, gentle halation around bright edges, creamy low-contrast falloff.'),
  'Leitz Summilux-C': lens('crisp centre sharpness with an elegant gentle falloff, neutral-cool colour, beautifully smooth creamy round bokeh.'),
  'Petzval Portrait Lens': lens('extreme swirling whirlpool bokeh spinning around a razor-sharp central subject, strong vignette, antique brass-lens rendering.'),
  // Three lenses whose signature IS a framing decision — a macro that stays at medium close-up
  // is just a portrait, so these override the shared framing rather than fight it.
  'Tilt-Shift Lens': lens(
    'a narrow diagonal band of sharp focus running across her eyes, everything above and below it — forehead, chin, shoulders, background — melting into strong smooth blur, the tilted plane of focus obvious.',
    'Medium close-up.'),
  'Macro Lens': lens(
    'life-size magnification — individual eyelashes, iris fibres and skin pores razor sharp, depth of field paper-thin so even the bridge of her nose is already blurred.',
    'EXTREME MACRO CLOSE-UP of one eye filling the entire frame.'),
  'Fisheye Lens': lens(
    'extreme circular fisheye barrel distortion — the whole scene bows outward into a bulging sphere, her face ballooning at the centre, the street bending into a curve, 180-degree field of view.',
    'Wide fisheye framing, her face centred and enlarged by the distortion.'),
  'Lensbaby Selective Focus': lens('a single small sweet-spot of sharpness on one eye with the rest smearing radially outward into painterly streaked blur.'),
  'Holga Plastic Lens': lens('soft dreamy plastic-lens rendering — heavy vignette, mushy corners, light leaks bleeding in from one edge, low contrast and colour shift.'),
  'Catadioptric Mirror Lens': lens('distinctive doughnut-shaped ring bokeh in every out-of-focus highlight, flat low contrast, heavy background compression.'),
  'Soft-Focus Portrait Lens': lens('a luminous glow blooming out of the highlights and across the skin, sharp underlying detail veiled in a soft halo, classic Hollywood beauty diffusion.'),
  'Voigtländer Nokton': lens('fast-lens rendering with a razor-thin plane of focus, gentle vintage glow around highlights, swirly-edged smooth bokeh.'),
  'ARRI Signature Prime': lens('modern cinema rendering — sharp but organic skin, very smooth natural falloff into large round bokeh, subtle warm highlight bloom, low distortion.')
};

// ── Framing ─────────────────────────────────────────────────────────────────
// The axis that shipped with NO images at all, which is why it renders as bare text tiles while
// every strip below it has pictures. Same character and plaza; only the shot size and camera
// position move. Kept lens-neutral on purpose — framing and focal length are independent axes and
// the user must be able to combine a wide shot with a macro lens without the tiles contradicting.
const framing = (shot) => ({
  axis: 'framing',
  prompt: `${REALISM}. ${CHARACTER}, ${LOCATION}. ${shot} Neutral natural lens rendering, no distortion effects.`
});

export const FRAMING = {
  'Extreme wide': framing('Extreme wide establishing shot — she is a small distant figure occupying a tiny fraction of the frame, the vast plaza and sky dominating.'),
  'Wide': framing('Wide shot — her full body head to toe, with the complete plaza environment surrounding her.'),
  'Medium': framing('Medium shot — framed from the waist up, environment still clearly readable behind her.'),
  'Close-up': framing('Tight close-up on her face filling the frame, emotional detail in the eyes, background reduced to soft context.'),
  'Macro detail': framing('Extreme macro detail of her hand and shirt cuff filling the frame, fabric weave and skin texture razor sharp, everything else blurred away.'),
  'Over-shoulder': framing('Over-the-shoulder shot — the blurred back of a second person\'s shoulder and head occupying the near foreground corner, her face sharp beyond it, classic dialogue geometry.'),
  'Low-angle power': framing('Low-angle shot from below her eye-line looking up, she towers heroically against the sky, buildings converging upward.'),
  'Top-down geometry': framing('Pure overhead top-down shot looking straight down at her from far above, she and her shadow reading as graphic shapes on the plaza paving grid.'),
  'Dutch tilt': framing('Dutch tilt — the horizon and buildings tilted steeply off-axis, unease in the canted frame, she stands off-centre.'),
  'Negative-space wide': framing('Wide shot with vast empty negative space — she is tiny and isolated in the bottom corner, the rest of the frame empty plaza and blank sky.'),
  'Through obstruction': framing('Shot through a blurred foreground obstruction — out-of-focus railings and leaves crossing the near frame, her face sharp in a gap between them, voyeuristic candid layer.'),
  'Tracking': framing('Dynamic tracking shot moving alongside her as she walks, her body sharp and the plaza behind streaked with horizontal motion blur.')
};
