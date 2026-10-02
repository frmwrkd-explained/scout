import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkClock, WORK_IDLE_MS } from '../frontend/workClock.js';
import { loadJsx } from './helpers.mjs';

class Events {
  hidden = false;
  listeners = new Map();
  addEventListener(name, fn) {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(fn);
    this.listeners.set(name, listeners);
  }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name) { for (const fn of this.listeners.get(name) ?? []) fn({ type: name }); }
  get count() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}

const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
function deferred() {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
  return { promise, resolve };
}

function harness(overrides = {}) {
  let time = 10_000;
  let seq = 0;
  const timers = new Map();
  const window = new Events();
  const document = new Events();
  const server = { id: 'a', running: true, started: time, day: '2026-10-02' };
  const calls = [];
  const errors = [];
  let changes = 0;
  const pause = async () => {
    calls.push('pause');
    if (overrides.pause) return overrides.pause(server, calls);
    const paused = server.running;
    server.running = false;
    return { paused, ...(paused ? { id: server.id } : {}) };
  };
  const resume = async () => {
    calls.push('resume');
    if (overrides.resume) return overrides.resume(server, calls);
    const resumed = !server.running;
    server.running = true;
    server.started = time;
    return { resumed, id: server.id };
  };
  const controller = createWorkClock({
    window, document, now: () => time,
    setInterval(fn, interval) { const id = ++seq; timers.set(id, { fn, interval, due: time + interval }); return id; },
    clearInterval(id) { timers.delete(id); },
    pause, resume,
    onChanged() { changes += 1; },
    onError(error, action) { errors.push({ action, message: error.message }); },
  });
  const snapshot = () => ({ day: server.day, now: { id: server.id, clock: { running: server.running, started: server.started } } });
  return {
    controller, window, document, server, calls, errors, snapshot,
    get changes() { return changes; },
    get timers() { return timers.size; },
    async advance(ms) {
      const end = time + ms;
      while (true) {
        const next = [...timers.values()].filter(timer => timer.due <= end).sort((a, b) => a.due - b.due)[0];
        if (!next) break;
        time = next.due;
        next.due += next.interval;
        next.fn();
        await flush();
      }
      time = end;
      await flush();
    },
  };
}

test('no Today snapshot means no clock calls, even after hours hidden', async t => {
  const h = harness();
  t.after(() => h.controller.dispose());
  h.document.hidden = true;
  h.document.emit('visibilitychange');
  await h.advance(2 * 60 * 60 * 1000);
  h.document.hidden = false;
  h.document.emit('visibilitychange');
  await flush();
  assert.deepEqual(h.calls, []);
});

test('idle capture and activity resume continue after navigating away from Today', async t => {
  const h = harness();
  t.after(() => h.controller.dispose());
  h.controller.update(h.snapshot());
  // Today unmounts here: it supplies no more snapshots. The App controller still receives
  // input from a document and owns its timer for the rest of the app's lifetime.
  await h.advance(WORK_IDLE_MS - 1);
  assert.deepEqual(h.calls, []);
  await h.advance(1);
  assert.deepEqual(h.calls, ['pause']);
  assert.equal(h.server.running, false);
  h.window.emit('keydown');
  await flush();
  assert.deepEqual(h.calls, ['pause', 'resume']);
  assert.equal(h.server.running, true);
  assert.equal(h.changes, 2, 'Today receives one refresh signal per successful transition');
});

test('hiding the window pauses immediately; hidden input cannot resume it', async t => {
  const h = harness();
  t.after(() => h.controller.dispose());
  h.controller.update(h.snapshot());
  h.document.hidden = true;
  h.document.emit('visibilitychange');
  await flush();
  assert.deepEqual(h.calls, ['pause']);
  h.window.emit('mousemove');
  h.window.emit('keydown');
  await h.advance(15_000);
  assert.deepEqual(h.calls, ['pause']);
  h.document.hidden = false;
  h.document.emit('visibilitychange');
  await flush();
  assert.deepEqual(h.calls, ['pause', 'resume']);
});

test('manual Pause remains paused across activity and visibility changes', async t => {
  const h = harness();
  t.after(() => h.controller.dispose());
  h.controller.update(h.snapshot());
  h.controller.setBusy(true);
  h.controller.manualAction('pause');
  h.server.running = false;
  h.controller.update(h.snapshot());
  h.controller.setBusy(false);
  h.window.emit('pointerdown');
  h.document.hidden = true;
  h.document.emit('visibilitychange');
  h.document.hidden = false;
  h.document.emit('visibilitychange');
  await h.advance(WORK_IDLE_MS);
  assert.deepEqual(h.calls, []);
  assert.equal(h.server.running, false);
});

test('automatic clock changes wait for an explicit Today action to finish', async t => {
  const h = harness();
  t.after(() => h.controller.dispose());
  h.controller.update(h.snapshot());
  h.controller.setBusy(true);
  h.document.hidden = true;
  h.document.emit('visibilitychange');
  await h.advance(30_000);
  assert.deepEqual(h.calls, []);
  h.controller.setBusy(false);
  await flush();
  assert.deepEqual(h.calls, ['pause']);
});

test('a no-op pause for an already stopped server clock grants no resume permission', async t => {
  const h = harness();
  t.after(() => h.controller.dispose());
  h.controller.update(h.snapshot());
  h.server.running = false; // a manual pause occurred before the next snapshot
  h.document.hidden = true;
  h.document.emit('visibilitychange');
  await flush();
  h.document.hidden = false;
  h.document.emit('visibilitychange');
  await flush();
  assert.deepEqual(h.calls, ['pause']);
  assert.equal(h.server.running, false);
});

test('failed automatic pause and resume both retry without another input event', async t => {
  let pauses = 0;
  let resumes = 0;
  const h = harness({
    pause(server) {
      if (++pauses === 1) throw new Error('server unreachable');
      server.running = false;
      return { paused: true, id: server.id };
    },
    resume(server) {
      if (++resumes === 1) throw new Error('server unreachable');
      server.running = true;
      return { resumed: true, id: server.id };
    },
  });
  t.after(() => h.controller.dispose());
  h.controller.update(h.snapshot());
  h.document.hidden = true;
  h.document.emit('visibilitychange');
  await flush();
  assert.deepEqual(h.calls, ['pause']);
  await h.advance(15_000);
  assert.equal(h.server.running, false);
  h.document.hidden = false;
  h.document.emit('visibilitychange');
  await flush();
  assert.deepEqual(h.calls, ['pause', 'pause', 'resume']);
  await h.advance(15_000);
  assert.deepEqual(h.calls, ['pause', 'pause', 'resume', 'resume']);
  assert.equal(h.server.running, true);
  assert.deepEqual(h.errors.map(error => error.action), ['pause', 'resume']);
});

test('activity during a slow pause is resumed as soon as that pause completes', async t => {
  const pending = deferred();
  const h = harness({ pause: () => pending.promise });
  t.after(() => h.controller.dispose());
  h.controller.update(h.snapshot());
  await h.advance(WORK_IDLE_MS);
  h.window.emit('keydown');
  assert.deepEqual(h.calls, ['pause']);
  h.server.running = false;
  pending.resolve({ paused: true, id: h.server.id });
  await flush();
  assert.deepEqual(h.calls, ['pause', 'resume']);
  assert.equal(h.server.running, true);
});

test('a stale pre-pause poll cannot revoke automatic-pause ownership', async t => {
  const h = harness();
  t.after(() => h.controller.dispose());
  const before = h.snapshot();
  h.controller.update(before);
  await h.advance(WORK_IDLE_MS);
  h.controller.update(before);
  h.window.emit('keydown');
  await flush();
  assert.deepEqual(h.calls, ['pause', 'resume']);
});

test('switching the Now item clears permission to resume the previous item', async t => {
  const h = harness();
  t.after(() => h.controller.dispose());
  h.controller.update(h.snapshot());
  await h.advance(WORK_IDLE_MS);
  h.server.id = 'b'; // another item is manually paused
  h.controller.update(h.snapshot());
  h.window.emit('keydown');
  await flush();
  assert.deepEqual(h.calls, ['pause']);
  assert.equal(h.server.running, false);
});

test('a new day clears automatic-pause ownership even when an item keeps its id', async t => {
  const h = harness();
  t.after(() => h.controller.dispose());
  h.controller.update(h.snapshot());
  await h.advance(WORK_IDLE_MS);
  h.server.day = '2026-10-03';
  h.controller.update(h.snapshot());
  h.window.emit('keydown');
  await flush();
  assert.deepEqual(h.calls, ['pause']);
});

test('manual clock intent defeats a late automatic-pause response', async t => {
  const pending = deferred();
  const h = harness({ pause: () => pending.promise });
  t.after(() => h.controller.dispose());
  h.controller.update(h.snapshot());
  await h.advance(WORK_IDLE_MS);
  h.controller.setBusy(true);
  h.controller.manualAction('pause');
  h.server.running = false;
  pending.resolve({ paused: true, id: h.server.id });
  await flush();
  h.controller.update(h.snapshot());
  h.controller.setBusy(false);
  h.window.emit('keydown');
  await flush();
  assert.deepEqual(h.calls, ['pause']);
  assert.equal(h.changes, 0, 'a superseded automatic request cannot publish stale state');
});

test('workspace reset discards old clock ownership and pending callbacks', async t => {
  const pending = deferred();
  const h = harness({ pause: () => pending.promise });
  t.after(() => h.controller.dispose());
  h.controller.update(h.snapshot());
  await h.advance(WORK_IDLE_MS);
  h.controller.reset();
  pending.resolve({ paused: true, id: 'a' });
  await flush();
  h.window.emit('keydown');
  await h.advance(WORK_IDLE_MS);
  assert.deepEqual(h.calls, ['pause']);
  assert.equal(h.changes, 0);
  h.server.running = false;
  h.controller.update(h.snapshot());
  h.window.emit('keydown');
  await flush();
  assert.deepEqual(h.calls, ['pause'], 'a same-named item in the new workspace is not auto-resumed');
});

test('App clock callbacks stay stable and reject old-workspace loader responses', async () => {
  const { default: App } = await loadJsx('frontend/App.jsx');
  const app = new App({});
  const calls = [];
  app.workClock = {
    update(value) { calls.push(['state', value]); },
    setBusy(value) { calls.push(['busy', value]); },
    manualAction(value) { calls.push(['intent', value]); },
    reset() { calls.push(['reset']); },
  };
  app.state.storageRoot = 'old';
  const previous = app.getWorkClockCallbacks();
  assert.equal(app.getWorkClockCallbacks(), previous);
  previous.onWorkClockState('old-valid');
  app.state.storageRoot = 'new';
  app.componentDidUpdate({}, { storageRoot: 'old' });
  previous.onWorkClockState('old-late');
  previous.onWorkClockBusy(false);
  previous.onWorkClockIntent('pause');
  const current = app.getWorkClockCallbacks();
  assert.notEqual(current, previous);
  current.onWorkClockState('new-valid');
  assert.deepEqual(calls, [['state', 'old-valid'], ['reset'], ['state', 'new-valid']]);
});

test('disposal removes listeners and timers and ignores an unfinished request', async () => {
  const pending = deferred();
  const h = harness({ pause: () => pending.promise });
  h.controller.update(h.snapshot());
  await h.advance(WORK_IDLE_MS);
  h.controller.dispose();
  assert.equal(h.window.count, 0);
  assert.equal(h.document.count, 0);
  assert.equal(h.timers, 0);
  pending.resolve({ paused: true, id: 'a' });
  await flush();
  h.window.emit('keydown');
  await h.advance(WORK_IDLE_MS);
  assert.deepEqual(h.calls, ['pause']);
  assert.equal(h.changes, 0);
});
