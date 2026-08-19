---
id: guest
label: Guests
icon: user
query:
  tag: guest
  path: data/guests/**
default_view: needs-review
fields:
  - { key: name,      type: text,   primary: true, required: true }
  - { key: status,    type: status, gate: true, options: [
        { value: needs-review, colour: warn,   group: todo },
        { value: shortlist,    colour: accent, group: active },
        { value: contacted,    colour: marked, group: active },
        { value: replied,      colour: ok,     group: active },
        { value: won,          colour: ok,     group: done } ] }
  - { key: handle,    type: text }
  - { key: platform,  type: select, options: [instagram, facebook, tiktok, youtube, other] }
  - { key: found_in,  type: relation, target: territory, inverse: finds }
  - { key: score,     type: number, display: bar, min: 1, max: 10 }
  - { key: found,     type: date,   display: freshness }
  - { key: tags,      type: multiselect }
  - { key: source,    type: url }
---

Starter collection. Your assistant will propose changes as it learns your work —
approve them and this file updates itself.
