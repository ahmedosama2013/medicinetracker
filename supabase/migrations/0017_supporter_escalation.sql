-- Stage 3: if a slot is still unmarked a while after the elder's own stage-2
-- follow-up, a supporter who opted in gets pinged. Independent of whether the
-- elder has push turned on at all -- this only reads slot_time and
-- households.followup_after, both plain schedule data.

-- ============================================================
-- 1. Its own dedup table, keyed by SUBSCRIPTION not household
-- ============================================================
-- This is the one place this feature departs from the shape of
-- notification_sends / daily_summary_sends. Two supporters on the same
-- household can each set their own escalation_after (30m/1h/2h/3h), so the
-- same slot becomes eligible at two different real timestamps for two
-- different subscribers. A household-keyed table could only remember one
-- claim per slot and would silently starve whichever supporter's window
-- opened second. Keying by subscription_id gives each subscriber an
-- independent timeline for the same underlying slot.
create table app.escalation_sends (
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  household_id    uuid not null references public.households(id) on delete cascade,
  local_date      date not null,
  slot_id         uuid not null,
  slot_time       time not null,
  claimed_at      timestamptz not null default now(),
  sent_at         timestamptz,
  attempts        int not null default 0,
  primary key (subscription_id, local_date, slot_id, slot_time)
);

create index escalation_sends_unsent_idx
  on app.escalation_sends (claimed_at) where sent_at is null;

-- ============================================================
-- 2. Claim
-- ============================================================
create or replace function app.claim_supporter_escalations(
  p_window interval default '20 minutes',  -- how long an escalation stays eligible
  p_retry  interval default '4 minutes'    -- delivery-failure backoff
) returns table (
  subscription_id uuid, endpoint text, p256dh text, auth_key text, slot_label text,
  household_id uuid, local_date date, slot_id uuid, slot_time time, elder_name text
)
language sql volatile security definer set search_path = '' as $$
  with sup as (
    -- Every opted-in supporter subscription, each carrying its own delay.
    select ps.id as subscription_id, ps.endpoint, ps.p256dh, ps.auth_key,
           ps.escalation_after, ps.household_id
      from public.push_subscriptions ps
     where ps.role = 'supporter' and ps.disabled_at is null and ps.notify_due
  ),
  hh as (
    select h.id, h.timezone, h.followup_after, h.display_name,
           (now() at time zone h.timezone)::date as today
      from public.households h
  ),
  -- Yesterday stays a candidate for the same reason it does in
  -- claim_due_notifications: a slot late in the evening, plus a 2-3 hour
  -- escalation delay, can cross the household's local midnight.
  cand as (
    select s.subscription_id, s.endpoint, s.p256dh, s.auth_key, s.escalation_after,
           h.id as household_id, h.timezone, h.followup_after, h.display_name, d.local_date
      from sup s
      join hh h on h.id = s.household_id
      cross join lateral (values (h.today), (h.today - 1)) as d(local_date)
  ),
  eligible as (
    select c.*, u.slot_id, u.label, u.fire_time
      from cand c
      cross join lateral app.unlogged_slots(c.household_id, c.local_date) u
     where now() >= ((c.local_date + u.fire_time) at time zone c.timezone)
                     + c.followup_after + c.escalation_after
       and now() <  ((c.local_date + u.fire_time) at time zone c.timezone)
                     + c.followup_after + c.escalation_after + p_window
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

create or replace function app.mark_supporter_escalation_sent(
  p_subscription_id uuid, p_date date, p_slot uuid, p_time time
) returns void
language sql volatile security definer set search_path = '' as $$
  update app.escalation_sends set sent_at = now()
   where subscription_id = p_subscription_id and local_date = p_date
     and slot_id = p_slot and slot_time = p_time;
$$;

-- ============================================================
-- 3. Public wrappers, service_role only
-- ============================================================
-- Same reasoning as every prior claim function: this hands back live push
-- endpoints and their encryption keys, so it must never be reachable by
-- anon or authenticated. Zero-argument, for the same reason 0014's rewrite
-- of claim_due_notifications is zero-argument -- send-reminders always calls
-- it with no arguments, and a wrapper that mirrors defaults it never uses is
-- exactly the trap 0009/0014 already document.
create or replace function public.claim_supporter_escalations()
returns table (
  subscription_id uuid, endpoint text, p256dh text, auth_key text, slot_label text,
  household_id uuid, local_date date, slot_id uuid, slot_time time, elder_name text
)
language sql volatile security definer set search_path = '' as $$
  select * from app.claim_supporter_escalations();
$$;

create or replace function public.mark_supporter_escalation_sent(
  p_subscription_id uuid, p_date date, p_slot uuid, p_time time
) returns void
language sql volatile security definer set search_path = '' as $$
  select app.mark_supporter_escalation_sent(p_subscription_id, p_date, p_slot, p_time);
$$;

revoke all on function app.claim_supporter_escalations(interval, interval),
                       app.mark_supporter_escalation_sent(uuid, date, uuid, time)
  from public, anon, authenticated;

revoke all on function public.claim_supporter_escalations(),
                       public.mark_supporter_escalation_sent(uuid, date, uuid, time)
  from public, anon, authenticated;

grant execute on function public.claim_supporter_escalations(),
                          public.mark_supporter_escalation_sent(uuid, date, uuid, time)
  to service_role;
