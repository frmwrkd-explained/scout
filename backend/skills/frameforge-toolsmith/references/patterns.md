# Four tools that work, and one that doesn't

Read these while drafting. Copy the *shape*, never the content — a tool that
fits the filmmaker's actual phrasing beats a tidy generic one every time.

---

## ANSWERER — `continuity-check`

Reads context, answers, writes nothing. The most common shape and the most
under-proposed, because it feels too small to be a tool. It isn't: the value is
that the question gets asked the same way every time.

```yaml
id: continuity-check
name: Continuity check
capability: Check a shot against the scenes before it and flag anything that contradicts.
```

```markdown
When I ask whether a shot holds continuity:

1. Read the shot record and every shot in the same scene before it.
2. Compare wardrobe, props, time of day, and weather references.
3. Report only contradictions. If there are none, say so in one line.
4. For each contradiction name the two shot ids and the single detail
   that differs — never a paragraph of reasoning.

Example: "SH040 vs SH032 — jacket. SH032 has it off."
```

**Why the capability reads that way:** "flag anything that contradicts" is what
the filmmaker says out loud. "Validate inter-shot continuity invariants" is not.
**Index line:** `continuity-check — Check a shot against the scenes before it and flag anything that contradicts.`

---

## RECORDER — `wardrobe-note`

Produces a record in *their* format. The format is the whole point — this is the
archetype where you should ask to see an example of the real thing.

```yaml
id: wardrobe-note
name: Wardrobe note
capability: Draft a wardrobe continuity note for a shot from what the project already knows.
```

```markdown
When I ask for a wardrobe note on a shot:

1. Read the shot record and the cast entries it references.
2. Draft the note in exactly this shape:

   SHOT · SCENE · CHARACTER
   Wearing —
   Changes from previous —
   Watch for —

3. Leave a line blank rather than inventing it. A blank line is a
   question for the costume department; a guess is a mistake on set.
4. Emit it as a tool.card with the shot id as the title.
```

**Why the capability reads that way:** "from what the project already knows"
sets the expectation that it won't interview them. **Index line:**
`wardrobe-note — Draft a wardrobe continuity note for a shot from what the project already knows.`

---

## COMPOSER — `look-to-scene`

Chains two things they already do by hand, one at a time. The value is
batching; the risk is doing it silently, so it confirms first.

```yaml
id: look-to-scene
name: Look to scene
capability: Apply one saved look across every shot in a scene, listing the changes before making them.
```

```markdown
When I ask to apply a look to a scene:

1. Confirm which look and which scene. Never guess the scene from
   the last thing discussed.
2. List every shot that would change, one line each: shot id, its
   current look, the new one.
3. Wait. Do not apply anything until I say go.
4. After I confirm, apply and report the count only.

Never touch a shot that already carries a different explicit look
without naming it in step 2.
```

**Why the capability reads that way:** "listing the changes before making them"
is a promise the body then keeps. **Index line:**
`look-to-scene — Apply one saved look across every shot in a scene, listing the changes before making them.`

---

## CHECKER — `shoot-ready`

Validates state and reports. Best written by asking *"what do you check the
night before?"* and transcribing the answer.

```yaml
id: shoot-ready
name: Shoot ready
capability: List what is still missing before a scene can be shot.
```

```markdown
When I ask if a scene is ready to shoot:

1. For every shot in the scene, check: does it have a prompt, a
   look, a location, and at least one approved frame?
2. Report as a list of gaps only — never a list of what is fine.
3. Order by shot number, not by severity. I read it on a call sheet.
4. End with one line: "N of M shots ready."
```

**Why the capability reads that way:** "still missing" tells the agent to report
absence, which is the part models get wrong by default. **Index line:**
`shoot-ready — List what is still missing before a scene can be shot.`

---

## The one that doesn't work — `helper`

```yaml
id: helper
name: Helper
capability: A tool that helps with various production tasks and makes things easier.
```

```markdown
This tool is designed to assist filmmakers with their production
workflow. It can help with many different tasks...

[180 more lines covering shots, looks, wardrobe, budgets, and
scheduling, plus a section promising to run `scripts/analyse.mjs`]
```

**The diagnosis, in order of severity:**

1. **It promises a script that does not exist.** The session *can* run `node`,
   so this fails at the file, not at the permission — `scripts/analyse.mjs` is
   never written, because saving a tool writes exactly one `SKILL.md` and
   nothing else. Point a tool at a script that already ships with an installed
   pack, or at `curl` against the API. Never at a file the tool invents.
2. **The capability names no moment.** "Various production tasks" cannot be
   recognised in a request, so the tool never fires. It will look broken.
3. **It is five tools.** Each would be findable alone; merged, none is.
4. **The body is 180 lines.** It loads on every turn the tool is enabled and
   crowds out the thing the filmmaker actually asked.

**The tell that you are drafting this one:** you cannot write the capability
sentence without the word "and", or without "various", "manage", or "helps
with". Stop and go back to interview question one.
