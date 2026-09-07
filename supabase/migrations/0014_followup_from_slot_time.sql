-- Stage 2 becomes "one hour after the slot", not "45 minutes after the first
-- message was delivered".
--
-- Three changes, and the first one reverses a decision 0004 made on purpose,
-- so it is spelled out rather than left to be rediscovered:
--
-- 1. STAGE 2 NO LONGER REQUIRES STAGE 1 TO HAVE BEEN SENT.
--
--    0004 said: "A slot only becomes stage-2 eligible once stage 1 has an
--    actual sent_at -- a slot whose stage-1 reminder was never sent has no
--    first message to follow up on, so it never gets a stage-2 either."
--
--    That is tidy and it is wrong for the case that actually happens. Someone
--    installs the app, taps through Settings, and turns reminders on at 09:05.
--    Their 09:00 slot has already passed its grace window, so stage 1 never
--    fires -- and under 0004's rule stage 2 never fires either, so their first
--    day produces no reminder at all for a dose sitting unmarked. The
--    `stage1_sent` CTE and its join are deleted. If you are tempted to
--    restore them as a bug fix: this is the bug.
--
-- 2. THE ANCHOR MOVES FROM sent_at TO THE SLOT'S OWN TIME.
--
--    Anchoring on delivery meant the follow-up inherited stage 1's lateness --
--    a reminder that went out at 09:12 pushed the follow-up to 09:57. The
--    slot's time is the thing the person actually has in their head, and it
--    does not drift.
--
-- 3. A CUTOFF, SO A LATE SLOT DOES NOT CHASE PAST BEDTIME.
--
--    A 23:00 slot would otherwise follow up at midnight -- on the next
--    calendar day, for a dose belonging to yesterday. Any stage 2 landing at
--    or after `nightly_summary_time` is dropped, because the nightly catch-all
--    (0015) covers that slot a few minutes later anyway.
--
-- Also here: `p_grace` 20 -> 30 minutes. Android's Doze can hold a push for
-- longer than twenty minutes on an idle phone, and a reminder skipped
-- entirely is worse than one arriving late. See the invariant note in 0013
-- before raising it further.

-- ============================================================
-- 1. The "is anything in this slot still unmarked" test, extracted
-- ============================================================
-- Was an inline CTE used twice inside claim_due_notifications. The nightly
-- summary (0015) needs the identical question asked of a whole day, which
-- would have made three copies of it -- and three copies of a predicate this
-- fiddly drift. One definition, three callers.
--
-- "Unmarked" means no dose_log row at all. A row with status 'skipped' counts
-- as marked: deciding not to take something is an answer, and chasing it
-- would be the app arguing with a decision the person already made.
create or replace function app.unlogged_slots(p_household uuid, p_date date)
returns table (slot_id uuid, label text, fire_time time)
language sql stable security definer set search_path = '' as $$
  with due_slots as (
    select sl.id as slot_id, sl.label,
           -- A medicine may override its slot's time; the slot fires at the
           -- earliest such override, else at its own time.
           coalesce(min(sc.time), sl.time) as fire_time
      from public.schedules sc
      join public.slots sl
        on sl.id = sc.slot_id and sl.household_id = sc.household_id and not sl.archived
      join public.medicines m
        on m.id = sc.medicine_id and m.household_id = sc.household_id and not m.archived
     where sc.household_id = p_household and sc.active
       and app.is_due(sc.freq_type, sc.freq_interval, sc.freq_days_of_week,
                      sc.freq_anchor_date, p_date)
     group by sl.id, sl.label, sl.time
  )
  select d.slot_id, d.label, d.fire_time
    from due_slots d
   where exists (
     select 1 from public.schedules sc
       join public.medicines m
         on m.id = sc.medicine_id and m.household_id = sc.household_id and not m.archived
      where sc.household_id = p_household and sc.slot_id = d.slot_id and sc.active
        and app.is_due(sc.freq_type, sc.freq_interval, sc.freq_days_of_week,
                       sc.freq_anchor_date, p_date)
        and not exists (
          select 1 from public.dose_log dl
           where dl.household_id = p_household and dl.local_date = p_date
             and dl.slot_id = d.slot_id and dl.medicine_id = sc.medicine_id)
   );
$$;

revoke all on function app.unlogged_slots(uuid, date) from public, anon, authenticated;

-- ============================================================
-- 2. claim_due_notifications, rebuilt
-- ============================================================
-- p_followup leaves the signature -- the value comes from the household row
-- now. A changed parameter list is a different function to Postgres, so
-- CREATE OR REPLACE would leave the old four-argument version sitting
-- alongside the new one; the same trap 0004 documents.
drop function if exists app.claim_due_notifications(interval, interval, interval, interval);

create or replace function app.claim_due_notifications(
  p_grace          interval default '30 minutes',  -- stage 1's fire window
  p_retry          interval default '4 minutes',   -- delivery-failure backoff
  p_followup_grace interval default '20 minutes'   -- how long stage 2 stays eligible
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
  -- Yesterday stays a candidate so a slot late in the evening is still
  -- reachable after the household's midnight. The stage-2 cutoff below is
  -- what stops that from producing a follow-up at 00:15.
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
       -- The cutoff. Note it tests the moment the follow-up WOULD fire, not
       -- `now()`: a slot whose follow-up falls after the nightly summary is
       -- never eligible at all, rather than eligible-until-23:50.
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
      on ps.household_id = c.household_id and ps.disabled_at is null and ps.notify_due;
$$;

-- ============================================================
-- 3. The public wrapper takes no arguments at all
-- ============================================================
-- 0009 mirrored all four defaults here and then passed them positionally on
-- every call, while its own comment claimed it "passes nothing it was not
-- given". It did, always -- so editing a default in app.* had no effect
-- whatsoever, because this wrapper's copy of it always won. That is a
-- genuinely nasty failure: the migration looks applied and nothing changes.
--
-- A zero-argument wrapper cannot have that bug. send-reminders calls it with
-- no arguments anyway, and app.* is now the only place the intervals are
-- written down.
drop function if exists public.claim_due_notifications(interval, interval, interval, interval);

create or replace function public.claim_due_notifications()
returns table (
  subscription_id uuid, endpoint text, p256dh text, auth_key text, slot_label text,
  household_id uuid, local_date date, slot_id uuid, slot_time time, stage smallint
)
language sql volatile security definer set search_path = '' as $$
  select * from app.claim_due_notifications();
$$;

-- Not anon, not authenticated: this hands back push endpoints and their
-- encryption keys for every household with something due.
revoke all on function public.claim_due_notifications() from public, anon, authenticated;
grant execute on function public.claim_due_notifications() to service_role;
