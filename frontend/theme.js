// frontend/theme.js — light/dark, one mechanism (docs/05_UI_SPEC.md §4).
//
// PURE-ish module, no React. It does exactly one thing: decide which of the two token sets is
// live and stamp it on <html> as `data-theme="dark" | "light"`. Everything else in the app reads
// `var(--x)` and never learns which theme it is in — that is the whole contract. If a component
// ever needs to know, the token it wants does not exist yet.
//
// THREE STATES, TWO OUTCOMES. The stored preference is 'system' | 'dark' | 'light'; the stamped
// attribute is only ever 'dark' or 'light'. Resolving `prefers-color-scheme` here rather than in
// CSS is deliberate: it means styles.css needs one selector instead of a media query AND a
// selector fighting over specificity, and it means `getTheme()` can answer "what did the person
// choose" separately from "what is on screen right now".
//
// Default is 'system' — the app follows the OS until the person says otherwise, and keeps
// following it (the media-query listener below) rather than freezing at whatever it was on
// first run.

const STORE_KEY = 'scout.theme';
export const THEMES = ['system', 'dark', 'light'];
const MEDIA = '(prefers-color-scheme: light)';

// Every DOM/storage touch is guarded: this module is imported by the token test, which runs in
// bare node, and by Electron's renderer where storage can be denied.
const hasDom = () => typeof document !== 'undefined' && !!document.documentElement;
function store() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

// What the OS says right now. No matchMedia (node, jsdom without it) → dark, which is the
// app's designed ground.
export function systemTheme() {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia(MEDIA).matches ? 'light' : 'dark';
    }
  } catch { /* denied */ }
  return 'dark';
}

// The stored PREFERENCE — 'system' | 'dark' | 'light'. Not the same question as "what is on
// screen": with 'system' stored, the screen can be either.
export function getTheme() {
  const raw = store()?.getItem(STORE_KEY);
  return THEMES.includes(raw) ? raw : 'system';
}

// The preference resolved to one of the two real token sets.
export function resolveTheme(pref = getTheme()) {
  return pref === 'light' || pref === 'dark' ? pref : systemTheme();
}

// What is currently stamped on <html>.
export function activeTheme() {
  if (!hasDom()) return resolveTheme();
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'light' ? 'light' : 'dark';
}

// Apply and persist. `t` is a preference ('system' | 'dark' | 'light'); anything unrecognised is
// treated as 'system' rather than throwing — a bad value in storage must not brick the app's
// chrome. Returns the RESOLVED theme, so a caller can render its own state without re-deriving it.
//
// `applyTheme()` with NO argument re-applies the STORED preference. That is the boot call, and it
// must not be "reset to system" — doing that would silently discard an explicit choice on every
// launch, which is the persistence half of the requirement.
export function applyTheme(t = getTheme()) {
  const pref = THEMES.includes(t) ? t : 'system';
  const resolved = resolveTheme(pref);
  try { store()?.setItem(STORE_KEY, pref); } catch { /* storage denied — the stamp still lands */ }
  if (hasDom()) {
    // Always explicit, never absent-means-dark: styles.css then needs exactly one selector, and
    // an inspector shows which theme is live instead of leaving it to be inferred.
    document.documentElement.setAttribute('data-theme', resolved);
    // Let the UA paint form controls, scrollbars and the window chrome to match. Without this the
    // scrollbars stay dark on a white page, which is the tell that a light mode was bolted on.
    document.documentElement.style.colorScheme = resolved;
  }
  notify(pref, resolved);
  return resolved;
}

// ⌥⌘L. Toggling from 'system' commits to the OPPOSITE of what is on screen — the person pressed
// a key to change something, so the screen must change. It stores an explicit choice, which is
// also how you get out of following the OS.
export function toggleTheme() {
  return applyTheme(activeTheme() === 'light' ? 'dark' : 'light');
}

// ── subscribers ─────────────────────────────────────────────────────────────────────────────
// A Settings screen wants to re-render when the theme changes, including when it changed because
// the OS did. Returns an unsubscribe.
const listeners = new Set();
export function onThemeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify(pref, resolved) { for (const fn of [...listeners]) { try { fn({ pref, resolved }); } catch { /* a bad subscriber must not break the toggle */ } } }

// ── init ────────────────────────────────────────────────────────────────────────────────────
// Call once from the app entry, BEFORE first paint, or the app flashes dark on a light machine.
// Idempotent: a second call re-applies and rebinds nothing.
//
// This is the FULL setup — `applyTheme()` alone only paints. Prefer it over `applyTheme()` at the
// entry point, and then do NOT bind ⌥⌘L again in the caller: two handlers on one chord toggle
// twice and the screen never changes. Two things live only here:
//   · following the OS while the preference is 'system', for the rest of the session;
//   · a ⌥⌘L binding that matches on `e.code`, because macOS reports `e.key` as '¬' when Option
//     is held on some engines — matching only `e.key === 'l'` is how that shortcut silently
//     does nothing on the one platform this app ships on first.
let bound = false;
export function initTheme() {
  const resolved = applyTheme(getTheme());
  if (bound || typeof window === 'undefined') return resolved;
  bound = true;

  // Follow the OS while the preference is 'system' — and only then. A person who chose light
  // does not want their app flipping at sunset.
  try {
    const mq = window.matchMedia(MEDIA);
    const onOs = () => { if (getTheme() === 'system') applyTheme('system'); };
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onOs);
    else if (typeof mq.addListener === 'function') mq.addListener(onOs); // older WebKit
  } catch { /* no matchMedia — stays on whatever is stored */ }

  // ⌥⌘L. metaKey + altKey, and `e.code` rather than `e.key`: with Option held, macOS reports
  // `e.key` as '¬', not 'l'. Matching on the physical key is what makes the shortcut fire at all.
  // Reserved by docs/../keymap.js's rule that anything with ⌘/⌃/⌥ is not rebindable.
  window.addEventListener('keydown', e => {
    if (e.metaKey && e.altKey && !e.ctrlKey && (e.code === 'KeyL' || String(e.key).toLowerCase() === 'l')) {
      e.preventDefault();
      toggleTheme();
    }
  });
  return resolved;
}

export default { THEMES, getTheme, resolveTheme, activeTheme, systemTheme, applyTheme, toggleTheme, onThemeChange, initTheme };
