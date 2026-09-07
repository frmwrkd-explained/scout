---
id: group
label: Groups
icon: users
query:
  tag: group
  path: data/groups/**
default_view: my-best
fields:
  - key: label
    type: text
    primary: true
    required: true
  - key: platform
    type: select
    options:
      - facebook
      - instagram
      - tiktok
      - reddit
  - key: url
    type: url
  - key: access
    type: select
    options:
      - untried
      - requested
      - joined
      - rejected
      - banned
  - key: members
    type: number
  - key: finds
    type: number
  - key: booked
    type: number
  - key: joined
    type: date
    display: freshness
  - key: tags
    type: multiselect
    options:
      - group
      - ph
      - health
      - parenting
      - migration
      - food
      - alumni
---
The catalogue of places worth working. The live scoreboard lives in `territory/` —
`finds` and `booked` here are what was counted by hand before the assistants ran, kept
because `my-best` has to sort on something (docs/decisions.md, seeding ambiguity 5).
