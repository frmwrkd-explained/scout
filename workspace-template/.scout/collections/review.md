---
id: review
label: Reviews
icon: clock
query:
  tag: review
  path: data/reviews/**
fields:
  - key: title
    type: text
    primary: true
    required: true
  - key: kind
    type: select
    options:
      - daily
      - weekly
  - key: period
    type: text
  - key: minutes
    type: number
  - key: done
    type: number
---
Daily and weekly reviews written by the conductor (docs/09_TODAY_LOOP.md §reviews). The numbers
are computed by code from the work log; the agent writes the narrative under "What the agent sees".
