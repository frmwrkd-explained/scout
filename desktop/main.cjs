// Scout desktop wrapper. Double-click launches this: it starts the bundled Express server
// (via Electron's own Node runtime — no system Node required), waits for it to answer, then
// opens a window pointing at it. The server still spawns the `claude` CLI for agent jobs, so
// nothing about the backend changes; this file only owns process lifecycle + the window.
const { app, BrowserWindow, shell, utilityProcess, ipcMain } = require('electron');
const path = require('path');
const net = require('net');
const http = require('http');
const { initUpdater } = require('./updater.cjs');

// keep everything the user creates in a writable per-user location — the app bundle is read-only
const DATA_DIR = path.join(app.getPath('userData'), 'storage');
const CONFIG_MD = path.join(app.getPath('userData'), 'config.md');

let serverProc = null;
let win = null;

// ── find a free localhost port so two copies (or a stray process) never collide ──
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// ── poll until the server answers (or give up) ──
function waitForServer(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/state', timeout: 1500 }, res => {
        res.destroy();
        resolve();
      });
      req.on('error', () => (Date.now() > deadline ? reject(new Error('server did not start')) : setTimeout(tryOnce, 300)));
      req.on('timeout', () => { req.destroy(); Date.now() > deadline ? reject(new Error('server timed out')) : setTimeout(tryOnce, 300); });
    };
    tryOnce();
  });
}

function startServer(port) {
  // in production the server + dist are unpacked under resources/app; __dirname is electron/
  const serverEntry = path.join(__dirname, '..', 'backend', 'index.mjs');
  serverProc = utilityProcess.fork(serverEntry, [String(port)], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      SCOUT_CONFIG: CONFIG_MD,
      SCOUT_DATA: DATA_DIR
    },
    stdio: 'pipe'
  });
  serverProc.stdout?.on('data', d => process.stdout.write('[server] ' + d));
  serverProc.stderr?.on('data', d => process.stderr.write('[server] ' + d));
}

async function createWindow() {
  const port = await freePort();
  startServer(port);

  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0B0C0E',
    title: 'Scout',
    show: false,
    // contextIsolation/nodeIntegration are unchanged; the preload adds exactly one function
    // (see desktop/preload.cjs) so bug reports can carry a real screenshot of the window.
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') }
  });

  // open external links (docs, fal URLs) in the real browser, not inside the app window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  try {
    await waitForServer(port);
    await win.loadURL('http://127.0.0.1:' + port + '/');
  } catch (e) {
    await win.loadURL('data:text/html,' + encodeURIComponent(
      '<body style="background:#0B0C0E;color:#ECEEF2;font-family:sans-serif;padding:40px">' +
      '<h2>Scout could not start its engine.</h2><p>' + String(e.message) + '</p></body>'));
  }
  win.show();
}

// ── screenshot for bug reports (docs/specs/beta-feedback/spec.md §5) ──
// Captures THIS window and nothing else — never the desktop, never another app — so a tester
// cannot accidentally send us whatever else was on their screen. No OS permission is involved.
// The rect is validated rather than trusted: the renderer is our own code, but a bridge that
// forwards unchecked geometry into a native call is the kind of thing that stops being true later.
ipcMain.handle('ff:capture', async (event, rect) => {
  try {
    const target = BrowserWindow.fromWebContents(event.sender);
    if (!target) return null;
    let area;
    if (rect) {
      const { x, y, width, height } = rect;
      const nums = [x, y, width, height].map(Number);
      if (nums.some(n => !Number.isFinite(n)) || nums[2] <= 0 || nums[3] <= 0) return null;
      const bounds = target.getContentBounds();
      // Clamp into the window. An out-of-range rect returns an empty image on some platforms and
      // throws on others; clamping gives the same answer everywhere.
      const cx = Math.max(0, Math.min(Math.round(nums[0]), bounds.width));
      const cy = Math.max(0, Math.min(Math.round(nums[1]), bounds.height));
      area = {
        x: cx, y: cy,
        width: Math.min(Math.round(nums[2]), bounds.width - cx),
        height: Math.min(Math.round(nums[3]), bounds.height - cy)
      };
      if (area.width <= 0 || area.height <= 0) return null;
    }
    const image = area ? await target.webContents.capturePage(area) : await target.webContents.capturePage();
    return image.isEmpty() ? null : image.toDataURL();
  } catch {
    return null; // a failed screenshot must never block a report — the panel sends without one
  }
});

// `finally` rather than `then`: a launch that failed is exactly when a pending update matters
// most, and initUpdater never throws. Update checks run after the window is up so they never
// compete with startup.
app.whenReady().then(createWindow).finally(() => initUpdater());

app.on('window-all-closed', () => { app.quit(); });
app.on('before-quit', () => { try { serverProc && serverProc.kill(); } catch { /* already gone */ } });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
