# Database reset report (medyra-dev)

Run on 2026-11-08T22:20:21.821Z by `npm run db:reset:dev`. Accounts remaining: 1 (1 on the keep list). Deleted accounts: 50. Storage files removed through the Storage API: 50.

## Rows per table, before and after

| Table | Before | After |
| --- | ---: | ---: |
| accounts | 51 | 1 |
| profiles | 51 | 1 |
| onboarding_preferences | 51 | 1 |
| notification_preferences | 0 | 0 |
| profile_education | 102 | 0 |
| profile_experience | 85 | 0 |
| profile_skills | 322 | 0 |
| posts | 250 | 0 |
| post_comments | 400 | 0 |
| post_likes | 600 | 0 |
| connections | 41 | 0 |
| follows | 61 | 0 |
| member_blocks | 0 | 0 |
| saved_items | 2 | 0 |
| notifications | 1623 | 0 |
| storage_objects | 50 | 0 |

## Structure check

Policies, enabled triggers, functions, RLS flags and bucket configuration are identical before and after; no trigger was disabled and no bypass was used.

```json
{
 "structureBefore": {
  "policies": 144,
  "enabled_triggers": 51,
  "disabled_triggers": 0,
  "tables_without_rls": 0,
  "functions": 106,
  "buckets_hash": "8e73e0506ec7c09eb15e165ad3007ad0"
 },
 "structureAfter": {
  "policies": 144,
  "enabled_triggers": 51,
  "disabled_triggers": 0,
  "tables_without_rls": 0,
  "functions": 106,
  "buckets_hash": "8e73e0506ec7c09eb15e165ad3007ad0"
 }
}
```
