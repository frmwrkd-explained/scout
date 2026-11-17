---
id: invoices
label: Invoices
colour: green
query:
  path: data/invoices/**
default_view: all
header:
  - status
  - amount
  - date
  - due_date
  - company
  - deal
page:
  layout: stack
  width: normal
  sections:
    - properties
    - note
fields:
  - key: name
    type: text
    primary: true
    required: true
    label: Number
  - key: status
    type: status
    options:
      - value: draft
        group: todo
      - value: sent
        group: active
        colour: marked
      - value: overdue
        group: active
        colour: warn
      - value: paid
        group: done
        colour: ok
  - key: amount
    type: number
    display: currency
  - key: date
    type: date
  - key: due_date
    type: date
  - key: company
    type: relation
    target: companies
  - key: deal
    type: relation
    target: deals
  - key: label
    type: text
  - key: line_items
    type: json
---
What has been billed. An invoice is made from a deal with the Invoice plugin and can be printed from its own page.
