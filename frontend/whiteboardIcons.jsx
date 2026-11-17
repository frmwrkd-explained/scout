// The whiteboard's tool icons — one small file, because the tool rail is the only place in the app
// that needs a picture of a pen. 24-unit grid, drawn with `currentColor`, so an icon takes the
// colour of the button it sits in and needs no token of its own.
import React from 'react';

const PATHS = {
  select: <path d="M5 3.5l13.5 7.2-5.6 1.7 3.4 6.6-2.5 1.3-3.4-6.7L6.2 17.4z" />,
  hand: <path d="M8.5 12V5.6a1.6 1.6 0 0 1 3.2 0V11m0-5.8V4.6a1.6 1.6 0 0 1 3.2 0V11m0-5.2a1.6 1.6 0 0 1 3.2 0V12m0-3a1.6 1.6 0 0 1 3.2 0v5.6a7.4 7.4 0 0 1-7.4 7.4h-1.3a6.4 6.4 0 0 1-4.9-2.3l-3.9-4.6a1.7 1.7 0 0 1 2.5-2.3L8.5 15" />,
  text: <><path d="M5 7V4.5h14V7" /><path d="M12 4.5v15" /><path d="M9 19.5h6" /></>,
  note: <><path d="M4.5 4.5h15v9.5l-5.5 5.5h-9.5z" /><path d="M14 19.5V14h5.5" /></>,
  rect: <rect x="3.5" y="5.5" width="17" height="13" rx="1" />,
  round: <rect x="3.5" y="5.5" width="17" height="13" rx="5" />,
  ellipse: <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />,
  diamond: <path d="M12 3.5l8.5 8.5-8.5 8.5-8.5-8.5z" />,
  connect: <><rect x="3" y="4" width="6" height="6" rx="1" /><rect x="15" y="14" width="6" height="6" rx="1" /><path d="M9 7h3.5a3 3 0 0 1 3 3v1.5" /><path d="M13.2 9.6l2.3 2.3 2.3-2.3" /></>,
  pen: <><path d="M4 20l1.2-4.6L16.6 4a2.1 2.1 0 0 1 3 3L8.2 18.6z" /><path d="M14.5 6.2l3 3" /></>,
  eraser: <><path d="M9 19.5h11" /><path d="M5.2 13.4l8.2-8.2a2 2 0 0 1 2.8 0l3.3 3.3a2 2 0 0 1 0 2.8l-8.4 8.2H8.4l-3.2-3.3a2 2 0 0 1 0-2.8z" /><path d="M9.8 8.8l6 6" /></>,
  frame: <><path d="M7.5 3v18" /><path d="M16.5 3v18" /><path d="M3 7.5h18" /><path d="M3 16.5h18" /></>,
  picture: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M20.5 15.5l-4.8-4.8-8.2 8.2" /></>,
};

export function ToolIcon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name] || null}
    </svg>
  );
}
