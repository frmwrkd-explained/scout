// The client half of bug capture — four in-memory ring buffers, installed before React mounts.
//
// PURE module: no React, no JSX, no imports. `install()` is called from main.jsx BEFORE
// createRoot so a crash during boot is already in the buffer by the time anything can report it.
//
// Nothing here transmits. Nothing here persists. The rings live in renderer memory, are dropped
// on reload, and are read exactly once — when a human opens the feedback panel and presses Send.
// If you find yourself adding a timer, a flush, or a fetch to this file, the feature has become
// telemetry and the privacy contract in docs/specs/beta-feedback/spec.md §2 is broken.
//
// Sizes are deliberately small. A bug report needs the seconds around the failure, not the
// session; a bigger ring costs memory and buys a bigger payload nobody reads.

const SIZES = { console: 100, errors: 25, network: 40, interactions: 50 };

// A ring that allocates once and never grows. push() is O(1) and allocates nothing beyond the
// record itself — this runs on every console call and every fetch in the app.
function ring(size) {
  const buf = new Array(size);
  let n = 0;
  return {
    push(rec) { buf[n % size] = rec; n++; },
    // oldest → newest, which is the order a human reads a log in
    read() {
      const out = [];
      const start = Math.max(0, n - size);
      for (let i = start; i < n; i++) out.push(buf[i % size]);
      return out;
    },
    get count() { return n; },
    clear() { n = 0; }
  };
}

const rings = {
  console: ring(SIZES.console),
  errors: ring(SIZES.errors),
  network: ring(SIZES.network),
  interactions: ring(SIZES.interactions)
};

let t0 = 0;
let installed = false;
const since = () => Math.round(performance.now() - t0);

// Long values in a log line are almost always a payload someone dumped. Cap here as well as in
// shared/redact.mjs: this one keeps the ring small, that one keeps the report safe. Different jobs.
const CAP = 2000;
function flatten(arg) {
  if (typeof arg === 'string') return arg.length > CAP ? arg.slice(0, CAP) + '…' : arg;
  if (arg instanceof Error) return (arg.stack || arg.message || String(arg)).slice(0, CAP);
  if (arg === null || arg === undefined || typeof arg !== 'object') return String(arg);
  try {
    const s = JSON.stringify(arg);
    return s.length > CAP ? s.slice(0, CAP) + '…' : s;
  } catch { return '[unserialisable ' + (arg.constructor ? arg.constructor.name : 'object') + ']'; }
}

// ── console ─────────────────────────────────────────────────────────────────────────────────

function wrapConsole() {
  for (const level of ['error', 'warn', 'log', 'info']) {
    const original = console[level];
    if (typeof original !== 'function') continue;
    console[level] = function (...args) {
      // ALWAYS the original first, and outside the try. Devtools must behave identically with
      // this installed — a capture layer that can swallow a log line is worse than no capture.
      original.apply(console, args);
      try {
        rings.console.push({ level, t: since(), msg: args.map(flatten).join(' ') });
      } catch { /* capture must never break the app it is capturing */ }
    };
    console[level]._ffOriginal = original;
  }
}

// ── errors ──────────────────────────────────────────────────────────────────────────────────

function recordError(kind, message, stack, extra) {
  try {
    rings.errors.push({ kind, t: since(), message: flatten(message), stack: String(stack || '').slice(0, 4000), ...extra });
  } catch { /* see above */ }
}

// Exported so main.jsx's ErrorBoundary can forward what it catches. Today that boundary renders a
// card and the stack dies with it — the one crash a user is guaranteed to notice is the one we
// currently keep no record of.
export function recordBoundaryError(error, info) {
  recordError('react', error && (error.message || error), error && error.stack, {
    componentStack: String((info && info.componentStack) || '').slice(0, 2000)
  });
}

function wrapErrors() {
  window.addEventListener('error', e => {
    // A failed <img>/<video> load fires here with no `error` object. Worth recording — a broken
    // asset URL is a real bug in this app — but it is not a script crash and must not read as one.
    if (e.target && e.target !== window && e.target.tagName) {
      recordError('resource', (e.target.tagName || '').toLowerCase() + ' failed to load', '', {
        src: String(e.target.currentSrc || e.target.src || '').slice(0, 500)
      });
      return;
    }
    recordError('uncaught', e.message, e.error && e.error.stack, { source: e.filename, line: e.lineno, col: e.colno });
  }, true);

  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    recordError('rejection', r && (r.message || r), r && r.stack);
  });
}

// ── network ─────────────────────────────────────────────────────────────────────────────────

function wrapFetch() {
  const original = window.fetch;
  if (typeof original !== 'function') return;

  window.fetch = function (input, init) {
    const started = performance.now();
    const method = (init && init.method) || (typeof input === 'object' && input && input.method) || 'GET';
    let url = '';
    try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch { /* exotic input */ }

    const done = res => {
      try {
        const rec = {
          t: Math.round(started - t0),
          method: String(method).toUpperCase(),
          // Our own routes keep their query — it is evidence. Everything else loses it, because a
          // third-party query string is where signed credentials live.
          url: url.startsWith('/api') ? url : String(url).split('?')[0],
          status: res.status,
          ms: Math.round(performance.now() - started)
        };
        rings.network.push(rec);
        // Bodies are NOT captured (spec §2.5). The one exception is the `error` string our own
        // routes already return on a failure: it is written for a human, carries no secrets, and
        // is almost always the entire content of the bug report.
        if (!res.ok) {
          res.clone().json()
            .then(b => { if (b && b.error) { rec.error = String(b.error).slice(0, 500); if (b.code) rec.code = b.code; } })
            .catch(() => { /* non-JSON error body: the status is enough */ });
        }
      } catch { /* never let capture change a fetch outcome */ }
      return res;
    };

    // Pass-through: the returned promise is the original's, with a tap on each side. Nothing is
    // awaited on the happy path and no body is read before the caller gets it, so timing and
    // stream semantics are exactly what they were without this wrapper.
    return original.apply(this, arguments).then(done, err => {
      try {
        rings.network.push({
          t: Math.round(started - t0), method: String(method).toUpperCase(),
          url: url.startsWith('/api') ? url : String(url).split('?')[0],
          status: 0, ms: Math.round(performance.now() - started),
          error: String((err && err.message) || err).slice(0, 300)
        });
      } catch { /* as above */ }
      throw err;
    });
  };
  window.fetch._ffOriginal = original;
}

// ── interactions ────────────────────────────────────────────────────────────────────────────
//
// The repro trail, and the reason this feature does not need screen recording. What a tester did
// in the ten seconds before the bug is most of what "steps to reproduce" means, and it costs one
// listener rather than a video encoder, an upload and a permission prompt.
//
// HARD RULE, and the thing to check in any diff that touches this section: we record what an
// element IS, never what it CONTAINS. No .value, no .textContent, no innerText. A tester typing a
// client's name into a prompt field must not find it in a bug report.

function describe(el) {
  if (!el || !el.tagName) return null;
  const tag = el.tagName.toLowerCase();
  // Prefer an explicit marker, then the accessible name — both are authored strings, chosen by
  // us, and neither can contain anything the user typed.
  const label = el.getAttribute('data-ff')
    || el.getAttribute('aria-label')
    || el.getAttribute('title')
    || el.getAttribute('placeholder')
    || (el.getAttribute('type') && tag === 'input' ? tag + ':' + el.getAttribute('type') : '')
    || tag;
  return String(label).slice(0, 60);
}

function wrapInteractions() {
  document.addEventListener('click', e => {
    try {
      // Walk to the nearest thing that reads as a control; a click lands on a span inside a button
      // far more often than on the button, and "span" is not a repro step.
      let el = e.target;
      for (let i = 0; i < 5 && el && el !== document.body; i++) {
        if (el.tagName && /^(button|a|select|input|label)$/i.test(el.tagName)) break;
        if (el.getAttribute && (el.getAttribute('data-ff') || el.getAttribute('role') || el.getAttribute('aria-label'))) break;
        el = el.parentElement;
      }
      const what = describe(el);
      if (what) rings.interactions.push({ t: since(), kind: 'click', what });
    } catch { /* never break a click */ }
  }, true);
}

// Called by App.onKey and by the router/tab switches — they know their own names, and inferring a
// route from the DOM would be guesswork we do not need.
export function note(kind, what, extra) {
  try { rings.interactions.push({ t: since(), kind, what: String(what).slice(0, 80), ...(extra || {}) }); }
  catch { /* as above */ }
}

// ── public surface ──────────────────────────────────────────────────────────────────────────

export function install() {
  if (installed) return;      // vite HMR re-runs modules; double-wrapping would double every log
  installed = true;
  t0 = performance.now();
  wrapConsole();
  wrapErrors();
  wrapFetch();
  if (typeof document !== 'undefined') wrapInteractions();
}

/**
 * Everything the panel sends. Plain JSON, no live references — the payload must not change
 * between the review step rendering it and the send completing.
 */
export function snapshot() {
  return {
    console: rings.console.read(),
    errors: rings.errors.read(),
    network: rings.network.read(),
    interactions: rings.interactions.read(),
    // Counts, so the panel can say "40 of 214 calls" rather than implying the ring is the whole
    // story. A truncated log presented as complete is how a red herring becomes a wasted day.
    totals: {
      console: rings.console.count, errors: rings.errors.count,
      network: rings.network.count, interactions: rings.interactions.count
    },
    uptimeMs: since()
  };
}

// The most recent uncaught error, used to pre-fill the panel's title and to build the dedupe
// signature. Resource errors are excluded: a failed image is rarely the bug the user is reporting.
export function lastError() {
  const errs = rings.errors.read().filter(e => e.kind !== 'resource');
  return errs.length ? errs[errs.length - 1] : null;
}

// The most recent failed /api call — the other half of the signature, and the more useful half
// when the failure was server-side and the UI merely showed a toast.
export function lastFailedCall() {
  const calls = rings.network.read().filter(c => c.status === 0 || c.status >= 400);
  return calls.length ? calls[calls.length - 1] : null;
}

export const CAPTURE_SIZES = SIZES;

// ── surviving a reload ──────────────────────────────────────────────────────────────────────
//
// The crash a user is most likely to want to report is the one that replaced the whole UI with
// main.jsx's boundary card — at which point React is gone and the panel cannot be opened. So the
// card stashes the rings and reloads; the panel picks them up on the way back.
//
// sessionStorage, not localStorage: it dies with the tab, exactly like the rings themselves. This
// is unredacted and stays on the machine — redaction happens at the egress point (spec §2.2), and
// putting a second copy of the rules here would be a second source of truth for it.

const STASH = 'ff:feedback:stash';

export function stashForReport(extra) {
  try {
    sessionStorage.setItem(STASH, JSON.stringify({ ...snapshot(), stashedAt: Date.now(), ...(extra || {}) }));
    return true;
  } catch { return false; } // quota, private mode — the reload still helps, the evidence is just lost
}

// Read-and-clear: a stash is for exactly one report, and a stale one would attach last week's
// crash to an unrelated complaint.
export function takeStash() {
  try {
    const raw = sessionStorage.getItem(STASH);
    if (!raw) return null;
    sessionStorage.removeItem(STASH);
    const s = JSON.parse(raw);
    // Older than an hour is not "the thing that just happened" any more.
    return Date.now() - (s.stashedAt || 0) < 3_600_000 ? s : null;
  } catch { return null; }
}
