-- Make the reminder job's three functions reachable.
--
-- send-reminders calls rpc('claim_due_notifications'), rpc('mark_notification_sent')
-- and rpc('disable_push_subscription'). All three live in the `app` schema.
-- PostgREST only serves the schemas a project exposes, and the Supabase client
-- resolves unqualified names against `public` -- so those calls have always
-- failed with "Could not find the function public.claim_due_notifications".
--
-- Together with the VAPID boot crash fixed alongside this, that means the
-- nightly reminder has never delivered a notification on this project. The
-- cron job fires every five minutes into a function that cannot do its work.
--
-- Wrappers rather than exposing the `app` schema, for two reasons:
--
--   1. Exposing `app` would publish every internal function at once, including
--      the freeze job. This publishes exactly three.
--   2. **claim_due_notifications returns push endpoints and keys, for every
--      household with something due.** It must never be callable by anon or
--      authenticated. Wrapping lets the grant be service_role only; exposing
--      the schema would make that much easier to get wrong.
--
-- Defaults mirror the `app` versions so the existing no-argument call keeps
-- working, and stay in one place -- the wrapper passes nothing it was not
-- given, so app.* remains the single definition of what those intervals mean.

create or replace function public.claim_due_notifications(
  p_grace          interval default '20 minutes',
  p_retry          interval default '4 minutes',
  p_followup       interval default '45 minutes',
  p_followup_grace interval default '20 minutes'
) returns table (
  subscription_id uuid, endpoint text, p256dh text, auth_key text, slot_label text,
  household_id uuid, local_date date, slot_id uuid, slot_time time, stage smallint
)
language sql volatile security definer set search_path = '' as $$
  select * from app.claim_due_notifications(p_grace, p_retry, p_followup, p_followup_grace);
$$;

create or replace function public.mark_notification_sent(
  p_household uuid, p_date date, p_slot uuid, p_time time, p_stage smallint default 1
) returns void
language sql volatile security definer set search_path = '' as $$
  select app.mark_notification_sent(p_household, p_date, p_slot, p_time, p_stage);
$$;

create or replace function public.disable_push_subscription(p_id uuid) returns void
language sql volatile security definer set search_path = '' as $$
  select app.disable_push_subscription(p_id);
$$;

-- ============================================================
-- Grants: service_role only
-- ============================================================
-- Not anon, not authenticated. The first of these hands back push endpoints
-- and their encryption keys for every household that has a dose due.

revoke all on function
  public.claim_due_notifications(interval, interval, interval, interval),
  public.mark_notification_sent(uuid, date, uuid, time, smallint),
  public.disable_push_subscription(uuid)
  from public, anon, authenticated;

grant execute on function
  public.claim_due_notifications(interval, interval, interval, interval),
  public.mark_notification_sent(uuid, date, uuid, time, smallint),
  public.disable_push_subscription(uuid)
  to service_role;
