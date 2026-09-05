-- Second reminder: if a slot's first reminder was actually sent and the slot
-- is still unlogged p_followup later, send exactly one follow-up. Never more
-- than one -- this is a gentle nudge, not a nag, per docs/ui.md's "must never
-- read as judgement" rule for the whole app.
--
-- The existing attempts/claimed_at/retry columns on notification_sends are a
-- DELIVERY-failure retry (a push that never went out), not a "still
-- unmarked" nudge -- those are two different problems and this keeps them
-- that way rather than overloading one mechanism for both.

-- ============================================================
-- 1. Track each stage independently
-- ============================================================
alter table app.notification_sends
  add column if not exists stage smallint not null default 1 check (stage in (1, 2));

alter table app.notification_sends drop constraint notification_sends_pkey;
alter table app.notification_sends
  add primary key (household_id, local_date, slot_id, slot_time, stage);

-- ============================================================
-- 2. claim_due_notifications: stage 1 unchanged, stage 2 added
-- ============================================================
-- CREATE OR REPLACE does not replace a function whose parameter list
-- changed -- Postgres treats a different signature as a different function,
-- so without this the old 2-argument version would keep existing
-- alongside the new one instead of being replaced by it.
drop function if exists app.claim_due_notifications(interval, interval);

create or replace function app.claim_due_notifications(
  p_grace          interval default '20 minutes',  -- stage 1's own fire window, unchanged
  p_retry          interval default '4 minutes',   -- delivery-failure retry backoff, unchanged
  p_followup       interval default '45 minutes',  -- how long to wait before the one follow-up
  p_followup_grace interval default '20 minutes'   -- how long the follow-up stays eligible
) returns table (
  subscription_id uuid, endpoint text, p256dh text, auth_key text, slot_label text,
  household_id uuid, local_date date, slot_id uuid, slot_time time, stage smallint
)
language sql volatile security definer set search_path = '' as $$
  with hh as (
    select h.id, h.timezone, (now() at time zone h.timezone)::date as today from public.households h
  ),
  cand as (
    select hh.id as household_id, hh.timezone, d.local_date
      from hh cross join lateral (values (hh.today), (hh.today - 1)) as d(local_date)
  ),
  due_slots as (
    select c.household_id, c.local_date, c.timezone, sl.id as slot_id, sl.label,
           coalesce(min(sc.time), sl.time) as fire_time
      from cand c
      join public.schedules sc on sc.household_id = c.household_id and sc.active
      join public.slots sl on sl.id = sc.slot_id and sl.household_id = sc.household_id and not sl.archived
      join public.medicines m on m.id = sc.medicine_id and m.household_id = sc.household_id and not m.archived
     where app.is_due(sc.freq_type, sc.freq_interval, sc.freq_days_of_week, sc.freq_anchor_date, c.local_date)
     group by c.household_id, c.local_date, c.timezone, sl.id, sl.label, sl.time
  ),
  -- Not time-windowed here on purpose -- "is this slot still unlogged" doesn't
  -- depend on which stage or window is asking, so both stages share this check.
  unlogged as (
    select d.* from due_slots d
     where exists (
       select 1 from public.schedules sc
         join public.medicines m on m.id = sc.medicine_id and m.household_id = sc.household_id and not m.archived
        where sc.household_id = d.household_id and sc.slot_id = d.slot_id and sc.active
          and app.is_due(sc.freq_type, sc.freq_interval, sc.freq_days_of_week, sc.freq_anchor_date, d.local_date)
          and not exists (
            select 1 from public.dose_log dl
             where dl.household_id = d.household_id and dl.local_date = d.local_date
               and dl.slot_id = d.slot_id and dl.medicine_id = sc.medicine_id)
     )
  ),
  stage1 as (
    select u.*, 1::smallint as stage
      from unlogged u
     where now() >= ((u.local_date + u.fire_time) at time zone u.timezone)
       and now() <  ((u.local_date + u.fire_time) at time zone u.timezone) + p_grace
  ),
  -- A slot only becomes stage-2 eligible once stage 1 has an actual sent_at --
  -- a slot whose stage-1 reminder was never sent (reminders were off, the
  -- slot's time already passed before they were turned on, etc.) has no
  -- first message to follow up on, so it never gets a stage-2 either.
  stage1_sent as (
    select household_id, local_date, slot_id, slot_time, sent_at
      from app.notification_sends
     where stage = 1 and sent_at is not null
  ),
  stage2 as (
    select u.*, 2::smallint as stage
      from unlogged u
      join stage1_sent s1
        on s1.household_id = u.household_id and s1.local_date = u.local_date
       and s1.slot_id = u.slot_id and s1.slot_time = u.fire_time
     where now() >= s1.sent_at + p_followup
       and now() <  s1.sent_at + p_followup + p_followup_grace
  ),
  fired as (
    select * from stage1
    union all
    select * from stage2
  ),
  claimed as (
    insert into app.notification_sends (household_id, local_date, slot_id, slot_time, stage, attempts)
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
                 and f.local_date = c.local_date and f.fire_time = c.slot_time and f.stage = c.stage
    join public.push_subscriptions ps
      on ps.household_id = c.household_id and ps.disabled_at is null and ps.notify_due;
$$;

-- ============================================================
-- 3. mark_notification_sent needs to know which stage it's marking
-- ============================================================
drop function if exists app.mark_notification_sent(uuid, date, uuid, time);

create or replace function app.mark_notification_sent(
  p_household uuid, p_date date, p_slot uuid, p_time time, p_stage smallint default 1
) returns void
language sql volatile security definer set search_path = '' as $$
  update app.notification_sends set sent_at = now()
   where household_id = p_household and local_date = p_date and slot_id = p_slot
     and slot_time = p_time and stage = p_stage;
$$;
