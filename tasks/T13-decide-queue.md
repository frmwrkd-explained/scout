# T13 · DECIDE — one queue, every card type
**Milestone:** M4 · **Reads:** `docs/01_CANON.md` Law 2, `docs/02_DATA_MODEL.md` §6

## Do
One card at a time, `A` accept / `R` reject, altitude 1 by default. **Every** approval in the app flows through here:

| Card | Accepting means |
|---|---|
| **Finding** | the record moves to shortlist |
| **Outbound message or post** | the exact wording is approved for sending |
| **New territory** | the agent may request to join |
| **Learning** | it enters memory and the cache |
| **Schema change** | a collection, field or subtable is created |
| **Question** | the answer is written into `learnings/` or `me.md` |

Rules: reasoning expands on click; evidence is two clicks; rejection takes one of five reasons in a single keystroke; a schema card must show the agent's evidence, never an opinion. Design for card 200 of the day — fatigue is the real constraint.

## Demonstrate
Work a queue containing all six card types using only the keyboard.
