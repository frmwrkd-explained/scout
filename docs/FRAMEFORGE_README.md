# FRAMEFORGE — mission control for AI-generated footage

A local-first desktop app for planning, generating, reviewing and cutting AI footage.
React + Express + Electron, over a portable markdown datastore. Your machine, your
provider keys, files you already own.

## Run

```bash
npm ci                       # NOT `npm install` — the lockfile is authoritative
cp .env.example .env         # add FAL_KEY / GROQ_API_KEY / KIE_API_KEY as needed
npm start                    # builds the frontend and serves on http://localhost:5176
```

Dev mode needs **two** shells — Vite proxies `/api` but does not start the backend:

```bash
npm run server               # express API on 5176
npm run dev                  # vite on 5175, proxying /api → 127.0.0.1:5176
```

Then open http://localhost:5175.

```bash
npm test                     # node --test · 384 tests
npm run build                # vite build → dist/
npm run app                  # build + electron
```

Ports are env-overridable, with one trap: the **backend does not read `FRFG_API_PORT`** —
only Vite does, to pick its proxy target. To move the API, pass the port as an argument:
`node backend/index.mjs 5286`. See `CLAUDE.md` for the full wiring.

## What it does

- Project-based footage library with review/triage workflows
- Story → shots breakdown, with cast, locations and props pinned as reusable records
- Mood boards and asset tagging
- A chat agent that operates the app through its own HTTP API
- FAL / Kie / Groq integrations for generation, transcription and vision metadata
- A multi-track timeline that cuts an animatic and exports to an NLE
- Portable `.md` datastore in `workspace/` — nothing is locked in a database

## Layout

```
workspace/          → portable markdown data store (gitignored; holds live keys)
backend/            → Express API and store modules (.mjs)
frontend/           → React UI (.jsx)
shared/             → imported by both sides
desktop/            → Electron wrapper (.cjs)
tests/              → plain node --test
docs/               → start at docs/MAP.md
landingpage/        → the marketing site. A SEPARATE static project, not part of the app
```

## Working on this

Read **`CLAUDE.md`** first — it holds the source-of-truth table, the shared-UI registry,
the port wiring and the hard rules. Then `docs/MAP.md` for everything under `docs/`.
`ISSUES.md` is a reading list of known issues, not a work queue.
