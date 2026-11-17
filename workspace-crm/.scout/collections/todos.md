---
id: todos
label: To-dos
colour: pink
query:
  path: data/todos/**
default_view: open
header:
  - status
  - due
  - deal
  - company
  - owner
page:
  layout: stack
  width: narrow
  sections:
    - properties
    - note
fields:
  - key: name
    type: text
    primary: true
    required: true
  - key: status
    type: status
    options:
      - value: todo
        group: todo
      - value: doing
        group: active
        colour: marked
      - value: done
        group: done
        colour: ok
  - key: due
    type: date
  - key: deal
    type: relation
    target: deals
  - key: company
    type: relation
    target: companies
  - key: owner
    type: select
    options:
      - Ines
      - Kofi
      - Mira
---
The next step on a deal. Some are written by hand; the kickoff one is made by an automation when a deal is won.
