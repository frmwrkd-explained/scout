// Shot Types library (F3.4) — curated shot-type vocabulary.
// 30 single + 30 multi camera-grammar entries; promptFragment is genre-neutral and pasteable.
export const SHOT_TYPE_LIB = [
  {
    "type": "single",
    "name": "Macro Detail",
    "promptFragment": "macro detail shot of the smallest meaningful part of the subject or object, tactile texture in sharp focus, the larger scene only implied by blur and context",
    "description": "Extreme close detail for texture, props, hands, fabric, product features, or facial details.",
    "sortOrder": 1,
    "slug": "single-macro-detail"
  },
  {
    "type": "single",
    "name": "Tight Close-Up",
    "promptFragment": "tight close-up on the subject, face fills the frame, eyes carrying the emotional beat, background compressed into soft abstraction",
    "description": "Classic emotional close-up.",
    "sortOrder": 2,
    "slug": "single-tight-close-up"
  },
  {
    "type": "single",
    "name": "Graphic Profile",
    "promptFragment": "strict side-profile angle, the subject cut into a clean graphic outline against negative space, shape language and posture carry the emotion",
    "description": "Hard profile for portraits, characters, products, fashion, or stylized silhouettes.",
    "sortOrder": 3,
    "slug": "single-profile-knife-edge"
  },
  {
    "type": "single",
    "name": "Low-Angle Power",
    "promptFragment": "low-angle shot from below the subject's eye line, posture and scale become dominant, background lines rise upward to make the subject feel larger",
    "description": "Makes one subject/object feel grand, heroic, imposing, or monumental.",
    "sortOrder": 4,
    "slug": "single-low-angle-power"
  },
  {
    "type": "single",
    "name": "High-Angle Vulnerable",
    "promptFragment": "high-angle shot looking down on the subject, body shape compressed by the camera position, surrounding space becomes part of the story",
    "description": "Makes a subject/object feel delicate, small, exposed, playful, or observed.",
    "sortOrder": 5,
    "slug": "single-high-angle-vulnerable"
  },
  {
    "type": "single",
    "name": "Top-Down Geometry",
    "promptFragment": "pure top-down overhead shot, subject and surrounding elements arranged as clean graphic shapes, geometry and negative space drive the composition",
    "description": "Overhead layout for people, objects, food, products, fashion, anime scenes, or wedding details.",
    "sortOrder": 6,
    "slug": "single-top-down-evidence"
  },
  {
    "type": "single",
    "name": "Dutch Tilt",
    "promptFragment": "dutch angle with the subject intentionally off-axis, vertical lines tilted, the frame gains motion, tension, playfulness, or surreal energy",
    "description": "Tilted camera for tension, energy, comedy, action, anime, fashion, or dream logic.",
    "sortOrder": 7,
    "slug": "single-dutch-paranoia"
  },
  {
    "type": "single",
    "name": "Through Obstruction",
    "promptFragment": "shot through a foreground layer such as glass, fabric, foliage, architecture, crowd, hands, or objects, the subject partially hidden but still readable",
    "description": "Adds depth, intimacy, candid energy, secrecy, or environmental texture.",
    "sortOrder": 8,
    "slug": "single-through-obstruction"
  },
  {
    "type": "single",
    "name": "Left-Focus Blocked",
    "promptFragment": "subject placed left of frame in sharp focus while a large blurred foreground shape blocks the right side, asymmetrical composition with layered depth",
    "description": "A focused-left, blocked-right composition for portraits, products, wedding moments, anime, or dialogue scenes.",
    "sortOrder": 9,
    "slug": "single-left-focus-blocked"
  },
  {
    "type": "single",
    "name": "Negative Space Wide",
    "promptFragment": "wide composition with the subject small inside generous negative space, environment and emptiness become active parts of the image",
    "description": "A quiet wide frame for scale, elegance, loneliness, luxury, wonder, or minimalist design.",
    "sortOrder": 10,
    "slug": "single-negative-space-trap"
  },
  {
    "type": "single",
    "name": "Reflection Read",
    "promptFragment": "subject seen through a mirror, water, glass, polished surface, screen, or other reflection, the reflected version carries the main composition",
    "description": "Uses reflection for beauty, memory, identity, romance, product polish, or surreal doubling.",
    "sortOrder": 11,
    "slug": "single-mirror-surveillance"
  },
  {
    "type": "single",
    "name": "Extreme Wide Scale",
    "promptFragment": "extreme wide shot where the subject is small in frame, the environment tells the story before the face or details do",
    "description": "A subject dwarfed by the room.",
    "sortOrder": 12,
    "slug": "single-extreme-wide-specimen"
  },
  {
    "type": "single",
    "name": "Floor-Level POV",
    "promptFragment": "floor-level angle looking past ground textures, feet, furniture legs, cables, petals, fabric, toys, or foreground objects toward the subject",
    "description": "A low grounded angle for drama, intimacy, scale, discovery, or childlike perspective.",
    "sortOrder": 13,
    "slug": "single-floor-level-threat"
  },
  {
    "type": "single",
    "name": "Overhead Source Halo",
    "promptFragment": "camera looks through or around an overhead light source, the subject sits beneath a bright halo or pool of light while edges fall away",
    "description": "Graphic overhead-light composition for beauty, drama, stage, ritual, product, or anime lighting.",
    "sortOrder": 14,
    "slug": "single-overhead-lamp-halo"
  },
  {
    "type": "single",
    "name": "Fisheye Confinement",
    "promptFragment": "wide fisheye angle close to the subject, edges bend dramatically, space feels exaggerated, playful, claustrophobic, surreal, or high-energy",
    "description": "Distorted wide angle for action, comedy, music videos, anime, product weirdness, or pressure.",
    "sortOrder": 15,
    "slug": "single-fisheye-confinement"
  },
  {
    "type": "single",
    "name": "Ceiling-Corner Wide",
    "promptFragment": "high ceiling-corner wide angle, the subject is viewed from an impersonal architectural corner, space and blocking read clearly",
    "description": "A monitored or observational angle for rooms, events, action blocking, or stylized overhead perspective.",
    "sortOrder": 16,
    "slug": "single-security-camera"
  },
  {
    "type": "single",
    "name": "Half-Face Shadow",
    "promptFragment": "one side of the subject hidden by shadow or negative space, the other side shaped by light, the image reads as a graphic split",
    "description": "Graphic split-light framing for people, creatures, masks, products, or dramatic anime faces.",
    "sortOrder": 17,
    "slug": "single-half-face-shadow"
  },
  {
    "type": "single",
    "name": "Vertical Drop",
    "promptFragment": "vertical drop angle from directly above the subject, disorienting scale, the surrounding scene becomes a graphic map around them",
    "description": "A straight-down angle for stylized portraits, objects, choreography, fashion, wedding tables, or anime staging.",
    "sortOrder": 18,
    "slug": "single-impossible-ceiling-drop"
  },
  {
    "type": "multi",
    "name": "Over-Shoulder",
    "promptFragment": "over-the-shoulder angle, one subject large and soft in the foreground while the opposite subject stays sharp, relationship and eyeline are clear",
    "description": "Classic relationship/dialogue angle for weddings, interviews, anime, drama, fashion, or product handoff scenes.",
    "sortOrder": 1,
    "slug": "multi-over-shoulder-pressure"
  },
  {
    "type": "multi",
    "name": "Dirty Two-Shot",
    "promptFragment": "dirty two-shot with one subject partially blocking the frame, the second subject visible through a gap, depth and relationship drive the composition",
    "description": "Two or more subjects with foreground blocking and layered depth.",
    "sortOrder": 2,
    "slug": "multi-dirty-two-shot"
  },
  {
    "type": "multi",
    "name": "Left Focus Right Block",
    "promptFragment": "left subject in sharp focus while a right-side subject or object sits close to lens and blocks part of the frame, asymmetry and depth create visual tension",
    "description": "Left subject sharp, right foreground subject/object blocking for asymmetrical layered depth.",
    "sortOrder": 3,
    "slug": "multi-left-focus-right-block"
  },
  {
    "type": "multi",
    "name": "Split Diopter Standoff",
    "promptFragment": "split-diopter style composition, a near subject and a far subject both appear sharp at once, the distance between them becomes visually important",
    "description": "Both near and far subjects sharp at the same time for drama, comedy, product scale, or stylized anime staging.",
    "sortOrder": 4,
    "slug": "multi-split-diopter-standoff"
  },
  {
    "type": "multi",
    "name": "Symmetrical Two-Shot",
    "promptFragment": "locked symmetrical two-shot, subjects balanced across a clear center line, props and background elements feel deliberately arranged",
    "description": "Balanced multi-subject frame for couples, rivals, product comparisons, interviews, or formal compositions.",
    "sortOrder": 5,
    "slug": "multi-symmetrical-interrogation"
  },
  {
    "type": "multi",
    "name": "Top-Down Blocking",
    "promptFragment": "top-down overhead multi-subject layout, bodies and objects arranged as readable shapes, relationships become clear through geometry",
    "description": "Overhead composition for weddings, tables, dances, action blocking, products, or ensemble scenes.",
    "sortOrder": 6,
    "slug": "multi-top-down-chessboard"
  },
  {
    "type": "multi",
    "name": "Through Glass",
    "promptFragment": "observational angle through glass, fabric, foliage, a window, screen, reflection, or transparent foreground layer, subjects visible through texture and partial occlusion",
    "description": "Multi-subject scene observed through a real foreground layer.",
    "sortOrder": 7,
    "slug": "multi-surveillance-through-glass"
  },
  {
    "type": "multi",
    "name": "Triangle Power Blocking",
    "promptFragment": "three-point triangular blocking, one element in foreground, one in midground, one in background, hierarchy and relationship created through depth",
    "description": "Layered blocking for groups, couples plus environment, hero-object scenes, or ensemble anime compositions.",
    "sortOrder": 8,
    "slug": "multi-triangle-power-blocking"
  },
  {
    "type": "multi",
    "name": "Crossfire Close-Ups",
    "promptFragment": "crossfire close-up angle, camera sits between two eyelines, faces or key subjects cut into opposing edges of the frame",
    "description": "Close opposing-edge composition for dialogue, romance, confrontation, comedy, or anime reaction shots.",
    "sortOrder": 9,
    "slug": "multi-crossfire-close-ups"
  },
  {
    "type": "multi",
    "name": "Low Surface Divide",
    "promptFragment": "low angle from surface height, the surface edge becomes a strong horizon dividing subjects, hands, props, food, flowers, products, or objects dominate foreground",
    "description": "Low surface-level angle for tables, floors, counters, stages, ceremonies, or product scenes.",
    "sortOrder": 10,
    "slug": "multi-low-table-divide"
  },
  {
    "type": "multi",
    "name": "Extreme Wide Isolation",
    "promptFragment": "extreme wide multi-subject shot with figures separated by architecture, landscape, set design, or empty space, distance becomes the emotional subject",
    "description": "Wide room composition where separation matters.",
    "sortOrder": 11,
    "slug": "multi-extreme-wide-isolation"
  },
  {
    "type": "multi",
    "name": "Dutch Duel",
    "promptFragment": "dutch-angle multi-subject shot, subjects lean against tilted lines, the frame feels energetic, unstable, comic, romantic, surreal, or action-driven",
    "description": "Tilted group or pair composition.",
    "sortOrder": 12,
    "slug": "multi-dutch-duel"
  },
  {
    "type": "multi",
    "name": "Rack Focus Hand-Off",
    "promptFragment": "composition built for rack focus, one subject or object soft in foreground and another sharp in background, depth suggests attention shifting between them",
    "description": "Depth setup for focus shift between people, products, creatures, props, or moments.",
    "sortOrder": 13,
    "slug": "multi-rack-focus-threat"
  },
  {
    "type": "multi",
    "name": "Reflection Double Read",
    "promptFragment": "multiple subjects staged with mirror, water, glass, screen, or polished-surface reflections, real and reflected versions create a doubled read",
    "description": "Reflection-based pair or group composition.",
    "sortOrder": 14,
    "slug": "multi-mirror-double-read"
  },
  {
    "type": "multi",
    "name": "Narrow Sliver View",
    "promptFragment": "view through a narrow opening, gap, curtain, doorway, crowd, architecture, or object slit, subjects compressed into a thin slice of visibility",
    "description": "A sliver view for secrecy, discovery, anticipation, candid wedding moments, or stylized anime reveals.",
    "sortOrder": 15,
    "slug": "multi-door-crack-eavesdrop"
  },
  {
    "type": "multi",
    "name": "Ceiling-Corner Wide",
    "promptFragment": "ceiling-corner wide angle on multiple subjects, the whole blocking pattern is readable from an impersonal architectural viewpoint",
    "description": "High wide angle for group blocking, rooms, ceremonies, action, or stylized observation.",
    "sortOrder": 16,
    "slug": "multi-ceiling-corner-watcher"
  },
  {
    "type": "multi",
    "name": "Face-Off Silhouettes",
    "promptFragment": "multiple subjects reduced to opposing silhouettes, faces mostly unreadable, body shape and negative space carry the relationship",
    "description": "Graphic silhouette composition for romance, rivalry, dance, product reveal, or anime drama.",
    "sortOrder": 17,
    "slug": "multi-face-off-silhouettes"
  },
  {
    "type": "multi",
    "name": "Surface Tunnel",
    "promptFragment": "tunnel-like angle along a surface between subjects, perspective lines stretch toward opposing figures or objects at the far ends",
    "description": "Surreal low surface perspective for tables, floors, aisles, roads, counters, or product lines.",
    "sortOrder": 18,
    "slug": "multi-impossible-table-tunnel"
  },
  {
    "type": "single",
    "name": "Tiny Detail Macro",
    "promptFragment": "ultra macro shot of one tiny meaningful detail, such as a ring edge, fabric stitch, eyelash, petal, droplet, object tip, glowing ember, or product texture; the larger subject is only implied",
    "description": "Very small detail macro that can work for weddings, products, anime objects, food, fashion, or dramatic props.",
    "sortOrder": 19,
    "slug": "single-cigarette-ember-macro"
  },
  {
    "type": "single",
    "name": "Pupil Reflection",
    "promptFragment": "extreme macro on a reflective eye, gem, lens, glass bead, chrome surface, water droplet, or polished object, with the larger scene reflected inside it",
    "description": "The scene compressed into one reflective detail.",
    "sortOrder": 20,
    "slug": "single-pupil-reflection"
  },
  {
    "type": "single",
    "name": "Below-Surface Up Angle",
    "promptFragment": "camera placed below or beneath a surface, looking upward through glass, water, a grate, transparent material, or an impossible cutaway, making the subject loom above",
    "description": "Below-surface perspective for glass floors, water, fantasy, anime, product displays, or surreal staging.",
    "sortOrder": 21,
    "slug": "single-under-floor-up-shot"
  },
  {
    "type": "single",
    "name": "Through Object Aperture",
    "promptFragment": "camera looks through a circular or irregular opening in a foreground object, using the object as a natural frame around the subject",
    "description": "A through-object frame using rings, wheels, flowers, machinery, doors, arches, glasses, or graphic shapes.",
    "sortOrder": 22,
    "slug": "single-inside-recorder-reel"
  },
  {
    "type": "single",
    "name": "Surface-Slit Horizon",
    "promptFragment": "razor-thin angle from surface height, the surface becomes a hard horizon and only selected subject details rise above it",
    "description": "Compressed surface-level sliver for tables, floors, counters, waterlines, roads, or product planes.",
    "sortOrder": 23,
    "slug": "single-table-slit-horizon"
  },
  {
    "type": "single",
    "name": "Distorted Object POV",
    "promptFragment": "point-of-view through a distorted foreground object such as glass, crystal, plastic, liquid, visor, lens, bottle, ornament, or transparent prop",
    "description": "Warped object-level POV that works for products, parties, weddings, sci-fi, anime, or dream scenes.",
    "sortOrder": 24,
    "slug": "single-ashtray-pov"
  },
  {
    "type": "single",
    "name": "Peephole Frame",
    "promptFragment": "peephole or tiny-opening angle with a circular or torn vignette, the subject seen through a small hidden aperture",
    "description": "Hidden aperture frame for discovery, intimacy, suspense, comedy, or stylized reveals.",
    "sortOrder": 25,
    "slug": "single-behind-wallpaper-peephole"
  },
  {
    "type": "single",
    "name": "Light-Source POV",
    "promptFragment": "camera positioned at or inside a visible light source, looking back toward the subject, with flare, glow, or halo shaping the frame edges",
    "description": "POV from a lamp, candle, neon sign, screen, sun flare, stage light, or magical glow.",
    "sortOrder": 26,
    "slug": "single-lamp-bulb-pov"
  },
  {
    "type": "single",
    "name": "Foreground Canyon",
    "promptFragment": "camera placed between tall foreground objects that form a canyon-like corridor, with the subject visible in the distance through the narrow gap",
    "description": "Foreground corridor using flowers, fabric, books, documents, architecture, product rows, trees, or props.",
    "sortOrder": 27,
    "slug": "single-file-folder-canyon"
  },
  {
    "type": "single",
    "name": "Shadow-Only Portrait",
    "promptFragment": "the subject is shown only as a shadow, silhouette, reflection, or cast shape on a nearby surface, with the real body hidden outside frame",
    "description": "A portrait or object read without direct visibility.",
    "sortOrder": 28,
    "slug": "single-shadow-only-portrait"
  },
  {
    "type": "single",
    "name": "Vertigo Stretch",
    "promptFragment": "vertigo-style perspective stretch, the subject stays central while the background appears to compress, elongate, or warp around them",
    "description": "Dolly-zoom inspired distortion for emotional, comic, surreal, fashion, anime, or action scenes.",
    "sortOrder": 29,
    "slug": "single-vertigo-corridor-pull"
  },
  {
    "type": "single",
    "name": "Hidden High Cutaway",
    "promptFragment": "hidden high-angle cutaway from inside architecture, foliage, set dressing, shelving, ceiling, fabric, or another overhead obstruction",
    "description": "Concealed overhead viewpoint through environmental texture.",
    "sortOrder": 30,
    "slug": "single-ceiling-tile-cutaway"
  },
  {
    "type": "multi",
    "name": "Tiny Detail Divide",
    "promptFragment": "ultra macro foreground detail dominates the frame while multiple subjects become blurred shapes behind it, the small object becomes the visual divider",
    "description": "A tiny object/detail dividing people, products, creatures, couples, or groups.",
    "sortOrder": 19,
    "slug": "multi-cigarette-tip-divide"
  },
  {
    "type": "multi",
    "name": "Below-Surface Standoff",
    "promptFragment": "camera placed below or beneath a surface, looking upward through glass, water, a grate, transparent material, or an impossible cutaway at multiple subjects",
    "description": "Below-surface group angle for fantasy, glass floors, pools, anime, product displays, or surreal staging.",
    "sortOrder": 20,
    "slug": "multi-under-floor-standoff"
  },
  {
    "type": "multi",
    "name": "Through Object Aperture",
    "promptFragment": "multiple subjects seen through circular or irregular openings in a foreground object, with the object acting as a strong graphic frame",
    "description": "Group view through rings, wheels, flowers, arches, glassware, machinery, windows, or graphic shapes.",
    "sortOrder": 21,
    "slug": "multi-recorder-reel-witness"
  },
  {
    "type": "multi",
    "name": "Between Hands Canyon",
    "promptFragment": "camera placed between opposing foreground elements such as hands, flowers, products, props, food, fabric, or documents, creating a corridor toward multiple subjects",
    "description": "Foreground canyon between people, props, decor, or products.",
    "sortOrder": 22,
    "slug": "multi-between-hands-canyon"
  },
  {
    "type": "multi",
    "name": "Light-Source Overhead",
    "promptFragment": "overhead light-source point of view looking down on multiple subjects, circular falloff or glow organizes the group into a clear composition",
    "description": "POV from a lamp, chandelier, sun flare, neon sign, screen, candle, stage light, or magical source.",
    "sortOrder": 23,
    "slug": "multi-lamp-bulb-interrogator"
  },
  {
    "type": "multi",
    "name": "Layered Reflection Ghosts",
    "promptFragment": "multiple subjects layered with ghosted reflections in glass, water, mirrors, screens, windows, polished surfaces, or transparent material",
    "description": "Layered reflection image with doubles, memories, crowds, romance, or surreal overlap.",
    "sortOrder": 24,
    "slug": "multi-two-way-mirror-ghosts"
  },
  {
    "type": "multi",
    "name": "Fractured Sliver View",
    "promptFragment": "angle through a fractured narrow foreground opening, with subjects visible only in broken slivers created by hardware, decor, architecture, foliage, fabric, or objects",
    "description": "Broken sliver view for reveals, candid moments, suspense, or stylized compositions.",
    "sortOrder": 25,
    "slug": "multi-door-chain-sliver"
  },
  {
    "type": "multi",
    "name": "Shadow Argument",
    "promptFragment": "multiple subjects appear only as shadows, silhouettes, cast shapes, or reflected outlines, body language readable without direct faces",
    "description": "Group or pair scene shown only through graphic shadow shapes.",
    "sortOrder": 26,
    "slug": "multi-shadow-argument"
  },
  {
    "type": "multi",
    "name": "Through Overhead Slats",
    "promptFragment": "high hidden angle through overhead slats, beams, leaves, rafters, balcony rails, blinds, fabric, or architectural gaps, with multiple subjects below",
    "description": "Overhead view through a repeated foreground pattern.",
    "sortOrder": 27,
    "slug": "multi-ceiling-vent-spy"
  },
  {
    "type": "multi",
    "name": "Layered Double Exposure",
    "promptFragment": "double-exposure style composition where two spaces, moments, or scales overlap and multiple subjects appear duplicated or layered",
    "description": "Surreal layered composition for memories, dreams, transitions, anime, music videos, or emotional montage.",
    "sortOrder": 28,
    "slug": "multi-split-room-double-exposure"
  },
  {
    "type": "multi",
    "name": "Reflection Inversion",
    "promptFragment": "the scene is composed mainly through a reflective surface, subjects appear inverted, stretched, or doubled while reality sits at the frame edge",
    "description": "Reflection-first frame using water, floors, tables, mirrors, glass, metal, screens, or polished products.",
    "sortOrder": 29,
    "slug": "multi-table-reflection-inversion"
  },
  {
    "type": "multi",
    "name": "Foreground Web POV",
    "promptFragment": "camera from behind a foreground web of objects, lines, decor, branches, wires, ribbons, strings, shelves, or graphic elements that partially block multiple subjects",
    "description": "Subjects seen through a dense foreground pattern or network.",
    "sortOrder": 30,
    "slug": "multi-evidence-board-pov"
  }
];
