-- Bug introduced by 0016, caught before it could ever fire in production:
-- push_subscriptions now holds both 'patient' and 'supporter' rows, and two
-- existing queries join that table by household_id alone, with no role
-- filter. Once a supporter subscription exists on a household, both would
-- have started reaching it:
--
--   * app.claim_due_notifications (0014) would deliver the ELDER's own
--     stage-1/stage-2 "Morning medicines" reminders to the supporter's phone
--     too -- not the escalation-only experience the supporter feature was
--     built to give them (see 0017's own, correctly role-filtered query for
--     what that experience is supposed to be).
--   * the nudge Edge Function's subscriber query would buzz the supporter's
--     OWN phone the moment they press "Send a reminder", alongside the
--     elder's -- the button is meant to reach only the elder.
--
-- app.claim_daily_summary (0015/0018) is correctly untouched: the nightly
-- catch-all is supposed to reach both roles, which is exactly why 0018 added
-- `role`/`elder_name` to its return columns in the first place.
--
-- Same signature, only the query body changes, so CREATE OR REPLACE is
-- enough here -- unlike 0014/0018, no DROP is needed.
create or replace function app.claim_due_notifications(
  p_grace          interval default '30 minutes',
  p_retry          interval default '4 minutes',
  p_followup_grace interval default '20 minutes'
) returns table (
  subscription_id uuid, endpoint text, p256dh text, auth_key text, slot_label text,
  household_id uuid, local_date date, slot_id uuid, slot_time time, stage smallint
)
language sql volatile security definer set search_path = '' as $$
  with hh as (
    select h.id, h.timezone, h.followup_after, h.nightly_summary_time,
           (now() at time zone h.timezone)::date as today
      from public.households h
  ),
  cand as (
    select hh.id as household_id, hh.timezone, hh.followup_after,
           hh.nightly_summary_time, d.local_date
      from hh cross join lateral (values (hh.today), (hh.today - 1)) as d(local_date)
  ),
  unlogged as (
    select c.household_id, c.timezone, c.followup_after, c.nightly_summary_time,
           c.local_date, u.slot_id, u.label, u.fire_time
      from cand c
      cross join lateral app.unlogged_slots(c.household_id, c.local_date) u
  ),
  stage1 as (
    select u.*, 1::smallint as stage
      from unlogged u
     where now() >= ((u.local_date + u.fire_time) at time zone u.timezone)
       and now() <  ((u.local_date + u.fire_time) at time zone u.timezone) + p_grace
  ),
  stage2 as (
    select u.*, 2::smallint as stage
      from unlogged u
     where now() >= ((u.local_date + u.fire_time) at time zone u.timezone) + u.followup_after
       and now() <  ((u.local_date + u.fire_time) at time zone u.timezone)
                    + u.followup_after + p_followup_grace
       and ((u.local_date + u.fire_time) at time zone u.timezone) + u.followup_after
             < ((u.local_date + u.nightly_summary_time) at time zone u.timezone)
  ),
  fired as (
    select * from stage1
    union all
    select * from stage2
  ),
  claimed as (
    insert into app.notification_sends
      (household_id, local_date, slot_id, slot_time, stage, attempts)
    select household_id, local_date, slot_id, fire_time, stage, 1 from fired
    on conflict (household_id, local_date, slot_id, slot_time, stage) do update
      set attempts = app.notification_sends.attempts + 1, claimed_at = now()
      where app.notification_sends.sent_at is null
        and app.notification_sends.attempts < 3
        and app.notification_sends.claimed_at < now() - p_retry
    returning household_id, slot_id, local_date, slot_time, stage
  )
  select ps.id, ps.endpoint, ps.p256dh, ps.auth_key, f.label,
         c.household_id, c.local_date, c.slot_id, c.slot_time, c.stage
    from claimed c
    join fired f on f.household_id = c.household_id and f.slot_id = c.slot_id
                 and f.local_date = c.local_date and f.fire_time = c.slot_time
                 and f.stage = c.stage
    join public.push_subscriptions ps
      on ps.household_id = c.household_id and ps.disabled_at is null and ps.notify_due
     and ps.role = 'patient';
$$;
