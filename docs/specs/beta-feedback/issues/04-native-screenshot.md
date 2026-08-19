# 04 — Native screenshot: preload, IPC, browser fallback

**Status:** resolved
**Blocked by:** None — can start immediately.

`desktop/preload.cjs` exposes exactly one function over `contextBridge`:

```js
window.frameforge = { capture: rect => ipcRenderer.invoke('ff:capture', rect) }
```

Main process answers with `win.webContents.capturePage(rect)` → PNG data URL.
`contextIsolation: true` and `nodeIntegration: false` stay as they are. **No other
channel is added to the bridge** — no fs, no shell, no generic `invoke`. The handler
validates `rect` is four finite numbers inside the window bounds or ignores it.

`frontend/screenshot.js` picks the path: `window.frameforge?.capture` when present,
otherwise `getDisplayMedia({ preferCurrentTab: true })` for `npm run dev`. Same
signature either way; the panel never branches.

## Done when

`npm run app` captures the window including the 3D stage's WebGL canvas and a playing
`<video>`; `npm run dev` falls back with the picker; a rect capture returns only that
rect; the app still starts with the preload present and no console warnings about it.
