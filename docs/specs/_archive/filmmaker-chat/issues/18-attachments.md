# 18 — Attachments: bring documents and images into the conversation

**What to build:** The composer accepts drops/uploads of images and documents
(script PDFs/text, treatments, reference stills). Files land in the project's
context boards via the existing context upload routes (classified per the existing
folder rules), and the message carries attachment refs the agent receives as
workspace paths/ids it can read or analyze (vision route for images). Attached
images render as thumbnails on the user message via the shared media components;
attaching a reference image mid-conversation makes it citable by id in generation
requests (ref composition at generate time, not prose description).

**Blocked by:** 11 — Chat UI shell.

**Status:** done — implemented in frontend/Chat.jsx (composer drag-drop + paperclip picker,
thumbnails, lightbox) and backend/chat.mjs (attachmentPromptLine + turn wiring, additive).
Uploads reuse the existing `POST /api/context/:pid/upload` route (api.uploadContext); images
classify into `References`, documents (pdf/txt/md) into `Script` — both reference-classified per
the existing folderKind rules (no parallel upload scheme). Tests: tests/phase18-attachments.test.mjs
(3 tests, green); full suite 139/139; `npm run build` clean; composer + paperclip verified live in
the browser (no console errors).

- [x] Dropping an image onto the composer uploads it to the project context and shows a thumbnail on the sent message — drag-drop + paperclip → api.uploadContext; thumbnails render via RenderMedia on the user bubble (Chat.jsx renderAttachments), click → RenderLightbox.
- [~] Text/PDF attachments are readable by the agent in-session — the agent receives each document as a `GET /api/context/:pid/file?...` ref it fetches through FrameForge's HTTP API (attachmentPromptLine). The refs are proven to reach the prompt via the simulate-echo stub (no live subscription); the end-to-end "summarize my attached treatment" turn needs a live Claude subscription and was not run here (PDF parsing then depends on the agent's own capability).
- [x] An attached reference image can be used as a generation ref by id without the agent describing its content into the prompt — the prompt block carries the exact `refs:[{ scope, folder, name }]` triple the /api/generate route accepts (asserted by the attachmentPromptLine unit test).
- [x] Attachment refs persist in the message record and survive reload — the `attachments` field on the user message ({ id, kind, name, folder, scope }) round-trips through the .messages.md record and the GET session route (test 2).

**Standalone sessions:** attach is disabled with a hint tooltip when there is no project (no context
surface here); library-scoped attach is left to ticket 24.
