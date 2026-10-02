// App-lifetime idle detection. The server's event log remains the only work clock; this
// controller sends its pause/resume verbs and keeps the last reported Now item across routes.
// It never opens Today or fetches its plan. Until Today supplies a snapshot, it does nothing.

export const WORK_IDLE_MS = 5 * 60 * 1000;
const TICK_MS = 15 * 1000;
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'pointerdown', 'touchstart', 'wheel'];
const clockKey = clock => clock ? `${clock.day}/${clock.id}` : null;

export function createWorkClock({
  window: windowEvents = globalThis.window,
  document: documentEvents = globalThis.document,
  now = Date.now,
  setInterval: schedule = globalThis.setInterval,
  clearInterval: cancel = globalThis.clearInterval,
  pause, resume, onChanged = () => {}, onError = () => {},
  idleMs = WORK_IDLE_MS, tickMs = TICK_MS,
}) {
  let clock = null;
  let automaticPause = null;
  let lastActive = now();
  let busy = false;
  let disposed = false;
  let intentVersion = 0;
  let inFlight = null;
  let retryAt = 0;
  let reportedError = null;

  const inactive = () => documentEvents.hidden || now() - lastActive >= idleMs;

  async function reconcile() {
    if (disposed || busy || inFlight || !clock || now() < retryAt) return;
    const idle = inactive();
    const action = clock.running && idle ? 'pause'
      : !clock.running && !idle && automaticPause?.key === clockKey(clock) ? 'resume' : null;
    if (!action) return;
    const request = { action, clock: { ...clock }, version: intentVersion };
    inFlight = request;
    let failed = false;
    try {
      const result = await (action === 'pause' ? pause() : resume());
      if (disposed || request.version !== intentVersion) return;
      retryAt = 0;
      reportedError = null;
      if (action === 'pause') {
        const id = result?.id ?? request.clock.id;
        clock = { ...request.clock, id, running: false };
        // A no-op pause means someone else stopped it. Only a successful automatic pause
        // gives this controller permission to resume it on the person's next activity.
        automaticPause = result?.paused === true
          ? { key: clockKey(clock), started: request.clock.started }
          : null;
      } else {
        clock = { ...clock, running: result?.resumed === true || result?.already === true, started: now() };
        automaticPause = null;
      }
      onChanged();
    } catch (error) {
      if (disposed || request.version !== intentVersion) return;
      failed = true;
      retryAt = now() + tickMs;
      // Ownership survives a failed resume, so the timer retries even if no further input
      // arrives. A failed pause remains running and is retried while idle or hidden.
      if (reportedError !== action) onError(error, action);
      reportedError = action;
    } finally {
      if (inFlight === request) inFlight = null;
      // Activity may have arrived during a slow pause request. Once it succeeds, resume
      // immediately instead of leaving an active person paused until the next tick.
      if (!failed && !disposed && request.version === intentVersion) void reconcile();
    }
  }

  const activity = () => {
    if (disposed || documentEvents.hidden) return;
    lastActive = now();
    void reconcile();
  };
  const visibility = () => {
    if (documentEvents.hidden) void reconcile();
    else activity();
  };
  for (const event of ACTIVITY_EVENTS) windowEvents.addEventListener(event, activity, { passive: true });
  documentEvents.addEventListener('visibilitychange', visibility);
  const timer = schedule(() => { void reconcile(); }, tickMs);

  return {
    update(today) {
      if (disposed) return;
      const item = today?.now;
      const next = item?.id ? {
        id: item.id, day: today.day, running: !!item.clock?.running, started: item.clock?.started,
      } : null;
      if (clockKey(next) !== clockKey(clock)) {
        intentVersion += 1;
        automaticPause = null;
        retryAt = 0;
      }
      // A poll that began before our pause can arrive afterward with the old start event.
      // It cannot revoke automatic-pause ownership. A genuinely new start event can.
      if (automaticPause && next?.running && next.started === automaticPause.started) return;
      if (next?.running) automaticPause = null;
      clock = next;
      void reconcile();
    },
    setBusy(value) {
      if (disposed) return;
      busy = !!value;
      if (!busy) void reconcile();
    },
    manualAction() {
      if (disposed) return;
      intentVersion += 1;
      automaticPause = null;
      retryAt = 0;
      reportedError = null;
    },
    reset() {
      if (disposed) return;
      intentVersion += 1;
      clock = null;
      automaticPause = null;
      busy = false;
      inFlight = null;
      retryAt = 0;
      reportedError = null;
      lastActive = now();
    },
    dispose() {
      disposed = true;
      intentVersion += 1;
      cancel(timer);
      for (const event of ACTIVITY_EVENTS) windowEvents.removeEventListener(event, activity);
      documentEvents.removeEventListener('visibilitychange', visibility);
    },
  };
}
