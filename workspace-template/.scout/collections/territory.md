---
id: territory
label: Territory
icon: map
query:
  path: territory/**
default_view: my-best
fields:
  - { key: label,   type: text, primary: true }
  - { key: kind,    type: select, options: [facebook-group, hashtag, subreddit, account, site, referral] }
  - { key: access,  type: status, options: [
        { value: untried,   colour: muted,  group: todo },
        { value: requested, colour: marked, group: active },
        { value: joined,    colour: ok,     group: active },
        { value: rejected,  colour: danger, group: done },
        { value: banned,    colour: danger, group: done } ] }
  - { key: url,        type: url }
  - { key: last_swept, type: date, display: freshness }
  - { key: sweep_interval_days, type: number }
  - { key: finds, type: rollup, via: finds, fn: count }
  - { key: wins,  type: rollup, via: finds, target_field: status, fn: count }
---

Where your assistants can work. `finds` and `wins` are computed from records —
never type them.
