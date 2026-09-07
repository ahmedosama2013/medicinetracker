-- Escalation was anchored on households.followup_after + escalation_after --
-- so picking "30 minutes" actually meant 1h30m after the slot (the elder's
-- own 1-hour follow-up delay, plus the supporter's 30 minutes on top). That
-- reads wrong: a supporter choosing a delay expects it counted from the
-- slot's own time, not from a number that belongs to the elder's ladder and
-- that the supporter never sees. This anchors escalation on the slot time
-- alone, matching what the Settings picker actually says ("30 minutes after
-- it's due").
--
-- Same signature as 0017 (same arguments, same return columns) -- only the
-- eligibility window changes, so CREATE OR REPLACE is enough here, same as
-- 0019's fix to claim_due_notifications.
create or replace function app.claim_supporter_escalations(
  p_window interval default '20 minutes',
  p_retry  interval default '4 minutes'
) returns table (
  subscription_id uuid, endpoint text, p256dh text, auth_key text, slot_label text,
  household_id uuid, local_date date, slot_id uuid, slot_time time, elder_name text
)
language sql volatile security definer set search_path = '' as $$
  with sup as (
    select ps.id as subscription_id, ps.endpoint, ps.p256dh, ps.auth_key,
           ps.escalation_after, ps.household_id
      from public.push_subscriptions ps
     where ps.role = 'supporter' and ps.disabled_at is null and ps.notify_due
  ),
  hh as (
    select h.id, h.timezone, h.display_name,
           (now() at time zone h.timezone)::date as today
      from public.households h
  ),
  cand as (
    select s.subscription_id, s.endpoint, s.p256dh, s.auth_key, s.escalation_after,
           h.id as household_id, h.timezone, h.display_name, d.local_date
      from sup s
      join hh h on h.id = s.household_id
      cross join lateral (values (h.today), (h.today - 1)) as d(local_date)
  ),
  -- Anchored on the SLOT's own time -- households.followup_after no longer
  -- enters into this at all.
  eligible as (
    select c.*, u.slot_id, u.label, u.fire_time
      from cand c
      cross join lateral app.unlogged_slots(c.household_id, c.local_date) u
     where now() >= ((c.local_date + u.fire_time) at time zone c.timezone) + c.escalation_after
       and now() <  ((c.local_date + u.fire_time) at time zone c.timezone) + c.escalation_after + p_window
  ),
  claimed as (
    insert into app.escalation_sends
      (subscription_id, household_id, local_date, slot_id, slot_time, attempts)
    select subscription_id, household_id, local_date, slot_id, fire_time, 1 from eligible
    on conflict (subscription_id, local_date, slot_id, slot_time) do update
      set attempts = app.escalation_sends.attempts + 1, claimed_at = now()
      where app.escalation_sends.sent_at is null
        and app.escalation_sends.attempts < 3
        and app.escalation_sends.claimed_at < now() - p_retry
    returning subscription_id, household_id, local_date, slot_id, slot_time
  )
  select c.subscription_id, e.endpoint, e.p256dh, e.auth_key, e.label,
         c.household_id, c.local_date, c.slot_id, c.slot_time, e.display_name
    from claimed c
    join eligible e on e.subscription_id = c.subscription_id and e.local_date = c.local_date
                    and e.slot_id = c.slot_id and e.fire_time = c.slot_time;
$$;
