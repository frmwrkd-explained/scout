# Connectors and Ask AI

For the owner. What is built, how to use it, what cannot work and why, and what comes next.

There are two different things here, and the app shows them as two lists:

- **Agents that can come in.** Another app on your computer (Claude Desktop, Claude Code, Codex, Gemini CLI, Antigravity) starts Scout's connector and works in your workspace through Scout's rules.
- **Agents Scout can send out.** The assistants Scout starts itself. "Ask AI" on a record uses these.

---

## 1. What is built

| | Works today | Where |
|---|---|---|
| Connectors screen | Yes | Settings → **Connectors** (above Integrations) |
| Connect / Update / Disconnect for Claude Desktop, Codex, Gemini CLI, Antigravity | Yes, by click | same screen |
| Claude Code | Yes, by copying one command | same screen |
| claude.ai and ChatGPT in the browser | **No** — explained on the screen | section 4 |
| All 34 Scout tools answer over the connector | Yes (6 used to answer "not bound") | `backend/mcp.mjs` |
| The connector over HTTP (`POST /api/mcp`) | Yes, for an app that connects by address — see the limit in section 3 | `backend/mcp.mjs` |
| Ask AI: answer, draft, fill | Backend and panel are built and tested. The button appears on the record page once it is mounted there (one line in `frontend/Document.jsx`). | `backend/askAi.mjs`, `frontend/AskAI.jsx` |
| Unattended schedules for connected agents | **Not built** | section 7 |

---

## 2. Connecting an agent, step by step

Open **Settings → Connectors**. Each card shows the exact text Scout will write and the exact file, before any button. Clicking **Connect** is the consent. Afterwards the card shows where the backup of the old file is and tells you to restart the app.

What `Connect` does, in every case:

1. Reads the app's settings file. If Scout cannot read it safely, it stops and changes nothing.
2. Saves a copy beside it: `<file>.scout-backup-YYYYMMDD-HHMMSS`.
3. Adds **one** entry named `scout`. Every other entry and setting is left as it was.
4. Writes the new file in one step (a temporary file, then a rename), keeping the file's permissions.

`Disconnect` removes that one entry, after another backup. It never deletes the file.

### Claude Desktop

- File (macOS): `~/Library/Application Support/Claude/claude_desktop_config.json`. Windows: `%APPDATA%\Claude\claude_desktop_config.json`. Linux: `~/.config/Claude/claude_desktop_config.json`.
- Scout adds `mcpServers.scout` with `command`, `args` and `env`.
- Then quit Claude Desktop completely and open it again.
- Official page: <https://modelcontextprotocol.io/docs/develop/connect-local-servers>

### Claude Code

- Claude Code keeps its servers in a file it manages itself (`~/.claude.json`), so Scout does not edit it. The card gives you one command to run in a terminal:
  `claude mcp add --scope user --env … --transport stdio scout -- <node> <script>`
- For one project only, the card also gives a `.mcp.json` to save in that project's folder.
- To undo: `claude mcp remove --scope user scout`.
- Official page: <https://code.claude.com/docs/en/mcp>

### Codex (GPT on your computer)

- File: `~/.codex/config.toml`.
- Scout adds a `[mcp_servers.scout]` table and a `[mcp_servers.scout.env]` table at the end of the file.
- Start a new Codex session afterwards.
- Official page: <https://learn.chatgpt.com/docs/extend/mcp?surface=cli>

### Gemini CLI

- File: `~/.gemini/settings.json`. Scout adds `mcpServers.scout`.
- Gemini CLI only loads servers in a folder you have marked as trusted.
- Google's own page says Gemini CLI was replaced by Antigravity for free and Google One accounts on 18 June 2026. If that is you, connect Antigravity.
- Official page: <https://geminicli.com/docs/tools/mcp-server/>

### Antigravity

- File: `~/.gemini/config/mcp_config.json`. Scout adds `mcpServers.scout`.
- Afterwards open the MCP servers list in Antigravity and restart or reload it.
- Official page: <https://antigravity.google/docs/mcp>

### What was checked, and how

- **Checked against the official pages above:** every file location, the shape of each entry, the Claude Code command syntax (including that an option must sit between `--env` and the server name).
- **Checked with the real tools on this computer, using a throw-away home folder** (your real settings were not touched): Codex's `codex mcp list` read Scout's `config.toml` and listed `scout`; Gemini CLI's `gemini mcp list` read Scout's `settings.json` and listed `scout`; Claude Code ran the generated command and stored the entry with the path — which contains spaces — as one argument.
- **Checked by test:** the entry Scout writes is started exactly as an app would start it, and answers with all 34 tools.
- **Not checked:** Claude Desktop and Antigravity themselves loading the entry (no test could open those apps), Windows and Linux on a real machine, and the signed, installed Scout app (see below).

### The installed Scout app, and Node.js

Agent apps start the connector as a separate program. In the installed app, the connector script is packed inside the app's archive (`app.asar`), which plain Node.js cannot read. So Scout does not ask for Node.js at all: the entry starts **the Scout app's own program in Node mode** (`ELECTRON_RUN_AS_NODE=1`).

- Tested: the Electron program that ships with this project started the connector from inside a packed archive and answered. Plain Node.js failed on the same archive, as expected.
- Not tested: the same on a signed, installed build. It relies on a standard Electron switch that this project has not turned off.
- If you move or update Scout, the path in the other app's settings goes stale. The card then says **Connected, older settings**, and **Update** fixes it.

When Scout runs from source (`npm run server`), the entry uses the Node.js that is running Scout, by its full path. Desktop apps do not see your terminal's PATH, so a bare `node` would not be found.

---

## 3. The connector over HTTP

`POST /api/mcp` on Scout's local server speaks the same protocol with the same 34 tools and the same rules. It is for an app that connects by address instead of starting a program.

- It only answers this computer. A request from another machine, with a non-local `Host`, or from a web page of another origin is refused (403). `GET` is answered 405: there is no stream.
- **Limit:** it only works while Scout is open, and the installed app picks a different port every time it starts, so the address is not stable there. From source the address is `http://127.0.0.1:5177/api/mcp`. For this reason the Connectors screen writes the start-a-program form, which works with Scout closed. Giving the installed app a fixed port is a small change in `desktop/main.cjs` and is not done.

---

## 4. What cannot work, and why

**claude.ai and ChatGPT in the browser.** These connect from Anthropic's and OpenAI's servers, not from your computer. They cannot start a program on your machine and cannot reach `127.0.0.1`. They need Scout at a public HTTPS address with a sign-in. Scout does not offer that. Use Claude Desktop or Claude Code for Claude, and Codex for GPT.

- Claude custom connectors: <https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp>
- OpenAI's page for ChatGPT connectors was not checked.

Making this work means running a tunnel or hosting Scout's connector publicly, with real authentication. That would put your notes behind a public address. It is a decision, not a missing button.

---

## 5. The safety model

### The gate

A connected agent is always treated as an agent, whatever name it gives. It can read records, add what it finds, and put suggestions in front of you. It cannot:

- delete anything,
- move a record past `shortlist`,
- change your goals or your profile,
- send a message to anyone. It can only ask, and the card waits for you.

Everything it does is in Activity under its own name (`mcp-claude-desktop`, `mcp-codex`, and so on).

Two holes were closed while building this:

- An agent could type your name as the actor and be treated as you. The connector now replaces a person's name with the agent id.
- On a brand-new workspace the goals rule treats an unknown name as the person. The goals tool therefore refuses at the door, always.

This is a safety rail against an agent's mistake. It is not a wall against a hostile program: anything with access to your disk can edit the files directly. Scout then ignores a promotion an agent wrote and shows it as such.

### Other apps' settings files

These files hold other tools' API keys. Scout reads them only to find its own entry. The Connectors screen shows a **count** of other servers, never their names, commands or keys. Scout refuses to edit a file it cannot read with certainty:

- JSON that does not parse (comments, a trailing comma),
- a `config.toml` with a line Scout does not recognise, or one that keeps all servers on a single line.

For TOML, Scout has no full parser. It reads the file's structure line by line and stops at anything unfamiliar. It only ever adds or removes its own table; every other byte stays.

Connect and Disconnect are for the person only. An agent's request is refused (403).

### Record text is not trusted

Many records were written by an agent or pasted from a web page. Any of them can contain "ignore your instructions". Ask AI is built so that this cannot do harm:

- The model has no tools. It can only return text.
- The rules come first and say the record is data. The record follows as quoted data inside a block whose marker is random for every request.
- The reply is checked as data. For Fill, each value is tested against the property's type and choices. Unknown properties, wrong types and values outside a choice list are dropped, and the panel says which. The stage (`status`) is never suggested.
- Nothing is saved until you click **Apply**.

A fooled model can produce a wrong suggestion, which you read before applying. Nothing else.

### Budgets

Ask AI uses the same daily call budget as the Today screen (the "light" budget, 40 calls a day by default, set in Settings → Today). Every call counts, including failed ones. When it is used up, Ask AI says so and when it resets (midnight).

---

## 6. Ask AI on a record

A button in the record page's toolbar opens a small panel with three starters:

- **Summarise this** — text back. Nothing changes.
- **Draft a note about…** — proposed text, for the end of the note or for one long-text property.
- **Fill the empty properties** — proposed values, for empty properties only.

A proposal is listed as before → after with **Apply** and **Discard**.

What it needs: one of Gemini CLI, Devin, or Codex (for GPT-6 Luna) **installed and signed in on this computer**. No API key is used or stored. If none is signed in, the panel says which to sign in to.

Route: `POST /api/ai/ask { path, question, mode, field? }`. It writes nothing.

---

## 7. The licensing question

Ask AI and the Today screen run on the subscriptions you are signed in to in each tool, through that tool's own command line. Anthropic's terms steer people who build products toward API keys rather than routing a subscription sign-in through another program (<https://code.claude.com/docs/en/legal-and-compliance>). OpenAI and Google have their own terms, which were not reviewed here.

For your own use on your own computer this is the tools being used as their command lines allow. For a Scout you **share with other people**, check each provider's terms before telling users to rely on their subscriptions, or add an API-key option. This is yours to decide; nothing here settles it.

Connected agents (section 2) are not affected: there the other app is the one calling its own model.

---

## 8. Next: agents that work on their own

Your goal is agents that work without you starting them, with results arriving as cards.

**What exists**

- A scheduler (`backend/dispatch.mjs`). Every minute it checks which of Scout's own assistants are due — `daily` (after 06:00), `weekly`, or `continuous` (every 30 minutes) — and sends them out, if **Automatic schedules** is on in Settings.
- Each run is recorded, and what it found is counted from the log.
- What an agent finds already arrives as suggestions in **Needs you**.
- A task queue that a connected agent can read and claim from (`scout_get_tasks`, `scout_post_tasks_claim`).

**What is missing**

1. **Scout cannot wake a connected agent.** The connector is one-directional: the other app starts the conversation. Scout has no way to tell Claude Desktop or Antigravity "start now". For those, the schedule has to live in the other tool (Claude Code and Codex can both be run from a timer with a prompt), and nothing in Scout sets that up or shows it.
2. **The scheduler only runs while Scout is open.** There is no background helper and no start-at-login. "Overnight" today means "the first time you open Scout after 06:00".
3. **No run card.** A finished run shows on Today, but there is no single card in Needs you saying "Codex came back: 12 found, 3 need you".
4. **Schedules are three fixed choices.** No "weekdays at 07:00".
5. **No per-agent limit for unattended work, and no notification** when a run fails or a card arrives.

None of this is built. The smallest useful next step is 3 and 5 together (a run card and a notification), then 2.

---

## Routes

| Route | What |
|---|---|
| `GET /api/connectors` | For each agent app: the file, the exact text, and what is there now |
| `POST /api/connectors/:id/install` | Add or refresh Scout's entry. Person only. Needs the `hash` the screen showed. |
| `POST /api/connectors/:id/remove` | Remove Scout's entry. Person only. |
| `POST /api/ai/ask` | Ask about one record. Returns an answer or a proposal. Writes nothing. |
| `POST /api/mcp` | The connector over HTTP. This computer only. |

Code: `backend/connectors.mjs`, `backend/connectorRoutes.mjs`, `backend/askAi.mjs`, `backend/mcp.mjs`, `frontend/Connectors.jsx`, `frontend/AskAI.jsx`. Tests: `tests/connectors.test.mjs`, `tests/ask-ai.test.mjs`.
