# 10 · Skills and plugins

How Scout learns to do new things, and how that stays safe enough to share.

This document decides. Where it says "is", the thing is built and tested on this branch. Where it
says "next" or "later", it is not built, and section 4 lists exactly which is which.

## The three things, and who each is for

| | What it is | Who uses it | Can it run code? |
|---|---|---|---|
| **Skill** | A folder of instructions (and optional scripts) an assistant reads | An assistant | Only inside an assistant's own run, which is already sandboxed and proposal-gated |
| **Plugin** | A folder holding a form, formulas and a template. It adds a button to a record | A person | No. Never |
| **Memory** | `me.md`, goals, playbook, learnings, and the hot cache made from them | Both | No |

One sentence to remember: **a skill tells an assistant how to do a job; a plugin gives a person a
button that makes a document; memory is what both of them read first.**

(The older "user tools" in `tools/<id>/SKILL.md` stay what they are: a chat tool an assistant can
call. They are instructions too, and they grant nothing.)

---

## 1 · Skills

### Decision: a skill is a folder, not a collection

`skills/<name>/SKILL.md`, plus any scripts and reference files beside it. Scout does **not** copy
skills into a "Skills" collection.

Why:

- Every assistant runtime Scout can drive (Claude, Codex, the others) already loads a skill by its
  folder. A record copy would be a second source of truth for the one thing that must not have two.
- A skill carries scripts. A script is a file with a path, not a field in a record.
- `CLAUDE.md` already rules that the app copies its skills fresh into each assistant session so a
  tampered copy never persists. That only works if the folder is the truth.

What people get instead is a **Skills screen**: its own group in the sidebar, above the
collections, that reads the folders and shows each skill the way a record would be shown.

### Where skills live

| Place | Folder | Who owns it |
|---|---|---|
| Built in | `<app>/skills/<name>/` | Scout. Mounted into every assistant run |
| This workspace | `<workspace>/skills/<name>/` | The person. It travels with the workspace folder |
| Personal library | the folders in Settings → skill repos (default `~/.claude/skills`) | The person, across all workspaces. Mounted per assistant. **Not listed on the Skills screen**: it is not part of the workspace, and listing it would put a private library into every screenshot |

### What a skill says about itself

`SKILL.md` frontmatter. Only the first two are required, and they are what every skill runtime
already reads:

```yaml
name: follow-up
description: Find the people who are waiting on a reply and draft the next message for approval.
reads:  [people, messages, deals]     # collection ids it looks in
writes: [messages]                    # collection ids it puts things in
schedule: daily                       # manual | daily | weekly | continuous
assistant: follow-up                  # who runs it on that schedule
```

- **`reads` / `writes` name collections by id.** They are a statement of intent for people and
  assistants, shown as coloured chips on the Skills screen. They are not a permission system: what
  an assistant may actually touch is its own `scope.collections` (`backend/workerScope.mjs`), and
  every write still goes through `records.mjs`, where an agent's record arrives as a proposal.
- A skill that declares nothing is shown with the collections its text **mentions**, labelled as
  an inference and never as a declaration.

### How a schedule attaches

**A skill never owns a clock. An assistant does.** `schedule:` on a skill is a request;
`assistant:` names who carries it out. The assistant file (`assistants/<id>.md`) holds the real
schedule and the existing scheduler in `backend/dispatch.mjs` runs it. Nothing new was built for
this, on purpose: a second scheduler would be a second place where "why did this run?" has to be
answered.

Automatic runs stay off unless switched on in Settings (`autoRun`). The Skills screen says so in
words: "Runs every day, as the Follow-up assistant. Automatic runs are switched off in Settings, so
today it runs when you send the assistant out."

### Scripts in a skill

A skill may carry scripts (`skills/scout-router/` has two). They run only when an assistant runs
them, inside that assistant's session: its own home folder, its scoped credentials, its write gate.
The Skills screen lists them and shows their source. Scout itself never executes a skill script.

Cron-style automation therefore is: **a skill with a script + an assistant with a schedule.** That
is the answer to "skills can contain scripts, especially for automations and cron jobs".

---

## 2 · The memory layer

### How a skill points at records

By **collection id and view name**, in plain text, in its instructions:

> `people` — the view **No reply in 14 days**. For each person, their `messages` and open `deals`.

That is enough, because the assistant's wake-up context (the hot cache, `renderCache`,
`docs/03_MEMORY.md`) already contains the Index of what exists, and the router skill knows how to
open a collection, a view and a record. A skill does not embed record paths: those change; a
collection id and a view name do not.

A skill points at **memory** the same way: `playbook/` for what has worked, `learnings/` for how
the person wants things done, `me.md` for who they are.

### Where an assistant writes things down

| What it has | Where it goes | How |
|---|---|---|
| A new record (a message draft, a found reference) | The collection named in `writes:` | The record pipeline. It lands `proposed: true` and waits for the person |
| Something it learned about the person ("she never quotes raw footage") | `learnings/` | Proposed as a learning card. Agents cannot activate a learning themselves |
| A claim about what works, with evidence | `playbook/` | Proposed, with links to the records that are the evidence |
| A change to a skill, a schema or a plugin | Nowhere directly | It proposes. A person disposes |

Accepted learnings and playbook claims are folded into the hot cache, under its token cap, so the
next run starts already knowing them. That loop is the memory layer: **skill reads records →
proposes records and learnings → person accepts → cache carries it into the next run.**

### Two worked examples

**The reference library** (`skills/reference-library/`, built in). Reads the `references`
collection: each record is a picture, its prompt and its tags. The skill tells an assistant to
search by tag, open the record, and reuse the prompt. What it learns about taste ("prefers
low-angle product shots") goes to `learnings/`.

**Follow-up** (`workspace-crm/skills/follow-up/`, in the CRM showcase). Reads `people`, `messages`
and `deals`; writes `messages`. It finds the people whose last message was theirs more than 14 days
ago, drafts one reply each as an outbound card, and never sends. If the person rewrites a draft, it
proposes a learning with what changed. The goal "Nobody waits more than 14 days" counts the same
records, so progress is counted, never typed.

---

## 3 · Plugins

### What a plugin is

A button on a record that makes something from it: an invoice from a deal, a quote, a statement, a
call sheet. Press it, answer a short form, see the document, print it or save it as a PDF, and
optionally file **one new record**.

### Decision: a plugin contains no code

A plugin is **a form, some formulas and a template**. Scout reads all three with a parser and an
interpreter that are part of Scout (`shared/pluginTemplate.mjs`). There is no JavaScript in a
plugin, and no way to write any.

This is the safety model, and it is the only one. The alternatives were rejected:

- **`node:vm`** is not a security boundary. Node's own documentation says so. Code inside it can
  reach the host.
- **A separate process with `node --permission`** blocks the file system and child processes, but
  on the Node this app ships with it does not block the network. A plugin could still send a
  record anywhere.
- **Trust plus review** ("read the code before you install") does not survive a community
  catalogue, and does not survive "a model wrote this a minute ago".

With no code there is nothing to sandbox. What a plugin does can be read off its manifest, by the
app, and shown to the person in plain words before they install it.

**The honest limit:** a plugin cannot do anything the formula and template language cannot say. It
cannot call an API, send an email, loop over the whole workspace, or change an existing record.
Jobs like those belong to an assistant with a skill, where the write gate already exists.

### The folder

```
plugins/invoice/
  plugin.md          what it is, its buttons, forms, formulas, and the record it creates
  invoice.html       the document
  invoice-note.md    the note written into the new record (optional)
```

`plugin.md`, shortened:

```yaml
id: invoice
name: Invoice
kind: template
actions:
  - id: create
    on: deals                       # the collection whose records get the button
    label: Create invoice
    template: invoice.html
    inputs:                         # the form
      - { key: number, label: Invoice number, type: text,
          default: "next_number('invoices', concat('INV-', year(today), '-'), 3)" }
      - { key: terms, label: Payment terms (days), type: number, default: "14" }
    reads:                          # relations to follow
      client: record.company
    compute:                        # formulas, in order
      - key: lines
        each: record.line_items
        as: { description: item.description, amount: item.quantity * item.unit_price }
      - { key: total, value: "sum(lines, item.amount)" }
      - { key: due,   value: "add_days(input.date, input.terms)" }
    creates:                        # optional: one new record
      collection: invoices
      fields: { name: input.number, amount: total, due_date: due, deal: record.slug }
      body: invoice-note.md
```

- **Formulas**: numbers, text, `+ - * /`, comparisons, dotted names, and a fixed list of functions
  (`sum`, `count`, `round`, `if`, `default`, `concat`, `add_days`, `year`, `money`, `date`,
  `next_number`, and a few more). A name is looked up as the record's own value only.
- **What a formula can see**: `record` (the one the button was pressed on), `input` (the form),
  `me` (your details in `me.md`), `today`, each relation named under `reads`, and each earlier
  `compute` key.
- **Templates**: HTML with `{{ formula }}`, `{{#each list}}…{{/each}}` and `{{#if …}}…{{/if}}`.
  Every printed value is escaped. There is no "raw" form.
- **A template may not contain** scripts, forms, `<link>`, `on…` attributes, web addresses, or
  anything loaded from elsewhere. Pictures must be embedded.

### Three layers, each enough on its own

1. **At install**: the manifest and templates are checked. Anything not allowed is listed in plain
   words and the plugin offers no button.
2. **On the page**: the rendered document carries a policy that forbids scripts and every network
   request.
3. **In the window**: the preview is shown in a frame that cannot run scripts.

### What a plugin may write

One new record, in the collection its manifest names, through `records.upsertRecord` like every
other writer. So the record has provenance, the log says `via: plugin:invoice/create`, and "What it
has made" on the Plugins screen is read straight from that log. A plugin never overwrites: a second
record with the same name is refused in words before anything is written.

**Only a person runs a plugin, creates one, approves one or removes one.** An agent gets a 403.

### Where plugins live

| Place | Folder | Notes |
|---|---|---|
| Built in | `<app>/plugins/<id>/` | Ships with Scout. Cannot be removed or shadowed |
| This workspace | `<workspace>/plugins/<id>/` | Travels with the workspace |
| Drafts | `<workspace>/plugins/_drafts/<id>/` | Not active. Can be previewed, never run |
| Set aside | `<workspace>/plugins/_archive/…` | Discarded drafts and removed plugins. Nothing is deleted |

A plugin only offers its buttons where its collections exist. The invoice plugin in a workspace
with no `deals` says "needs a collection called deals" instead of failing.

### "Create a plugin"

1. The person describes it: *"A one-page quote for a deal: the line items, a total, valid 30 days."*
2. A model is given the format, the workspace's collections and fields, and the invoice plugin as a
   worked example, and answers with one JSON object.
3. Scout checks that answer exactly as it checks any plugin folder. One retry with the problems
   listed. If it still does not pass, nothing is written and the person is told why.
4. It is saved as a **draft**. The Plugins screen shows what it reads and writes (worked out by
   Scout from the manifest, never taken from the model's own description) and lets the person
   preview it on a real record.
5. **Approve and install** moves the folder into `plugins/`. The button appears. Or discard it.

Because a draft is only formulas and a template, approving one a model just wrote is safe in the
same way installing the built-in one is.

Without a model connected the screen says so, and offers **Start from a copy**: an installed plugin
copied into a draft folder to edit by hand.

### Sharing, and a community catalogue

A plugin is one folder. Today sharing is: send the folder, drop it into `plugins/`, and it appears
with its account of what it reads and writes.

A catalogue (later) is a public list of such folders with a name, a description and a checksum.
Installing from it is a download into `_drafts/`, then the same approval step. The no-code rule is
what makes this reasonable: the worst a stranger's plugin can do is draw an ugly document and file
one wrong record that you can see and archive.

---

## 4 · First, next, later

**Built on this branch**

- Skills screen: built-in and workspace skills, their collections, schedule, files and
  instructions. Read-only.
- The plugin format, its parser and interpreter, and the checks.
- The Invoice plugin: "Create invoice" on a deal, "Print or save as PDF" on an invoice.
- Plugins screen: what each plugin reads and writes, what it has made, try it on a record.
- Create a plugin: model-written drafts behind approval, start from a copy, discard, remove.
- The CRM showcase workspace (`workspace-crm/`) with a workspace skill and an assistant.

**Next**

- The plugin buttons on the record page itself (one line in `Document.jsx`; the component exists).
- `reads`/`writes` on the three built-in skills, so they stop relying on inference.
- An "occurrence" flag on a collection, so messages and invoices with similar names are never
  merged by the near-match rule.
- Rollups and formulas that honour `display: currency`; relative-date view filters ("closing this
  month", "no reply in 14 days") so those views do not need a stored flag.
- An assistant proposing a plugin run as a card ("Create the deposit invoice for this deal?").

**Later**

- A community catalogue, with checksums and install-as-draft.
- A second plugin kind for work that truly needs code, run as an assistant job behind the existing
  gate rather than as a new sandbox.
- Editing a skill from the Skills screen, as a proposal.

---

## 5 · Automations (added after the first version of this document)

"When this happens to a record, do that." Built; `backend/automations.mjs` is the whole of it.

- **A rule is one file**, `automations/<slug>.md`. The frontmatter is the rule (`name`, `enabled`,
  `mode: ask | auto`, `when`, `do`); the body is a note in plain words.
- **Two triggers**: a record is created in a collection; a field *becomes* a value (it was
  something else before that write). Both are decided inside the one record writer, so a change
  made in the app fires at once. A file edited by hand on disk fires nothing.
- **Two actions**, and both only ever file one new record: press a plugin button with its usual
  values, or create a record from a small template (`{{name}}`, `{{field}}`).
- **`ask`** raises a card in Needs you and runs on yes. **`auto`** runs at once, in the name of the
  person who switched the rule on. A change made by an assistant always asks.
- **Once** per rule, record and value, kept as a receipt. A record an automation made never fires
  another. Only a person switches a rule on, edits or archives it; an assistant's rule arrives
  switched off. A rule that names something missing is shown as broken with the reason.

Not built: a schedule trigger ("every Monday"), sending an assistant out or running a skill from a
rule, and any action that changes, deletes or sends.
