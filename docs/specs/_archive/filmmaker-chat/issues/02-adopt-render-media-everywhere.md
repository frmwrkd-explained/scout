# 02 — Adopt shared media components in shot workspace and home

**What to build:** The shot workspace (candidate thumbnails, hero/stage viewer with
double-click zoom, its private zoom lightbox) and the home dashboard favorites strip
render all images/videos through the shared RenderMedia/RenderTile/RenderLightbox
from ticket 01. After this ticket there is exactly one implementation of
"render a generated image or video" in the app.

**Blocked by:** 01 — Shared RenderMedia / RenderTile / RenderLightbox.

**Status:** done (verified shipped 2026-07-20)

- [x] Shot workspace candidate tiles, hero viewer, and zoom use the shared components; its private image/video branch code is deleted — `ShotWorkspace.jsx:13` imports the trio, used at `:277` and `:391`
- [x] Home favorites tiles use the shared components; the inline video/img branch is deleted — `App.jsx:24` imports, favorites render via the shared components at `:1579`
- [x] No behavior regressions: candidate select, promote, double-click zoom, hover-play all still work
- [x] A grep for hand-rolled `<video`/`<img` generation-render branches outside the shared module and moodboard returns nothing load-bearing

**Notes:** verified shipped 2026-07-20 — ShotWorkspace and the home dashboard both import RenderMedia/RenderTile/RenderLightbox from `frontend/RenderMedia.jsx`.
