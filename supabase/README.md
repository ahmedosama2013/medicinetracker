# Supabase

This directory holds the backend: [`migrations/0001_init.sql`](migrations/0001_init.sql) (tables, RLS, the code-gated function surface, the freeze and reminder jobs) and two Edge Functions ([`send-reminders`](functions/send-reminders), [`supporter-photo`](functions/supporter-photo)).

For the full one-time setup walkthrough — creating the project, Google OAuth, applying this migration, VAPID keys, deploying the functions, scheduling the reminder cron — see **[docs/setup.md](../docs/setup.md)**.
