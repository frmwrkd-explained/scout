// FrameForge auto-update. Deliberately conservative: check once at launch, download in the
// background, install when the user quits. Nothing in here ever restarts the app — a
// generation batch can run for many minutes and a mid-session relaunch would kill it.
// That is why `quitAndInstall()` is never called: electron-updater's own
// `autoInstallOnAppQuit` applies the staged update on the next normal quit.
//
// The feed is NOT the private DevFrmwrkd/frameforge repo. A private GitHub feed needs a
// PAT baked into the shipped app, and anything in the bundle is extractable — so the
// provider is `generic` (any HTTPS host: R2, S3, a plain static server).
//
// Feed resolution, highest precedence first:
//   1. FRFG_UPDATE_URL          — runtime override, points this build at another feed
//   2. resources/app-update.yml — baked in at build time from package.json `build.publish`
//                                 (override per build with `-c.publish.url=…`)
// FRFG_UPDATE_CHANNEL swaps the channel (latest / beta / alpha).
// FRFG_NO_UPDATE=1 disables the whole thing.
const { app, Notification } = require('electron');

// what happened, for logging and for anything that later wants to surface it in the UI
const state = { enabled: false, checking: false, available: null, downloaded: false, error: null };

function log(...args) { console.log('[updater]', ...args); }

function initUpdater() {
  try {
    if (process.env.FRFG_NO_UPDATE === '1') return log('disabled by FRFG_NO_UPDATE');
    // In dev there is no app-update.yml and no installer to replace; electron-updater
    // throws rather than no-ops, so bail before requiring it.
    if (!app.isPackaged) return log('skipped — not a packaged build');

    const { autoUpdater } = require('electron-updater');

    autoUpdater.autoDownload = true;          // fetch in the background as soon as one is found
    autoUpdater.autoInstallOnAppQuit = true;  // …and swap it in on quit, never mid-session
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };

    const url = String(process.env.FRFG_UPDATE_URL || '').trim();
    if (url) {
      autoUpdater.setFeedURL({ provider: 'generic', url, channel: process.env.FRFG_UPDATE_CHANNEL || 'latest' });
      log('feed overridden →', url);
    } else if (process.env.FRFG_UPDATE_CHANNEL) {
      autoUpdater.channel = process.env.FRFG_UPDATE_CHANNEL;
    }

    // Every listener is best-effort. A dead feed, an offline machine or an unsigned macOS
    // build (Squirrel.Mac refuses those — see docs/RELEASE.md) must never break the app.
    autoUpdater.on('error', e => { state.checking = false; state.error = String(e && e.message || e); log('error:', state.error); });
    autoUpdater.on('checking-for-update', () => { state.checking = true; });
    autoUpdater.on('update-not-available', () => { state.checking = false; log('up to date'); });
    autoUpdater.on('update-available', info => {
      state.checking = false; state.available = info && info.version;
      log('update available:', state.available, '— downloading in background');
    });
    autoUpdater.on('update-downloaded', info => {
      state.downloaded = true;
      const v = (info && info.version) || state.available || '';
      log('update', v, 'staged — installs on quit');
      try {
        if (Notification.isSupported()) {
          new Notification({
            title: 'FrameForge update ready',
            body: `Version ${v} installs the next time you quit. Your work is untouched.`
          }).show();
        }
      } catch { /* notifications are a nicety, not a requirement */ }
    });

    state.enabled = true;
    autoUpdater.checkForUpdates().catch(e => log('check failed:', e && e.message));
  } catch (e) {
    state.error = String(e && e.message || e);
    log('init failed:', state.error);
  }
}

module.exports = { initUpdater, updaterState: state };
