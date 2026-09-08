-- Reset all customer/test data while preserving the schema, migrations, Storage buckets,
-- SQL functions, default slot definitions, and community medicine data.
--
-- WARNING: this is destructive and cannot be undone. Run only against the
-- intended Supabase project. Community medicine references and photo suggestions are preserved.

begin;

-- These ledgers do not all have a household foreign key, so clear them explicitly.
delete from app.notification_sends;
delete from app.daily_summary_sends;
delete from app.escalation_sends;

-- Storage files cannot be deleted through SQL; Supabase protects storage.objects.
-- Run reset-test-storage.mjs separately if photos should also be removed.


-- Deleting users cascades through Supabase auth tables and the application household
-- graph: households, slots, medicines, schedules, dose logs, snapshots,
-- push subscriptions, and other household-owned rows.
-- All slot rows are household-scoped customer data. Built-in Morning, Afternoon,
-- Evening, and Night rows therefore cascade with the household and are recreated
-- automatically for new users; their definitions remain in the app/schema.
delete from auth.users;


commit;
