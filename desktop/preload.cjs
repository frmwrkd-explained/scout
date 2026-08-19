// The renderer's only bridge to the main process, and it stays that way.
//
// It exists for one reason: a bug report needs a real screenshot, and a DOM rasteriser cannot
// take one. It misses the 3D stage's WebGL canvas, it misses playing <video>, and it renders CSS
// its own way — which produces a picture of a bug that is not the bug. `capturePage()` is what
// the compositor actually drew.
//
// contextIsolation stays true and nodeIntegration stays false (desktop/main.cjs). What is exposed
// here is ONE function that takes a rectangle and returns a PNG. No fs, no shell, no generic
// `invoke` passthrough, no event emitter. Everything the renderer needs it already gets over HTTP
// from the local server, which is guarded, audited and origin-checked; this bridge must not become
// a second, unguarded way in. If a later feature wants something from main, add a named function
// with its own validation — never widen this one.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scout', {
  // rect is optional { x, y, width, height } in CSS pixels; omitted means the whole window.
  // Returns a PNG data URL, or null when the capture failed for any reason — callers fall back
  // to the browser path rather than blocking a report on a screenshot.
  capture: rect => ipcRenderer.invoke('ff:capture', rect || null),

  // Lets the renderer tell "shipped app" from "npm run dev" without sniffing the user agent,
  // which is how the panel knows whether to expect a picker.
  isDesktop: true
});
