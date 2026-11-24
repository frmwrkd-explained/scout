---
name: reference-library
description: Find a visual reference in a local Scout reference library and turn it into a ready image prompt. Use this skill whenever the user asks for a reference, an inspiration image, a look, a layout or a style "like the one with…", wants references by type (ads, YouTube thumbnails), by tag or by words in the prompt, asks for a reference's prompt, or wants a prompt built from a reference plus their own product or subject. It reads the Markdown records and images straight from disk — Scout can be closed and no Airtable account is needed.
---

# Reference library — find one, hand over its prompt, build a new one

The library is a folder of plain files inside a Scout workspace:

- `data/references/ref-0042.md` — one reference per file. Frontmatter holds `name`, `category`, `tags`, `prompt`, `signature`, `image`; the body holds the analysis.
- `files/<sha256>.jpg` — the images. A record's `image` field is the path, relative to the workspace.

Everything below goes through one script that sits beside this file. It needs Node 18 or newer and nothing else.

```bash
node <this skill's folder>/reflib.mjs stats
```

**Which workspace.** The script takes the first of these that exists: `--workspace <folder>`, the `SCOUT_WORKSPACE` environment variable, or the nearest parent of the current directory that contains `data/references`. If it finds none it says so and stops — ask the user where their Scout workspace is; do not guess a path.

## 1 · Find a reference

```bash
node reflib.mjs find --category "YouTube Thumbnails" --tag "Sports & Outdoors" --text "shark water" --limit 10
```

- `--category` — the type, exact but not case-sensitive. `stats` lists the ones that exist.
- `--tag` — repeat it to require several tags.
- `--text` — every word must appear in the prompt, the name, the signature or the tags.
- `--has-prompt` — only references that carry a prompt.
- `--json` — the same results as data.

Each result gives the id, the name, the tags, the **absolute image path** and the prompt length. Look at the image before recommending it: read the file at that path.

Show the user a short list (id, name, why it fits) and let them choose. Do not pick silently when several fit.

Some libraries are shared without pictures (the public prompts-only pack): `stats` then reports "0 with an image" and a result's image shows `—`. Work from the name, tags and prompt, say that the picture is not included, and do not go looking for one.

## 2 · Hand over the prompt, word for word

```bash
node reflib.mjs show ref-0042 --prompt
```

This prints the prompt and nothing else — no heading, no added newline.

**A prompt is quoted, never retold.** When the user asks for a reference's prompt, give them this output exactly as printed, in a code block. Do not shorten it, tidy it, translate it, fix its typos or "improve" it. If you think it should change, hand over the original first and propose the change separately.

`show ref-0042` (no flag) prints the record with its image path; `show ref-0042 --json` returns every field, including `image_path`, `generated_image_path` and the analysis in `body`.

## 3 · Build a prompt from a reference and the user's subject

```bash
node reflib.mjs compose ref-0042 --subject "a matte black espresso tin"
```

The script **wraps** the reference prompt; it does not rewrite it. The ready prompt is two lines that name the subject, a blank line, then the reference prompt unchanged. It also prints the reference image path — attach that image alongside the prompt when the generator accepts one.

If the reference uses bracketed placeholders such as `[PRODUCT]` or `[BRAND LOGO]`, the script lists them under "Still to fill". Fill them only with what the user told you:

```bash
node reflib.mjs compose ref-0042 --subject "a diving watch" --fill "PRODUCT=the diving watch" --fill "BRAND LOGO=the Aqualine wordmark"
```

Every replacement is reported with its count. `--prompt-only` prints just the ready prompt; `--json` returns the ready prompt, the untouched `reference_prompt`, the placeholders and the image path.

**Adapting the wording** beyond that (rewriting the scene for the subject, changing colours, cutting sections) is allowed only when the user asks for it. When you do it, say so, and keep the original available — the user must always be able to tell which words came from the library and which came from you.

## When Scout is running

The files are the source of truth, so the script works either way. If the app is up you may use its agent door instead:

```bash
curl -s -m 2 http://127.0.0.1:5177/api/index     # the list of what the app offers — read it first
```

Routes that exist for reading: `GET /api/search?q=…` (finds records; a reference is found by the words in its prompt), `GET /api/collections/references/documents`, `GET /api/document?path=data/references/ref-0042.md`, and `GET /api/files/raw?path=files/<name>` for the image bytes. Use only routes that `/api/index` or this list names. Do not invent one.

## The rule that does not bend

**Never write to the library without asking the user first.** No new records, no edits to a `.md` file, nothing added to or removed from `files/`. The script has no write command on purpose.

If the user says yes to adding or changing a reference, the write goes through Scout's own pipeline — `POST /api/records/upsert` with `"collection": "references"` while the app is running, or a file dropped into the workspace's `_inbox/` when it is not — so it is deduplicated, attributed and logged. Never by editing files under `data/` directly: Scout holds such a file apart as written around the pipeline.

Never delete a reference. Scout archives, with a reason, and that is the user's action.
