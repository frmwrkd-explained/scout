// Camera movement vocabulary for AI video generators (curated for the FrameForge
// Camera Movement Builder). Pure data — each movement carries a promptFragment
// written to be unambiguous for Kling / Seedance / Veo / Sora style models.
export const MOVE_CATEGORIES = [
  { id: 'fixed', label: 'Fixed' },
  { id: 'axis', label: 'Axis' },
  { id: 'lens', label: 'Lens' },
  { id: 'lateral', label: 'Lateral' },
  { id: 'dolly', label: 'Dolly' },
  { id: 'vertical', label: 'Vertical' },
  { id: 'rotation', label: 'Rotation' }
];

export const CAMERA_MOVEMENTS = [
  { id: 'static', name: 'Static', category: 'fixed', diagram: 'static', directionLabel: 'camera locked',
    description: 'No camera movement. Composition, performance or product shape stays exact.',
    promptFragment: 'Keep the camera completely locked on a tripod or fixed virtual camera. Do not pan, tilt, zoom, dolly, drift, shake, or reframe. The composition should stay stable from first frame to last; any motion should come from the subject or environment only.' },
  { id: 'pan-left', name: 'Pan Left', category: 'axis', diagram: 'pan-left', directionLabel: 'lens rotates left',
    description: 'Camera stays planted while the lens swings left.',
    promptFragment: 'Rotate the camera head left from a fixed position. The tripod/camera body does not travel through space. Use the pan to follow action moving left or reveal new information entering from the left side of the frame.' },
  { id: 'pan-right', name: 'Pan Right', category: 'axis', diagram: 'pan-right', directionLabel: 'lens rotates right',
    description: 'Camera stays planted while the lens swings right.',
    promptFragment: 'Rotate the camera head right from a fixed position. The tripod/camera body does not travel through space. Use the pan to follow action moving right or reveal new information entering from the right side of the frame.' },
  { id: 'tilt-up', name: 'Tilt Up', category: 'axis', diagram: 'tilt-up', directionLabel: 'lens tilts up',
    description: 'Camera stays planted while the lens rotates upward.',
    promptFragment: 'Tilt the lens upward while the camera body stays planted. Start framed lower, then rotate up to reveal height, a face, a building, the sky, a creature, a product detail, or whatever sits above the starting frame.' },
  { id: 'tilt-down', name: 'Tilt Down', category: 'axis', diagram: 'tilt-down', directionLabel: 'lens tilts down',
    description: 'Camera stays planted while the lens rotates downward.',
    promptFragment: 'Tilt the lens downward while the camera body stays planted. Start framed higher, then rotate down to reveal the subject, an object, hands, feet, floor action, a product surface, or the key detail below.' },
  { id: 'zoom-in', name: 'Zoom In', category: 'lens', diagram: 'zoom-in', directionLabel: 'focal length tightens',
    description: 'Lens magnifies the subject without moving the camera body.',
    promptFragment: 'Zoom in with the lens only. The camera body stays fixed in place, so there is no parallax shift. The subject grows larger in frame and the field of view tightens as focal length increases.' },
  { id: 'zoom-out', name: 'Zoom Out', category: 'lens', diagram: 'zoom-out', directionLabel: 'focal length widens',
    description: 'Lens widens the view without moving the camera body.',
    promptFragment: 'Zoom out with the lens only. The camera body stays fixed in place, so there is no parallax shift. The subject becomes smaller in frame and more of the surrounding environment is revealed as focal length widens.' },
  { id: 'roll-clockwise', name: 'Roll CW', category: 'rotation', diagram: 'roll-cw', directionLabel: 'frame rotates clockwise',
    description: 'The camera rolls around the lens axis.',
    promptFragment: 'Roll the camera clockwise around the lens axis. The frame itself rotates clockwise while the camera position stays otherwise controlled. Use it as a stylized transition, disorientation beat, impact moment, or surreal camera move.' },
  { id: 'roll-counterclockwise', name: 'Roll CCW', category: 'rotation', diagram: 'roll-ccw', directionLabel: 'frame rotates counterclockwise',
    description: 'Reverse lens-axis roll.',
    promptFragment: 'Roll the camera counterclockwise around the lens axis. The frame itself rotates counterclockwise while the camera position stays otherwise controlled. Use it as a stylized transition, disorientation beat, impact moment, or surreal camera move.' },
  { id: 'tracking-left', name: 'Tracking Left', category: 'lateral', diagram: 'track-left', directionLabel: 'camera travels left',
    description: 'Camera physically slides left on track, dolly, gimbal, or virtual path.',
    promptFragment: 'Move the entire camera left on a track, dolly, gimbal, slider, or virtual camera path. This is physical lateral travel, not a pan. Foreground and background should slide with visible parallax while the subject remains readable.' },
  { id: 'tracking-right', name: 'Tracking Right', category: 'lateral', diagram: 'track-right', directionLabel: 'camera travels right',
    description: 'Camera physically slides right on track, dolly, gimbal, or virtual path.',
    promptFragment: 'Move the entire camera right on a track, dolly, gimbal, slider, or virtual camera path. This is physical lateral travel, not a pan. Foreground and background should slide with visible parallax while the subject remains readable.' },
  { id: 'arc-clockwise', name: 'Arc CW', category: 'rotation', diagram: 'arc-cw', directionLabel: 'camera arcs clockwise',
    description: 'Camera physically curves around the subject.',
    promptFragment: 'Move the camera in a clockwise arc around the subject. The camera physically changes position on a curved path, keeping the subject as the anchor while the background rotates with clear parallax.' },
  { id: 'arc-counterclockwise', name: 'Arc CCW', category: 'rotation', diagram: 'arc-ccw', directionLabel: 'camera arcs counterclockwise',
    description: 'Camera physically curves around the subject in reverse.',
    promptFragment: 'Move the camera in a counterclockwise arc around the subject. The camera physically changes position on a curved path, keeping the subject as the anchor while the background rotates with clear parallax.' },
  { id: 'boom-up', name: 'Boom Up', category: 'vertical', diagram: 'up', directionLabel: 'camera arm rises',
    description: 'Crane/jib arm raises the camera through space.',
    promptFragment: 'Raise the camera upward on a crane, jib, boom arm, drone, or virtual vertical path. This is a physical rise through space, not a lens tilt. Reveal height, scale, overhead geometry, or a broader view as the camera ascends.' },
  { id: 'boom-down', name: 'Boom Down', category: 'vertical', diagram: 'down', directionLabel: 'camera arm lowers',
    description: 'Crane/jib arm lowers the camera through space.',
    promptFragment: 'Lower the camera downward on a crane, jib, boom arm, drone, or virtual vertical path. This is a physical descent through space, not a lens tilt. Move from a higher view down toward subject level, a detail, or a more intimate final frame.' },
  { id: 'pedestal-up', name: 'Pedestal Up', category: 'vertical', diagram: 'up', directionLabel: 'camera column rises',
    description: 'Camera moves vertically up without tilting.',
    promptFragment: 'Pedestal the camera straight upward while keeping the lens angle level. The camera column rises vertically without tilting up. Preserve screen direction and use the height change to reveal more of the subject or set.' },
  { id: 'pedestal-down', name: 'Pedestal Down', category: 'vertical', diagram: 'down', directionLabel: 'camera column lowers',
    description: 'Camera moves vertically down without tilting.',
    promptFragment: 'Pedestal the camera straight downward while keeping the lens angle level. The camera column lowers vertically without tilting down. Preserve screen direction and use the height change to settle onto the subject or detail.' },
  { id: 'push-in', name: 'Push In / Dolly', category: 'dolly', diagram: 'push-in', directionLabel: 'camera moves toward subject',
    description: 'Camera physically moves forward, creating parallax.',
    promptFragment: 'Dolly or push the entire camera forward toward the subject. This is physical camera travel, not a zoom. Foreground and background should shift with natural parallax as the shot becomes tighter and more focused.' },
  { id: 'pull-out', name: 'Pull Out / Dolly', category: 'dolly', diagram: 'pull-out', directionLabel: 'camera moves away',
    description: 'Camera physically moves backward, revealing more context.',
    promptFragment: 'Dolly or pull the entire camera backward away from the subject. This is physical camera travel, not a zoom. Foreground and background should shift with natural parallax as the frame widens and reveals more context.' },
  { id: 'dolly-zoom', name: 'Dolly Zoom', category: 'dolly', diagram: 'dolly-zoom', directionLabel: 'camera and lens counter-move',
    description: 'Camera movement and lens zoom oppose each other for a vertigo effect.',
    promptFragment: 'Create a dolly zoom: move the camera physically in one direction while zooming the lens in the opposite direction. Keep the subject nearly the same size in frame while the background appears to stretch, compress, or warp dramatically.' }
];

export const MOVE_SPEEDS = [
  { id: 'creep', label: 'Creep', phrase: 'The movement is a barely perceptible creep — extremely slow and controlled.' },
  { id: 'slow', label: 'Slow', phrase: 'The movement is slow and deliberate, letting the frame breathe.' },
  { id: 'normal', label: 'Normal', phrase: 'The movement runs at a natural, steady operating speed.' },
  { id: 'fast', label: 'Fast', phrase: 'The movement is fast and energetic, with clear momentum.' }
];

export const MOVE_STABILIZATIONS = [
  { id: 'locked', label: 'Locked', phrase: 'Execution is perfectly stabilized — machined, tripod/robotic smoothness with zero shake.' },
  { id: 'smooth', label: 'Gimbal', phrase: 'Execution is gimbal-smooth with a faint organic float, no visible shake.' },
  { id: 'handheld', label: 'Handheld', phrase: 'Execution is handheld with natural micro-shake and human energy.' }
];

// deterministic assembly, mirror of the prompt-builder philosophy: no AI in the loop
export function assembleMovePrompt(move, { subject, speed, duration, stabilization }) {
  if (!move) return '';
  const parts = [];
  if (subject && subject.trim()) parts.push(subject.trim().replace(/\.?$/, '.'));
  parts.push(move.promptFragment);
  const sp = MOVE_SPEEDS.find(s => s.id === speed);
  if (sp) parts.push(sp.phrase);
  if (duration) parts.push('The move plays out over roughly ' + duration + ' seconds, one continuous take.');
  const st = MOVE_STABILIZATIONS.find(s => s.id === stabilization);
  if (st) parts.push(st.phrase);
  return parts.join(' ');
}
