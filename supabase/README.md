# Supabase

This directory holds the backend: [`migrations/0001_init.sql`](migrations/0001_init.sql) (tables, RLS, the code-gated function surface, the freeze and reminder jobs), later migrations layered on top of it, and five Edge Functions — [`send-reminders`](functions/send-reminders), [`nudge`](functions/nudge), [`test-notification`](functions/test-notification) and [`supporter-photo`](functions/supporter-photo), and [`community-medicine`](functions/community-medicine).

[`functions/_shared/`](functions/_shared) is not a function: the leading underscore keeps Supabase from deploying it, and it holds code the functions import. Every push notification's wording is in [`_shared/messages.ts`](functions/_shared/messages.ts) — see [docs/notifications.md](../docs/notifications.md) before editing it, the four rules at the top of that file are load-bearing.

For the full one-time setup walkthrough — creating the project, Google OAuth, applying this migration, VAPID keys, deploying the functions, scheduling the reminder cron — see **[docs/setup.md](../docs/setup.md)**.
