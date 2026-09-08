-- Reset all customer/test data while preserving the schema, migrations, Storage buckets,
-- SQL functions, and the default slot definitions in the code/migrations.
--
-- WARNING: this is destructive and cannot be undone. Run only against the
-- intended Supabase project. It also clears the shared community medicine
-- catalogue so a deployment can start completely fresh.

begin;

-- These ledgers do not all have a household foreign key, so clear them explicitly.
delete from app.notification_sends;
delete from app.daily_summary_sends;

-- Storage files cannot be deleted through SQL; Supabase protects storage.objects.
-- Run reset-test-storage.mjs separately with the service-role key.

-- This cascades through Supabase auth tables and the application household
-- graph: households, slots, medicines, schedules, dose logs, snapshots,
-- push subscriptions, and other household-owned rows.
-- The slot rows are customer data; the default slot timings themselves remain
-- defined by the app/schema and will be recreated for the next household.
delete from auth.users;

-- Community rows are not owned by a household, so auth.users cannot cascade to
-- them. Delete them after medicines are gone because medicines reference the
-- community records with ON DELETE RESTRICT.
delete from community_photo_suggestions;
delete from community_medicine_references;

commit;
