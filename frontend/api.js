// Surface the server's { error } message rather than a bare status code — every route sends a
// human-readable reason, and swallowing it made unrelated failures show the wrong toast.
const j = async r => {
  if (!r.ok) {
    let msg = 'api ' + r.status, code = null;
    try { const b = await r.clone().json(); if (b && b.error) msg = b.error; if (b && b.code) code = b.code; } catch { /* non-JSON body */ }
    const err = new Error(msg);
    // Carry the server's discriminator ('not-configured' | 'no-entry' | …) so callers can render a
    // failure-specific empty state instead of one catch-all headline. Dropping it here is why every
    // Remotion failure used to read "No Remotion project connected", including the ones where it was.
    err.code = code;
    err.status = r.status;
    throw err;
  }
  return r.json();
};
const opts = body => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  state: () => fetch('/api/state').then(j),
  // Delta probe. Returns either {revision, full:false, changed:[domains]} — 40 bytes, ~2ms — or,
  // when the server can't answer from its change log (restart, or a gap longer than the ring
  // buffer), the FULL state payload, which has no `full` key. Callers must handle both: see
  // App.sync(). The server has always supported this; nothing called it, so every idle fallback
  // poll rebuilt and shipped the entire ~270KB state instead.
  stateSince: rev => fetch('/api/state?since=' + encodeURIComponent(rev)).then(j),
  // projects
  createProject: (name, sub, gradIx) => fetch('/api/projects', { method: 'POST', ...opts({ name, sub, gradIx }) }).then(j),
  patchProject: (pid, patch) => fetch('/api/projects/' + pid, { method: 'PATCH', ...opts(patch) }).then(j),
  // DEV-136 — agent mode for the new-project dialog. PROPOSES ONLY: nothing is written until the
  // user confirms and the ordinary createProject runs.
  proposeProject: idea => fetch('/api/projects/propose', { method: 'POST', ...opts({ idea }) }).then(j),
  archiveProject: pid => fetch('/api/projects/' + pid + '/archive', { method: 'POST' }).then(j),
  restoreProject: dir => fetch('/api/projects/restore', { method: 'POST', ...opts({ dir }) }).then(j),
  // asset rename / move / folder rename
  renameAsset: (scope, name, folder, newName) => fetch('/api/assets/' + scope + '/rename', { method: 'POST', ...opts({ name, folder: folder || '', newName }) }).then(j),
  moveAsset: (scope, name, folder, toFolder) => fetch('/api/assets/' + scope + '/move', { method: 'POST', ...opts({ name, folder: folder || '', toFolder: toFolder || '' }) }).then(j),
  renameFolder: (scope, name, newName) => fetch('/api/assets/' + scope + '/rename-folder', { method: 'POST', ...opts({ name, newName }) }).then(j),
  // reveal a file (name set) or open a board folder (name empty) in Finder
  revealAsset: (scope, name, folder) => fetch('/api/assets/' + scope + '/reveal', { method: 'POST', ...opts({ name: name || '', folder: folder || '' }) }).then(j),
  // shots reorder / duplicate
  reorderShots: (pid, order) => fetch('/api/story/' + pid + '/shots/reorder', { method: 'PATCH', ...opts({ order }) }).then(j),
  duplicateShot: (pid, id) => fetch('/api/story/' + pid + '/shots/' + encodeURIComponent(id) + '/duplicate', { method: 'POST' }).then(j),
  patchPrompt: (file, patch) => fetch('/api/prompts/' + encodeURIComponent(file), { method: 'PATCH', ...opts(patch) }).then(j),
  // live key tests + remotion starter
  testKey: service => fetch('/api/test/' + service).then(j),
  // fal full-catalog mirror (Settings → provider cards)
  falCatalog: () => fetch('/api/catalog/fal').then(j),
  syncFalCatalog: () => fetch('/api/catalog/fal/sync', { method: 'POST' }).then(j),
  remotionTemplate: overwrite => fetch('/api/remotion/template', { method: 'POST', ...opts({ overwrite: !!overwrite }) }).then(r => r.json()),
  // generation hub (F2)
  generate: body => fetch('/api/generate', { method: 'POST', ...opts(body) }).then(j),
  generations: pid => fetch('/api/generations/' + pid).then(j),
  saveGenToShot: (pid, id, shot, final) => fetch('/api/generations/' + pid + '/' + id + '/save-to-shot', { method: 'POST', ...opts({ shot: shot || null, final: !!final }) }).then(j),
  saveGenToBoard: (pid, id, folder) => fetch('/api/generations/' + pid + '/' + id + '/save-to-board', { method: 'POST', ...opts({ folder }) }).then(j),
  deleteGen: (pid, id) => fetch('/api/generations/' + pid + '/' + id, { method: 'DELETE' }).then(j),
  // Phase 2 candidate review — decisions live on the generation record (the candidate)
  reviewCandidate: (pid, id, body) => fetch('/api/generations/' + pid + '/' + id + '/review', { method: 'PATCH', ...opts(body) }).then(j),
  rerollCandidate: (pid, id, body) => fetch('/api/generations/' + pid + '/' + id + '/reroll', { method: 'POST', ...opts(body || {}) }).then(j),
  promoteCandidate: (pid, id, body) => fetch('/api/generations/' + pid + '/' + id + '/promote', { method: 'POST', ...opts(body || {}) }).then(j),
  renderUrl: (pid, name) => '/api/renders/' + pid + '/file?name=' + encodeURIComponent(name),
  revealRender: (pid, name) => fetch('/api/renders/' + pid + '/reveal', { method: 'POST', ...opts({ name }) }).then(j),
  // manual round-trip (backend/manual.mjs) — prompts out, downloads back in
  manual: pid => fetch('/api/manual/' + pid).then(j),
  manualHandoff: (pid, body) => fetch('/api/manual/' + pid + '/handoff', { method: 'POST', ...opts(body) }).then(j),
  manualCloseHandoff: (pid, id, status) => fetch('/api/manual/' + pid + '/handoff/' + encodeURIComponent(id), { method: 'PATCH', ...opts({ status }) }).then(j),
  manualScan: (pid, handoff) => fetch('/api/manual/' + pid + '/scan', { method: 'POST', ...opts({ handoff: handoff || null }) }).then(j),
  manualSort: (pid, body) => fetch('/api/manual/' + pid + '/sort', { method: 'POST', ...opts(body || {}) }).then(j),
  manualApply: (pid, decisions) => fetch('/api/manual/' + pid + '/apply', { method: 'POST', ...opts({ decisions }) }).then(j),
  manualDiscard: (pid, name) => fetch('/api/manual/' + pid + '/file', { method: 'DELETE', ...opts({ name }) }).then(j),
  manualReveal: pid => fetch('/api/manual/' + pid + '/reveal', { method: 'POST' }).then(j),
  // File bodies go up raw, exactly like the context/library drop zones — no multipart parser in
  // this app. The inbox preview reads back through the same route by name.
  manualUpload: (pid, file) => fetch('/api/manual/' + pid + '/upload?name=' + encodeURIComponent(file.name), { method: 'POST', body: file }).then(j),
  manualFileUrl: (pid, name) => '/api/manual/' + pid + '/file?name=' + encodeURIComponent(name),
  // looks (F3.3)
  looks: () => fetch('/api/looks').then(j),
  extractLook: (scope, name, folder, measurements, provider) => fetch('/api/looks/extract', { method: 'POST', ...opts({ scope, name, folder: folder || '', measurements, provider }) }).then(j),
  // reads a contact sheet back into a move id from frontend/cameraMovements.js
  analyzeMove: (scope, name, folder, provider) => fetch('/api/moves/analyze', { method: 'POST', ...opts({ scope, name, folder: folder || '', provider }) }).then(j),
  deleteLook: id => fetch('/api/looks/' + encodeURIComponent(id), { method: 'DELETE' }).then(j),
  // SCOPED item identity (Phase 1) — { projectId, itemId }. The client NEVER calls the legacy
  // /api/items/:id routes (those exist only as deprecated wrappers that 409 on ambiguous ids).
  patchItem: (pid, id, body) => fetch('/api/projects/' + pid + '/items/' + encodeURIComponent(id), { method: 'PATCH', ...opts(body) }).then(j),
  note: (pid, id, text, extra) => fetch('/api/projects/' + pid + '/items/' + encodeURIComponent(id) + '/note', { method: 'POST', ...opts({ text, ...(extra || {}) }) }).then(j),
  trashItem: (pid, id) => fetch('/api/projects/' + pid + '/items/' + encodeURIComponent(id) + '/trash', { method: 'POST' }).then(j),
  restoreItem: (pid, id) => fetch('/api/projects/' + pid + '/items/' + encodeURIComponent(id) + '/restore', { method: 'POST' }).then(j),
  emptyTrash: () => fetch('/api/trash/empty', { method: 'POST' }).then(j),
  actions: () => fetch('/api/actions').then(j),
  undoAction: id => fetch('/api/actions/' + encodeURIComponent(id) + '/undo', { method: 'POST' }).then(j),
  // the Reel (animatic) — derived from shots on every read, so there is nothing to import or sync
  reel: pid => fetch('/api/reel/' + pid).then(j),
  reelSources: pid => fetch('/api/reel/' + pid + '/sources').then(j),
  patchReel: (pid, patch, log) => fetch('/api/reel/' + pid, { method: 'PATCH', ...opts({ patch, log }) }).then(j),
  layDownShots: (pid, body) => fetch('/api/reel/' + pid + '/laydown', { method: 'POST', ...opts(body || {}) }).then(j),
  addReelClip: (pid, spec) => fetch('/api/reel/' + pid + '/clips', { method: 'POST', ...opts(spec) }).then(j),
  patchReelClip: (pid, id, patch) => fetch('/api/reel/' + pid + '/clips/' + id, { method: 'PATCH', ...opts(patch) }).then(j),
  deleteReelClip: (pid, id, ripple) => fetch('/api/reel/' + pid + '/clips/' + id + (ripple ? '?ripple=1' : ''), { method: 'DELETE' }).then(j),
  setClipTake: (pid, id, generation) => fetch('/api/reel/' + pid + '/clips/' + id + '/take', { method: 'POST', ...opts({ generation }) }).then(j),
  exportReel: (pid, formats) => fetch('/api/reel/' + pid + '/export', { method: 'POST', ...opts({ formats }) }).then(j),
  renderReel: pid => fetch('/api/reel/' + pid + '/render', { method: 'POST' }).then(j),
  renderReelJob: (pid, id) => fetch('/api/reel/' + pid + '/render/' + id).then(j),
  // ── the Board (per-project infinite canvas) — backend/board.mjs ──
  // Node writes are batched by the component (one PATCH per gesture, not per mousemove); every
  // route here maps 1:1 onto an operation in board.mjs so the agent tool and the UI share a path.
  board: pid => fetch('/api/board/' + pid).then(j),
  // `base` is the document's `rev` this edit was built from. The server 409s rather than
  // letting a stale page write its whole node list over a newer one (see backend/board.mjs).
  patchBoard: (pid, patch, log, base) => fetch('/api/board/' + pid, { method: 'PATCH', ...opts({ patch, log, base: base || null }) }).then(j),
  addBoardNodes: (pid, nodes, log) => fetch('/api/board/' + pid + '/nodes', { method: 'POST', ...opts({ nodes, log }) }).then(j),
  patchBoardNodes: (pid, nodes, log) => fetch('/api/board/' + pid + '/nodes', { method: 'PATCH', ...opts({ nodes, log }) }).then(j),
  deleteBoardNodes: (pid, ids, log) => fetch('/api/board/' + pid + '/nodes', { method: 'DELETE', ...opts({ ids, log }) }).then(j),
  syncBoardShots: (pid, only) => fetch('/api/board/' + pid + '/sync', { method: 'POST', ...opts({ only: only || null }) }).then(j),
  // production assets only (cast/locations/wardrobe/props, per shared/assetKinds.mjs) — a board
  // that pulled in every reference too would bury the cast under the moodboard on the first click
  syncBoardAssets: (pid, kinds) => fetch('/api/board/' + pid + '/assets', { method: 'POST', ...opts({ kinds: kinds || null }) }).then(j),
  alignBoard: (pid, layout, o) => fetch('/api/board/' + pid + '/align', { method: 'POST', ...opts({ layout, opts: o || {} }) }).then(j),
  setBoardShow: (pid, show) => fetch('/api/board/' + pid + '/show', { method: 'POST', ...opts({ show }) }).then(j),
  exportBoard: (pid, o) => fetch('/api/board/' + pid + '/export', { method: 'POST', ...opts(o || {}) }).then(j),
  boardExportUrl: pid => '/api/board/' + pid + '/export/file?t=' + Date.now(),
  // edit-manifest / selects bridge — final selects in shot order for the editor
  manifest: pid => fetch('/api/manifest/' + pid).then(j),
  setInOut: (pid, shot, inP, out) => fetch('/api/manifest/' + pid + '/in-out', { method: 'POST', ...opts({ shot, in: inP, out }) }).then(j),
  exportSelects: pid => fetch('/api/manifest/' + pid + '/export', { method: 'POST' }).then(j),
  // serializable UI state (Phase 6) — non-sensitive location + prefs, persisted to ui-state.md
  uiState: () => fetch('/api/ui-state').then(j),
  saveUiState: body => fetch('/api/ui-state', { method: 'PUT', ...opts(body) }).then(j),
  // batch variants + durable queue (Phase 7)
  batches: () => fetch('/api/batches').then(j),
  estimateBatch: body => fetch('/api/batches/estimate', { method: 'POST', ...opts(body) }).then(j),
  createBatch: body => fetch('/api/batches', { method: 'POST', ...opts(body) }).then(j),
  pauseBatch: id => fetch('/api/batches/' + encodeURIComponent(id) + '/pause', { method: 'POST' }).then(j),
  resumeBatch: id => fetch('/api/batches/' + encodeURIComponent(id) + '/resume', { method: 'POST' }).then(j),
  cancelBatch: id => fetch('/api/batches/' + encodeURIComponent(id) + '/cancel', { method: 'POST' }).then(j),
  retryBatch: (id, fresh) => fetch('/api/batches/' + encodeURIComponent(id) + '/retry', { method: 'POST', ...opts({ fresh: !!fresh }) }).then(j),
  // structured search (Phase 9) — typed filters + free text; results carry exact location objects
  search: (q, cursor) => fetch('/api/search?q=' + encodeURIComponent(q || '') + (cursor ? '&cursor=' + cursor : '')).then(j),
  // persistent review sessions (Phase 5)
  reviewSessions: () => fetch('/api/review-sessions').then(j),
  saveSession: body => fetch('/api/review-sessions', { method: 'POST', ...opts(body) }).then(j),
  patchSession: (id, body) => fetch('/api/review-sessions/' + encodeURIComponent(id), { method: 'PATCH', ...opts(body) }).then(j),
  deleteSession: id => fetch('/api/review-sessions/' + encodeURIComponent(id), { method: 'DELETE' }).then(j),
  // staged trash (Phase 3D) — recoverable physical deletions
  stagedTrash: () => fetch('/api/staged-trash').then(j),
  restoreStaged: id => fetch('/api/staged-trash/' + encodeURIComponent(id) + '/restore', { method: 'POST' }).then(j),
  purgeStaged: id => fetch('/api/staged-trash/' + encodeURIComponent(id), { method: 'DELETE' }).then(j),
  purgeAllStaged: () => fetch('/api/staged-trash/purge-all', { method: 'POST' }).then(j),
  saveBrief: (pid, content) => fetch('/api/brief/' + pid, { method: 'PUT', ...opts({ content }) }).then(j),
  saveSettings: s => fetch('/api/settings', { method: 'PUT', ...opts(s) }).then(j),
  setStorageRoot: p => fetch('/api/storage-root', { method: 'PUT', ...opts({ path: p }) }).then(j),
  browse: p => fetch('/api/browse?path=' + encodeURIComponent(p || '')).then(j),
  reveal: (pid, id) => fetch('/api/reveal', { method: 'POST', ...opts({ pid, id }) }).then(j),
  bump: kind => fetch('/api/history/' + kind, { method: 'POST', ...opts({ n: 1 }) }).then(j),
  uploadContext: (pid, file, folder) => fetch('/api/context/' + pid + '/upload?name=' + encodeURIComponent(file.name) + '&folder=' + encodeURIComponent(folder || ''), { method: 'POST', body: file }).then(j),
  addNote: (pid, name, content, folder, replace) => fetch('/api/context/' + pid + '/note', { method: 'POST', ...opts({ name, content, folder: folder || '', replace: replace || '' }) }).then(j),
  fetchText: url => fetch(url).then(r => { if (!r.ok) throw new Error('api ' + r.status); return r.text(); }),
  deleteContext: (pid, name, folder) => fetch('/api/context/' + pid + '/file?name=' + encodeURIComponent(name) + '&folder=' + encodeURIComponent(folder || ''), { method: 'DELETE' }).then(j),
  contextUrl: (pid, name, folder) => '/api/context/' + pid + '/file?name=' + encodeURIComponent(name) + '&folder=' + encodeURIComponent(folder || ''),
  createFolder: (pid, name) => fetch('/api/context/' + pid + '/folder', { method: 'POST', ...opts({ name }) }).then(j),
  // local video import — yt-dlp / local file → ffmpeg shot-cut detection → frame picker
  videoTools: () => fetch('/api/video-import/tools').then(j),
  videoImportUrl: (pid, url, folder, quality) => fetch('/api/video-import/' + pid, { method: 'POST', ...opts({ url, folder: folder || '', quality }) }).then(j),
  videoImportFile: (pid, file, folder, quality) => fetch('/api/video-import/' + pid + '/upload?name=' + encodeURIComponent(file.name) + '&folder=' + encodeURIComponent(folder || '') + '&quality=' + encodeURIComponent(quality || 'medium'), { method: 'POST', body: file }).then(j),
  videoImportJob: id => fetch('/api/video-import/job/' + id).then(j),
  // `v` is the poster revision from the job — a retrim rewrites the same path, so without it
  // the browser serves the pre-trim frame from cache and the trim looks like it did nothing.
  videoImportFrameUrl: (id, ix, v) => '/api/video-import/job/' + id + '/frame/' + ix + (v ? '?v=' + v : ''),
  videoImportAtUrl: (id, t) => '/api/video-import/job/' + id + '/at?t=' + Number(t).toFixed(2),
  videoImportTrim: (id, ix, start, end) => fetch('/api/video-import/job/' + id + '/shot/' + ix, { method: 'POST', ...opts({ start, end }) }).then(j),
  videoImportSheet: (id, shot, step) => fetch('/api/video-import/job/' + id + '/sheet', { method: 'POST', ...opts({ shot, step }) }).then(j),
  videoImportSheetUrl: (id, sid) => '/api/video-import/job/' + id + '/sheet/' + sid,
  videoImportSheetDiscard: (id, sid) => fetch('/api/video-import/job/' + id + '/sheet/' + sid + '/discard', { method: 'POST' }).then(j),
  videoImportSave: (id, indices, sheets) => fetch('/api/video-import/job/' + id + '/save', { method: 'POST', ...opts({ indices, sheets }) }).then(j),
  videoImportDiscard: id => fetch('/api/video-import/job/' + id + '/discard', { method: 'POST' }).then(j),
  deleteFolder: (pid, name) => fetch('/api/context/' + pid + '/folder?name=' + encodeURIComponent(name), { method: 'DELETE' }).then(j),
  // story → shots
  story: pid => fetch('/api/story/' + pid).then(j),
  saveStory: (pid, content) => fetch('/api/story/' + pid, { method: 'PUT', ...opts({ content }) }).then(j),
  breakdown: (pid, story, mode) => fetch('/api/story/' + pid + '/breakdown', { method: 'POST', ...opts({ story, mode: mode || 'replace' }) }).then(j),
  addShot: (pid, shot) => fetch('/api/story/' + pid + '/shots', { method: 'POST', ...opts(shot) }).then(j),
  patchShot: (pid, id, patch, log) => fetch('/api/story/' + pid + '/shots/' + encodeURIComponent(id), { method: 'PATCH', ...opts({ patch, log }) }).then(j),
  deleteShot: (pid, id) => fetch('/api/story/' + pid + '/shots/' + encodeURIComponent(id), { method: 'DELETE' }).then(j),
  // groq
  transcribe: file => fetch('/api/groq/transcribe?name=' + encodeURIComponent(file.name), { method: 'POST', body: file }).then(j),
  // opts { provider:'groq'|'fal', depth:'quick'|'deep' } override the Settings default per call
  analyzeAsset: (scope, name, folder, o) => fetch('/api/assets/' + scope + '/analyze', { method: 'POST', ...opts({ name, folder: folder || '', ...(o || {}) }) }).then(j),
  saveMeta: (scope, name, folder, meta) => fetch('/api/assets/' + scope + '/meta', { method: 'PUT', ...opts({ name, folder: folder || '', meta }) }).then(j),
  sendFal: (scope, name, folder) => fetch('/api/assets/' + scope + '/send-fal', { method: 'POST', ...opts({ name, folder: folder || '' }) }).then(j),
  // global library
  uploadLibrary: (file, folder) => fetch('/api/library/upload?name=' + encodeURIComponent(file.name) + '&folder=' + encodeURIComponent(folder || ''), { method: 'POST', body: file }).then(j),
  libraryUrl: (name, folder) => '/api/library/file?name=' + encodeURIComponent(name) + '&folder=' + encodeURIComponent(folder || ''),
  deleteLibrary: (name, folder) => fetch('/api/library/file?name=' + encodeURIComponent(name) + '&folder=' + encodeURIComponent(folder || ''), { method: 'DELETE' }).then(j),
  createLibraryFolder: name => fetch('/api/library/folder', { method: 'POST', ...opts({ name }) }).then(j),
  deleteLibraryFolder: name => fetch('/api/library/folder?name=' + encodeURIComponent(name), { method: 'DELETE' }).then(j),
  copyAsset: (fromScope, name, folder, toScope, toFolder) => fetch('/api/library/copy', { method: 'POST', ...opts({ fromScope, name, folder, toScope, toFolder }) }).then(j),
  // control maps — any still → depth / edges / pose / cutout, written to library/control
  controlKinds: () => fetch('/api/control/kinds').then(j),
  controlMaps: () => fetch('/api/control').then(j),
  deriveControl: body => fetch('/api/control/derive', { method: 'POST', ...opts(body) }).then(j),
  deleteControl: name => fetch('/api/control/' + encodeURIComponent(name), { method: 'DELETE' }).then(j),
  // prompt builder
  prompts: () => fetch('/api/prompts').then(j),
  savePrompt: (name, prompt, axes) => fetch('/api/prompts', { method: 'POST', ...opts({ name, prompt, axes }) }).then(j),
  deletePrompt: file => fetch('/api/prompts/' + encodeURIComponent(file), { method: 'DELETE' }).then(j),
  // quick snippets (chatwoot-style canned text)
  snippets: () => fetch('/api/snippets').then(j),
  saveSnippet: (name, trigger, content) => fetch('/api/snippets', { method: 'POST', ...opts({ name, trigger, content }) }).then(j),
  patchSnippet: (file, patch) => fetch('/api/snippets/' + encodeURIComponent(file), { method: 'PATCH', ...opts(patch) }).then(j),
  deleteSnippet: file => fetch('/api/snippets/' + encodeURIComponent(file), { method: 'DELETE' }).then(j),
  seedSnippets: () => fetch('/api/snippets/seed', { method: 'POST' }).then(j),
  // remotion handoff + export pack
  openRemotion: pid => fetch('/api/remotion/open', { method: 'POST', ...opts({ pid }) }).then(j),
  exportPack: pid => fetch('/api/export/' + pid, { method: 'POST' }).then(j),
  // Agent setup. `provider` is 'claude' | 'codex'; omit it to act on the active agentCommand.
  testAgent: provider => fetch('/api/agent/test' + (provider ? '?provider=' + provider : '')).then(j),
  agentStatus: provider => fetch('/api/agent/status' + (provider ? '?provider=' + provider : '')).then(j),
  agentProviders: () => fetch('/api/agent/providers').then(j),
  installAgent: provider => fetch('/api/agent/install', { method: 'POST', ...opts({ provider }) }).then(j),
  openLogin: provider => fetch('/api/agent/login', { method: 'POST', ...opts({ provider }) }).then(j),
  skillFile: p => fetch('/api/skills/file?path=' + encodeURIComponent(p)).then(j),
  saveSkillFile: (p, content) => fetch('/api/skills/file', { method: 'PUT', ...opts({ path: p, content }) }).then(j),
  enhanceSkill: (p, instruction) => fetch('/api/skills/enhance', { method: 'POST', ...opts({ path: p, instruction }) }).then(j),
  chatSkills: () => fetch('/api/chat/skills').then(j),
  routerFile: rel => fetch('/api/chat/skills/router/file?rel=' + encodeURIComponent(rel)).then(j),
  houseRules: () => fetch('/api/chat/house-rules').then(j),
  saveHouseRules: content => fetch('/api/chat/house-rules', { method: 'PUT', ...opts({ content }) }).then(j),
  // ── integrated feature helpers (docs/integration/*) ──
  // style locks
  styleLocks: () => fetch('/api/stylelocks').then(j),
  saveStyleLock: body => fetch('/api/stylelocks', { method: 'POST', ...opts(body) }).then(j),
  deleteStyleLock: id => fetch('/api/stylelocks/' + encodeURIComponent(id), { method: 'DELETE' }).then(j),
  favStyleLock: (id, fav) => fetch('/api/stylelocks/' + encodeURIComponent(id) + '/fav', { method: 'POST', ...opts({ fav }) }).then(j),
  importStyleLock: body => fetch('/api/stylelocks/import-item', { method: 'POST', ...opts(body) }).then(j),
  styleLockRefUrl: id => '/api/stylelocks/' + encodeURIComponent(id) + '/ref',
  // renders a sample frame for a style — {fragment, subject?, model?, aspect?} → {dataUrl, model, cost}.
  // Costs real money and can take ~30s; the result is held in the draft until the style is saved.
  styleLockPreview: body => fetch('/api/stylelocks/preview', { method: 'POST', ...opts(body) }).then(j),
  // prompt enhancement (Quick Generate) — { text, mode:'quick'|'full' } → { text }
  enhance: (text, mode) => fetch('/api/enhance', { method: 'POST', ...opts({ text, mode }) }).then(j),
  // project memory (hot cache)
  getMemory: pid => fetch('/api/memory/' + pid).then(j),
  saveMemory: (pid, content) => fetch('/api/memory/' + pid, { method: 'PUT', ...opts({ content }) }).then(j),
  appendMemory: (pid, text) => fetch('/api/memory/' + pid + '/append', { method: 'POST', ...opts({ text }) }).then(j),
  // Dedupe-aware sibling of appendMemory — the correction loop writes through this so telling the
  // agent the same thing twice does not leave two bullets. Returns { added, skipped }.
  appendLearnings: (pid, learnings) => fetch('/api/memory/' + pid + '/learnings', { method: 'POST', ...opts({ learnings: Array.isArray(learnings) ? learnings : [learnings] }) }).then(j),
  // References/Assets folder classification overrides
  folderKinds: pid => fetch('/api/folders/' + pid).then(j),
  setFolderKind: (pid, folder, kind) => fetch('/api/folders/' + pid, { method: 'PUT', ...opts({ folder, kind }) }).then(j),
  // remotion library — compositions, presets, render queue, thumbnails, jobs (RemotionLibrary.jsx)
  remotionCompositions: refresh => fetch('/api/remotion/compositions' + (refresh ? '?refresh=1' : '')).then(j),
  remotionPresets: comp => fetch('/api/remotion/presets?comp=' + encodeURIComponent(comp || '')).then(j),
  remotionSavePreset: (comp, name, props) => fetch('/api/remotion/presets', { method: 'POST', ...opts({ comp, name, props }) }).then(j),
  remotionDeletePreset: file => fetch('/api/remotion/presets/' + encodeURIComponent(file), { method: 'DELETE' }).then(j),
  remotionRender: body => fetch('/api/remotion/render', { method: 'POST', ...opts(body) }).then(j),
  remotionPreview: (comp, props) => fetch('/api/remotion/preview', { method: 'POST', ...opts({ comp, props }) }).then(j),
  remotionStudio: () => fetch('/api/remotion/studio').then(j),
  remotionStudioStart: () => fetch('/api/remotion/studio', { method: 'POST', ...opts({}) }).then(j),
  remotionStudioStop: () => fetch('/api/remotion/studio', { method: 'DELETE' }).then(j),
  remotionThumbs: comps => fetch('/api/remotion/thumbs', { method: 'POST', ...opts(comps ? { comps } : {}) }).then(j),
  remotionJobs: () => fetch('/api/remotion/jobs').then(j),
  // validate a candidate project path before committing it to settings, and find a MotionKit
  // checkout for the cold-start case
  remotionProbe: p => fetch('/api/remotion/probe?path=' + encodeURIComponent(p || '')).then(j),
  remotionSuggest: () => fetch('/api/remotion/suggest').then(j),
  // ── normalized per-model input schemas (ticket 04) — fallback:true in the response means
  // "no synced spec, render the generic FormatControls instead"; never an error status.
  modelSchema: id => fetch('/api/catalog/model-schema?id=' + encodeURIComponent(id)).then(j),
  syncModelSchema: id => fetch('/api/catalog/model-schema/sync?id=' + encodeURIComponent(id), { method: 'POST' }).then(j),
  // ── server-side grid split (ticket 06) — writes child generation records per kept cell;
  // body: { rows?, cols?, gutter?, skip?: ['r-c'], shots?: { 'r-c': shotId } }
  splitGrid: (pid, id, body) => fetch('/api/generations/' + encodeURIComponent(pid) + '/' + encodeURIComponent(id) + '/split-grid', { method: 'POST', ...opts(body || {}) }).then(j),
  // ── filmmaker chat sessions (ticket 08) — durable, resumable conversations + per-turn checkpoints.
  // The turn executor is simulate-only for now (ticket 09 plugs in the real CLI runner); progress
  // for a posted turn streams over chatStreamUrl (an EventSource endpoint), not the POST response.
  chatSessions: (project, all) => fetch('/api/chat/sessions' + (all ? '?all=1' : project ? '?project=' + encodeURIComponent(project) : '')).then(j),
  chatSession: id => fetch('/api/chat/sessions/' + encodeURIComponent(id)).then(j),
  createChatSession: body => fetch('/api/chat/sessions', { method: 'POST', ...opts(body || {}) }).then(j),
  patchChatSession: (id, body) => fetch('/api/chat/sessions/' + encodeURIComponent(id), { method: 'PATCH', ...opts(body || {}) }).then(j),
  archiveChatSession: (id, archived) => fetch('/api/chat/sessions/' + encodeURIComponent(id) + '/archive', { method: 'POST', ...opts({ archived: archived !== false }) }).then(j),
  chatTurn: (id, text, attachments) => fetch('/api/chat/sessions/' + encodeURIComponent(id) + '/turn', { method: 'POST', ...opts({ text, attachments: attachments || [] }) }).then(j),
  chatCheckpoint: (id, body) => fetch('/api/chat/sessions/' + encodeURIComponent(id) + '/checkpoint', { method: 'POST', ...opts(body || {}) }).then(j),
  restoreChatCheckpoint: (id, cid) => fetch('/api/chat/sessions/' + encodeURIComponent(id) + '/checkpoint/' + encodeURIComponent(cid) + '/restore', { method: 'POST' }).then(j),
  chatStreamUrl: id => '/api/chat/sessions/' + encodeURIComponent(id) + '/stream',
  // cancel a streaming turn (ticket 09) — terminal SSE event is turn-cancelled
  cancelChatTurn: id => fetch('/api/chat/sessions/' + encodeURIComponent(id) + '/cancel', { method: 'POST' }).then(j),
  // ticket 20 — session-end learnings + session-start understanding
  closeChatSession: id => fetch('/api/chat/sessions/' + encodeURIComponent(id) + '/close', { method: 'POST' }).then(j),
  distillChatSession: id => fetch('/api/chat/sessions/' + encodeURIComponent(id) + '/distill', { method: 'POST' }).then(j),
  chatUnderstanding: id => fetch('/api/chat/sessions/' + encodeURIComponent(id) + '/understanding').then(j),
  // ticket 13 — Production Panel posts a compact system event (ids only) to the active session when a
  // creative lock changes; broadcast on the session SSE channel as `system-event`.
  chatSystemEvent: (id, text) => fetch('/api/chat/sessions/' + encodeURIComponent(id) + '/system-event', { method: 'POST', ...opts({ text }) }).then(j),
  // ticket 19 — record a manual-mode generation turn (client started the gen via generate/createBatch).
  // body: { userText, assistantText?, directive } — directive is { type:'generation', ref } | { type:'generation.batch', batch }.
  chatManualTurn: (id, body) => fetch('/api/chat/sessions/' + encodeURIComponent(id) + '/manual-turn', { method: 'POST', ...opts(body || {}) }).then(j),
  // ticket 15 — toggle a chat tool's GLOBAL default (settings.enabledChatTools): what a project
  // inherits until it has its own opinion, and the only layer a standalone chat has.
  // Returns { id, enabled, tools }.
  toggleChatTool: (id, enabled) => fetch('/api/chat/tools/' + encodeURIComponent(id) + '/toggle', { method: 'POST', ...opts({ enabled: enabled !== false }) }).then(j),
  // Per-project tool enablement — what the chat's TOOLS rail drives. Persists to that project's
  // project.md, so two projects can run different tool sets. Pass enabled:null to clear the
  // project's opinion and fall back to the global default.
  // Returns { pid, id, enabled, scope, enabledTools, tools }.
  toggleProjectTool: (pid, id, enabled) => fetch('/api/projects/' + encodeURIComponent(pid) + '/tools/' + encodeURIComponent(id) + '/toggle',
    { method: 'POST', ...opts({ enabled: enabled === null ? null : enabled !== false }) }).then(j),

  // ── ticket 25 — user-authored tools (backend/userTools.mjs) ──
  // Not under /api/chat: authoring survives the chat module being off. createUserTool is posted by
  // the USER clicking Create on a tool.draft card — never by the agent, even though it could curl.
  userTools: () => fetch('/api/tools').then(j),
  createUserTool: draft => fetch('/api/tools', { method: 'POST', ...opts(draft || {}) }).then(j),
  deleteUserTool: id => fetch('/api/tools/' + encodeURIComponent(id), { method: 'DELETE' }).then(j),

  // ticket 24 — promote a standalone chat to a project. Create the project first (createProject),
  // then bind: the session + transcript move into projects/<pid>/chat and the scope flips, keeping
  // the same session id. Returns the bound session (scope 'project', project set).
  chatBindSession: (id, project) => fetch('/api/chat/sessions/' + encodeURIComponent(id) + '/bind', { method: 'POST', ...opts({ project }) }).then(j)
};
