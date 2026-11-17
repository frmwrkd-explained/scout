---
name: Kickoff to-do when a deal is won
enabled: true
mode: auto
when:
  'on': field_becomes
  collection: deals
  field: stage
  value: won
do:
  run: create_record
  collection: todos
  fields:
    name: 'Book the kickoff — {{name}}'
    status: todo
    deal: '{{slug}}'
    company: '{{company}}'
    owner: '{{owner}}'
created: '2026-11-17T09:00:00.874Z'
created_by: crystal
enabled_by: crystal
updated: '2026-11-17T09:00:00.875Z'
---
Does it without asking: a to-do is cheap to make and easy to tick off. It is linked to the deal and its company and given to the deal’s owner.
