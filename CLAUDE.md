# CarePair (Medicine Tracker)

A medicine reminder and pill identification web app for elderly users. Two people, two phones:

- **Elder** ("simple" role in code): the person taking the medicines. Signs in with Google once and owns the household. Marks doses, checks pill photos, fills the weekly pill box.
- **Supporter** (the "helper" in elder-facing text): has no account. Connects with a 6-character share code from the elder's Settings. Adds medicines, photos and times, and follows the day.

Plain browser app (PWA): vanilla JS ES modules, no build step, no dependencies. Backend is Supabase (Postgres, Auth, Realtime, Storage, Edge Functions). Push notifications are sent by the `send-reminders` Edge Function on a cron.

## Repo structure

```
index.html, sw.js, manifest.webmanifest   app shell, service worker (+ push), PWA manifest
css/app.css                               all styles; two "dialects" (elder / supporter) via a body class
js/
  main.js, router.js                      boot, routes, nav
  strings.js                              all UI text, plus APP_VERSION
  date.js                                 date maths; everything runs on the HOUSEHOLD's timezone
  store.js, db.js                         local IndexedDB cache
  sync.js                                 elder: Realtime mirror + offline outbox
  supporter.js, supporter-sync.js         supporter: code-gated RPCs + polling into the same cache
  push.js, supporter-push.js              Web Push subscribe per role
  views/                                  one file per screen (today, settings, calendar, ...)
supabase/
  migrations/NNNN_*.sql                   numbered, additive; latest number + 1 for a new one
  functions/                              Edge Functions (send-reminders, nudge, ...)
docs/                                     architecture, notifications, ui rules, setup
```

## Conventions

- **Version**: `APP_VERSION` in `js/strings.js`. Bump the last digit by one for each release (1.0.1 -> 1.0.2 -> 1.0.3). Never bump the minor or major number.
- **Household-wide settings** (like `uses_organizer`, `nightly_summary_enabled`) are a column on `households`, set through a code-gated RPC callable by both roles, and synced to the elder via `sync.js` and to the supporter via `get_routine`/`supporter-sync.js`.
- Text uses " - " rather than em dashes. Never assume the elder's pronouns ("their").

## Deploying

- The frontend is GitHub Pages: pushing to `main` deploys it. The user does the git push themselves.
- Database migrations go out separately with `npx supabase db push` (the project is already linked). **Apply migrations before pushing frontend code that depends on them.**
- Ask before running anything against the live Supabase project.
