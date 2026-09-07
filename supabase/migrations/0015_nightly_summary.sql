-- The nightly catch-all: one generic message before the day ends, if anything
-- from any of the day's slots is still unmarked.
--
-- Every reminder before this one is per-slot, which leaves a real gap: a day
-- where three separate slots went unticked produces three stage-1s, three
-- stage-2s, and then nothing to close the day. This is the closing message.
--
-- It names no slot and no medicine -- by 23:50 the useful thing to say is
-- "have a look", not an itemised list of what is outstanding, which would
-- read as a bill. See supabase/functions/_shared/messages.ts for the wording
-- and the rules governing it.
--
-- DELIBERATELY NOT SUPPRESSED BY A RECENT STAGE 2. A 22:00 slot left unmarked
-- produces stage 1 at 22:00, stage 2 at 23:00 and this at 23:50. That is
-- three notifications in under two hours and it is intended: the first two are
-- about one slot, this one is about the day, and someone who has marked
-- everything by 23:50 gets none of it.

-- ============================================================
-- 1. Its own dedup table
-- ============================================================
-- Not app.notification_sends. That table is keyed
-- (household, local_date, slot_id, slot_time, stage) and a whole-day message
-- has no slot -- a synthetic slot_id would sit in the same table
-- claim_due_notifications reads, where it could satisfy a stage lookup by
-- accident. A separate table cannot be confused for a slot reminder.
--
-- The retry columns mirror notification_sends exactly, so the claim/retry
-- pattern below reads the same as stage 1's. The foreign key is new (0001's
-- notification_sends has none): there is no reason for these rows to outlive
-- the household they describe.
create table if not exists app.daily_summary_sends (
  household_id uuid not null references public.households(id) on delete cascade,
  local_date   date not null,
  claimed_at   timestamptz not null default now(),
  sent_at      timestamptz,
  attempts     int not null default 0,
  primary key (household_id, local_date)
);

create index if not exists daily_summary_unsent_idx
  on app.daily_summary_sends (claimed_at) where sent_at is null;

-- ============================================================
-- 2. Claim
-- ============================================================
create or replace function app.claim_daily_summary(
  p_window interval default '20 minutes',  -- how long the summary stays eligible
  p_retry  interval default '4 minutes'    -- delivery-failure backoff
) returns table (
  subscription_id uuid, endpoint text, p256dh text, auth_key text,
  household_id uuid, local_date date
)
language sql volatile security definer set search_path = '' as $$
  with hh as (
    select h.id, h.timezone, h.nightly_summary_time,
           (now() at time zone h.timezone)::date as today
      from public.households h
  ),
  -- The cron runs every five minutes, so the fire moment is never hit exactly;
  -- p_window is what turns "at 23:50" into "some time in 23:50-00:10". The
  -- primary key is what keeps that from sending four times.
  in_window as (
    select hh.id, hh.timezone, hh.nightly_summary_time, hh.today
      from hh
     where now() >= ((hh.today + hh.nightly_summary_time) at time zone hh.timezone)
       and now() <  ((hh.today + hh.nightly_summary_time) at time zone hh.timezone) + p_window
  ),
  pending as (
    select w.id as household_id, w.today as local_date
      from in_window w
     where exists (
       select 1 from app.unlogged_slots(w.id, w.today) u
        -- A slot timed AFTER the summary itself (a 23:55 slot against a 23:50
        -- summary) is due today but not yet late, so it must not drag the
        -- whole day into "not fully marked". Chasing a dose before its own
        -- time would be the app inventing a lapse.
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
  select ps.id, ps.endpoint, ps.p256dh, ps.auth_key, c.household_id, c.local_date
    from claimed c
    join public.push_subscriptions ps
      on ps.household_id = c.household_id and ps.disabled_at is null and ps.notify_due;
$$;

create or replace function app.mark_daily_summary_sent(p_household uuid, p_date date)
returns void
language sql volatile security definer set search_path = '' as $$
  update app.daily_summary_sends set sent_at = now()
   where household_id = p_household and local_date = p_date;
$$;

-- ============================================================
-- 3. Public wrappers, service_role only
-- ============================================================
-- Wrappers rather than exposing the `app` schema, and zero-argument for the
-- claim, for both reasons 0009 and 0014 give: PostgREST only serves exposed
-- schemas, and claim_daily_summary hands back push endpoints and their
-- encryption keys. Defaults stay written down once, in app.*.
create or replace function public.claim_daily_summary()
returns table (
  subscription_id uuid, endpoint text, p256dh text, auth_key text,
  household_id uuid, local_date date
)
language sql volatile security definer set search_path = '' as $$
  select * from app.claim_daily_summary();
$$;

create or replace function public.mark_daily_summary_sent(p_household uuid, p_date date)
returns void
language sql volatile security definer set search_path = '' as $$
  select app.mark_daily_summary_sent(p_household, p_date);
$$;

revoke all on function app.claim_daily_summary(interval, interval),
                       app.mark_daily_summary_sent(uuid, date)
  from public, anon, authenticated;

revoke all on function public.claim_daily_summary(),
                       public.mark_daily_summary_sent(uuid, date)
  from public, anon, authenticated;

grant execute on function public.claim_daily_summary(),
                          public.mark_daily_summary_sent(uuid, date)
  to service_role;
