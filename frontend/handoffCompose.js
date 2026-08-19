// Manual handoff composer — "what would FrameForge have sent?", as text you can paste elsewhere.
//
// Named handoffCompose, not manualHandoff: this repo lives on a case-insensitive volume, where
// `manualHandoff.js` and the `ManualHandoff.jsx` component resolve to the same module and the
// bundler fails with a bewildering "default is not exported". Keep the two names distinct.
//
// The whole value of the manual round-trip depends on ONE property: the prompt a user pastes into
// Google Flow must be byte-identical to the prompt /api/generate would have received for that shot.
// The moment this file starts composing its own prompt — joining a look with `a + ', ' + b`,
// picking its own model default, reading `sh.prompt` raw — the manual path silently renders
// something different from the API path and the two workflows stop being the same app.
//
// So: this delegates to shotGenerateBody (frontend/shotGenerate.js), the single shot→generation
// composer, and takes its `.prompt` verbatim. It adds nothing to the prompt text and never
// re-derives look, cast, location or model. If a prompt looks wrong here, it is wrong in
// /api/generate too, and the fix belongs in shotGenerate.js.
//
// Refs are carried as NAMES only. An external tool can't consume our file paths, but a director
// pasting into Flow still needs to know "attach the Mara turnaround and the dock plate" — so the
// names ride along as a reminder in the sheet, not as data anything downstream resolves.
import { shotGenerateBody, entityIndex, defaultShotModel } from './shotGenerate';

// Shots → handoff entries, in the order given. Shots with no prompt are reported as `skipped`
// rather than silently dropped: "12 shots" that hands out 9 prompts is a bug the user must see.
export function handoffEntries(app, pid, shots, opts = {}) {
  const idx = entityIndex(app, pid);
  const entries = [], skipped = [];
  for (const sh of shots) {
    const body = shotGenerateBody(app, pid, sh, { ...opts, entityIndex: idx });
    if (!body) { skipped.push({ shot: sh.id, reason: 'no prompt or description yet' }); continue; }
    entries.push({
      shot: sh.id,
      title: sh.title || '',
      prompt: body.prompt,
      model: body.model,
      aspect: body.aspect,
      refs: (body.refs || []).map(r => r.name)
    });
  }
  return { entries, skipped };
}

// The model the shots WOULD have used — shown in the handoff dialog so the user can pick a
// comparable one in the external tool. Read from the same resolver the generate path uses.
export function intendedModel(app, pid) { return defaultShotModel(app, pid); }
