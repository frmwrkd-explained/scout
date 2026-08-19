# 07 — Music, voice, and sound-design model kinds

**What to build:** Extend the model catalog's kind vocabulary with `music`, `voice`,
and `sfx` alongside preview/render/edit/video, and add at least one enabled FAL
model per new kind (e.g. a music-generation, a TTS/voice, and a sound-effects
endpoint), with cost notes. The generation pipeline accepts these kinds end-to-end:
a generation of kind music/voice/sfx runs, lands an audio file in renders, gets a
generation record, and plays back in the shared media components (RenderMedia grows
an audio branch with a compact player). Model defaults settings gain entries for the
new kinds. This unlocks Manual mode's output-kind list (later ticket).

**Blocked by:** None — can start immediately. (RenderMedia audio branch lands here if 01 is already merged, else in 01's component once available.)

**Status:** done (pipeline + UI verified by tests and build; a live audio generation needs a real FAL key — see note)

- [x] Catalog kinds include music, voice, sfx with at least one model each; kind grouping appears in the shared ModelPicker
      — `KINDS` + `AUDIO_KINDS` in `frontend/modelCatalog.js`; models: `fal-ai/stable-audio-25/text-to-audio` (music, ~$0.20/clip),
      `fal-ai/elevenlabs/tts/turbo-v2.5` (voice, ~$0.05/1k chars), `fal-ai/elevenlabs/sound-effects/v2` (sfx, ~$0.002/s).
      `enabledCatalog` is catalog-driven so the shared `ModelPicker` (`GenerationControls.jsx`) groups the new AUDIO · … sections
      automatically — no edit to that file was needed.
- [x] Generating with an audio-kind model produces a playable audio file and a normal generation record with cost logged
      — `backend/providers.mjs` `runFal` builds an audio payload (prompt→`text`/`prompt`, no image_size/aspect) and parses
      `audio`/`audio.url`/`audio_file`; `backend/generate.mjs` writes an `.mp3`/`.wav` render, ledgers `op:'audio'`, and skips
      pixel sizing. Adapter I/O and result parsing covered by `tests/phase-audio-kinds.test.mjs` (fetch-stubbed FAL queue).
- [x] Shared media components render an audio player for audio generations
      — `frontend/RenderMedia.jsx` `mediaKind` recognises audio extensions and renders a compact always-controls `<audio>`
      (tiles + lightbox).
- [x] Settings modelDefaults cover the new kinds without breaking existing defaults
      — `DEFAULT_SETTINGS.modelDefaults` (`backend/store.mjs`) gains music/voice/sfx; defaults UIs in `Settings.jsx` and
      `ToolsSuite.jsx` add the three rows. Existing preview/render/edit/video defaults unchanged (asserted by the test).

**Verification:** `node --test tests/phase*.test.mjs` → 114/114 green; `npm run build` green.
**Needs a live-key run:** an end-to-end audio generation against the real FAL API (music/voice/sfx) was not executed to avoid
spending real money. The pipeline is exercised with the tests' fetch-stubbed FAL queue; run one real generation per audio kind
with a FAL key set to confirm the delivered file extension and cost land as expected.
