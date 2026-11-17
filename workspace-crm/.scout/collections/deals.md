---
id: deals
label: Deals
colour: amber
query:
  path: data/deals/**
default_view: pipeline
header:
  - stage
  - amount
  - close_date
  - company
  - person
  - owner
page:
  layout: stack
  width: normal
  sections:
    - properties
    - note
    - children
subtables:
  - id: messages
    label: Messages
    collection: messages
    bind:
      deal: $self
  - id: invoices
    label: Invoices
    collection: invoices
    bind:
      deal: $self
  - id: todos
    label: To-dos
    collection: todos
    bind:
      deal: $self
fields:
  - key: name
    type: text
    primary: true
    required: true
  - key: stage
    type: status
    options:
      - value: lead
        group: todo
        colour: blue
      - value: qualified
        group: active
        colour: teal
      - value: proposal
        group: active
        colour: amber
      - value: negotiation
        group: active
        colour: orange
      - value: won
        group: done
        colour: ok
      - value: lost
        group: done
        colour: red
  - key: amount
    type: number
    display: currency
  - key: close_date
    type: date
  - key: quarter
    type: select
    options:
      - 2026-Q3
      - 2026-Q4
      - 2027-Q1
  - key: company
    type: relation
    target: companies
  - key: person
    type: relation
    target: people
    label: Contact
  - key: owner
    type: select
    options:
      - Ines
      - Kofi
      - Mira
  - key: source
    type: select
    options:
      - referral
      - inbound
      - conference
      - outreach
  - key: probability
    type: number
  - key: line_items
    type: json
---
Work being sold. A deal moves left to right through the pipeline; its line items are what an invoice is made from.
