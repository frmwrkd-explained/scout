/* Kie job polling — terminal states, and the cost of not recognising one.
 *
 * A user hit "kie/flux-2 timed out after 300s (last job state: fail)". The job had failed after
 * ~65 seconds; Kie says `fail`, the poll loop tested for `failed`, so the terminal state went
 * unrecognised and the loop ran the full five minutes against a job that was already dead. The
 * message even printed the real state while claiming a timeout.
 *
 * The generation itself was fine — Kie returned a transient `500 internal error`, and the same
 * request succeeded on retry. So this file is about the loop, not the payload: a dead job must be
 * reported as dead, promptly, with the provider's own reason.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.FRFG_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'frfg-kie-'));
process.env.KIE_API_KEY = 'test-key-not-used-against-the-network';

const { runProvider } = await import('../backend/providers.mjs');

/* Stub the network. createTask hands back a taskId; recordInfo replies with whatever `states`
   supplies, one entry per poll. Nothing here may reach api.kie.ai. */
function withKie(states, fn) {
  const real = globalThis.fetch;
  let i = 0;
  globalThis.fetch = async url => {
    const u = String(url);
    if (u.includes('/jobs/createTask')) {
      return { ok: true, status: 200, json: async () => ({ code: 200, data: { taskId: 'stub-task' } }) };
    }
    if (u.includes('/jobs/recordInfo')) {
      const d = states[Math.min(i++, states.length - 1)];
      return { ok: true, status: 200, json: async () => ({ code: 200, data: d }) };
    }
    throw new Error('unexpected fetch in test: ' + u);
  };
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = real; });
}

const gen = extra => runProvider('kie', {
  model: 'kie/nano-banana-pro', prompt: 'x', aspect: '16:9', resolution: '2K', refUrls: [], ...extra,
});

test('state "fail" terminates the poll instead of running to the timeout', async () => {
  const t0 = Date.now();
  await withKie(
    [{ state: 'waiting' }, { state: 'fail', failCode: '500', failMsg: 'internal error, please try again later.' }],
    async () => {
      await assert.rejects(gen(), err => {
        assert.match(err.message, /internal error, please try again later/,
          "the provider's own reason must survive to the user, not be replaced by a timeout");
        assert.doesNotMatch(err.message, /timed out/, 'a failed job is not a timeout');
        return true;
      });
    });
  // The image poll interval is 2.5s, so two polls is ~5s. The bug made this 300s.
  assert.ok(Date.now() - t0 < 60_000, 'a dead job must be reported promptly, took ' + (Date.now() - t0) + 'ms');
});

test('every spelling of failure is terminal', async () => {
  for (const state of ['fail', 'failed', 'failure', 'error', 'cancelled']) {
    await withKie([{ state, failMsg: 'nope' }], async () => {
      await assert.rejects(gen(), /Kie job failed/, state + ' must be treated as terminal');
    });
  }
});

test('successFlag still terminates when the textual state is absent', async () => {
  // Some Kie endpoints answer with a numeric flag rather than a state string; both must work.
  await withKie([{ successFlag: 2, failMsg: 'flagged failure' }], async () => {
    await assert.rejects(gen(), /flagged failure/);
  });
});

test('a successful job returns its media URL', async () => {
  await withKie([{ state: 'waiting' }, { state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://example.test/a.png'] }) }],
    async () => {
      const out = await gen();
      assert.equal(out.fileUrl, 'https://example.test/a.png');
    });
});

test('in-progress states keep polling rather than being read as terminal', async () => {
  // `waiting` is the one Kie actually uses, but a queue/generating state must not look like an end.
  await withKie([{ state: 'waiting' }, { state: 'queuing' }, { state: 'generating' },
                 { state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://example.test/b.png'] }) }],
    async () => {
      const out = await gen();
      assert.equal(out.fileUrl, 'https://example.test/b.png');
    });
});
