---
name: Invoice when a deal is won
enabled: true
mode: ask
when:
  'on': field_becomes
  collection: deals
  field: stage
  value: won
do:
  run: plugin
  plugin: invoice
  action: create
created: '2026-11-17T09:00:00.871Z'
created_by: crystal
enabled_by: crystal
updated: '2026-11-17T09:00:00.872Z'
---
Asks first, because an invoice number is used up the moment it is filed. Yes presses “Create invoice” with its usual values: the next number, today, the whole amount, 14 days.
