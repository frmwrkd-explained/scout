---
id: work
label: Work
icon: check
query:
  tag: work
  path: data/work/**
fields:
  - key: title
    type: text
    primary: true
    required: true
  - key: bucket
    type: select
    options:
      - research
      - reading
      - seo
      - marketing
      - email
      - facebook-groups
      - reddit
      - admin
  - key: status
    type: status
    options:
      - value: planned
        colour: warn
        group: todo
      - value: now
        colour: accent
        group: active
      - value: done
        colour: ok
        group: done
      - value: parked
        colour: muted
        group: todo
      - value: stuck
        colour: warn
        group: todo
  - key: day
    type: date
  - key: order
    type: number
  - key: estimate_min
    type: number
  - key: why
    type: text
  - key: result
    type: number
  - key: result_note
    type: text
  - key: prep
    type: checkbox
  - key: prep_state
    type: select
    options:
      - none
      - preparing
      - ready
      - failed
---
The Today loop's work items (docs/09_TODAY_LOOP.md). `day` empty means backlog; `status`
is where the item sits in the push — it is a board column, not a gate: the conductor writes
freely and the human's own day is not a pipeline to be gated through.
