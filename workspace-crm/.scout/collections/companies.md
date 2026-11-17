---
id: companies
label: Companies
colour: teal
query:
  path: data/companies/**
default_view: cards
header:
  - stage
  - tier
  - owner
  - pipeline_value
  - last_contact
page:
  layout: stack
  width: normal
  sections:
    - properties
    - note
    - children
subtables:
  - id: people
    label: People
    collection: people
    bind:
      company: $self
  - id: deals
    label: Deals
    collection: deals
    bind:
      company: $self
  - id: messages
    label: Messages
    collection: messages
    bind:
      company: $self
  - id: invoices
    label: Invoices
    collection: invoices
    bind:
      company: $self
fields:
  - key: name
    type: text
    primary: true
    required: true
  - key: stage
    type: select
    options:
      - value: lead
        colour: blue
      - value: prospect
        colour: amber
      - value: customer
        colour: ok
      - past
  - key: tier
    type: select
    options:
      - value: key
        colour: violet
      - standard
  - key: industry
    type: select
    options:
      - Food & drink
      - Software
      - Retail
      - Media
      - Outdoor gear
      - Hospitality
      - Architecture
      - Music
      - Education
      - Health & wellness
      - Non-profit
  - key: size
    type: select
    options:
      - 1–10
      - 11–50
      - 51–200
      - 200+
  - key: owner
    type: select
    options:
      - Ines
      - Kofi
      - Mira
  - key: city
    type: text
  - key: website
    type: url
  - key: tags
    type: multiselect
  - key: deals
    type: relation
    target: deals
    many: true
    label: All deals
  - key: open_deals
    type: relation
    target: deals
    many: true
  - key: messages
    type: relation
    target: messages
    many: true
  - key: deal_count
    type: rollup
    via: deals
    target_field: amount
    fn: count
    label: Deals
  - key: pipeline_value
    type: rollup
    via: open_deals
    target_field: amount
    fn: sum
    label: Open pipeline
  - key: last_contact
    type: rollup
    via: messages
    target_field: date
    fn: latest
---
Every organisation the studio has worked with or wants to. A company lists its people, its deals, its messages and its invoices.
