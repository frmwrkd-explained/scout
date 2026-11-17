---
type: goal
id: answer-every-inbound-in-a-day
label: Nobody waits more than 14 days
target: 0
unit: people waiting
deadline: '2026-12-17'
created: '2026-10-18'
count:
  path: data/people/**
  where:
    follow_up: true
created_by: crystal
updated: '2026-11-17'
updated_by: crystal
---
The count is the people whose last message was theirs and is older than two weeks. The follow-up skill keeps it honest.
