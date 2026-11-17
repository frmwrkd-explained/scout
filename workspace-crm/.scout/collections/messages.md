---
id: messages
label: Messages
colour: violet
query:
  path: data/messages/**
default_view: timeline
header:
  - date
  - channel
  - direction
  - person
  - company
  - deal
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
    label: Subject
  - key: date
    type: date
  - key: channel
    type: select
    options:
      - value: email
        colour: blue
      - value: call
        colour: green
      - value: meeting
        colour: violet
      - value: linkedin
        colour: teal
  - key: direction
    type: select
    options:
      - value: inbound
        colour: marked
      - outbound
  - key: person
    type: relation
    target: people
  - key: company
    type: relation
    target: companies
  - key: deal
    type: relation
    target: deals
---
Every email, call and meeting, one record each. The note is what was said.
