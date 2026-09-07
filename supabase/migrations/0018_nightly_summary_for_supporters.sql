-- The nightly catch-all already reaches supporter subscriptions -- its join
-- to push_subscriptions in 0015 has no role filter, so a 'supporter' row is
-- already included the moment one exists. The only gap is that the function
-- doesn't say which kind of row it just claimed, so send-reminders has no way
-- to pick supporter wording ("<name>'s medicines are still unmarked") over
-- the elder's own ("Before the day ends"). This adds exactly that: `role` and
-- the elder's `households.display_name`, nothing else changes -- which
-- households/dates are eligible is untouched.
--
-- A changed RETURNS TABLE column list needs an explicit drop first, or the
-- old version keeps existing alongside the new one -- the same trap 0004 and
-- 0014 already document for a changed argument list.
drop function if exists app.claim_daily_summary(interval, interval);
drop function if exists public.claim_daily_summary();

create or replace function app.claim_daily_summary(
  p_window interval default '20 minutes',
  p_retry  interval default '4 minutes'
) returns table (
  subscription_id uuid, endpoint text, p256dh text, auth_key text,
  household_id uuid, local_date date, role text, elder_name text
)
language sql volatile security definer set search_path = '' as $$
  with hh as (
    select h.id, h.timezone, h.nightly_summary_time, h.display_name,
           (now() at time zone h.timezone)::date as today
      from public.households h
  ),
  in_window as (
    select hh.id, hh.timezone, hh.nightly_summary_time, hh.display_name, hh.today
      from hh
     where now() >= ((hh.today + hh.nightly_summary_time) at time zone hh.timezone)
       and now() <  ((hh.today + hh.nightly_summary_time) at time zone hh.timezone) + p_window
  ),
  pending as (
    select w.id as household_id, w.today as local_date, w.display_name
      from in_window w
     where exists (
       select 1 from app.unlogged_slots(w.id, w.today) u
        where u.fire_time <= w.nightly_summary_time
     )
  ),
  claimed as (
    insert into app.daily_summary_sends (household_id, local_date, attempts)
    select household_id, local_date, 1 from pending
    on conflict (household_id, local_date) do update
      set attempts = app.daily_summary_sends.attempts + 1, claimed_at = now()
      where app.daily_summary_sends.sent_at is null
        and app.daily_summary_sends.attempts < 3
        and app.daily_summary_sends.claimed_at < now() - p_retry
    returning household_id, local_date
  )
  select ps.id, ps.endpoint, ps.p256dh, ps.auth_key, c.household_id, c.local_date,
         ps.role, p.display_name
    from claimed c
    join pending p on p.household_id = c.household_id and p.local_date = c.local_date
    join public.push_subscriptions ps
      on ps.household_id = c.household_id and ps.disabled_at is null and ps.notify_due;
$$;

create or replace function public.claim_daily_summary()
returns table (
  subscription_id uuid, endpoint text, p256dh text, auth_key text,
  household_id uuid, local_date date, role text, elder_name text
)
language sql volatile security definer set search_path = '' as $$
  select * from app.claim_daily_summary();
$$;

revoke all on function app.claim_daily_summary(interval, interval) from public, anon, authenticated;
revoke all on function public.claim_daily_summary() from public, anon, authenticated;
grant execute on function public.claim_daily_summary() to service_role;
