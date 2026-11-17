---
id: people
label: People
colour: blue
query:
  path: data/people/**
default_view: by-company
header:
  - role
  - company
  - email
  - phone
  - last_message
  - follow_up
page:
  layout: stack
  width: normal
  sections:
    - properties
    - children
    - note
subtables:
  - id: messages
    label: Messages
    collection: messages
    bind:
      person: $self
fields:
  - key: name
    type: text
    primary: true
    required: true
  - key: role
    type: text
  - key: company
    type: relation
    target: companies
  - key: email
    type: email
  - key: phone
    type: phone
  - key: decision_maker
    type: checkbox
  - key: follow_up
    type: checkbox
    label: Needs follow-up
  - key: messages
    type: relation
    target: messages
    many: true
  - key: last_message
    type: rollup
    via: messages
    target_field: date
    fn: latest
---
The people at each company. A person belongs to one company and carries the messages exchanged with them.
